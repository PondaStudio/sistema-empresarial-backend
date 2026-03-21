import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

export async function getMe(req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, numero_agente, foto_url, estado_presencia, activo, rol_id, sucursal_id, roles(id, nombre, nivel), sucursales(nombre)')
      .eq('id', req.user!.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'USER_NOT_FOUND' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

const meSchema = z.object({
  numero_agente:    z.string().max(20).optional(),
  foto_url:         z.string().url().optional(),
  estado_presencia: z.enum(['disponible', 'ocupado', 'comiendo', 'no_disponible', 'ausente']).optional(),
})

export async function updateMe(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id
    console.error('[updateMe] req.user.id =', userId, '| isMock =', (req.user as any)?.isMock)

    if (!userId || userId === 'mock-user') {
      return res.status(400).json({
        error: 'MOCK_USER',
        message: 'El usuario mock no tiene un ID real en base de datos. Inicia sesión con cuenta real para guardar cambios.',
      })
    }

    const parsed = meSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: 'NO_FIELDS', message: 'Envía al menos un campo para actualizar' })
    }

    const { error, data } = await supabase.from('usuarios').update(parsed.data).eq('id', userId).select('id').single()
    if (error || !data) {
      console.error('[updateMe] supabase error:', error)
      return res.status(500).json({ error: 'UPDATE_FAILED', detail: error?.message ?? 'Registro no encontrado' })
    }

    return res.json({ message: 'Perfil actualizado' })
  } catch (err) {
    console.error('[updateMe] exception:', err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

export async function listUsers(req: AuthRequest, res: Response) {
  try {
    let query = supabase
      .from('usuarios')
      .select('id, nombre, email, estado_presencia, foto_url, activo, rol_id, sucursal_id, roles(nivel, nombre), sucursales(nombre)')
      .eq('activo', true)
      .order('nombre')

    // Non-superusers only see their sucursal
    if (req.user!.rol_nivel >= 5 && req.user!.sucursal_id) {
      query = query.eq('sucursal_id', req.user!.sucursal_id)
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

const profileSchema = z.object({
  foto_url:         z.string().url().optional(),
  estado_presencia: z.enum(['disponible','ocupado','comiendo','no_disponible','ausente']).optional(),
})

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params

    // Users can only update their own profile fields
    if (id !== req.user!.id && req.user!.rol_nivel > 4) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const parsed = profileSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { error } = await supabase.from('usuarios').update(parsed.data).eq('id', id)
    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

    return res.json({ message: 'Perfil actualizado' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

const adminSchema = z.object({
  nombre:      z.string().min(2).max(200).optional(),
  rol_id:      z.string().uuid().optional(),
  sucursal_id: z.string().uuid().nullable().optional(),
  activo:      z.boolean().optional(),
})

export async function updateAdmin(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params

    // Prevent modifying users of equal or higher rank
    const { data: target } = await supabase
      .from('usuarios')
      .select('rol_id, roles(nivel)')
      .eq('id', id)
      .single()

    const targetNivel = (target as any)?.roles?.nivel ?? 0
    if (targetNivel <= req.user!.rol_nivel) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'No puedes modificar usuarios de igual o mayor rango' })
    }

    const parsed = adminSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { error } = await supabase.from('usuarios').update(parsed.data).eq('id', id)
    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

    return res.json({ message: 'Usuario actualizado' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}
