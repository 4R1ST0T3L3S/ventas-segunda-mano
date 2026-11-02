// Recibe una lectura de la extensión de Chrome (origen "lector") o de Claude (origen "claude").
import { cargar, guardar, guardarDia, guardarEstadisticas, ingerir, claveValida } from './_datos.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (!claveValida(req, 'CLAVE_LECTOR')) return res.status(401).json({ error: 'Clave incorrecta' });
  const datos = req.body?.datos;
  if (!datos || typeof datos !== 'object') return res.status(400).json({ error: 'Faltan los datos' });
  const d = await cargar(true);
  const { nuevos, archivar, estadisticas } = ingerir(d, datos);
  // Los días que se cierran se guardan antes que d: si después falla d, la siguiente lectura los vuelve a escribir igual.
  for (const dia of archivar) await guardarDia(dia);
  for (const dia of estadisticas) await guardarEstadisticas(dia);
  await guardar(d);
  res.json({ ok: true, avisos: nuevos, ventas: Object.keys(d.ventas).length, dias: Object.keys(d.lecturas).length, lecturasHoy: d.hoy?.lecturas.length ?? 0 });
}
