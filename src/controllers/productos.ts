import { Response } from 'express'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

export async function listProductos(req: AuthRequest, res: Response) {
  try {
    const { q, categoria_id, activo = 'true' } = req.query as Record<string, string>

    let query = supabase
      .from('productos')
      .select('id, codigo, nombre, descripcion, foto_url, activo, categoria_id, categorias(nombre)')
      .eq('activo', activo === 'true')
      .order('nombre')

    if (q) query = query.ilike('nombre', `%${q}%`)
    if (categoria_id) query = query.eq('categoria_id', categoria_id)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: 'DB_ERROR' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

const productoSchema = z.object({
  codigo:       z.string().min(1).max(100),
  nombre:       z.string().min(1).max(300),
  categoria_id: z.string().uuid().optional(),
  descripcion:  z.string().optional(),
  foto_url:     z.string().url().optional(),
})

export async function createProducto(req: AuthRequest, res: Response) {
  try {
    const parsed = productoSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { data, error } = await supabase.from('productos').insert(parsed.data).select().single()
    if (error?.code === '23505') return res.status(409).json({ error: 'CODIGO_DUPLICADO' })
    if (error) return res.status(500).json({ error: 'CREATE_FAILED' })
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}

export async function updateProducto(req: AuthRequest, res: Response) {
  try {
    const parsed = productoSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

    const { error } = await supabase.from('productos').update(parsed.data).eq('id', req.params.id)
    if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })
    return res.json({ message: 'Producto actualizado' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error interno' })
  }
}
