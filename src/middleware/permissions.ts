import { Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'
import { AuthRequest } from './auth'

// In-memory permission cache with TTL
const permCache = new Map<string, { value: boolean; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min max TTL (safety net)

// Subscribe to Supabase Realtime for live cache invalidation
supabase
  .channel('permissions_updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'permisos_usuario' }, (payload) => {
    const userId = (payload.new as any)?.usuario_id || (payload.old as any)?.usuario_id
    if (userId) invalidateUserCache(userId)
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'permisos_base' }, () => {
    permCache.clear() // role-level change — clear all
  })
  .subscribe()

function invalidateUserCache(userId: string) {
  for (const key of permCache.keys()) {
    if (key.startsWith(`${userId}:`)) permCache.delete(key)
  }
}

async function hasPermission(
  userId: string,
  rolId: number,
  modulo: string,
  accion: string
): Promise<boolean> {
  const cacheKey = `${userId}:${modulo}:${accion}`
  const cached = permCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  // Check individual override first, then role default
  const { data: override } = await supabase
    .from('permisos_usuario')
    .select('habilitado')
    .eq('usuario_id', userId)
    .eq('modulo', modulo)
    .eq('accion', accion)
    .maybeSingle()

  let result: boolean
  if (override !== null) {
    result = override.habilitado
  } else {
    const { data: base } = await supabase
      .from('permisos_base')
      .select('habilitado')
      .eq('rol_id', rolId)
      .eq('modulo', modulo)
      .eq('accion', accion)
      .maybeSingle()
    result = base?.habilitado ?? false
  }

  permCache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

export function checkPermission(modulo: string, accion: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' })

    // Mock users (dev) and Creador (nivel 1) bypass all permission checks
    if (req.user.isMock || req.user.rol_nivel === 1) return next()

    const allowed = await hasPermission(req.user.id, req.user.rol_id, modulo, accion)
    if (!allowed) return res.status(403).json({ error: 'FORBIDDEN', modulo, accion })

    next()
  }
}
