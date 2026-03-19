import { Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { AuthRequest } from './auth'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export function auditLog(modulo: string, accion: string) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (req.user) {
      // Fire-and-forget — don't block the request
      supabase.from('bitacora_actividad').insert({
        usuario_id: req.user.id,
        modulo,
        accion,
        metodo: req.method,
        ruta: req.originalUrl,
        ip: req.ip,
        datos: req.method !== 'GET' ? req.body : null,
      }).then()
    }
    next()
  }
}
