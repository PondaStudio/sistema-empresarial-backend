import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { config } from 'dotenv'

config()

const app = express()

// Security
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}))

// Body parsing
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'backend' })
})

// Todas las rutas bajo /api
import { Router } from 'express'
const api = Router()

// Wave 1 routes
import authRoutes       from './routes/auth'
import usersRoutes      from './routes/users'
import sucursalesRoutes from './routes/sucursales'
import permisosRoutes   from './routes/permisos'
import rolesRoutes      from './routes/roles'

api.use('/auth',        authRoutes)
api.use('/users',       usersRoutes)
api.use('/sucursales',  sucursalesRoutes)
api.use('/permisos',    permisosRoutes)
api.use('/roles',       rolesRoutes)

// Wave 2 routes
import productosRoutes   from './routes/productos'
import inventarioRoutes  from './routes/inventario'
import proveedoresRoutes from './routes/proveedores'

api.use('/productos',   productosRoutes)
api.use('/inventario',  inventarioRoutes)
api.use('/proveedores', proveedoresRoutes)

// Wave 3 routes
import pedidosVentaRoutes from './routes/pedidosVenta'
import clientesRoutes     from './routes/clientes'
import areasBodegaRoutes  from './routes/areasBodega'

api.use('/pedidos/venta', pedidosVentaRoutes)
api.use('/clientes',      clientesRoutes)
api.use('/areas-bodega',  areasBodegaRoutes)

// Wave 4 routes
import comunicacionRoutes from './routes/comunicacion'
import tareasRoutes       from './routes/tareas'
import rrhhRoutes         from './routes/rrhh'

api.use('/comunicacion', comunicacionRoutes)
api.use('/tareas',       tareasRoutes)
api.use('/rrhh',         rrhhRoutes)

// Wave 5 routes
import dashboardRoutes      from './routes/dashboard'
import avisosRoutes         from './routes/avisos'
import notificacionesRoutes from './routes/notificaciones'
import bitacoraRoutes       from './routes/bitacora'

api.use('/dashboard',      dashboardRoutes)
api.use('/avisos',         avisosRoutes)
api.use('/notificaciones', notificacionesRoutes)
api.use('/bitacora',       bitacoraRoutes)

// Wave 5b routes
import capacitacionesRoutes from './routes/capacitaciones'
import evaluacionesRoutes   from './routes/evaluaciones'
import formatosRoutes       from './routes/formatos'

api.use('/capacitaciones', capacitacionesRoutes)
api.use('/evaluaciones',   evaluacionesRoutes)
api.use('/formatos',       formatosRoutes)

// Wave 6 routes — permisos granulares
import permisosGranularesRoutes from './routes/permisosGranulares'
api.use('/', permisosGranularesRoutes)

app.use('/api', api)

export default app
