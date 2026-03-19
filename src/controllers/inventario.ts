import { Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'
import axios from 'axios'
import multer from 'multer'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

export async function listInventario(req: AuthRequest, res: Response) {
  const { sucursal_id } = req.query as Record<string, string>

  // Encargado de sucursal only sees their own branch
  const targetSucursal = (req.user!.rol_nivel >= 5 && req.user!.sucursal_id)
    ? req.user!.sucursal_id
    : sucursal_id

  let query = supabase
    .from('inventario')
    .select('id, cantidad, stock_minimo, updated_at, producto_id, sucursal_id, productos(codigo, nombre, foto_url, categorias(nombre)), sucursales(nombre)')
    .order('cantidad')

  if (targetSucursal) query = query.eq('sucursal_id', targetSucursal)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
}

export async function getAlertas(req: AuthRequest, res: Response) {
  const { sucursal_id } = req.query as Record<string, string>
  const targetSucursal = (req.user!.rol_nivel >= 5 && req.user!.sucursal_id)
    ? req.user!.sucursal_id
    : sucursal_id

  let query = supabase
    .from('inventario')
    .select('id, cantidad, stock_minimo, producto_id, sucursal_id, productos(codigo, nombre), sucursales(nombre)')
    .filter('cantidad', 'lte', 'stock_minimo')

  if (targetSucursal) query = query.eq('sucursal_id', targetSucursal)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
}

const ajusteSchema = z.object({
  cantidad:    z.number().int(),
  stock_minimo: z.number().int().min(0).optional(),
  notas:       z.string().optional(),
})

export async function ajustarInventario(req: AuthRequest, res: Response) {
  const { id } = req.params
  const parsed = ajusteSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { data: inv } = await supabase.from('inventario').select('*').eq('id', id).single()
  if (!inv) return res.status(404).json({ error: 'NOT_FOUND' })

  const update: Record<string, any> = {}
  if (parsed.data.cantidad !== undefined) update.cantidad = parsed.data.cantidad
  if (parsed.data.stock_minimo !== undefined) update.stock_minimo = parsed.data.stock_minimo

  const { error } = await supabase.from('inventario').update(update).eq('id', id)
  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

  // Log movement
  if (parsed.data.cantidad !== undefined) {
    await supabase.from('movimientos_inventario').insert({
      producto_id: inv.producto_id,
      sucursal_id: inv.sucursal_id,
      tipo: 'ajuste',
      cantidad: parsed.data.cantidad - inv.cantidad,
      notas: parsed.data.notas,
      usuario_id: req.user!.id,
    })
  }

  return res.json({ message: 'Inventario actualizado' })
}

const mermaSchema = z.object({
  producto_id: z.string().uuid(),
  sucursal_id: z.string().uuid(),
  cantidad:    z.number().int().positive(),
  motivo:      z.string().min(1),
})

export async function registrarMerma(req: AuthRequest, res: Response) {
  const parsed = mermaSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { producto_id, sucursal_id, cantidad, motivo } = parsed.data

  // Decrease inventory
  const { error: _invError } = await supabase.rpc('decrement_inventario', {
    p_producto_id: producto_id, p_sucursal_id: sucursal_id, p_cantidad: cantidad
  })

  const { error } = await supabase.from('mermas').insert({
    ...parsed.data, registrado_por: req.user!.id
  })
  if (error) return res.status(500).json({ error: 'CREATE_FAILED' })

  await supabase.from('movimientos_inventario').insert({
    producto_id, sucursal_id, tipo: 'merma', cantidad: -cantidad,
    notas: motivo, usuario_id: req.user!.id,
  })

  return res.status(201).json({ message: 'Merma registrada' })
}

// CEDIS daily import — parses Excel/CSV and updates inventory
export async function importCedis(req: AuthRequest, res: Response) {
  if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' })

  try {
    const formData = new FormData()
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype })
    formData.append('file', blob, req.file.originalname)
    formData.append('sucursal_id', (req.body.sucursal_id ?? req.user!.sucursal_id) as string)

    const { data: result } = await axios.post(
      `${process.env.ANALYSIS_URL}/analysis/cedis-import`,
      formData,
      { headers: { 'X-Internal-Key': process.env.INTERNAL_SECRET, 'Content-Type': 'multipart/form-data' } }
    )
    return res.json(result)
  } catch (err: any) {
    return res.status(502).json({ error: 'ANALYSIS_ERROR', detail: err.message })
  }
}

export async function getCedisStatus(_req: AuthRequest, res: Response) {
  // Returns the last CEDIS import movement
  const { data, error } = await supabase
    .from('movimientos_inventario')
    .select('created_at, notas, sucursal_id, sucursales(nombre)')
    .eq('tipo', 'cedis_import')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
}
