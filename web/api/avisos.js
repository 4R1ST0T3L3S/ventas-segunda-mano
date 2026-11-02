// Avisos para el vigilante de Claude: devuelve los pendientes y marca como atendidos los ids de "atendidos".
import { cargar, guardar, claveValida } from './_datos.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (!claveValida(req, 'CLAVE_PANEL')) return res.status(401).json({ error: 'Clave incorrecta' });
  const d = await cargar(true);
  const atendidos = new Set(req.body?.atendidos ?? []);
  if (atendidos.size) {
    for (const a of d.avisos) if (atendidos.has(a.id)) a.atendido = true;
    await guardar(d);
  }
  res.json({ pendientes: d.avisos.filter((a) => !a.atendido), origenes: d.origenes });
}
