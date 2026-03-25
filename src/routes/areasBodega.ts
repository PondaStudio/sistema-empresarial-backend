import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    let query = supabase
      .from('areas_bodega')
      .select('id, nombre, sucursal_id')
      .order('nombre')

    if (req.user!.sucursal_id) {
      query = query.eq('sucursal_id', req.user!.sucursal_id)
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR', detail: error.message })
    return res.json(data ?? [])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
