import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

// GET mis notificaciones (últimas 50)
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('notificaciones')
    .select('*')
    .eq('usuario_id', req.user!.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

// GET conteo sin leer
router.get('/unread-count', requireAuth, async (req: AuthRequest, res: Response) => {
  const { count, error } = await supabase
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', req.user!.id)
    .eq('leida', false)

  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json({ count: count ?? 0 })
})

// PATCH marcar como leída
router.patch('/:id/leer', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('notificaciones')
    .update({ leida: true })
    .eq('id', req.params.id)
    .eq('usuario_id', req.user!.id)

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Notificación leída' })
})

// PATCH marcar todas como leídas
router.patch('/leer-todas', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('notificaciones')
    .update({ leida: true })
    .eq('usuario_id', req.user!.id)
    .eq('leida', false)

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Todas leídas' })
})

// DELETE eliminar notificación
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('notificaciones')
    .delete()
    .eq('id', req.params.id)
    .eq('usuario_id', req.user!.id)

  if (error) return res.status(500).json({ error: 'DELETE_FAILED' })
  return res.json({ message: 'Eliminada' })
})

export default router
