import { Router } from 'express'
import { listProductos, createProducto, updateProducto } from '../controllers/productos'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'

const router = Router()

router.get('/',     requireAuth, checkPermission('catalogo', 'VER'), listProductos)
router.post('/',    requireAuth, checkPermission('catalogo', 'CREAR'), auditLog('catalogo', 'CREAR'), createProducto)
router.patch('/:id', requireAuth, checkPermission('catalogo', 'EDITAR'), auditLog('catalogo', 'EDITAR'), updateProducto)

export default router
