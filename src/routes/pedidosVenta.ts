import { Router } from 'express'
import {
  listPedidos, crearPedido, getPedido, getPedidoByFolio,
  editarPedido, deletePedido, reemplazarItems,
  surtirItem, confirmarSurtidoParcial, validarPiso, cobrarNota, checadaPiso, checadaSalida, cerrarNota,
} from '../controllers/pedidosVenta'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'
import { supabase } from '../lib/supabase'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()

// ── Endpoint de diagnóstico temporal ──────────────────────
router.get('/test-insert', requireAuth, async (req: AuthRequest, res: Response) => {
  const testFolio = `TEST-${Date.now()}`
  const { data, error } = await supabase
    .from('pedidos_venta')
    .insert({
      folio:          testFolio,
      vendedora_id:   req.user!.id,
      sucursal_id:    req.user!.sucursal_id ?? null,
      nombre_cliente: 'TEST DIAGNÓSTICO',
      estado:         'capturada',
      facturacion:    false,
    })
    .select()
    .single()
  return res.json({ ok: !error, data, error, user: req.user })
})

// Flujo: capturada → en_surtido → completa_en_piso → lista_para_cobro → cobrada → checada_en_piso → checada_en_salida → cerrada
//                              → devuelta_vendedora → en_surtido (re-surtir) | lista_para_cobro (aceptar parcial)

// /folio/:folio debe ir antes de /:id para evitar colisión de params
router.get('/folio/:folio',
  requireAuth,
  checkPermission('pedidos_venta', 'VER'),
  getPedidoByFolio
)

router.get('/',
  requireAuth,
  checkPermission('pedidos_venta', 'VER'),
  listPedidos
)

router.post('/',
  requireAuth,
  checkPermission('pedidos_venta', 'CREAR'),
  auditLog('pedidos_venta', 'CREAR'),
  crearPedido
)

router.get('/:id',
  requireAuth,
  checkPermission('pedidos_venta', 'VER'),
  getPedido
)

router.patch('/:id',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  editarPedido
)

router.delete('/:id',
  requireAuth,
  checkPermission('pedidos_venta', 'ELIMINAR'),
  auditLog('pedidos_venta', 'ELIMINAR'),
  deletePedido
)

router.patch('/:id/items',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  reemplazarItems
)

// Almacenista actualiza item: cantidad_surtida, estado, área, incidencia
router.patch('/:id/surtir-item/:itemId',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  surtirItem
)

// Vendedora confirma surtido parcial: re_surtir → en_surtido | aceptar → lista_para_cobro
router.patch('/:id/confirmar-surtido-parcial',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  confirmarSurtidoParcial
)

// Vendedora valida en piso (completa_en_piso) → lista_para_cobro + regenera qr_code
router.patch('/:id/validar-piso',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  validarPiso
)

// Cajera cobra → cobrada
router.patch('/:id/cobrar',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  cobrarNota
)

// Checador confirma mercancía en piso → checada_en_piso
router.patch('/:id/checada-piso',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  checadaPiso
)

// Checador confirma salida → checada_en_salida
router.patch('/:id/checada-salida',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  checadaSalida
)

// Cierre definitivo → cerrada
router.patch('/:id/cerrar',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  cerrarNota
)

export default router
