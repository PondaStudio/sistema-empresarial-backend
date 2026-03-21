import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

export async function listSucursales(_req: AuthRequest, res: Response) {
  try {
    const { data, error } = await supabase
      .from('sucursales')
      .select('*')
      .eq('activa', true)
      .order('nombre')

    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

const sucursalSchema = z.object({
  nombre:         z.string().min(2).max(150),
  direccion:      z.string().optional(),
  horarios:       z.record(z.any()).optional(),
  areas_internas: z.array(z.string()).optional(),
})

export async function createSucursal(req: AuthRequest, res: Response) {
  try {
    if (req.user!.rol_nivel > 2) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const parsed = sucursalSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { data, error } = await supabase.from('sucursales').insert(parsed.data).select().single()
    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })

    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

export async function updateSucursal(req: AuthRequest, res: Response) {
  try {
    if (req.user!.rol_nivel > 4) {
      return res.status(403).json({ error: 'FORBIDDEN' })
    }

    const parsed = sucursalSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { error } = await supabase.from('sucursales').update(parsed.data).eq('id', req.params.id)
    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

    return res.json({ message: 'Sucursal actualizada' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}
