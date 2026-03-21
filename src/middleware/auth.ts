import { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    rol_id: number
    rol_nivel: number
    sucursal_id: string | null
    isMock?: boolean
  }
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'TOKEN_MISSING' })
  }

  // Bypass para tokens mock en desarrollo
  if (token.startsWith('mock-token-nivel-')) {
    const nivel = parseInt(token.replace('mock-token-nivel-', ''), 10)

    // Mapeo nivel → ID real de usuario de prueba en Supabase
    const MOCK_USER_IDS: Record<number, { id: string; email: string }> = {
      1:  { id: 'aec92e91-16db-411b-bab5-2fd1e706d610', email: 'pondaxems@dev.local' },
      2:  { id: 'b324c97a-a1cb-4f47-b29b-efd7f30f5373', email: 'gerente@dev.local' },
      8:  { id: 'bb634c06-9920-4ff8-8cc6-e0cd22757af8', email: 'cajera@dev.local' },
      9:  { id: 'd99b43d7-134f-4878-891f-34f539626758', email: 'almacenista@dev.local' },
      10: { id: '45a6c286-7ba6-4425-91d9-5e8fd108db9e', email: 'vendedora@dev.local' },
    }

    // También acepta X-Mock-User-Id para override manual
    const headerUserId = req.headers['x-mock-user-id'] as string | undefined
    const mapped = MOCK_USER_IDS[isNaN(nivel) ? -1 : nivel]

    req.user = {
      id:          headerUserId ?? mapped?.id ?? 'mock-user',
      email:       mapped?.email ?? 'mock@dev.local',
      rol_id:      0,
      rol_nivel:   isNaN(nivel) ? 99 : nivel,
      sucursal_id: null,
      isMock:      true,
    }
    return next()
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    return res.status(401).json({ error: 'TOKEN_INVALID' })
  }

  // Fetch user profile with role info
  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('id, email, rol_id, roles(nivel), sucursal_id')
    .eq('id', data.user.id)
    .single()

  if (profileError || !profile) {
    return res.status(401).json({ error: 'USER_NOT_FOUND' })
  }

  req.user = {
    id: profile.id,
    email: profile.email,
    rol_id: profile.rol_id,
    rol_nivel: (profile as any).roles?.nivel ?? 99,
    sucursal_id: profile.sucursal_id,
  }

  next()
}
