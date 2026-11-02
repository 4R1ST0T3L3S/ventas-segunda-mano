// Datos del panel: un solo JSON en Vercel Blob (nombre secreto en DATOS_RUTA). Formato completo en DATOS.md.
// - ventas: {clave: {fecha, app, articulo, importe, estado, entrega, codigo, hora, anuncios, pedido}}
// - lecturas: {AAAA-MM-DD: {Vinted: [anuncio], Wallapop: [anuncio]}}; la última lectura del día sustituye a las anteriores.
//   anuncio = {clave, url, articulo, precio, publicado, publicado_en, visitas, favoritos, chats, ofertas?, estado, ref};
//   ref es la REF de la descripción (null si no tiene; sin el campo, aún no se ha mirado), y une los anuncios de un
//   mismo producto. Solo el último día de cada app va entero; los anteriores, {clave, visitas, favoritos}.
// - avisos: ventas nuevas, canceladas y cerradas, para que Claude las atienda.
// - origenes: {lector | claude: {ultima, errores, notas?, sinLeer?}}, la última lectura de cada origen.
//   sinLeer = {Vinted | Wallapop: {n, desde}}: los chats sin leer y la hora del más antiguo (null si no hay).
// - errores: [{t, origen, e}], las 300 últimas lecturas que tuvieron algún problema.
// - estado: {Vinted | Wallapop: {clave: fila}}, cada anuncio en la última lectura de su app.
//   fila = [visitas, favoritos, precio, estado, chats, ofertas?]; ofertas solo en Vinted, que en Wallapop no hay.
// - hoy: {fecha, base, lecturas: [{t, app, n, c?, fuera?}], posiciones?}, todas las lecturas del día con su hora (t, ISO en UTC).
//   posiciones = {Wallapop: {t, anuncios: {clave: [búsqueda, puesto]}}}, una vez al día (ver DATOS.md).
//   base es el estado al empezar el día; c, las filas que cambiaron; fuera, los anuncios que ya no están; n, cuántos hay.
//   Una lectura sin c ni fuera también cuenta: esa media hora se miró y no cambió nada; si falta, no se miró.
//   Con la primera lectura de otro día, hoy se guarda aparte en rutaHistorial(fecha) y su fecha pasa a historial.
// - historial: [AAAA-MM-DD], los días guardados aparte.
// - fichas: {clave: {app, url, articulo, ref, publicado_en, categoria, categoria_id, marca, talla, color, estado_prenda,
//   medidas, visto_primero, visto_ultimo}}, lo que no cambia de cada anuncio, también de los que ya no están.
// - ultima: {Vinted | Wallapop: t}, la hora de la última lectura anotada de cada app.
// - estadisticas: [AAAA-MM-DD], los días con las visitas, favoritos y chats de cada anuncio según Wallapop, guardados
//   aparte en rutaEstadisticas(fecha) como {fecha, app, anuncios: {clave: [visitas, favoritos, chats]}}.
// Los cálculos de diario y anuncios son los de estadisticas/panel.py.
import { put, head, BlobNotFoundError } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

const RUTA = process.env.DATOS_RUTA;
const APPS = ['Vinted', 'Wallapop'];
const ESTADO = { C: 'Cobrado', W: 'Pendiente', N: 'Pendiente', P: 'Pendiente', X: 'Perdido', A: 'Perdido', D: 'Perdido' };

const vacio = () => ({ ventas: {}, lecturas: {}, avisos: [], origenes: {}, siguiente: 1, estado: {}, hoy: null, historial: [], fichas: {}, ultima: {}, estadisticas: [], errores: [] });
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12);
const suma = (filas, campo) => filas.reduce((s, a) => s + a[campo], 0);
export const hoy = (t = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(t);
const restar = (f, dias) => new Date(Date.parse(f + 'T00:00:00Z') - dias * 864e5).toISOString().slice(0, 10);

export function claveValida(req, variable) {
  const dada = Buffer.from(String(req.body?.clave ?? ''));
  const buena = Buffer.from(process.env[variable] ?? '');
  return buena.length > 0 && dada.length === buena.length && timingSafeEqual(dada, buena);
}

// Cada head() gasta una operación del almacén (el plan Hobby da 10.000 al mes y, si se pasa, lo cierra 30 días),
// así que la dirección del JSON, que no cambia, se pide una vez por instancia.
let direccion;
export async function cargar() {
  try {
    direccion ??= (await head(RUTA)).url;
    const r = await fetch(`${direccion}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) { direccion = null; throw new Error(`Blob ${r.status}`); }
    return { ...vacio(), ...(await r.json()) };
  } catch (e) {
    if (e instanceof BlobNotFoundError) return vacio();
    throw e;
  }
}

const opciones = { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 };
export const guardar = (d) => put(RUTA, JSON.stringify(d), opciones);
// Un día de lecturas, con la forma de hoy. Se escribe una vez, al empezar el día siguiente.
export const rutaHistorial = (fecha) => `${RUTA.replace(/\.json$/, '')}/historial/${fecha}.json`;
export const guardarDia = (dia) => put(rutaHistorial(dia.fecha), JSON.stringify(dia), opciones);
// Un día de las estadísticas de Wallapop. Se escribe una vez, cuando el día ya ha terminado.
export const rutaEstadisticas = (fecha) => `${RUTA.replace(/\.json$/, '')}/estadisticas/${fecha}.json`;
export const guardarEstadisticas = (dia) => put(rutaEstadisticas(dia.fecha), JSON.stringify(dia), opciones);
// Lee un archivo guardado aparte, que está junto al JSON principal. Esos archivos no cambian, así que puede salir
// de la caché. null si no existe.
export async function leerArchivo(ruta) {
  direccion ??= (await head(RUTA)).url;
  const url = new URL(direccion);
  url.pathname = '/' + ruta;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Blob ${r.status}`);
  return r.json();
}

const fila = (a) => [a.visitas, a.favoritos, a.precio, a.estado, a.chats ?? null, ...(a.ofertas != null ? [a.ofertas] : [])];

// Anota en hoy, estado y fichas una lectura de una app hecha a la hora t. Si es del día siguiente, devuelve el día
// que se cierra, para guardarlo aparte.
function anotar(d, app, filas, t) {
  const dia = hoy(new Date(t)), archivar = [];
  if (d.hoy && d.hoy.fecha !== dia) {
    archivar.push(d.hoy);
    if (!d.historial.includes(d.hoy.fecha)) d.historial.push(d.hoy.fecha);
    d.hoy = null;
  }
  d.hoy ??= { fecha: dia, base: structuredClone(d.estado), lecturas: [] };
  const antes = d.estado[app] ?? {}, ahora = {}, c = {};
  for (const a of filas) {
    ahora[a.clave] = fila(a);
    if (JSON.stringify(ahora[a.clave]) !== JSON.stringify(antes[a.clave])) c[a.clave] = ahora[a.clave];
    const f = (d.fichas[a.clave] ??= { app, visto_primero: t });
    Object.assign(f, { url: a.url, articulo: a.articulo, publicado_en: a.publicado_en ?? f.publicado_en ?? null, visto_ultimo: t });
    if ('ref' in a) f.ref = a.ref;
  }
  const fuera = Object.keys(antes).filter((k) => !(k in ahora));
  d.hoy.lecturas.push({ t, app, n: filas.length, ...(Object.keys(c).length && { c }), ...(fuera.length && { fuera }) });
  d.estado[app] = ahora;
  d.ultima[app] = t;
  return archivar;
}

// datos = {origen, errores, sinAvisos, reemplazarVentas, horas: {Vinted?: t, Wallapop?: t},
//          anuncios: {Vinted?: [anuncio], Wallapop?: [anuncio]}, fichas: {clave: ficha},
//          ventas: [{clave, fecha, app, articulo, importe, codigo?, estado?, entrega?, hora?, anuncios?, pedido?}],
//          estadisticas: {Wallapop: {clave: [[AAAA-MM-DD, visitas, favoritos, chats]]}}}
// horas es cuándo se leyó cada app; sin ella, ahora. Una lectura más vieja que la última anotada de su app se salta.
// Las ventas "En mano" de Wallapop son los vendidos del catálogo, que incluyen los vendidos con envío: se descartan
// los que tienen una venta con envío (no perdida) del mismo anuncio o del mismo comienzo de título, como en panel.py.
// reemplazarVentas borra las ventas guardadas antes de añadir las que llegan: solo para recargar el historial entero.
// soloNuevas no toca las ventas que ya están (las de Claude pueden ser más viejas que las de la extensión).
// Devuelve {nuevos, archivar, estadisticas}: los avisos nuevos y los días que hay que guardar con guardarDia y
// guardarEstadisticas antes de guardar d.
export function ingerir(d, datos, ahora = new Date()) {
  const dia = hoy(ahora), creado = ahora.toISOString(), archivar = [], estadisticas = {};
  let nuevos = 0;
  if (datos.reemplazarVentas) d.ventas = {};
  for (const app of APPS) {
    const filas = datos.anuncios?.[app];
    if (!Array.isArray(filas) || !filas.length) continue;
    const t = Date.parse(datos.horas?.[app]) ? new Date(datos.horas[app]).toISOString() : creado;
    if (t <= (d.ultima[app] ?? '') || (d.hoy && hoy(new Date(t)) < d.hoy.fecha)) continue;
    const diaT = hoy(new Date(t));
    (d.lecturas[diaT] ??= {})[app] = filas;
    // Los días anteriores de esa app se quedan solo con lo que usa calcular de ellos: el resto está en fichas y en el
    // historial. Así el JSON crece unos 4 KB al día en vez de 30 (el plan Hobby deja leer 10 GB al mes).
    for (const [f, l] of Object.entries(d.lecturas)) {
      if (f < diaT && l[app]?.[0]?.url) l[app] = l[app].map(({ clave, visitas, favoritos }) => ({ clave, visitas, favoritos }));
    }
    archivar.push(...anotar(d, app, filas, t));
  }
  // El puesto de cada anuncio en la búsqueda de Wallapop, una vez al día: va con el día al historial.
  if (datos.posiciones?.Wallapop && d.hoy) (d.hoy.posiciones ??= {}).Wallapop = { t: datos.horas?.Wallapop ?? creado, anuncios: datos.posiciones.Wallapop };
  for (const [clave, f] of Object.entries(datos.fichas ?? {})) d.fichas[clave] = { ...d.fichas[clave], ...f };
  // Las fechas de Wallapop son las de su API (medianoche en UTC). Un día que aún no ha terminado se salta: vuelve mañana.
  for (const [clave, filas] of Object.entries(datos.estadisticas?.Wallapop ?? {})) {
    for (const [fecha, ...valores] of Array.isArray(filas) ? filas : []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha >= creado.slice(0, 10) || d.estadisticas.includes(fecha)) continue;
      (estadisticas[fecha] ??= { fecha, app: 'Wallapop', anuncios: {} }).anuncios[clave] = valores;
    }
  }
  d.estadisticas = [...d.estadisticas, ...Object.keys(estadisticas)].sort();
  for (const v of datos.ventas ?? []) {
    const estado = v.estado ?? ESTADO[v.codigo];
    if (!v.clave || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha ?? '') || Number.isNaN(Date.parse(v.fecha)) || !estado) continue;
    if (v.app === 'Wallapop' && v.entrega === 'En mano' && Object.values(d.ventas).some((e) => e.app === 'Wallapop' && e.entrega === 'Envío'
      && e.estado !== 'Perdido' && (v.anuncios?.some((a) => e.anuncios?.includes(a)) || norm(e.articulo) === norm(v.articulo)))) {
      delete d.ventas[v.clave]; // por si entró antes de que llegara su venta con envío
      continue;
    }
    const antes = d.ventas[v.clave];
    if (antes && datos.soloNuevas) continue;
    const tipo = !antes ? (v.fecha >= restar(dia, 3) ? 'venta nueva' : null)
      : antes.estado === estado ? null : estado === 'Perdido' ? 'cancelada' : estado === 'Cobrado' ? 'cerrada' : 'cambio';
    if (tipo && !datos.sinAvisos) {
      d.avisos.push({ id: d.siguiente++, creado, app: v.app, tipo, clave: v.clave, articulo: v.articulo, antes: antes?.estado ?? null, ahora: estado, atendido: false });
      nuevos++;
    }
    d.ventas[v.clave] = {
      fecha: v.fecha, app: v.app, articulo: v.articulo || antes?.articulo || '', importe: Number(v.importe), estado,
      entrega: v.entrega ?? antes?.entrega ?? 'Envío', codigo: v.codigo ?? antes?.codigo ?? null,
      hora: v.hora ?? antes?.hora ?? null, anuncios: v.anuncios ?? antes?.anuncios ?? null, pedido: v.pedido ?? antes?.pedido ?? null,
    };
  }
  d.avisos = d.avisos.slice(-300);
  const limite = restar(dia, 400);
  for (const f of Object.keys(d.lecturas)) if (f < limite) delete d.lecturas[f];
  // notas: lo último que un origen quiso dejar apuntado aparte de los errores (por ejemplo, el resultado de una prueba).
  // sinLeer: los chats sin leer de cada app; si una app no se pudo mirar, se queda lo último que se supo de ella.
  const notas = datos.notas ?? d.origenes[datos.origen]?.notas;
  const sinLeer = { ...d.origenes[datos.origen]?.sinLeer, ...datos.sinLeer };
  if (datos.origen) d.origenes[datos.origen] = { ultima: creado, errores: datos.errores || null, ...(notas && { notas }), ...(Object.keys(sinLeer).length && { sinLeer }) };
  // origenes solo guarda los problemas de la última lectura: aquí quedan todos, para ver los que van y vienen.
  if (datos.origen && datos.errores) d.errores = [...(d.errores ?? []), { t: creado, origen: datos.origen, e: datos.errores }].slice(-300);
  return { nuevos, archivar, estadisticas: Object.values(estadisticas) };
}

export function calcular(d) {
  const fechas = Object.keys(d.lecturas).sort();
  const diario = [], previo = {};
  for (const fecha of fechas) {
    for (const app of APPS) {
      const filas = d.lecturas[fecha][app];
      if (!filas?.length) continue; // esa app no se leyó ese día
      const ant = previo[app];
      const sube = (campo) => (ant ? filas.reduce((s, a) => s + Math.max(0, a[campo] - (ant[a.clave]?.[campo] ?? 0)), 0) : null);
      diario.push({ fecha, app, anuncios: filas.length, visitas: suma(filas, 'visitas'), favoritos: suma(filas, 'favoritos'),
        visitas_nuevas: sube('visitas'), favoritos_nuevos: sube('favoritos') });
      previo[app] = Object.fromEntries(filas.map((a) => [a.clave, a]));
    }
  }
  // Anuncios de la última lectura de cada app y lo que han subido sus visitas en 7 días
  // (null hasta que haya una lectura de hace una semana o más).
  const anuncios = [];
  for (const app of APPS) {
    const dias = fechas.filter((f) => d.lecturas[f][app]?.length);
    if (!dias.length) continue;
    const ult = dias.at(-1);
    const base = dias.filter((f) => f <= restar(ult, 7)).at(-1);
    const ref = base ? Object.fromEntries(d.lecturas[base][app].map((a) => [a.clave, a])) : null;
    for (const a of d.lecturas[ult][app]) {
      anuncios.push({ ...a, app, dias: a.publicado ? Math.round((Date.parse(ult) - Date.parse(a.publicado)) / 864e5) : null,
        visitas_7d: ref ? a.visitas - (ref[a.clave]?.visitas ?? 0) : null });
    }
  }
  const ventas = Object.entries(d.ventas).map(([clave, v]) => ({ clave, ...v }));
  return { ventas, diario, anuncios };
}
