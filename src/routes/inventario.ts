import { Router } from 'express'
import { listInventario, getAlertas, ajustarInventario, registrarMerma, importCedis, getCedisStatus, upload } from '../controllers/inventario'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { auditLog } from '../middleware/audit'

const router = Router()

router.get('/',                     requireAuth, checkPermission('inventario', 'VER'),    listInventario)
router.get('/alertas',              requireAuth, checkPermission('inventario', 'VER'),    getAlertas)
router.get('/import-cedis/status',  requireAuth, checkPermission('inventario', 'VER'),    getCedisStatus)
router.patch('/:id',                requireAuth, checkPermission('inventario', 'EDITAR'), auditLog('inventario', 'EDITAR'), ajustarInventario)
router.post('/mermas',              requireAuth, checkPermission('inventario', 'CREAR'),  auditLog('inventario', 'CREAR'), registrarMerma)
router.post('/import-cedis',        requireAuth, checkPermission('inventario', 'CREAR'),  auditLog('inventario', 'CREAR'), upload.single('file'), importCedis)

export default router
