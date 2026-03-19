import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'
import multer from 'multer'

const router = Router()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

router.get('/', requireAuth, checkPermission('formatos', 'VER'), async (req: AuthRequest, res: Response) => {
  const { categoria } = req.query as Record<string, string>
  let query = supabase.from('formatos').select('*, subido_por:usuarios!subido_por(nombre)').eq('activo', true).order('nombre')
  if (categoria) query = query.eq('categoria', categoria)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

router.post('/', requireAuth, checkPermission('formatos', 'CREAR'),
  upload.single('archivo'),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' })
    const { nombre, categoria, descripcion } = req.body
    if (!nombre || !categoria) return res.status(400).json({ error: 'NOMBRE_CATEGORIA_REQUIRED' })

    const path = `formatos/${categoria}/${Date.now()}-${req.file.originalname}`
    const { error: uploadErr } = await supabase.storage
      .from('formatos')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype })
    if (uploadErr) return res.status(500).json({ error: 'UPLOAD_FAILED' })

    const url = supabase.storage.from('formatos').getPublicUrl(path).data.publicUrl

    const { data, error } = await supabase.from('formatos').insert({
      nombre, categoria, descripcion: descripcion ?? null,
      url_plantilla: url,
      subido_por: req.user!.id,
    }).select().single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  }
)

router.delete('/:id', requireAuth, checkPermission('formatos', 'ELIMINAR'), async (_req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('formatos').update({ activo: false }).eq('id', _req.params.id)
  if (error) return res.status(500).json({ error: 'DELETE_FAILED' })
  return res.json({ message: 'Formato eliminado' })
})

export default router
