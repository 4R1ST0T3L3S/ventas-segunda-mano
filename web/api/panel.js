// Datos para la página del panel, con la clave del panel.
import { cargar, calcular, claveValida } from './_datos.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (!claveValida(req, 'CLAVE_PANEL')) return res.status(401).json({ error: 'Clave incorrecta' });
  const d = await cargar();
  const r = calcular(d);
  // Puesto de hoy en la búsqueda de Wallapop desde tu zona (null: no sale en los 120 primeros).
  const pos = d.hoy?.posiciones?.Wallapop?.anuncios ?? {};
  for (const a of r.anuncios) if (a.app === 'Wallapop' && pos[a.clave]) [a.busqueda, a.puesto] = pos[a.clave];
  res.json({ ...r, origenes: d.origenes });
}
