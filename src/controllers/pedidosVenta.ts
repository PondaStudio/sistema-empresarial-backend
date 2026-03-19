import { Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

// ── PASO 1: Vendedora crea pedido ─────────────────────────
const crearPedidoSchema = z.object({
  cliente_id:    z.string().uuid().optional(),
  nombre_cliente: z.string().optional(),
  notas:         z.string().optional(),
  items: z.array(z.object({
    producto_id: z.string().uuid(),
    cantidad:    z.number().int().positive(),
  })).min(1),
})

export async function crearPedido(req: AuthRequest, res: Response) {
  const parsed = crearPedidoSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { items, ...pedidoData } = parsed.data

  const { data: pedido, error } = await supabase
    .from('pedidos_venta')
    .insert({
      ...pedidoData,
      sucursal_id:  req.user!.sucursal_id,
      vendedora_id: req.user!.id,
      estado:       'pendiente_almacen',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'CREATE_FAILED', detail: error.message })

  const itemsData = items.map(i => ({ ...i, pedido_id: pedido.id }))
  const { error: itemsError } = await supabase.from('items_pedido_venta').insert(itemsData)
  if (itemsError) {
    await supabase.from('pedidos_venta').delete().eq('id', pedido.id)
    return res.status(500).json({ error: 'ITEMS_FAILED' })
  }

  return res.status(201).json(pedido)
}

// ── GET pedido con items ──────────────────────────────────
export async function getPedido(req: AuthRequest, res: Response) {
  const { data, error } = await supabase
    .from('pedidos_venta')
    .select(`
      *,
      vendedora:usuarios!vendedora_id(nombre),
      sucursales(nombre),
      clientes_frecuentes(nombre, telefono),
      items_pedido_venta(
        id, cantidad, estado_confirmacion, observaciones, confirmado_at,
        productos!producto_id(id, codigo, nombre, foto_url),
        sustituto:productos!sustituto_producto_id(id, codigo, nombre),
        almacenista:usuarios!almacenista_id(nombre)
      )
    `)
    .eq('id', req.params.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' })
  return res.json(data)
}

// ── GET lista de pedidos ──────────────────────────────────
export async function listPedidos(req: AuthRequest, res: Response) {
  const { estado, fecha_desde, fecha_hasta } = req.query as Record<string, string>

  let query = supabase
    .from('pedidos_venta')
    .select('id, folio, estado, nombre_cliente, created_at, updated_at, vendedora:usuarios!vendedora_id(nombre), sucursales(nombre)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (estado) query = query.eq('estado', estado)
  if (fecha_desde) query = query.gte('created_at', fecha_desde)
  if (fecha_hasta) query = query.lte('created_at', fecha_hasta)
  if (req.user!.rol_nivel >= 8) query = query.eq('vendedora_id', req.user!.id)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'DB_ERROR' })
  return res.json(data)
}

// ── PASO 3A/3B/3C: Almacenista confirma/rechaza item ─────
const confirmarItemSchema = z.object({
  estado_confirmacion:   z.enum(['confirmado', 'sustituto', 'no_disponible']),
  sustituto_producto_id: z.string().uuid().optional(),
  observaciones:         z.string().optional(),
})

export async function confirmarItem(req: AuthRequest, res: Response) {
  const { id: pedidoId, itemId } = req.params

  // Validate pedido exists and is in right state
  const { data: pedido } = await supabase.from('pedidos_venta').select('estado').eq('id', pedidoId).single()
  if (!pedido || !['pendiente_almacen', 'en_revision'].includes(pedido.estado)) {
    return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido no está en revisión' })
  }

  const parsed = confirmarItemSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const { error } = await supabase.from('items_pedido_venta').update({
    ...parsed.data,
    almacenista_id: req.user!.id,
    confirmado_at:  new Date().toISOString(),
  }).eq('id', itemId).eq('pedido_id', pedidoId)

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

  // Update pedido state to en_revision
  await supabase.from('pedidos_venta').update({ estado: 'en_revision' }).eq('id', pedidoId)

  // Check if all items are resolved → move to confirmado
  const { data: items } = await supabase
    .from('items_pedido_venta')
    .select('estado_confirmacion')
    .eq('pedido_id', pedidoId)

  const allResolved = items?.every(i => i.estado_confirmacion !== 'pendiente')
  if (allResolved) {
    await supabase.from('pedidos_venta').update({ estado: 'confirmado' }).eq('id', pedidoId)
  }

  return res.json({ message: 'Item actualizado', allConfirmed: allResolved })
}

// ── PASO 6: Vendedora imprime nota ────────────────────────
export async function imprimirNota(req: AuthRequest, res: Response) {
  const { data: pedido } = await supabase
    .from('pedidos_venta')
    .select('estado, items_pedido_venta(estado_confirmacion)')
    .eq('id', req.params.id)
    .single()

  if (!pedido) return res.status(404).json({ error: 'NOT_FOUND' })
  if (pedido.estado !== 'confirmado') {
    return res.status(400).json({ error: 'NOT_CONFIRMED', message: 'Todos los productos deben estar confirmados antes de imprimir' })
  }

  const { error } = await supabase.from('pedidos_venta').update({
    estado:     'impreso',
    impreso_at: new Date().toISOString(),
  }).eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Nota impresa', pedido_id: req.params.id })
}

// ── PASO 9: Almacenista confirma surtido ──────────────────
export async function confirmarSurtido(req: AuthRequest, res: Response) {
  const { data: pedido } = await supabase.from('pedidos_venta').select('estado').eq('id', req.params.id).single()
  if (!pedido || pedido.estado !== 'impreso') {
    return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido debe estar impreso' })
  }

  const { error } = await supabase.from('pedidos_venta').update({
    estado:     'surtido',
    surtido_at: new Date().toISOString(),
  }).eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

  // Discount inventory for each confirmed item
  const { data: items } = await supabase
    .from('items_pedido_venta')
    .select('producto_id, cantidad, sustituto_producto_id, estado_confirmacion')
    .eq('pedido_id', req.params.id)

  for (const item of items ?? []) {
    const prodId = item.estado_confirmacion === 'sustituto' ? item.sustituto_producto_id : item.producto_id
    if (!prodId || item.estado_confirmacion === 'no_disponible') continue

    await supabase.rpc('decrement_inventario_safe', {
      p_producto_id: prodId,
      p_sucursal_id: req.user!.sucursal_id,
      p_cantidad:    item.cantidad,
    })

    await supabase.from('movimientos_inventario').insert({
      producto_id:     prodId,
      sucursal_id:     req.user!.sucursal_id,
      tipo:            'salida',
      cantidad:        -item.cantidad,
      referencia_id:   req.params.id,
      referencia_tipo: 'pedido_venta',
      usuario_id:      req.user!.id,
    })
  }

  return res.json({ message: 'Surtido confirmado' })
}

// ── PASO 10: Vendedora escanea y verifica ─────────────────
export async function verificarVendedora(req: AuthRequest, res: Response) {
  const { data: pedido } = await supabase.from('pedidos_venta').select('estado').eq('id', req.params.id).single()
  if (!pedido || pedido.estado !== 'surtido') {
    return res.status(400).json({ error: 'INVALID_STATE' })
  }

  const { error } = await supabase.from('pedidos_venta').update({ estado: 'verificado_vendedora' }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Verificado por vendedora' })
}

// ── PASO 12: Checador escanea con celular ─────────────────
export async function escanearChecador(req: AuthRequest, res: Response) {
  const { data: pedido } = await supabase.from('pedidos_venta').select('estado').eq('id', req.params.id).single()
  if (!pedido || pedido.estado !== 'verificado_vendedora') {
    return res.status(400).json({ error: 'INVALID_STATE' })
  }

  const { error } = await supabase.from('pedidos_venta').update({ estado: 'en_checador' }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Checador registrado' })
}

// ── PASO 13: Personal de puerta cierra definitivamente ────
export async function cerrarPuerta(req: AuthRequest, res: Response) {
  const { data: pedido } = await supabase.from('pedidos_venta').select('estado').eq('id', req.params.id).single()
  if (!pedido || pedido.estado !== 'en_checador') {
    return res.status(400).json({ error: 'INVALID_STATE' })
  }

  const { error } = await supabase.from('pedidos_venta').update({
    estado:     'cerrado',
    cerrado_at: new Date().toISOString(),
  }).eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
  return res.json({ message: 'Pedido cerrado definitivamente' })
}
