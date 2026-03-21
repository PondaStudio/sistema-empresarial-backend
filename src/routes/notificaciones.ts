import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

// GET mis notificaciones (últimas 50)
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('notificaciones')
      .select('*')
      .eq('usuario_id', req.user!.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// GET conteo sin leer
router.get('/unread-count', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { count, error } = await supabase
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', req.user!.id)
      .eq('leida', false)

    if (error) return res.json({ count: 0 })
    return res.json({ count: count ?? 0 })
  } catch {
    return res.json({ count: 0 })
  }
})

// PATCH marcar como leída
router.patch('/:id/leer', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', req.params.id)
      .eq('usuario_id', req.user!.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Notificación leída' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// PATCH marcar todas como leídas
router.patch('/leer-todas', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true })
      .eq('usuario_id', req.user!.id)
      .eq('leida', false)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Todas leídas' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// DELETE eliminar notificación
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabase
      .from('notificaciones')
      .delete()
      .eq('id', req.params.id)
      .eq('usuario_id', req.user!.id)

    if (error) return res.status(500).json({ error: 'DELETE_FAILED' })
    return res.json({ message: 'Eliminada' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
