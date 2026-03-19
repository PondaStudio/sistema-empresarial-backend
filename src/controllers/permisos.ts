import { Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { AuthRequest } from '../middleware/auth'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function getMyPermisos(req: AuthRequest, res: Response) {
  const { data: overrides } = await supabase
    .from('permisos_usuario')
    .select('modulo, accion, habilitado')
    .eq('usuario_id', req.user!.id)

  const { data: base } = await supabase
    .from('permisos_base')
    .select('modulo, accion, habilitado')
    .eq('rol_id', req.user!.rol_id)

  // Merge: individual overrides take precedence over role defaults
  const merged: Record<string, Record<string, boolean>> = {}

  for (const p of base ?? []) {
    if (!merged[p.modulo]) merged[p.modulo] = {}
    merged[p.modulo][p.accion] = p.habilitado
  }
  for (const p of overrides ?? []) {
    if (!merged[p.modulo]) merged[p.modulo] = {}
    merged[p.modulo][p.accion] = p.habilitado
  }

  return res.json(merged)
}

const permisosSchema = z.object({
  permisos: z.array(z.object({
    modulo:    z.string(),
    accion:    z.enum(['VER','CREAR','EDITAR','ELIMINAR','EXPORTAR','APROBAR','IMPRIMIR']),
    habilitado: z.boolean(),
  })).min(1),
})

export async function updateUserPermisos(req: AuthRequest, res: Response) {
  // Only Creador can modify permissions
  if (req.user!.rol_nivel !== 1) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Solo el Creador puede modificar permisos individuales' })
  }

  const { userId } = req.params

  // Prevent modifying users of equal or higher rank than current user
  const { data: target } = await supabase
    .from('usuarios')
    .select('rol_id, roles(nivel)')
    .eq('id', userId)
    .single()

  const targetNivel = (target as any)?.roles?.nivel ?? 0
  if (targetNivel <= req.user!.rol_nivel) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'No puedes modificar permisos de igual o mayor rango' })
  }

  const parsed = permisosSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })

  const upserts = parsed.data.permisos.map(p => ({
    usuario_id:     userId,
    modulo:         p.modulo,
    accion:         p.accion,
    habilitado:     p.habilitado,
    modificado_por: req.user!.id,
  }))

  const { error } = await supabase
    .from('permisos_usuario')
    .upsert(upserts, { onConflict: 'usuario_id,modulo,accion' })

  if (error) return res.status(500).json({ error: 'UPDATE_FAILED' })

  return res.json({ message: `${upserts.length} permiso(s) actualizado(s)` })
}
