import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../middleware/auth'
import { checkPermission } from '../middleware/permissions'
import { AuthRequest } from '../middleware/auth'
import { Response } from 'express'

const router = Router()
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

router.get('/kpis', requireAuth, checkPermission('dashboard', 'VER'), async (_req: AuthRequest, res: Response) => {
  const now = new Date()
  const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [ventas, pedidosPendientes, tareas, stockBajo, presencia] = await Promise.all([
    // Ventas del mes (pedidos completados)
    supabase.from('pedidos_venta')
      .select('total', { count: 'exact' })
      .gte('created_at', primerDiaMes)
      .in('estado', ['entregado', 'facturado']),

    // Pedidos pendientes de atención
    supabase.from('pedidos_venta')
      .select('id', { count: 'exact' })
      .in('estado', ['pendiente', 'confirmado', 'surtiendo']),

    // Tareas por estado
    supabase.from('tareas')
      .select('estado'),

    // Productos con stock bajo mínimo (column comparison done in JS)
    supabase.from('inventario')
      .select('cantidad_actual, stock_minimo'),

    // Usuarios con presencia activa
    supabase.from('usuarios')
      .select('id', { count: 'exact' })
      .eq('estado_presencia', 'disponible'),
  ])

  const totalVentas = (ventas.data ?? []).reduce((sum: number, p: any) => sum + (p.total ?? 0), 0)

  const tareasPorEstado = (tareas.data ?? []).reduce((acc: Record<string, number>, t: any) => {
    acc[t.estado] = (acc[t.estado] ?? 0) + 1
    return acc
  }, {})

  return res.json({
    ventas_mes:        totalVentas,
    pedidos_pendientes: pedidosPendientes.count ?? 0,
    tareas:            tareasPorEstado,
    stock_bajo:        (stockBajo.data ?? []).filter((i: any) => i.cantidad_actual <= (i.stock_minimo ?? 0)).length,
    usuarios_activos:  presencia.count ?? 0,
  })
})

router.get('/ventas-semana', requireAuth, checkPermission('dashboard', 'VER'), async (_req: AuthRequest, res: Response) => {
  const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('pedidos_venta')
    .select('created_at, total')
    .gte('created_at', hace7)
    .in('estado', ['entregado', 'facturado'])
    .order('created_at')

  if (error) return res.status(500).json({ error: 'DB_ERROR' })

  // Agrupar por día
  const porDia: Record<string, number> = {}
  for (const p of data ?? []) {
    const dia = p.created_at.slice(0, 10)
    porDia[dia] = (porDia[dia] ?? 0) + (p.total ?? 0)
  }

  return res.json(Object.entries(porDia).map(([fecha, total]) => ({ fecha, total })))
})

export default router
