import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

// ── Folio generator: PV-YYYYMMDD-XXXX ────────────────────
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

// ── PASO 1: Vendedora crea pedido ─────────────────────────
const crearPedidoSchema = z.object({
  cliente_id:     z.string().uuid().optional(),
  nombre_cliente: z.string().optional(),
  notas:          z.string().optional(),
  items: z.array(z.object({
    producto_id: z.string().uuid(),
    cantidad:    z.number().int().positive(),
  })).min(1),
})

export async function crearPedido(req: AuthRequest, res: Response) {
  try {
    const parsed = crearPedidoSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { items, ...pedidoData } = parsed.data
    const folio = await generarFolio()

    const { data: pedido, error } = await supabase
      .from('pedidos_venta')
      .insert({
        ...pedidoData,
        folio,
        sucursal_id:  req.user!.sucursal_id,
        vendedora_id: req.user!.id,
        estado:       'pendiente_almacen',
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: 'CREATE_FAILED', detail: error.message })

    const itemsData = items.map(i => ({
      ...i,
      pedido_id:           pedido.id,
      estado_confirmacion: 'pendiente',
    }))
    const { error: itemsError } = await supabase.from('items_pedido_venta').insert(itemsData)
    if (itemsError) {
      await supabase.from('pedidos_venta').delete().eq('id', pedido.id)
      return res.status(500).json({ error: 'ITEMS_FAILED', detail: itemsError.message })
    }

    return res.status(201).json(pedido)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── GET lista de pedidos (filtro por rol) ─────────────────
export async function listPedidos(req: AuthRequest, res: Response) {
  try {
    const { estado, fecha_desde, fecha_hasta } = req.query as Record<string, string>
    const nivel = req.user!.rol_nivel

    let query = supabase
      .from('pedidos_venta')
      .select('id, folio, estado, nombre_cliente, created_at, updated_at, sucursal_id, vendedora_id, vendedora:usuarios!vendedora_id(nombre), sucursales(nombre)')
      .order('created_at', { ascending: false })
      .limit(100)

    // Vendedora (nivel >= 8) solo ve sus propios pedidos
    if (nivel >= 8) {
      query = query.eq('vendedora_id', req.user!.id)
    // Encargado/almacenista (niveles 4-7) solo ve su sucursal
    } else if (nivel >= 4 && req.user!.sucursal_id) {
      query = query.eq('sucursal_id', req.user!.sucursal_id)
    }
    // nivel 1-3 (creador/gerente) ven todo sin filtro adicional

    if (estado) query = query.eq('estado', estado)
    if (fecha_desde) query = query.gte('created_at', fecha_desde)
    if (fecha_hasta) query = query.lte('created_at', fecha_hasta)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR', detail: error.message })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── GET detalle completo con items y productos ────────────
export async function getPedido(req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('pedidos_venta')
      .select(`
        *,
        vendedora:usuarios!vendedora_id(id, nombre),
        sucursales(nombre),
        clientes_frecuentes(nombre, telefono),
        items_pedido_venta(
          id, cantidad, estado_confirmacion, observaciones, confirmado_at,
          productos!producto_id(id, codigo, nombre, foto_url),
          sustituto:productos!sustituto_producto_id(id, codigo, nombre),
          almacenista:usuarios!almacenista_id(id, nombre)
        )
      `)
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' })

    // Vendedora solo puede ver sus propios pedidos
    if (req.user!.rol_nivel >= 8 && (data as any).vendedora_id !== req.user!.id) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PASO 3: Almacenista confirma/rechaza item ─────────────
const confirmarItemSchema = z.object({
  estado_confirmacion:   z.enum(['confirmado', 'sustituto', 'no_disponible']),
  sustituto_producto_id: z.string().uuid().optional(),
  observaciones:         z.string().optional(),
})

export async function confirmarItem(req: AuthRequest, res: Response) {
  try {
    const { id: pedidoId, itemId } = req.params

    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', pedidoId)
      .single()

    if (!pedido || !['pendiente_almacen', 'en_revision'].includes(pedido.estado)) {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido no está disponible para revisión' })
    }

    const parsed = confirmarItemSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    if (parsed.data.estado_confirmacion === 'sustituto' && !parsed.data.sustituto_producto_id) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'sustituto_producto_id requerido para estado sustituto' })
    }

    const { error } = await supabase
      .from('items_pedido_venta')
      .update({
        ...parsed.data,
        almacenista_id: req.user!.id,
        confirmado_at:  new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('pedido_id', pedidoId)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED', detail: error.message })

    // Marcar pedido en_revision mientras haya items pendientes
    await supabase.from('pedidos_venta').update({ estado: 'en_revision' }).eq('id', pedidoId)

    // Si todos los items fueron resueltos → confirmado
    const { data: items } = await supabase
      .from('items_pedido_venta')
      .select('estado_confirmacion')
      .eq('pedido_id', pedidoId)

    const allResolved = items?.every(i => i.estado_confirmacion !== 'pendiente') ?? false
    if (allResolved) {
      await supabase.from('pedidos_venta').update({ estado: 'confirmado' }).eq('id', pedidoId)
    }

    return res.json({ message: 'Item actualizado', allConfirmed: allResolved })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PASO 6: Vendedora imprime (solo si todos confirmados) ─
export async function imprimirNota(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado, vendedora_id')
      .eq('id', req.params.id)
      .single()

    if (!pedido) return res.status(404).json({ error: 'NOT_FOUND' })

    // Solo la vendedora dueña o superiores pueden imprimir
    if (req.user!.rol_nivel >= 8 && pedido.vendedora_id !== req.user!.id) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    if (pedido.estado !== 'confirmado') {
      return res.status(400).json({ error: 'NOT_CONFIRMED', message: 'Todos los items deben estar confirmados antes de imprimir' })
    }

    const { error } = await supabase.from('pedidos_venta').update({
      estado:     'impreso',
      impreso_at: new Date().toISOString(),
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Nota impresa', pedido_id: req.params.id })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PASO 9: Almacenista confirma surtido completo ─────────
export async function confirmarSurtido(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado, sucursal_id')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'impreso') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido debe estar impreso para surtir' })
    }

    const { error } = await supabase.from('pedidos_venta').update({
      estado:     'surtido',
      surtido_at: new Date().toISOString(),
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

    // Descuentar inventario por cada item confirmado o sustituto
    const { data: items } = await supabase
      .from('items_pedido_venta')
      .select('producto_id, cantidad, sustituto_producto_id, estado_confirmacion')
      .eq('pedido_id', req.params.id)

    for (const item of items ?? []) {
      if (item.estado_confirmacion === 'no_disponible') continue

      const prodId = item.estado_confirmacion === 'sustituto'
        ? item.sustituto_producto_id
        : item.producto_id

      if (!prodId) continue

      await supabase.rpc('decrement_inventario_safe', {
        p_producto_id: prodId,
        p_sucursal_id: pedido.sucursal_id,
        p_cantidad:    item.cantidad,
      })

      await supabase.from('movimientos_inventario').insert({
        producto_id:     prodId,
        sucursal_id:     pedido.sucursal_id,
        tipo:            'salida',
        cantidad:        -item.cantidad,
        referencia_id:   req.params.id,
        referencia_tipo: 'pedido_venta',
        usuario_id:      req.user!.id,
      })
    }

    return res.json({ message: 'Surtido confirmado' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PASO 10: Vendedora verifica ───────────────────────────
export async function verificarVendedora(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado, vendedora_id')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'surtido') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido debe estar surtido' })
    }

    if (req.user!.rol_nivel >= 8 && pedido.vendedora_id !== req.user!.id) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const { error } = await supabase
      .from('pedidos_venta')
      .update({ estado: 'verificado_vendedora' })
      .eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Verificado por vendedora' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PASO 12: Checador escanea ─────────────────────────────
export async function escanearChecador(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'verificado_vendedora') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido debe estar verificado por la vendedora' })
    }

    const { error } = await supabase
      .from('pedidos_venta')
      .update({ estado: 'en_checador' })
      .eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Checador registrado' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

// ── PASO 13: Cierre definitivo ────────────────────────────
export async function cerrarPuerta(req: AuthRequest, res: Response) {
  try {
    const { data: pedido } = await supabase
      .from('pedidos_venta')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'en_checador') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'El pedido debe estar en checador' })
    }

    const { error } = await supabase.from('pedidos_venta').update({
      estado:     'cerrado',
      cerrado_at: new Date().toISOString(),
    }).eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Pedido cerrado definitivamente' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}
