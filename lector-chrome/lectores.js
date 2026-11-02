// Lecturas de Vinted y Wallapop con la sesión abierta en Chrome. Cada una devuelve
// {anuncios?, fichas?, ventas?} con el formato de /api/ingesta (DATOS.md), o {error}.
// Desde la 1.7, fondo.js llama las de Vinted directamente, sin página, como las de Wallapop. Si fallan, las vuelve a
// pedir dentro de una página de www.vinted.es (chrome.scripting, mundo MAIN), así que cada una va sola, sin nada de
// fuera de ella, y con la dirección completa. Las de Wallapop llevan el token de la sesión como último argumento.

// miembro: tu número de Vinted (el de vinted.es/member/…).
export async function leerVinted(miembro) {
  try {
    const pedir = (u) => fetch('https://www.vinted.es' + u, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
    // The session token lasts a few hours. In the background tab Vinted's own /session-refresh page
    // does not renew it, and every reading got 401 until someone opened Vinted (twice on 28-10-2026).
    // Renew it the way that page does and try once more.
    const get = async (u) => {
      let r = await pedir(u);
      if (r.status === 401 && (await fetch('https://www.vinted.es/web/api/auth/refresh', { method: 'POST', credentials: 'include' })).ok) r = await pedir(u);
      if (!r.ok) throw new Error(`${r.status} en ${u.split('?')[0]}`);
      return r.json();
    };
    const dia = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(t * 1000);
    const anuncios = [], fichas = {};
    for (let p = 1, total = 1; p <= total; p++) {
      const w = await get(`/api/v2/wardrobe/${miembro}/items?page=${p}&per_page=96&order=relevance`);
      total = w.pagination.total_pages;
      for (const it of w.items) {
        if (it.is_closed || it.is_draft) continue;
        // La hora de subida de la primera foto es la de publicación: Vinted no da otra.
        const subido = it.photos?.[0]?.high_resolution?.timestamp;
        anuncios.push({
          clave: 'V' + it.id, url: `https://www.vinted.es/items/${it.id}`, articulo: it.title, precio: Number(it.price?.amount ?? it.price), publicado: subido ? dia(subido) : null,
          publicado_en: subido ? new Date(subido * 1000).toISOString() : null,
          visitas: it.view_count, favoritos: it.favourite_count, estado: it.is_hidden ? 'oculto' : it.is_reserved ? 'reservado' : 'activo',
        });
        fichas['V' + it.id] = { marca: it.brand || null, talla: it.size || null, estado_prenda: it.status || null };
      }
    }
    // Pedidos de los últimos 60 días; los anteriores ya están en el panel.
    const desde = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const codigo = (s) => /finalizado/i.test(s) ? 'C' : /reembolso autom/i.test(s) ? 'A' : /cancelad|reembolso/i.test(s) ? 'X'
      : /enviado|camino|entregado|recog|punto/i.test(s) && !/etiqueta/i.test(s) ? 'W' : 'N';
    const ventas = [];
    for (let p = 1, total = 1; p <= total; p++) {
      const o = await get(`/api/v2/my_orders?type=sold&status=all&per_page=100&page=${p}`);
      total = o.pagination.total_pages;
      for (const x of o.my_orders) {
        // date viene en UTC; el día es el de Madrid (un pedido a las 00:30 es de ese día, no del anterior).
        const fecha = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(x.date));
        if (fecha >= desde) ventas.push({ clave: 'V' + x.transaction_id, fecha, hora: new Date(x.date).toISOString(), app: 'Vinted', articulo: x.title,
          importe: Number(x.price?.amount ?? x.price), codigo: codigo(x.status), entrega: 'Envío' });
      }
      if (o.my_orders.at(-1)?.date.slice(0, 10) < desde) break;
    }
    return { anuncios, fichas, ventas };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Lo que la lista del armario no trae de un anuncio, de la misma API que
// usa el formulario de editarlo: la REF (solo está en la descripción), la categoría, el color y las medidas del
// recuadro "Medidas". fondo.js lo pide una sola vez por anuncio y lo guarda.
export async function leerFichaVinted(id) {
  try {
    const pedir = () => fetch(`https://www.vinted.es/api/v2/item_upload/items/${id}`, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
    let r = await pedir();
    if (r.status === 401 && (await fetch('https://www.vinted.es/web/api/auth/refresh', { method: 'POST', credentials: 'include' })).ok) r = await pedir();
    if (!r.ok) throw new Error(`${r.status} en item_upload/items/${id}`);
    const it = (await r.json()).item;
    const refs = [...new Set([...(it.description ?? '').matchAll(/REF\s*(\d{4})/gi)].map((m) => m[1]))];
    return { ficha: {
      ref: refs.length === 1 ? refs[0] : null, categoria_id: it.catalog_id ?? null, color: [it.color1, it.color2].filter(Boolean).join(', ') || null,
      medidas: it.measurement_length || it.measurement_width ? { largo: it.measurement_length ?? null, ancho: it.measurement_width ?? null } : null,
    } };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Los anuncios que se vendieron en un pedido (varios si es un lote).
export async function leerPedidoVinted(id) {
  try {
    const pedir = () => fetch(`https://www.vinted.es/api/v2/transactions/${id}`, { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
    let r = await pedir();
    if (r.status === 401 && (await fetch('https://www.vinted.es/web/api/auth/refresh', { method: 'POST', credentials: 'include' })).ok) r = await pedir();
    if (!r.ok) throw new Error(`${r.status} en transactions/${id}`);
    const t = (await r.json()).transaction;
    const ids = (t.order?.items ?? []).map((i) => i.id);
    if (!ids.length && t.item_id) ids.push(t.item_id);
    return { anuncios: ids.map((i) => 'V' + i) };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// De qué anuncio es cada chat de la bandeja y cuántas ofertas lleva.
// conocidos = {id del chat: {hora, anuncio, ofertas}} de lecturas anteriores. Solo se abren los chats nuevos o con
// mensajes nuevos, como mucho 10 por lectura, y nunca uno sin leer: así no se marca como leído antes de que lo
// veas. Devuelve {chats: {id: {hora, anuncio, ofertas} | null}, sinLeer: {n, desde}}; null es un chat que aún no se
// ha podido abrir. sinLeer cuenta los chats sin leer; desde es la hora del último mensaje del más antiguo (null si no hay).
export async function leerChatsVinted(conocidos) {
  try {
    const h = { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } };
    const get = async (u) => {
      let r = await fetch('https://www.vinted.es' + u, h);
      if (r.status === 401 && (await fetch('https://www.vinted.es/web/api/auth/refresh', { method: 'POST', credentials: 'include' })).ok) r = await fetch('https://www.vinted.es' + u, h);
      if (!r.ok) throw new Error(`${r.status} en ${u.split('?')[0]}`);
      return r.json();
    };
    const chats = {}, sinLeer = { n: 0, desde: null };
    let abiertos = 0;
    for (let p = 1, total = 1; p <= total; p++) {
      const b = await get(`/api/v2/inbox?page=${p}&per_page=50`);
      total = b.pagination.total_pages;
      for (const c of b.conversations) {
        if (c.unread) {
          const t = new Date(c.updated_at).toISOString();
          sinLeer.n++;
          if (!sinLeer.desde || t < sinLeer.desde) sinLeer.desde = t;
        }
        const antes = conocidos[c.id];
        if (antes?.hora === c.updated_at || c.unread || abiertos >= 10) { chats[c.id] = antes ?? null; continue; }
        abiertos++;
        await new Promise((ok) => setTimeout(ok, 1500 + Math.random() * 2500));
        const x = (await get('/api/v2/conversations/' + c.id)).conversation, t = x.transaction;
        // Los chats en los que compras tú no cuentan.
        chats[c.id] = { hora: c.updated_at, anuncio: t?.current_user_side === 'seller' && t.item_id ? 'V' + t.item_id : null,
          ofertas: (x.messages ?? []).filter((m) => m.entity_type === 'offer_request_message').length };
      }
    }
    return { chats, sinLeer };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Los chats sin leer de Wallapop, de la misma bandeja que carga la web: no abre ninguno, así que no marca nada como
// leído. Devuelve {sinLeer: {n, desde}}, como leerChatsVinted.
export async function leerSinLeerWallapop(token) {
  try {
    const r = await fetch('https://api.wallapop.com/bff/messaging/inbox?page_size=50&max_messages=1', { headers: { Authorization: 'Bearer ' + token, 'X-DeviceOS': '0' } });
    if (!r.ok) throw new Error(`${r.status} en messaging/inbox`);
    const sinLeer = { n: 0, desde: null };
    for (const c of (await r.json()).conversations ?? []) {
      if (!(c.unread_messages > 0)) continue;
      const ms = c.messages?.messages?.[0]?.timestamp, t = ms ? new Date(ms).toISOString() : null;
      sinLeer.n++;
      if (t && (!sinLeer.desde || t < sinLeer.desde)) sinLeer.desde = t;
    }
    return { sinLeer };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Los anuncios publicados con sus visitas, chats y favoritos,
// de la misma API que usa la página de estadísticas (así no hace falta bajar por la lista).
export async function leerWallapopAnuncios(token) {
  try {
    const opciones = { headers: { Authorization: 'Bearer ' + token, 'X-DeviceOS': '0' } };
    const dia = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ms);
    const anuncios = [], fichas = {};
    for (let siguiente = '', vuelta = 0; vuelta < 25; vuelta++) {
      const r = await fetch('https://api.wallapop.com/api/v3/items/mine/published' + (siguiente ? '?' + siguiente : ''), opciones);
      if (!r.ok) throw new Error(`${r.status} en items/mine/published`);
      for (const { content: c } of await r.json()) {
        const clave = 'W' + c.web_slug.match(/-(\d+)$/)[1];
        anuncios.push({
          clave, url: `https://es.wallapop.com/item/${c.web_slug}`, articulo: c.title, precio: Number(c.sale_price), publicado: dia(c.publish_date),
          publicado_en: new Date(c.publish_date).toISOString(), visitas: c.views, favoritos: c.favorites, chats: c.conversations ?? null,
          estado: c.flags?.reserved ? 'reservado' : 'activo', ref: c.description?.match(/REF\s*(\d{4})/i)?.[1] ?? null,
        });
        // id_app es el id con el que se pide la ficha (leerFichaWallapop); la clave usa el número del enlace.
        fichas[clave] = { id_app: c.id, categoria_id: c.category_id ?? null };
      }
      siguiente = r.headers.get('x-nextpage');
      if (!siguiente) break;
    }
    return { anuncios, fichas };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// La categoría completa, la marca, la talla, el color y el estado de un anuncio,
// que la lista no trae. id es el id_app de leerWallapopAnuncios. fondo.js lo pide una sola vez por anuncio y lo guarda.
export async function leerFichaWallapop(id, token) {
  try {
    const r = await fetch('https://api.wallapop.com/api/v3/items/' + id, { headers: { Authorization: 'Bearer ' + token, 'X-DeviceOS': '0', 'Accept-Language': 'es-ES' } });
    if (!r.ok) throw new Error(`${r.status} en items/${id}`);
    const it = await r.json(), a = it.type_attributes ?? {};
    return { ficha: {
      categoria: (it.taxonomy ?? []).map((x) => x.name).join(' > ') || null, categoria_id: it.taxonomy?.at(-1)?.id ?? null,
      marca: a.brand?.text ?? null, talla: a.size?.text ?? null, color: a.color?.text ?? null, estado_prenda: a.condition?.text ?? null,
    } };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Las visitas, los favoritos y los chats de cada uno de los últimos 7 días de
// un anuncio, de la API de la página de estadísticas (la gráfica "Estadísticas de la semana"). id es el id_app.
// Cada día es [AAAA-MM-DD, visitas, favoritos, chats]; la fecha es la que da Wallapop (medianoche en UTC) y el
// último día es hoy, aún sin terminar.
export async function leerEstadisticasWallapop(id, token) {
  try {
    const r = await fetch('https://api.wallapop.com/api/v3/statistics/item/' + id, { headers: { Authorization: 'Bearer ' + token, 'X-DeviceOS': '0' } });
    if (!r.ok) throw new Error(`${r.status} en statistics/item/${id}`);
    const { entries = [] } = await r.json();
    return { dias: entries.map((e) => [new Date(e.date).toISOString().slice(0, 10), e.values?.views ?? 0, e.values?.favs ?? 0, e.values?.chats ?? 0]) };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// En qué puesto sale un anuncio cuando alguien de tu zona (lat, lon) busca «busqueda» en Wallapop, por relevancia
// como la web, mirando los 120 primeros (puesto null: más abajo). Es la búsqueda pública, sin tu sesión. id es el id_app.
export async function leerPuestoWallapop(busqueda, id, lat, lon) {
  try {
    let url = 'https://api.wallapop.com/api/v3/search/section?' + new URLSearchParams({
      keywords: busqueda, latitude: String(lat), longitude: String(lon), order_by: 'most_relevance', search_country: 'ES', source: 'search_box',
      search_section: 'organic_search_results', section_type: 'organic_search_results', search_id: crypto.randomUUID() });
    for (let vistos = 0; vistos < 120;) {
      const r = await fetch(url, { headers: { 'X-DeviceOS': '0' }, credentials: 'omit' });
      if (!r.ok) throw new Error(`${r.status} en search/section`);
      const j = await r.json(), items = j.data?.section?.items ?? [];
      const i = items.findIndex((x) => x.id === id);
      if (i >= 0) return { puesto: vistos + i + 1 };
      vistos += items.length;
      if (!items.length || !j.meta?.next_page) break;
      url = 'https://api.wallapop.com/api/v3/search/section?next_page=' + encodeURIComponent(j.meta.next_page);
      await new Promise((ok) => setTimeout(ok, 1500 + Math.random() * 2000));
    }
    return { puesto: null };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// "Tu catálogo > Vendidos", que tiene todo lo vendido, con envío o en mano.
// Se mandan todos como ventas en mano y el panel descarta los que tienen venta con envío. La fecha es la de la última
// modificación del anuncio, que es cuando se marcó como vendido, y la clave la de estadisticas/panel.py.
export async function leerWallapopVendidos(token) {
  try {
    const opciones = { headers: { Authorization: 'Bearer ' + token, 'X-DeviceOS': '0' } };
    const dia = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ms);
    const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12);
    const ventas = [], vistas = {};
    for (let siguiente = '', vuelta = 0; vuelta < 25; vuelta++) {
      const r = await fetch('https://api.wallapop.com/api/v3/user/items/sold' + (siguiente ? '?' + siguiente : ''), opciones);
      if (!r.ok) throw new Error(`${r.status} en user/items/sold`);
      for (const x of (await r.json()).data ?? []) {
        const fecha = dia(x.modified_date), anuncio = x.slug?.match(/-(\d+)$/)?.[1];
        let clave = `M${fecha}-${norm(x.title)}`;
        vistas[clave] = (vistas[clave] ?? 0) + 1;
        if (vistas[clave] > 1) clave += `-${vistas[clave]}`; // dos iguales el mismo día, como subir-vercel.py
        ventas.push({ clave, fecha, app: 'Wallapop', articulo: x.title, importe: Number(x.price?.amount), estado: 'Cobrado', entrega: 'En mano',
          anuncios: anuncio ? ['W' + anuncio] : null });
      }
      siguiente = r.headers.get('x-nextpage');
      if (!siguiente) break;
    }
    return { ventas };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// Las ventas con envío de la pestaña "ongoing" (en curso) o "finished" (finalizadas) de Ventas, de la API con la
// que la página pinta la lista (sdui/selling). La clave es la de estadisticas/panel.py: fecha y comienzo del título.
export async function leerWallapopVentas(pestana, token) {
  try {
    // Sin X-AppVersion la API responde 400 (vale cualquier número); Accept-Language, para que los textos lleguen en español.
    const r = await fetch('https://api.wallapop.com/sdui/selling?tab=' + pestana, {
      headers: { Authorization: 'Bearer ' + token, 'X-DeviceOS': '0', 'X-AppVersion': '830420', 'Accept-Language': 'es-ES' },
    });
    if (!r.ok) throw new Error(`${r.status} en sdui/selling`);
    const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
    const fecha = (s) => {
      if (!/^\d{1,2} \p{L}+\.? \d{4}$/u.test(s)) return null;
      const [d, m, a] = s.split(' '), n = MESES[m.replace('.', '').toLowerCase()];
      return n ? `${a}-${String(n).padStart(2, '0')}-${d.padStart(2, '0')}` : null; // mes que no conocemos: se salta
    };
    const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12);
    const esPrecio = (s) => /^[\d.]+(,\d\d)? ?€$/.test(s);
    const precio = (s) => Number(s.replace(/ ?€/, '').replace('.', '').replace(',', '.'));
    // En curso, como en Vinted. Un pedido sin enviar no tiene línea de estado, solo la etiqueta; cuando se envía
    // aparece "La empresa de transporte tiene el paquete" (y después en camino, entregado, "El comprador tiene el
    // paquete"...): W, como en Vinted, hasta que se completa. Si no, N.
    const codigo = (s) => /completada/i.test(s) ? 'C' : /cancelad/i.test(s) ? 'X' : /devuelto/i.test(s) ? 'D'
      : /transporte|camino|tr[aá]nsito|reparto|entregad|reco[gj]|enviado|tiene el paquete|recibid/i.test(s) && !/\benv[ií]a\b|lleva|deposita|pendiente de env/i.test(s) ? 'W' : 'N';
    const texto = (n) => (n?.data?.content ?? '').replace(/ /g, ' ').trim();
    // Los textos de un pedido en orden, sin los de sus botones y enlaces.
    const textos = (n, out = []) => {
      if (Array.isArray(n)) n.forEach((x) => textos(x, out));
      else if (n && typeof n === 'object') {
        if (n.type === 'text') out.push(texto(n));
        else for (const [k, x] of Object.entries(n)) if (k !== 'events') textos(x, out);
      }
      return out;
    };
    // En curso cada pedido es un action_card con estado (title), título y precio. En finalizadas, un
    // list_item_transaction: título, "Transacción completada 24 oct 2026", fecha de pedido, código, comprador, precio.
    const pedidos = [];
    const buscar = (n) => {
      if (Array.isArray(n)) n.forEach(buscar);
      else if (n && typeof n === 'object') {
        if (n.type === 'action_card' || n.type === 'list_item_transaction') pedidos.push(n);
        else Object.values(n).forEach(buscar);
      }
    };
    buscar(await r.json());
    const ventas = [];
    let saltadas = 0; // tarjetas sin título, precio o fecha de pedido legibles: se avisa para no perderlas sin saberlo
    for (const p of pedidos) {
      const T = textos(p.data).filter(Boolean);
      const [estado, titulo, importe] = p.type === 'action_card'
        ? [texto(p.data.title), texto(p.data.item_title), texto(p.data.item_price)]
        : [T[1] ?? '', T[0] ?? '', T.findLast(esPrecio) ?? ''];
      const f = fecha(T[T.indexOf('Fecha de pedido') + 1] ?? '');
      if (!titulo || !esPrecio(importe) || !f) { saltadas++; continue; }
      // El pedido (el id de su seguimiento) y el anuncio vendido salen de los enlaces y las fotos de la tarjeta;
      // las fotos de los anuncios van en carpetas c10420p<número del anuncio>. Si el anuncio ya se borró, no hay foto.
      const s = JSON.stringify(p), anuncio = s.match(/\/c10420p(\d+)\//)?.[1];
      ventas.push({ clave: `W${f}-${norm(titulo)}`, fecha: f, app: 'Wallapop', articulo: titulo, importe: precio(importe), codigo: codigo(estado), entrega: 'Envío',
        pedido: s.match(/tracking\/([0-9a-f-]{36})/)?.[1] ?? null, anuncios: anuncio ? ['W' + anuncio] : null });
    }
    return { ventas, saltadas };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}
