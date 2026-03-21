import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

// GET /api/subfunciones — devuelve registros agrupados por módulo
export async function listSubfunciones(_req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('subfunciones')
      .select('id, modulo, slug, nombre, orden')
      .order('modulo')
      .order('orden')

    if (error) return res.status(500).json({ error: 'DB_ERROR', detail: error.message })

    const grouped: Record<string, typeof data> = {}
    for (const row of data ?? []) {
      if (!grouped[row.modulo]) grouped[row.modulo] = []
      grouped[row.modulo]!.push(row)
    }

    return res.json(grouped)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// GET /permisos-granulares/:userId
// Devuelve permisos del usuario: overrides individuales + defaults del rol, mergeados
export async function getUserPermisosGranulares(req: AuthRequest, res: Response) {
  try {
    if (req.user!.rol_nivel !== 1) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el Creador puede ver permisos granulares' })
    }

    const { userId } = req.params

    const { data: targetUser } = await supabase
      .from('usuarios')
      .select('rol_id')
      .eq('id', userId)
      .single()

    if (!targetUser) return res.status(404).json({ error: 'USER_NOT_FOUND' })

    const [{ data: rolPermisos }, { data: userPermisos }] = await Promise.all([
      supabase
        .from('permisos_subfuncion_rol')
        .select('subfuncion_id, nivel')
        .eq('rol_id', targetUser.rol_id),
      supabase
        .from('permisos_subfuncion_usuario')
        .select('subfuncion_id, nivel')
        .eq('usuario_id', userId),
    ])

    // Merge: overrides individuales tienen precedencia sobre rol base
    const merged: Record<string, { nivel: number; fuente: 'usuario' | 'rol' }> = {}

    for (const p of rolPermisos ?? []) {
      merged[p.subfuncion_id] = { nivel: p.nivel, fuente: 'rol' }
    }
    for (const p of userPermisos ?? []) {
      merged[p.subfuncion_id] = { nivel: p.nivel, fuente: 'usuario' }
    }

    return res.json(merged)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

const saveSchema = z.object({
  permisos: z.array(z.object({
    subfuncion_id: z.string().uuid(),
    nivel:         z.number().int().min(0).max(2),
  })).min(1),
})

// PUT /permisos-granulares/:userId
export async function saveUserPermisosGranulares(req: AuthRequest, res: Response) {
  try {
    if (req.user!.rol_nivel !== 1) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el Creador puede modificar permisos granulares' })
    }

    const { userId } = req.params

    const parsed = saveSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    }

    const upserts = parsed.data.permisos.map(p => ({
      usuario_id:    userId,
      subfuncion_id: p.subfuncion_id,
      nivel:         p.nivel,
      created_by:    req.user!.id,
      updated_at:    new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('permisos_subfuncion_usuario')
      .upsert(upserts, { onConflict: 'usuario_id,subfuncion_id' })

    if (error) return res.status(500).json({ error: 'SAVE_FAILED', detail: error.message })
    return res.json({ message: `${upserts.length} permiso(s) guardado(s)` })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// DELETE /permisos-granulares/:userId/reset
export async function resetUserPermisosGranulares(req: AuthRequest, res: Response) {
  try {
    if (req.user!.rol_nivel !== 1) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el Creador puede resetear permisos' })
    }

    const { userId } = req.params

    const { error } = await supabase
      .from('permisos_subfuncion_usuario')
      .delete()
      .eq('usuario_id', userId)

    if (error) return res.status(500).json({ error: 'RESET_FAILED', detail: error.message })
    return res.json({ message: 'Permisos individuales eliminados. El usuario usará los defaults de su rol.' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}
