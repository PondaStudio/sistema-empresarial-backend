import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../middleware/auth'

const router = Router()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

router.get('/', requireAuth, async (_req, res) => {
  const { data, error } = await supabase
    .from('roles')
    .select('id, nombre, nivel, descripcion')
    .order('nivel')
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

export default router
