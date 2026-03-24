import { Router } from 'express'
import {
  listPedidos, crearPedido, getPedido, getPedidoByFolio,
  surtirItem, validarPiso, cobrarNota, revisarSalida, cerrarNota,
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

// Flujo: capturada → en_surtido → surtido_parcial → completa_en_piso
//        → lista_para_cobro → cobrada → en_revision_salida → cerrada

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

// Almacenista actualiza item: cantidad_surtida, estado, área, incidencia
router.patch('/:id/surtir-item/:itemId',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  surtirItem
)

// Vendedora valida en piso → lista_para_cobro + regenera qr_code
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

// Checador escanea → en_revision_salida
router.patch('/:id/revisar-salida',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  revisarSalida
)

// Cierre definitivo → cerrada
router.patch('/:id/cerrar',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  cerrarNota
)

export default router
