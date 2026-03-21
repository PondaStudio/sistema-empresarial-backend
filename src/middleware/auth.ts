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

  // Bypass para tokens mock: formato mock-token-nivel-{N}-uid-{uuid}
  if (token.startsWith('mock-token-nivel-')) {
    // Parsear nivel y uid del token
    const uidSplit = token.split('-uid-')
    const nivel = parseInt(uidSplit[0].replace('mock-token-nivel-', ''), 10)
    const tokenUid = uidSplit[1] ?? null

    // Mapeo nivel → ID real de usuario de prueba en Supabase (fallback)
    const MOCK_USER_IDS: Record<number, { id: string; email: string }> = {
      1:  { id: 'aec92e91-16db-411b-bab5-2fd1e706d610', email: 'pondaxems@gmail.com' },
      2:  { id: 'b324c97a-a1cb-4f47-b29b-efd7f30f5373', email: 'gerente@empresa.com' },
      3:  { id: '5d8c6406-e8a1-45e2-a4a8-d2f6234af9a5', email: 'dueno@empresa.com' },
      4:  { id: '6b1422ab-5273-4b43-b78a-fd389f59cf18', email: 'familiar@empresa.com' },
      5:  { id: '4cd57c7f-33b4-4a4d-b219-4ac967f184a1', email: 'admg2@empresa.com' },
      6:  { id: '8a079946-b8c8-41e7-a52e-50efe21e9e71', email: 'encargado@empresa.com' },
      7:  { id: '343067c0-5e23-4e22-bce4-ff6f487375e3', email: 'admg1@empresa.com' },
      8:  { id: 'bb634c06-9920-4ff8-8cc6-e0cd22757af8', email: 'cajera@empresa.com' },
      9:  { id: 'd99b43d7-134f-4878-891f-34f539626758', email: 'almacenista@empresa.com' },
      10: { id: '45a6c286-7ba6-4425-91d9-5e8fd108db9e', email: 'vendedora@empresa.com' },
      11: { id: '3d330838-ba39-4fed-97a6-d9521327ea6a', email: 'promotor@empresa.com' },
    }

    const mapped = MOCK_USER_IDS[isNaN(nivel) ? -1 : nivel]

    req.user = {
      id:          tokenUid ?? mapped?.id ?? 'mock-user',
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
