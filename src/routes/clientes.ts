import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

router.get('/', requireAuth, checkPermission('clientes', 'VER'), async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query as Record<string, string>
    let query = supabase
      .from('clientes_frecuentes')
      .select('*, domicilios_cliente(*), datos_fiscales_cliente(*)')
      .order('nombre')
    if (q) query = query.ilike('nombre', `%${q}%`)
    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/', requireAuth, checkPermission('clientes', 'CREAR'), auditLog('clientes', 'CREAR'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      nombre: z.string().min(2).max(200),
      telefono: z.string().optional(),
      email: z.string().email().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    const { data, error } = await supabase.from('clientes_frecuentes').insert(parsed.data).select().single()
    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/:id/domicilios', requireAuth, checkPermission('clientes', 'EDITAR'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      tipo: z.enum(['casa', 'oficina', 'bodega', 'otro']).default('casa'),
      direccion: z.string().min(5),
      predeterminado: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    const { data, error } = await supabase.from('domicilios_cliente').insert({ ...parsed.data, cliente_id: req.params.id }).select().single()
    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.put('/:id/datos-fiscales', requireAuth, checkPermission('facturacion', 'EDITAR'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      rfc: z.string().min(12).max(13),
      razon_social: z.string().min(2),
      direccion_fiscal: z.string().optional(),
      regimen_fiscal: z.string().optional(),
      uso_cfdi: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    const { data, error } = await supabase.from('datos_fiscales_cliente')
      .upsert({ ...parsed.data, cliente_id: req.params.id }, { onConflict: 'cliente_id' })
      .select().single()
    if (error) return res.status(500).json({ error: 'UPSERT_FAILED' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
