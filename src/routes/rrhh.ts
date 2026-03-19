import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'
import multer from 'multer'
import Papa from 'papaparse'

const router = Router()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// GET lista empleados con su usuario
router.get('/empleados', requireAuth, checkPermission('rrhh', 'VER'), async (_req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('empleados')
    .select('*, usuarios(nombre, email, foto_url, estado_presencia, rol_id, sucursal_id, roles(nombre), sucursales(nombre))')
    .order('created_at')
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

// POST importar CSV del checador (asistencia diaria)
router.post('/asistencia/import', requireAuth, checkPermission('rrhh', 'CREAR'), auditLog('rrhh', 'CREAR'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' })

    const csv = req.file.buffer.toString('utf-8')
    const { data: rows, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true })
    if (errors.length) return res.status(400).json({ error: 'PARSE_ERROR', errors })

    // Expected columns: email/usuario, fecha, hora_entrada, hora_salida
    let imported = 0, skipped = 0
    const JORNADA_NORMAL = 8

    for (const row of rows as any[]) {
      const email        = row.email || row.usuario || row.correo
      const fecha        = row.fecha
      const hora_entrada = row.hora_entrada || row.entrada
      const hora_salida  = row.hora_salida  || row.salida

      if (!email || !fecha) { skipped++; continue }

      const { data: usuario } = await supabase.from('usuarios').select('id').eq('email', email).single()
      if (!usuario) { skipped++; continue }

      const { data: empleado } = await supabase.from('empleados').select('id').eq('usuario_id', usuario.id).single()
      if (!empleado) { skipped++; continue }

      // Calculate hours worked and overtime
      let horas_trabajadas = 0, horas_extra = 0
      if (hora_entrada && hora_salida) {
        const [eh, em] = hora_entrada.split(':').map(Number)
        const [sh, sm] = hora_salida.split(':').map(Number)
        horas_trabajadas = Math.max(0, ((sh * 60 + sm) - (eh * 60 + em)) / 60)
        horas_extra = Math.max(0, horas_trabajadas - JORNADA_NORMAL)
      }

      await supabase.from('asistencia').upsert({
        empleado_id:      empleado.id,
        fecha,
        hora_entrada:     hora_entrada ?? null,
        hora_salida:      hora_salida  ?? null,
        horas_trabajadas: Math.round(horas_trabajadas * 100) / 100,
        horas_extra:      Math.round(horas_extra * 100) / 100,
        fuente:           'checador',
      }, { onConflict: 'empleado_id,fecha' })

      imported++
    }

    return res.json({ message: 'Importación completada', imported, skipped })
  }
)

// GET asistencia de empleado
router.get('/asistencia/:empleadoId', requireAuth, checkPermission('rrhh', 'VER'), async (req: AuthRequest, res: Response) => {
  const { desde, hasta } = req.query as Record<string, string>
  let query = supabase.from('asistencia').select('*').eq('empleado_id', req.params.empleadoId).order('fecha', { ascending: false })
  if (desde) query = query.gte('fecha', desde)
  if (hasta) query = query.lte('fecha', hasta)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

// POST registrar vacaciones
router.post('/vacaciones', requireAuth, checkPermission('rrhh', 'CREAR'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    empleado_id:  z.string().uuid(),
    fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fecha_fin:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { data, error } = await supabase.from('vacaciones').insert(parsed.data).select().single()
  if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
  return res.status(201).json(data)
})

router.patch('/vacaciones/:id/aprobar', requireAuth, checkPermission('rrhh', 'APROBAR'), async (req: AuthRequest, res: Response) => {
  const { estado } = req.body
  if (!['aprobado','rechazado'].includes(estado)) return res.status(400).json({ error: 'INVALID_STATE' })
  const { error } = await supabase.from('vacaciones').update({ estado, aprobado_por: req.user!.id }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Vacaciones actualizadas' })
})

// POST registrar llamada de atención
router.post('/llamadas-atencion', requireAuth, checkPermission('rrhh', 'CREAR'), auditLog('rrhh', 'CREAR'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    empleado_id: z.string().uuid(),
    motivo:      z.string().min(5),
    tipo:        z.enum(['verbal','escrita','suspension','otro']).default('verbal'),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { data, error } = await supabase.from('llamadas_atencion').insert({
    ...parsed.data, registrado_por: req.user!.id
  }).select().single()

  if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
  return res.status(201).json(data)
})

// GET bonos por período
router.get('/bonos/:periodo', requireAuth, checkPermission('rrhh', 'VER'), async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('bonos')
    .select('*, empleados(id, usuarios(nombre))')
    .eq('periodo', req.params.periodo)
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
})

export default router
