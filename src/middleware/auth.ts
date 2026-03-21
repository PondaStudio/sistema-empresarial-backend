import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    rol_id: number
    rol_nivel: number
    sucursal_id: string | null
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
  if (token.startsWith('mock-token-nivel-') && process.env.NODE_ENV !== 'production') {
    const nivel = parseInt(token.replace('mock-token-nivel-', ''), 10)
    req.user = {
      id: 'mock-user',
      email: 'mock@dev.local',
      rol_id: 0,
      rol_nivel: isNaN(nivel) ? 99 : nivel,
      sucursal_id: null,
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
