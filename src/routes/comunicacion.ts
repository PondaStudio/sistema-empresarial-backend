import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'
import multer from 'multer'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

// GET canales del usuario
router.get('/canales', requireAuth, checkPermission('comunicacion', 'VER'), async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('canales')
      .select('*, miembros_canal!inner(usuario_id), sucursales(nombre)')
      .eq('miembros_canal.usuario_id', req.user!.id)
      .order('nombre')
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// POST crear canal
router.post('/canales', requireAuth, checkPermission('comunicacion', 'CREAR'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      nombre: z.string().min(2).max(150),
      tipo: z.enum(['sucursal', 'area', 'directo', 'general']).default('sucursal'),
      sucursal_id: z.string().uuid().optional(),
      miembros: z.array(z.string().uuid()).min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { miembros, ...canalData } = parsed.data
    const { data: canal, error } = await supabase
      .from('canales')
      .insert({ ...canalData, creado_por: req.user!.id })
      .select().single()
    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })

    // Add creator + members
    const memberSet = new Set([req.user!.id, ...miembros])
    await supabase.from('miembros_canal').insert([...memberSet].map(uid => ({ canal_id: canal.id, usuario_id: uid })))

    return res.status(201).json(canal)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// GET historial mensajes de un canal
router.get('/canales/:id/mensajes', requireAuth, checkPermission('comunicacion', 'VER'), async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? '50'), 200)
    const before = req.query.before as string

    let query = supabase
      .from('mensajes')
      .select('*, usuarios!usuario_id(nombre, foto_url)')
      .eq('canal_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (before) query = query.lt('created_at', before)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data?.reverse())
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// POST enviar mensaje de texto
router.post('/canales/:id/mensajes', requireAuth, checkPermission('comunicacion', 'CREAR'), async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({ contenido: z.string().min(1).max(4000) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { data, error } = await supabase.from('mensajes').insert({
      canal_id: req.params.id,
      usuario_id: req.user!.id,
      tipo: 'texto',
      contenido: parsed.data.contenido,
    }).select('*, usuarios!usuario_id(nombre, foto_url)').single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// POST subir nota de voz o imagen/archivo
router.post('/canales/:id/archivos', requireAuth, checkPermission('comunicacion', 'CREAR'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' })

      const tipo = req.file.mimetype.startsWith('audio') ? 'nota_voz'
        : req.file.mimetype.startsWith('image') ? 'imagen' : 'archivo'

      const path = `mensajes/${req.params.id}/${Date.now()}-${req.file.originalname}`
      const { error: uploadError } = await supabase.storage
        .from('comunicacion')
        .upload(path, req.file.buffer, { contentType: req.file.mimetype })

      if (uploadError) return res.status(500).json({ error: 'UPLOAD_FAILED' })

      const { data: urlData } = supabase.storage.from('comunicacion').getPublicUrl(path)

      const { data, error } = await supabase.from('mensajes').insert({
        canal_id: req.params.id,
        usuario_id: req.user!.id,
        tipo,
        archivo_url: urlData.publicUrl,
      }).select('*, usuarios!usuario_id(nombre, foto_url)').single()

      if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
      return res.status(201).json(data)
    } catch (err) {
      console.error(err)
      return res.status(500).json({ error: 'Error interno' })
    }
  }
)

export default router
