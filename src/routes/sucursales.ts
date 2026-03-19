import { Router } from 'express'
import { listSucursales, createSucursal, updateSucursal } from '../controllers/sucursales'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'

const router = Router()

router.get('/',
  requireAuth,
  checkPermission('login', 'VER'),
  listSucursales
)
router.post('/',
  requireAuth,
  checkPermission('login', 'CREAR'),
  auditLog('login', 'CREAR'),
  createSucursal
)
router.patch('/:id',
  requireAuth,
  checkPermission('login', 'EDITAR'),
  auditLog('login', 'EDITAR'),
  updateSucursal
)

export default router
