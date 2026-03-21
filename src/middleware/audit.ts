import { Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'
import { AuthRequest } from './auth'

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
