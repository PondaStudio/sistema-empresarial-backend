import * as dotenv from 'dotenv'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function importar() {
  const ruta = 'C:\\Users\\chris\\Documents\\sistema-empresarial-backend\\Lista de productos.xlsx'
  const wb = XLSX.readFile(ruta)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]

  const map = new Map<string, string>()
  for (let i = 6; i < data.length; i++) {
    const row = data[i]
    const codigo = String(row[0] ?? '').trim()
    const nombre = String(row[1] ?? '').trim().replace(/^'/, '')
    if (codigo && nombre && codigo !== 'undefined' && nombre !== 'undefined') {
      map.set(codigo, nombre)
    }
  }
  const productos = Array.from(map.entries()).map(([codigo, nombre]) => ({ codigo, nombre }))

  console.log(`Total productos únicos a insertar: ${productos.length}`)

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
