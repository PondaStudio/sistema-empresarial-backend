import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

router.get('/', requireAuth, checkPermission('bitacora', 'VER'), async (req: AuthRequest, res: Response) => {
  try {
    const { modulo, accion, usuario_id, desde, hasta, page = '1' } = req.query as Record<string, string>

    const PAGE_SIZE = 50
    const offset = (parseInt(page) - 1) * PAGE_SIZE

    let query = supabase
      .from('bitacora_actividad')
      .select('*, usuarios!usuario_id(nombre, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (modulo)     query = query.eq('modulo', modulo)
    if (accion)     query = query.eq('accion', accion)
    if (usuario_id) query = query.eq('usuario_id', usuario_id)
    if (desde)      query = query.gte('created_at', desde)
    if (hasta)      query = query.lte('created_at', hasta)

    const { data, count, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })

    return res.json({ data, total: count, page: parseInt(page), page_size: PAGE_SIZE })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
