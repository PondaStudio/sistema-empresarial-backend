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

// Wave 1 routes
import authRoutes       from './routes/auth'
import usersRoutes      from './routes/users'
import sucursalesRoutes from './routes/sucursales'
import permisosRoutes   from './routes/permisos'
import rolesRoutes      from './routes/roles'

app.use('/auth',        authRoutes)
app.use('/users',       usersRoutes)
app.use('/sucursales',  sucursalesRoutes)
app.use('/permisos',    permisosRoutes)
app.use('/roles',       rolesRoutes)

// Wave 2 routes
import productosRoutes   from './routes/productos'
import inventarioRoutes  from './routes/inventario'
import proveedoresRoutes from './routes/proveedores'

app.use('/productos',   productosRoutes)
app.use('/inventario',  inventarioRoutes)
app.use('/proveedores', proveedoresRoutes)

// Wave 3 routes
import pedidosVentaRoutes from './routes/pedidosVenta'
import clientesRoutes     from './routes/clientes'

app.use('/pedidos/venta', pedidosVentaRoutes)
app.use('/clientes',      clientesRoutes)

// Wave 4 routes
import comunicacionRoutes from './routes/comunicacion'
import tareasRoutes       from './routes/tareas'
import rrhhRoutes         from './routes/rrhh'

app.use('/comunicacion', comunicacionRoutes)
app.use('/tareas',       tareasRoutes)
app.use('/rrhh',         rrhhRoutes)

// Wave 5 routes
import dashboardRoutes      from './routes/dashboard'
import avisosRoutes         from './routes/avisos'
import notificacionesRoutes from './routes/notificaciones'
import bitacoraRoutes       from './routes/bitacora'

app.use('/dashboard',      dashboardRoutes)
app.use('/avisos',         avisosRoutes)
app.use('/notificaciones', notificacionesRoutes)
app.use('/bitacora',       bitacoraRoutes)

// Wave 5b routes
import capacitacionesRoutes from './routes/capacitaciones'
import evaluacionesRoutes   from './routes/evaluaciones'
import formatosRoutes       from './routes/formatos'

app.use('/capacitaciones', capacitacionesRoutes)
app.use('/evaluaciones',   evaluacionesRoutes)
app.use('/formatos',       formatosRoutes)

// Wave 6 routes — permisos granulares
import permisosGranularesRoutes from './routes/permisosGranulares'
app.use('/', permisosGranularesRoutes)

export default app
