import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

const avisosSchema = z.object({
  titulo:      z.string().min(3).max(200),
  contenido:   z.string().min(5),
  tipo:        z.enum(['info', 'alerta', 'urgente']).default('info'),
  fijado:      z.boolean().default(false),
  sucursal_id: z.string().uuid().optional(),
  expires_at:  z.string().datetime().optional(),
})

router.get('/', requireAuth, checkPermission('avisos', 'VER'), async (_req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('avisos')
    .select('*, creado_por_user:usuarios!creado_por(nombre)')
    .eq('activo', true)
    .order('fijado', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

router.post('/', requireAuth, checkPermission('avisos', 'CREAR'), auditLog('avisos', 'CREAR'), async (req: AuthRequest, res: Response) => {
  const parsed = avisosSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { data, error } = await supabase.from('avisos').insert({
    ...parsed.data,
    creado_por: req.user!.id,
  }).select().single()

  if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
  return res.status(201).json(data)
})

router.patch('/:id', requireAuth, checkPermission('avisos', 'EDITAR'), async (req: AuthRequest, res: Response) => {
  const allowed = ['titulo', 'contenido', 'tipo', 'fijado', 'activo', 'expires_at']
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const { error } = await supabase.from('avisos').update(updates).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Aviso actualizado' })
})

router.delete('/:id', requireAuth, checkPermission('avisos', 'ELIMINAR'), async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('avisos').update({ activo: false }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: 'DELETE_FAILED' })
  return res.json({ message: 'Aviso eliminado' })
})

export default router
