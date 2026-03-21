import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

const schema = z.object({
  nombre:          z.string().min(2).max(200),
  contacto_nombre: z.string().optional(),
  contacto_tel:    z.string().optional(),
  contacto_email:  z.string().email().optional(),
  notas:           z.string().optional(),
})

router.get('/', requireAuth, checkPermission('proveedores', 'VER'), async (_req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase.from('proveedores').select('*').eq('activo', true).order('nombre')
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/', requireAuth, checkPermission('proveedores', 'CREAR'), auditLog('proveedores', 'CREAR'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    const { data, error } = await supabase.from('proveedores').insert(parsed.data).select().single()
    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.patch('/:id', requireAuth, checkPermission('proveedores', 'EDITAR'), auditLog('proveedores', 'EDITAR'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    const { error } = await supabase.from('proveedores').update(parsed.data).eq('id', req.params.id)
    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Proveedor actualizado' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
