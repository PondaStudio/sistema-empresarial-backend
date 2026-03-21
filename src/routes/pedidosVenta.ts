import { Router } from 'express'
import {
  listPedidos, crearPedido, getPedido,
  confirmarItem, imprimirNota, confirmarSurtido,
  verificarVendedora, escanearChecador, cerrarPuerta,
} from '../controllers/pedidosVenta'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'

const router = Router()

// Flujo completo de pedido de venta:
// pendiente_almacen → en_revision → confirmado → impreso → surtido → verificado_vendedora → en_checador → cerrado

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

// Almacenista confirma/rechaza/sustituye cada item
router.patch('/:id/items/:itemId',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  confirmarItem
)

// Vendedora imprime la nota (solo si todos los items están confirmados)
router.patch('/:id/imprimir',
  requireAuth,
  checkPermission('pedidos_venta', 'IMPRIMIR'),
  auditLog('pedidos_venta', 'IMPRIMIR'),
  imprimirNota
)

// Almacenista confirma surtido completo (descuenta inventario)
router.patch('/:id/surtir',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  auditLog('pedidos_venta', 'EDITAR'),
  confirmarSurtido
)

// Vendedora verifica que recibió todo correctamente
router.patch('/:id/verificar',
  requireAuth,
  checkPermission('pedidos_venta', 'EDITAR'),
  verificarVendedora
)

// Checador escanea en puerta
router.patch('/:id/checador',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  escanearChecador
)

// Cierre definitivo del pedido
router.patch('/:id/cerrar',
  requireAuth,
  checkPermission('pedidos_venta', 'APROBAR'),
  auditLog('pedidos_venta', 'APROBAR'),
  cerrarPuerta
)

export default router
