import { Router } from 'express'
import { getMyPermisos, updateUserPermisos } from '../controllers/permisos'
import { requireAuth } from '../middleware/auth'
import { auditLog } from '../middleware/audit'

const router = Router()

router.get('/me',
  requireAuth,
  getMyPermisos
)
router.patch('/:userId',
  requireAuth,
  auditLog('permisos', 'EDITAR'),
  updateUserPermisos
)

export default router
