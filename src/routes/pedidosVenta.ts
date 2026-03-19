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

router.get('/',                          requireAuth, checkPermission('pedidos_venta', 'VER'),    listPedidos)
router.post('/',                         requireAuth, checkPermission('pedidos_venta', 'CREAR'),  auditLog('pedidos_venta', 'CREAR'), crearPedido)
router.get('/:id',                       requireAuth, checkPermission('pedidos_venta', 'VER'),    getPedido)
router.patch('/:id/items/:itemId',       requireAuth, checkPermission('pedidos_venta', 'EDITAR'), auditLog('pedidos_venta', 'EDITAR'), confirmarItem)
router.post('/:id/imprimir',             requireAuth, checkPermission('pedidos_venta', 'IMPRIMIR'), auditLog('pedidos_venta', 'IMPRIMIR'), imprimirNota)
router.patch('/:id/surtir',             requireAuth, checkPermission('pedidos_venta', 'EDITAR'), auditLog('pedidos_venta', 'EDITAR'), confirmarSurtido)
router.patch('/:id/verificar-vendedora', requireAuth, checkPermission('pedidos_venta', 'EDITAR'), verificarVendedora)
router.patch('/:id/checador',            requireAuth, checkPermission('pedidos_venta', 'APROBAR'), auditLog('pedidos_venta', 'APROBAR'), escanearChecador)
router.patch('/:id/puerta',             requireAuth, checkPermission('pedidos_venta', 'APROBAR'), auditLog('pedidos_venta', 'APROBAR'), cerrarPuerta)

export default router
