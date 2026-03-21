import { Router } from 'express'
import { getMe, updateMe, listUsers, updateProfile, updateAdmin } from '../controllers/users'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'

const router = Router()

// /me routes must come before /:id to avoid param collision
router.get('/me',
  requireAuth,
  getMe
)
router.patch('/me',
  requireAuth,
  updateMe
)

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
