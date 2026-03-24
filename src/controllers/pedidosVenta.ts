import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

// Flujo: capturada → en_surtido → surtido_parcial → completa_en_piso
//        → lista_para_cobro → cobrada → en_revision_salida → cerrada

// ── Helpers ───────────────────────────────────────────────
async function generarFolio(): Promise<string> {
  const now = new Date()
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '')
  const startOfDay = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`

  const { count } = await supabase
    .from('pedidos_venta')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfDay)

  const seq = String((count ?? 0) + 1).padStart(4, '0')
  return `PV-${datePart}-${seq}`
}

function qrUrl(folio: string): string {
  return `/pedidos/${folio}`
}

// ── POST / — Vendedora crea nota ──────────────────────────
const crearPedidoSchema = z.object({
  cliente_id:         z.string().uuid().optional(),
  nombre_cliente:     z.string().optional(),
  notas:              z.string().optional(),
  tipo_cliente:       z.string().optional(),
  facturacion:        z.boolean().optional(),
  descuento_especial: z.boolean().optional(),
  area:               z.string().optional(),
  items: z.array(z.object({
    producto_id: z.string().uuid().optional().nullable(),
    codigo:      z.string().min(1),
    nombre:      z.string().min(1),
    cantidad:    z.number().int().positive(),
    area:        z.string().optional(),
  })).min(1),
})

export async function crearPedido(req: AuthRequest, res: Response) {
  try {
    console.log('[crearPedido] body recibido:', JSON.stringify(req.body))
    console.log('[crearPedido] user:', JSON.stringify(req.user))

    // Validación rápida con mensaje legible antes de Zod
    if (!req.body.nombre_cliente && !req.body.cliente_id) {
      return res.status(400).json({ error: 'nombre_cliente y productos son requeridos', body: req.body })
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ error: 'nombre_cliente y productos son requeridos', body: req.body })
    }

    const parsed = crearPedidoSchema.safeParse(req.body)
    if (!parsed.success) {
      console.log('[crearPedido] VALIDATION ERROR:', JSON.stringify(parsed.error.issues))
      return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
    }

    const { items, cliente_id, nombre_cliente, notas, tipo_cliente, facturacion, descuento_especial, area } = parsed.data
    const folio = await generarFolio()
    const sucursal_id = req.user!.sucursal_id ?? null

    console.log('[crearPedido] user.id:', req.user!.id, '| sucursal_id:', sucursal_id, '| folio:', folio)
    console.log('[DEBUG] insertando pedido:', {
      folio,
      vendedora_id:       req.user!.id,
      sucursal_id,
      nombre_cliente:     nombre_cliente ?? null,
      cliente_id:         cliente_id ?? null,
      estado:             'capturada',
    })

    const { data, error } = await supabase
      .from('pedidos_venta')
      .insert({
        folio,
        vendedora_id:       req.user!.id,
        sucursal_id,
        nombre_cliente:     nombre_cliente ?? null,
        cliente_id:         cliente_id ?? null,
        notas:              notas ?? null,
        tipo_cliente:       tipo_cliente ?? null,
        facturacion:        facturacion ?? false,
        descuento_especial: descuento_especial ?? null,
        area:               area ?? null,
        estado:             'capturada',
      })
      .select()
      .single()

    console.log('[crearPedido] INSERT result:', data?.id ?? null, '| error:', error?.message ?? null)

    if (error) {
      console.error('[crearPedido] ERROR COMPLETO:', error)
      return res.status(500).json({ error: error.message })
    }

    const itemsData = items.map(i => ({
      pedido_id:           data.id,
      producto_id:         i.producto_id ?? null,
      codigo:              i.codigo,
      nombre:              i.nombre,
      cantidad:            i.cantidad,
      area:                i.area ?? null,
      estado_confirmacion: 'pendiente',
      cantidad_surtida:    0,
    }))
    const { error: itemsError } = await supabase.from('items_pedido_venta').insert(itemsData)
    if (itemsError) {
      console.error('[crearPedido] ITEMS ERROR:', itemsError)
      await supabase.from('pedidos_venta').delete().eq('id', data.id)
      return res.status(500).json({ error: itemsError.message })
    }

    return res.status(201).json(data)
  } catch (error: any) {
    console.error('[createPedido] ERROR:', error?.message, error?.details, error?.hint)
    return res.status(500).json({ error: error?.message, details: error?.details, hint: error?.hint })
  }
}

// ── GET / — Lista filtrada por rol ────────────────────────
export async function listPedidos(req: AuthRequest, res: Response) {
  try {
    const { estado, estados, fecha_desde, fecha_hasta } = req.query as Record<string, string>
    const nivel = req.user!.rol_nivel
    const sucursalId = req.user!.sucursal_id
    console.log('[listPedidos] nivel:', nivel, '| user.id:', req.user!.id, '| sucursal_id:', sucursalId)

    let query = supabase
      .from('pedidos_venta')
      .select('id, folio, estado, nombre_cliente, tipo_cliente, qr_code, area, created_at, updated_at, sucursal_id, vendedora_id, vendedora:usuarios!vendedora_id(nombre), sucursales(nombre)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (nivel >= 10) {
      // Vendedora/promotora: solo sus propias notas
      query = query.eq('vendedora_id', req.user!.id)
    } else if (nivel === 8) {
      // Cajera: notas listas para cobrar (filtro de estado por defecto)
      if (!estado && !estados) query = query.in('estado', ['lista_para_cobro', 'cobrada'])
      if (sucursalId) query = query.eq('sucursal_id', sucursalId)
    } else if (nivel >= 4) {
      // Almacenista (9), encargado (6-7), admin sucursal (4-5): toda su sucursal
      // Si sucursal_id es null, devuelve todas sin filtro de sucursal
      if (sucursalId) query = query.eq('sucursal_id', sucursalId)
    }
    // nivel 1-3: sin filtro adicional

    console.log('[listPedidos] sucursal_id del usuario:', sucursalId, '| aplicando filtro sucursal:', !!sucursalId)

    // Filtro por múltiples estados (param ?estados=capturada,en_surtido)
    if (estados) {
      const estadosArr = estados.split(',').map(s => s.trim()).filter(Boolean)
      if (estadosArr.length > 0) query = query.in('estado', estadosArr)
    } else if (estado) {
      query = query.eq('estado', estado)
    }

    if (fecha_desde) query = query.gte('created_at', fecha_desde)
    if (fecha_hasta) query = query.lte('created_at', fecha_hasta)

    const { data, error } = await query
    console.log('[listPedidos] resultados:', data?.length ?? 0, '| error:', error?.message ?? null)
    if (error) return res.status(500).json({ error: 'DB_ERROR', detail: error.message })
    return res.json(data ?? [])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── GET /:id — Detalle completo ───────────────────────────
export async function getPedido(req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('pedidos_venta')
      .select(`
        *,
        vendedora:usuarios!vendedora_id(id, nombre),
        cajera:usuarios!cajera_id(id, nombre),
        checador:usuarios!checador_id(id, nombre),
        sucursales(nombre),
        clientes_frecuentes(nombre, telefono),
        items_pedido_venta(
          id, codigo, nombre, cantidad, cantidad_surtida, estado_confirmacion,
          area, incidencia, observaciones, confirmado_at,
          productos!producto_id(id, codigo, nombre, foto_url),
          almacenista:usuarios!almacenista_id(id, nombre)
        )
      `)
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' })

    // Vendedora solo puede ver sus propias notas
    if (req.user!.rol_nivel >= 10 && (data as any).vendedora_id !== req.user!.id) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    // Normalizar: items_pedido_venta → items, estado_confirmacion → estado_item
    const { items_pedido_venta, ...rest } = data as any
    const normalizado = {
      ...rest,
      items: (items_pedido_venta ?? []).map((it: any) => ({
        ...it,
        estado_item: it.estado_confirmacion ?? 'pendiente',
      })),
    }

    return res.json(normalizado)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── GET /folio/:folio — Buscar por folio (escaneo QR) ────
export async function getPedidoByFolio(req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('pedidos_venta')
      .select(`
        *,
        vendedora:usuarios!vendedora_id(id, nombre),
        cajera:usuarios!cajera_id(id, nombre),
        checador:usuarios!checador_id(id, nombre),
        sucursales(nombre),
        items_pedido_venta(
          id, cantidad, cantidad_surtida, estado_confirmacion,
          area, incidencia, observaciones,
          productos!producto_id(id, codigo, nombre, foto_url)
        )
      `)
      .eq('folio', req.params.folio)
      .single()

    if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PATCH /:id — Editar datos de la nota (nivel <=2 o 4) ─
const editarPedidoSchema = z.object({
  nombre_cliente:     z.string().optional(),
  notas:              z.string().optional(),
  tipo_cliente:       z.string().optional(),
  facturacion:        z.boolean().optional(),
  descuento_especial: z.boolean().optional(),
  area:               z.string().optional(),
})

export async function editarPedido(req: AuthRequest, res: Response) {
  try {
    const nivel = req.user!.rol_nivel
    if (nivel > 2 && nivel !== 4) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo niveles 1, 2 y 4 pueden editar notas' })
    }
    const parsed = editarPedidoSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { error } = await supabase
      .from('pedidos_venta')
      .update(parsed.data)
      .eq('id', req.params.id)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ message: 'Nota actualizada' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── DELETE /:id — Borrar nota (nivel <=2 o 4) ────────────
export async function deletePedido(req: AuthRequest, res: Response) {
  try {
    const nivel = req.user!.rol_nivel
    if (nivel > 2 && nivel !== 4) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo niveles 1, 2 y 4 pueden borrar notas' })
    }

    // Borrar items primero (FK constraint)
    await supabase.from('items_pedido_venta').delete().eq('pedido_id', req.params.id)

    const { error } = await supabase.from('pedidos_venta').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ message: 'Nota eliminada' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PATCH /:id/surtir-item/:itemId — Almacenista surte ───
const surtirItemSchema = z.object({
  cantidad_surtida:      z.number().int().min(0),
  estado_confirmacion:   z.enum(['pendiente', 'surtido', 'surtido_parcial', 'no_disponible', 'sustituto']),
  area:                  z.string().optional(),
  incidencia:            z.string().optional(),
  observaciones:         z.string().optional(),
  sustituto_producto_id: z.string().uuid().optional(),
})

export async function surtirItem(req: AuthRequest, res: Response) {
  try {
    const { id: pedidoId, itemId } = req.params

    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', pedidoId)
      .single()

    if (!pedido || !['capturada', 'en_surtido', 'surtido_parcial'].includes(pedido.estado)) {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'La nota no está disponible para surtir' })
    }

    const parsed = surtirItemSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { error: updateError } = await supabase
      .from('items_pedido_venta')
      .update({
        ...parsed.data,
        almacenista_id: req.user!.id,
        confirmado_at:  new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('pedido_id', pedidoId)

    if (updateError) return res.status(500).json({ error: 'UPDATE_FAILED', detail: updateError.message })

    // Recalcular estado de la nota según todos sus items
    const { data: allItems } = await supabase
      .from('items_pedido_venta')
      .select('estado_confirmacion, cantidad, cantidad_surtida')
      .eq('pedido_id', pedidoId)

    const items = allItems ?? []
    const allResolved = items.every(i => i.estado_confirmacion !== 'pendiente')

    let nuevoEstado: string
    if (!allResolved) {
      nuevoEstado = 'en_surtido'
    } else {
      const hayParciales = items.some(i =>
        i.estado_confirmacion === 'no_disponible' ||
        i.estado_confirmacion === 'surtido_parcial' ||
        (i.cantidad_surtida !== null && i.cantidad_surtida < i.cantidad)
      )
      nuevoEstado = hayParciales ? 'surtido_parcial' : 'completa_en_piso'
    }

    await supabase.from('pedidos_venta').update({ estado: nuevoEstado }).eq('id', pedidoId)

    return res.json({ message: 'Item actualizado', estado_nota: nuevoEstado, allResolved })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PATCH /:id/validar-piso — Vendedora → lista_para_cobro
export async function validarPiso(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado, vendedora_id, folio')
      .eq('id', req.params.id)
      .single()

    if (!pedido) return res.status(404).json({ error: 'NOT_FOUND' })

    if (!['completa_en_piso', 'surtido_parcial'].includes(pedido.estado)) {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'La nota debe estar en piso (completa o parcial) para validar' })
    }

    if (req.user!.rol_nivel >= 10 && pedido.vendedora_id !== req.user!.id) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const qr_code = qrUrl(pedido.folio)

    const { error } = await supabase.from('pedidos_venta').update({
      estado:                'lista_para_cobro',
      validada_vendedora_at: new Date().toISOString(),
      qr_code,
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Nota validada y lista para cobro', qr_code })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PATCH /:id/cobrar — Cajera cobra la nota ─────────────
export async function cobrarNota(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'lista_para_cobro') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'La nota debe estar lista para cobro' })
    }

    const { error } = await supabase.from('pedidos_venta').update({
      estado:     'cobrada',
      cajera_id:  req.user!.id,
      cobrada_at: new Date().toISOString(),
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Nota cobrada' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PATCH /:id/revisar-salida — Checador escanea ─────────
export async function revisarSalida(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'cobrada') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'La nota debe estar cobrada' })
    }

    const { error } = await supabase.from('pedidos_venta').update({
      estado:      'en_revision_salida',
      checador_id: req.user!.id,
      checador_at: new Date().toISOString(),
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'En revisión de salida' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PATCH /:id/cerrar — Cierre definitivo ────────────────
export async function cerrarNota(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'en_revision_salida') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'La nota debe estar en revisión de salida' })
    }

    const { error } = await supabase.from('pedidos_venta').update({
      estado:     'cerrada',
      cerrado_at: new Date().toISOString(),
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Nota cerrada definitivamente' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}
