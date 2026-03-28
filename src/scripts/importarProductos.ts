import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

async function importar() {
  const ruta = 'C:\\Users\\chris\\Documents\\sistema-empresarial-backend\\Lista_de_productos.xlsx'
  const wb = XLSX.readFile(ruta)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]

  const productos: { codigo: string; nombre: string }[] = []
  for (let i = 6; i < data.length; i++) {
    const row = data[i]
    const codigo = String(row[0] ?? '').trim()
    const nombre = String(row[1] ?? '').trim().replace(/^'/, '')
    if (codigo && nombre && codigo !== 'undefined' && nombre !== 'undefined') {
      productos.push({ codigo, nombre })
    }
  }

  console.log(`Total productos a insertar: ${productos.length}`)

  const loteSize = 100
  const lotes = Math.ceil(productos.length / loteSize)

  for (let i = 0; i < lotes; i++) {
    const lote = productos.slice(i * loteSize, (i + 1) * loteSize)
    const { error } = await supabase
      .from('productos')
      .upsert(
        lote.map(p => ({ codigo: p.codigo, nombre: p.nombre, activo: true })),
        { onConflict: 'codigo' }
      )
    if (error) {
      console.error(`Error en lote ${i + 1}:`, error.message)
    } else {
      console.log(`Lote ${i + 1}/${lotes} insertado ✅`)
    }
  }
  console.log('¡Importación completa!')
}

importar()
