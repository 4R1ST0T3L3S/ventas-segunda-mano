// Los datos guardados tal cual, con la clave del panel, para analizarlos (formato en DATOS.md).
// Sin más: {hoy, historial, estadisticas, fichas, estado, ultima, origenes, errores, bytes}. bytes es lo que ocupa el JSON principal.
// Con {dia: "AAAA-MM-DD"}: ese día del historial (tipo "historial", por defecto) o de las estadísticas de Wallapop
// (tipo "estadisticas"); null si no está guardado.
import { cargar, claveValida, leerArchivo, rutaHistorial, rutaEstadisticas } from './_datos.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (!claveValida(req, 'CLAVE_PANEL')) return res.status(401).json({ error: 'Clave incorrecta' });
  const { dia, tipo = 'historial' } = req.body ?? {};
  if (dia !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !['historial', 'estadisticas'].includes(tipo)) return res.status(400).json({ error: 'dia o tipo no válidos' });
    return res.json(await leerArchivo(tipo === 'historial' ? rutaHistorial(dia) : rutaEstadisticas(dia)));
  }
  const d = await cargar();
  const { hoy, historial, estadisticas, fichas, estado, ultima, origenes, errores = [] } = d;
  res.json({ hoy, historial, estadisticas, fichas, estado, ultima, origenes, errores, bytes: JSON.stringify(d).length });
}
