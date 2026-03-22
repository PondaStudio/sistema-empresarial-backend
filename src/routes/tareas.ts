import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'
import multer from 'multer'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

const tareaSchema = z.object({
  titulo:       z.string().min(2).max(300),
  descripcion:  z.string().optional(),
  asignada_a:   z.string().uuid(),
  sucursal_id:  z.string().uuid().optional(),
  fecha_limite: z.string().datetime().optional(),
})

router.get('/mis-tareas', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 5
    const { data, error } = await supabase
      .from('tareas')
      .select('*')
      .eq('asignado_a', req.user!.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json({ tareas: data ?? [] })
  } catch (err) {
    console.error(err)
    return res.json({ tareas: [] })
  }
})

router.get('/', requireAuth, checkPermission('tareas', 'VER'), async (req: AuthRequest, res: Response) => {
  try {
    const { estado, asignada_a } = req.query as Record<string, string>
    let query = supabase
      .from('tareas')
      .select('*, asignada_por_user:usuarios!asignada_por(nombre), asignada_a_user:usuarios!asignada_a(nombre, foto_url), evidencias_tarea(url), subtareas(id, titulo, completada)')
      .order('created_at', { ascending: false })

    if (estado) query = query.eq('estado', estado)
    if (asignada_a) query = query.eq('asignada_a', asignada_a)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/', requireAuth, checkPermission('tareas', 'CREAR'), auditLog('tareas', 'CREAR'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = tareaSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { data, error } = await supabase.from('tareas').insert({
      ...parsed.data, asignada_por: req.user!.id,
    }).select().single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// State machine transitions
const TRANSICIONES: Record<string, string[]> = {
  pendiente:    ['en_progreso'],
  en_progreso:  ['en_revision'],
  en_revision:  ['completada', 'rechazada'],
  rechazada:    ['en_progreso'],
}

router.patch('/:id/estado', requireAuth, checkPermission('tareas', 'EDITAR'), auditLog('tareas', 'EDITAR'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      estado:        z.enum(['pendiente','en_progreso','en_revision','rechazada','completada']),
      notas_rechazo: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { data: tarea } = await supabase.from('tareas').select('estado, asignada_por, asignada_a').eq('id', req.params.id).single()
    if (!tarea) return res.status(404).json({ error: 'NOT_FOUND' })

    const allowed = TRANSICIONES[tarea.estado] ?? []
    if (!allowed.includes(parsed.data.estado)) {
      return res.status(400).json({ error: 'INVALID_TRANSITION', from: tarea.estado, to: parsed.data.estado, allowed })
    }

    // Only assignee can move to en_revision; only assigner can approve/reject
    if (['completada','rechazada'].includes(parsed.data.estado) && tarea.asignada_por !== req.user!.id && req.user!.rol_nivel > 5) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el asignador puede aprobar o rechazar' })
    }

    const { error } = await supabase.from('tareas').update({
      estado: parsed.data.estado,
      notas_rechazo: parsed.data.notas_rechazo ?? null,
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Estado actualizado', estado: parsed.data.estado })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// Upload evidence photo
router.post('/:id/evidencias', requireAuth, checkPermission('tareas', 'EDITAR'), upload.single('foto'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' })

    const path = `evidencias/${req.params.id}/${Date.now()}-${req.file.originalname}`
    const { error: uploadError } = await supabase.storage
      .from('tareas')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype })

    if (uploadError) return res.status(500).json({ error: 'UPLOAD_FAILED' })

    const { data: urlData } = supabase.storage.from('tareas').getPublicUrl(path)

    const { data, error } = await supabase.from('evidencias_tarea').insert({
      tarea_id: req.params.id,
      url: urlData.publicUrl,
      subida_por: req.user!.id,
    }).select().single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/:id/comentarios', requireAuth, checkPermission('tareas', 'EDITAR'), async (req: AuthRequest, res: Response) => {
  try {
    const { contenido } = req.body
    if (!contenido) return res.status(400).json({ error: 'CONTENIDO_REQUIRED' })

    const { data, error } = await supabase.from('comentarios_tarea').insert({
      tarea_id: req.params.id,
      usuario_id: req.user!.id,
      contenido,
    }).select('*, usuarios!usuario_id(nombre)').single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
