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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// GET lista de capacitaciones
router.get('/', requireAuth, checkPermission('capacitaciones', 'VER'), async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('capacitaciones')
    .select('*, capacitaciones_completadas(usuario_id)')
    .eq('activa', true)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: 'DB_ERROR' })

  // Marcar cuáles completó el usuario actual
  const result = (data ?? []).map((c: any) => ({
    ...c,
    completada_por_mi: c.capacitaciones_completadas.some((x: any) => x.usuario_id === req.user!.id),
    total_completadas: c.capacitaciones_completadas.length,
  }))
  return res.json(result)
})

// POST crear capacitación (con material opcional)
router.post('/', requireAuth, checkPermission('capacitaciones', 'CREAR'), auditLog('capacitaciones', 'CREAR'),
  upload.single('material'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        titulo:      z.string().min(3).max(300),
        descripcion: z.string().optional(),
        obligatoria: z.string().optional().transform(v => v === 'true'),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

      let url_material: string | null = null
      if (req.file) {
        const path = `capacitaciones/${Date.now()}-${req.file.originalname}`
        const { error: uploadErr } = await supabase.storage
          .from('capacitaciones')
          .upload(path, req.file.buffer, { contentType: req.file.mimetype })
        if (uploadErr) return res.status(500).json({ error: 'UPLOAD_FAILED' })
        url_material = supabase.storage.from('capacitaciones').getPublicUrl(path).data.publicUrl
      }

      const { data, error } = await supabase.from('capacitaciones').insert({
        ...parsed.data,
        url_material,
        creado_por: req.user!.id,
      }).select().single()

      if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
      return res.status(201).json(data)
    } catch (err) {
      console.error(err)
      return res.status(500).json({ error: 'Error interno' })
    }
  }
)

// PATCH marcar como completada
router.post('/:id/completar', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('capacitaciones_completadas').insert({
    capacitacion_id: req.params.id,
    usuario_id: req.user!.id,
  })
  if (error?.code === '23505') return res.json({ message: 'Ya completada' })
  if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
  return res.status(201).json({ message: 'Capacitación marcada como completada' })
})

// DELETE desactivar
router.delete('/:id', requireAuth, checkPermission('capacitaciones', 'ELIMINAR'), async (_req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabase.from('capacitaciones').update({ activa: false }).eq('id', _req.params.id)
    if (error) return res.status(500).json({ error: 'DELETE_FAILED' })
    return res.json({ message: 'Capacitación desactivada' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

export default router
