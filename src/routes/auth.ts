import { Router } from 'express'
import { invite, login, logout, me } from '../controllers/auth'
import { requireAuth } from '../middleware/auth'
import { auditLog } from '../middleware/audit'

const router = Router()

router.post('/invite', requireAuth, auditLog('login', 'CREAR'), invite)
router.post('/login',  login)
router.post('/logout', requireAuth, logout)
router.get('/me',      requireAuth, me)

export default router
