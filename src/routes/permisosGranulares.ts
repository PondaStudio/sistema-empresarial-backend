import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { auditLog } from '../middleware/audit'
import {
  listSubfunciones,
  getUserPermisosGranulares,
  saveUserPermisosGranulares,
  resetUserPermisosGranulares,
} from '../controllers/permisosGranulares'

const router = Router()

// Sub-funciones del sistema (referencia estática)
router.get('/subfunciones', listSubfunciones)

// Permisos granulares por usuario
router.get('/permisos-granulares/:userId',        requireAuth, getUserPermisosGranulares)
router.put('/permisos-granulares/:userId',         requireAuth, auditLog('permisos', 'EDITAR'), saveUserPermisosGranulares)
router.delete('/permisos-granulares/:userId/reset',requireAuth, auditLog('permisos', 'ELIMINAR'), resetUserPermisosGranulares)

export default router
