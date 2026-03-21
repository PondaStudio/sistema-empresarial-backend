import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

const evalSchema = z.object({
  empleado_id:         z.string().uuid(),
  periodo:             z.string().min(4).max(20),
  puntaje_puntualidad: z.number().min(0).max(10),
  puntaje_calidad:     z.number().min(0).max(10),
  puntaje_actitud:     z.number().min(0).max(10),
  comentarios:         z.string().optional(),
})

router.get('/', requireAuth, checkPermission('evaluaciones', 'VER'), async (req: AuthRequest, res: Response) => {
  try {
    const { periodo, empleado_id } = req.query as Record<string, string>
    let query = supabase
      .from('evaluaciones')
      .select('*, empleado:empleados(id, usuarios(nombre)), evaluador:usuarios!evaluador_id(nombre)')
      .order('created_at', { ascending: false })

    if (periodo)     query = query.eq('periodo', periodo)
    if (empleado_id) query = query.eq('empleado_id', empleado_id)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/', requireAuth, checkPermission('evaluaciones', 'CREAR'), auditLog('evaluaciones', 'CREAR'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = evalSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { puntaje_puntualidad, puntaje_calidad, puntaje_actitud } = parsed.data
    const puntaje_total = Math.round(((puntaje_puntualidad + puntaje_calidad + puntaje_actitud) / 3) * 100) / 100

    const { data, error } = await supabase.from('evaluaciones').insert({
      ...parsed.data,
      puntaje_total,
      evaluador_id: req.user!.id,
    }).select().single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.patch('/:id/publicar', requireAuth, checkPermission('evaluaciones', 'APROBAR'), async (_req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('evaluaciones').update({ estado: 'publicada' }).eq('id', _req.params.id)
  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Evaluación publicada' })
})

export default router
