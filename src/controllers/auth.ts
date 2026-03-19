import { Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const inviteSchema = z.object({
  email:       z.string().email(),
  nombre:      z.string().min(2).max(200),
  rol_id:      z.string().uuid(),
  sucursal_id: z.string().uuid().optional(),
})

export async function invite(req: AuthRequest, res: Response) {
  if (req.user?.rol_nivel !== 1) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el Creador puede invitar usuarios' })
  }

  const parsed = inviteSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { email, nombre, rol_id, sucursal_id } = parsed.data

  // Create auth user via Supabase admin API
  const { data: authUser, error: authError } = await supabase.auth.admin.inviteUserByEmail(email)
  if (authError) return res.status(400).json({ error: 'INVITE_FAILED', message: authError.message })

  // Create profile
  const { error: profileError } = await supabase.from('usuarios').insert({
    id: authUser.user.id,
    nombre,
    email,
    rol_id,
    sucursal_id: sucursal_id ?? null,
  })

  if (profileError) {
    await supabase.auth.admin.deleteUser(authUser.user.id)
    return res.status(500).json({ error: 'PROFILE_CREATE_FAILED' })
  }

  return res.status(201).json({ message: 'Invitación enviada', userId: authUser.user.id })
}

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { email, password } = parsed.data

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ error: 'INVALID_CREDENTIALS' })

  const { data: profile } = await supabase
    .from('usuarios')
    .select('id, nombre, email, estado_presencia, foto_url, rol_id, sucursal_id, roles(nivel, nombre)')
    .eq('id', data.user.id)
    .single()

  return res.json({
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
    user: profile,
  })
}

export async function logout(req: AuthRequest, res: Response) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) await supabase.auth.admin.signOut(token)
  return res.json({ message: 'Sesión cerrada' })
}

export async function me(req: AuthRequest, res: Response) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nombre, email, estado_presencia, foto_url, rol_id, sucursal_id, activo, roles(nivel, nombre), sucursales(nombre)')
    .eq('id', req.user!.id)
    .single()

  if (error) return res.status(404).json({ error: 'USER_NOT_FOUND' })
  return res.json(data)
}
