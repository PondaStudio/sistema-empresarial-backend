import { Router } from 'express'
import { listUsers, updateProfile, updateAdmin } from '../controllers/users'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'

const router = Router()

router.get('/',
  requireAuth,
  checkPermission('login', 'VER'),
  listUsers
)
router.patch('/:id/profile',
  requireAuth,
  auditLog('login', 'EDITAR'),
  updateProfile
)
router.patch('/:id/admin',
  requireAuth,
  checkPermission('login', 'EDITAR'),
  auditLog('login', 'EDITAR'),
  updateAdmin
)

export default router
