// Lector de ventas. Cada 30 minutos, de 8:00 a 24:00, lee Vinted y Wallapop con la sesión que tengas abierta en
// Chrome, sin abrir ninguna página: Wallapop desde la versión 1.5 y Vinted desde la 1.7 (si Vinted falla, esa
// lectura usa una ventana minimizada que se cierra al acabar). De noche, cada 3 horas, solo los anuncios de
// Wallapop (1.6).
// Manda lo leído a tu panel (<panel>/api/ingesta), con la hora de cada lectura. La dirección del panel, su clave
// y tu número de Vinted se ponen en las opciones de la extensión (opciones.html), que se abren al instalarla.
// Si el panel no responde, la lectura espera en una cola y se manda en la siguiente.
// El botón de la extensión lee en el momento.
// Al instalarse crea en la barra de favoritos la carpeta «Venta online».
import { leerVinted, leerFichaVinted, leerPedidoVinted, leerChatsVinted, leerSinLeerWallapop, leerWallapopAnuncios, leerFichaWallapop, leerEstadisticasWallapop, leerPuestoWallapop, leerWallapopVendidos, leerWallapopVentas } from './lectores.js';

const CADA = 30; // minutos entre lecturas
// Las opciones: {panel: 'https://….vercel.app', clave, vinted: número de miembro, lat?, lon?}.
const ajustes = async () => (await chrome.storage.local.get('ajustes')).ajustes ?? {};
const configurado = (a) => Boolean(a.panel && a.clave && a.vinted);
const FAVORITOS = (a) => [
  ...(a.panel ? [['Panel de ventas', a.panel + '/']] : []),
  ...(a.vinted ? [['Vinted: mi perfil', `https://www.vinted.es/member/${a.vinted}`]] : []),
  ['Vinted: mensajes', 'https://www.vinted.es/inbox'],
  ['Vinted: pedidos', 'https://www.vinted.es/my_orders'],
  ['Vinted: saldo', 'https://www.vinted.es/wallet/balance'],
  ['Vinted: subir artículo', 'https://www.vinted.es/items/new'],
  ['Wallapop: catálogo', 'https://es.wallapop.com/app/catalog/published'],
  ['Wallapop: chat', 'https://es.wallapop.com/app/chat'],
  ['Wallapop: ventas', 'https://es.wallapop.com/app/selling'],
  ['Wallapop: estadísticas', 'https://es.wallapop.com/app/stats'],
  ['Wallapop: subir producto', 'https://es.wallapop.com/app/catalog/upload'],
  ['Vercel', 'https://vercel.com/dashboard'],
];

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
// La lectura va en una ventana propia, minimizada y sin foco: no sale entre tus pestañas ni entra en
// tus grupos, así que nadie la cierra sin querer (el 29-10-2026 una lectura falló con "No tab with id").
const ventana = async () => (await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' })).tabs[0];
const programar = () => chrome.alarms.create('ciclo', { delayInMinutes: 1, periodInMinutes: CADA });

// El token de la sesión de Wallapop, de su cookie accessToken. Dura 5 minutos: cuando le quedan menos de 30 s, se pide
// otro como hace la web, a /api/auth/federated-session, que lo deja en la misma cookie (probado el 29-10-2026: con
// 30 s por delante da uno nuevo; con 3 minutos, no).
async function tokenWallapop() {
  const leer = async () => decodeURIComponent((await chrome.cookies.get({ url: 'https://es.wallapop.com/app/', name: 'accessToken' }))?.value ?? '');
  const queda = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 - Date.now(); } catch { return 0; } };
  let t = await leer();
  if (queda(t) > 30e3) return t;
  const r = await fetch('https://es.wallapop.com/api/auth/federated-session', { credentials: 'include', cache: 'no-store' });
  // Error de CloudFront: Wallapop rechaza la sesión (pasa a ratos, y con algunas VPN); se quita solo.
  if (r.status === 403) throw new Error('la web bloquea la sesión (error 403; si usas VPN, desactívala); se prueba en la próxima lectura');
  t = await leer();
  if (queda(t) <= 0) throw new Error(`sin sesión iniciada (federated-session ${r.status})`);
  return t;
}

chrome.runtime.onInstalled.addListener(async () => {
  programar();
  favoritos();
  if (!configurado(await ajustes())) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(programar);
chrome.storage.onChanged.addListener((c, zona) => { if (zona === 'local' && c.ajustes) favoritos(); });
chrome.action.onClicked.addListener(() => leer(true));
chrome.alarms.onAlarm.addListener((a) => {
  // Cada lectura sale entre 0 y 5 minutos después de su turno, para no ir siempre a la misma hora.
  if (a.name === 'ciclo') chrome.alarms.create('leer', { when: Date.now() + Math.random() * 5 * 60e3 });
  if (a.name === 'leer') leer(false);
  // De 8:00 a 24:00 Windows no deja dormir el PC por estar sin usar: cuando la tarea «Despertar PC ventas» lo despierta
  // de la hibernación a las 8:00 (pc/LEEME.md), sin esto volvería a dormirse a los pocos minutos (1.8).
  if (a.name === 'ciclo') new Date().getHours() >= 8 ? chrome.power.requestKeepAwake('system') : chrome.power.releaseKeepAwake();
});

async function favoritos() {
  const hijos = await chrome.bookmarks.getChildren('1'); // barra de favoritos
  const carpeta = hijos.find((b) => !b.url && b.title === 'Venta online') ?? await chrome.bookmarks.create({ parentId: '1', title: 'Venta online' });
  const hay = new Set((await chrome.bookmarks.getChildren(carpeta.id)).map((b) => b.url));
  for (const [title, url] of FAVORITOS(await ajustes())) if (!hay.has(url)) await chrome.bookmarks.create({ parentId: carpeta.id, title, url });
}

// Carga la dirección en la pestaña y espera a que termine (hasta 60 s).
async function abrir(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  const origen = new URL(url).origin;
  let cargando = false;
  for (let i = 0; i < 120; i++) {
    await esperar(500);
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'loading') cargando = true;
    else if (t.status === 'complete' && !t.pendingUrl && t.url?.startsWith(origen) && (cargando || i >= 6)) return;
  }
  throw new Error('la página no cargó en 60 s');
}

async function leer(aMano) {
  const aj = await ajustes();
  if (!configurado(aj)) {
    chrome.action.setBadgeBackgroundColor({ color: '#b4402e' });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: 'Falta configurar el lector: clic derecho en el icono > Opciones' });
    if (aMano) chrome.runtime.openOptionsPage();
    return;
  }
  // De 0:00 a 8:00 solo se miran los anuncios de Wallapop, que no abre ninguna ventana, una vez cada 3 horas más o
  // menos: así se sabe a qué hora de la noche llegan las visitas. Vinted, las ventas y las estadísticas esperan a las 8:00.
  const noche = !aMano && new Date().getHours() < 8;
  if (noche) {
    const { nocturna = 0 } = await chrome.storage.local.get('nocturna');
    if (Date.now() - nocturna < 170 * 60e3) return;
    await chrome.storage.local.set({ nocturna: Date.now() });
  }
  const { leyendo } = await chrome.storage.session.get('leyendo');
  if (leyendo && Date.now() - leyendo < 5 * 60e3) return;
  await chrome.storage.session.set({ leyendo: Date.now() });
  chrome.action.setBadgeText({ text: '…' });

  const datos = { origen: 'lector', horas: {}, anuncios: {}, fichas: {}, ventas: [] }, errores = [];
  const dia = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
  let tab, conVentana = null; // por qué hizo falta la ventana de Vinted en esta lectura
  // Vinted, desde la 1.7, aquí mismo, sin página, como Wallapop (la prueba del 29-10-2026 salió bien). En cuanto una
  // llamada falla (la sesión caducada o su antibots), esa y las siguientes de la lectura van por la página de su perfil,
  // en una ventana minimizada que se abre entonces (y otra vez si alguien la cierra), como hasta la 1.6.
  const enVinted = async (func, args = []) => {
    if (!conVentana) {
      try {
        const r = await func(...args);
        if (r && !r.error) return r;
        conVentana = r?.error ?? 'no devolvió nada';
      } catch (e) {
        conVentana = e.message;
      }
    }
    if (!(tab && (await chrome.tabs.get(tab.id).catch(() => null)))) {
      tab = await ventana();
      await abrir(tab.id, `https://www.vinted.es/member/${aj.vinted}`);
    }
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args }))[0]?.result;
  };
  // Wallapop, aquí mismo, sin página: las mismas llamadas a su API que hace la web, con el token de la sesión.
  const enWallapop = async (func, args = []) => func(...args, await tokenWallapop());
  const paso = async (nombre, correr, func, args) => {
    try {
      const r = await correr(func, args);
      if (!r || r.error) throw new Error(r?.error ?? 'no devolvió nada');
      return r;
    } catch (e) {
      errores.push(`${nombre}: ${e.message}`);
      return {};
    }
  };
  const deDia = (nombre, correr, func, args) => (noche ? {} : paso(nombre, correr, func, args));
  // Lo que se pide una sola vez por anuncio o por pedido queda guardado: fichas = {clave: ficha} (una ficha sin
  // "ref" es que aún no se ha mirado; ref null, que no tiene REF) y pedidos = {clave de la venta: [clave de anuncio]}.
  const { fichas = {}, pedidos = {} } = await chrome.storage.local.get(['fichas', 'pedidos']);
  // Pide lo que falte, como mucho 10 por lectura y con pausas, a ritmo de persona.
  const completar = async (claves, correr, func, arg, apuntar, maximo = 10) => {
    for (const k of claves.slice(0, maximo)) {
      try {
        const r = await correr(func, [arg(k)]);
        if (r && !r.error) apuntar(k, r);
      } catch {}
      await esperar(1500 + Math.random() * 2500);
    }
  };
  let pedidosLeidos = false;
  try {
    const v = await deDia('Vinted', enVinted, leerVinted, [aj.vinted]);
    if (v.anuncios) {
      datos.horas.Vinted = new Date().toISOString();
      await completar(v.anuncios.map((a) => a.clave).filter((k) => !fichas[k]), enVinted, leerFichaVinted, (k) => k.slice(1), (k, r) => { fichas[k] = r.ficha; });
      for (const a of v.anuncios) {
        if (fichas[a.clave]) a.ref = fichas[a.clave].ref;
        datos.fichas[a.clave] = { ...v.fichas[a.clave], ...fichas[a.clave] };
      }
      datos.anuncios.Vinted = v.anuncios;
      // Los chats y las ofertas de cada anuncio, que la lista de Vinted no trae (desde la 1.6). Un chat que aún no se
      // ha podido abrir no cuenta todavía.
      const { chatsVinted = {} } = await chrome.storage.local.get('chatsVinted');
      const ch = await paso('Vinted chats', enVinted, leerChatsVinted, [chatsVinted]);
      if (ch.chats) {
        await chrome.storage.local.set({ chatsVinted: ch.chats });
        const cuenta = {};
        for (const c of Object.values(ch.chats)) {
          if (!c?.anuncio) continue;
          const x = (cuenta[c.anuncio] ??= { chats: 0, ofertas: 0 });
          x.chats++;
          x.ofertas += c.ofertas;
        }
        for (const a of v.anuncios) Object.assign(a, cuenta[a.clave] ?? { chats: 0, ofertas: 0 });
        (datos.sinLeer ??= {}).Vinted = ch.sinLeer; // para el aviso del panel (desde la 1.8)
      }
    }
    if (v.ventas) {
      await completar(v.ventas.map((x) => x.clave).filter((k) => !pedidos[k]), enVinted, leerPedidoVinted, (k) => k.slice(1), (k, r) => { pedidos[k] = r.anuncios; });
      for (const x of v.ventas) x.anuncios = pedidos[x.clave] ?? null;
      datos.ventas.push(...v.ventas);
      pedidosLeidos = true;
    }
    if (tab) chrome.windows.remove(tab.windowId).catch(() => {}); // Vinted ya está: la ventana sobra
    tab = null;
    // Cuántas lecturas de hoy han necesitado la ventana, y por qué la última: si son muchas, Vinted rechaza la extensión.
    if (!noche) {
      let { modoVinted: m } = await chrome.storage.local.get('modoVinted');
      if (m?.dia !== dia) m = { dia, sin: 0, con: 0 };
      if (conVentana) { m.con++; m.motivo = conVentana; } else m.sin++;
      await chrome.storage.local.set({ modoVinted: m });
      datos.notas = `Vinted hoy: ${m.sin} lecturas sin ventana y ${m.con} con ventana` + (m.motivo ? ` (la última, por: ${m.motivo})` : '');
    }
    // Sin sesión de Wallapop no se pide nada más, para no llenar la lectura de errores iguales.
    if (await tokenWallapop().then(() => true, (e) => { errores.push(`Wallapop: ${e.message}`); return false; })) {
      const enCurso = await deDia('Wallapop ventas en curso', enWallapop, leerWallapopVentas, ['ongoing']);
      const w = await paso('Wallapop anuncios', enWallapop, leerWallapopAnuncios);
      if (w.anuncios) {
        datos.horas.Wallapop = new Date().toISOString();
        await completar(w.anuncios.map((a) => a.clave).filter((k) => !fichas[k]), enWallapop, leerFichaWallapop, (k) => w.fichas[k].id_app, (k, r) => { fichas[k] = r.ficha; });
        for (const a of w.anuncios) datos.fichas[a.clave] = { ...w.fichas[a.clave], ...fichas[a.clave] };
        datos.anuncios.Wallapop = w.anuncios;
      }
      const sl = await deDia('Wallapop chats sin leer', enWallapop, leerSinLeerWallapop);
      if (sl.sinLeer) (datos.sinLeer ??= {}).Wallapop = sl.sinLeer;
      const finalizadas = await deDia('Wallapop ventas finalizadas', enWallapop, leerWallapopVentas, ['finished']);
      // Los vendidos van detrás de las ventas con envío: el panel descarta los que ya tienen una.
      const vendidos = await deDia('Wallapop vendidos', enWallapop, leerWallapopVendidos);
      datos.ventas.push(...(enCurso.ventas ?? []), ...(finalizadas.ventas ?? []), ...(vendidos.ventas ?? []));
      const saltadas = (enCurso.saltadas ?? 0) + (finalizadas.saltadas ?? 0);
      if (saltadas) errores.push(`Wallapop ventas: ${saltadas} pedidos sin título, precio o fecha de pedido legibles`);
      // Una vez al día, lo de cada uno de los últimos 7 días según Wallapop: cubre los días con el PC apagado.
      // Va lo último porque tarda unos 2 minutos. Lo que falle se pide otra vez; si aun así falta algún anuncio,
      // ese día se queda sin él, y si faltan todos, se prueba en la siguiente lectura.
      const { estadisticasDia } = await chrome.storage.local.get('estadisticasDia');
      if (w.anuncios && !noche && estadisticasDia !== dia) {
        const est = {}, claves = w.anuncios.map((a) => a.clave);
        const pedir = (lista) => completar(lista, enWallapop, leerEstadisticasWallapop, (k) => w.fichas[k].id_app, (k, r) => { est[k] = r.dias; }, Infinity);
        await pedir(claves);
        await pedir(claves.filter((k) => !est[k]));
        const fallan = claves.filter((k) => !est[k]).length;
        if (fallan) errores.push(`Wallapop estadísticas: ${fallan} de ${claves.length} anuncios sin leer`);
        if (fallan < claves.length) {
          datos.estadisticas = { Wallapop: est };
          await chrome.storage.local.set({ estadisticasDia: dia });
        }
      }
      // También una vez al día, si las opciones tienen tu ubicación: en qué puesto sale cada anuncio si alguien de tu
      // zona busca lo que es y su marca («jersey scorzzo»; sin marca, las dos primeras palabras del título). Explica
      // por qué bajan las visitas.
      const { posicionesDia } = await chrome.storage.local.get('posicionesDia');
      if (w.anuncios && !noche && posicionesDia !== dia && aj.lat && aj.lon) {
        const puestos = {};
        const busqueda = (a) => {
          const [tipo = '', segunda = ''] = a.articulo.toLowerCase().split(/\s+/), marca = fichas[a.clave]?.marca?.toLowerCase();
          return marca && marca !== tipo && !/^(otra|otras|sin marca)/.test(marca) ? `${tipo} ${marca}` : `${tipo} ${segunda}`.trim();
        };
        for (const a of w.anuncios) {
          const b = busqueda(a);
          try {
            const r = await enWallapop(leerPuestoWallapop, [b, w.fichas[a.clave].id_app, aj.lat, aj.lon]);
            if (!r.error) puestos[a.clave] = [b, r.puesto];
          } catch {}
          await esperar(1500 + Math.random() * 2500);
        }
        const fallan = w.anuncios.length - Object.keys(puestos).length;
        if (fallan) errores.push(`Wallapop puestos: ${fallan} de ${w.anuncios.length} anuncios sin buscar`);
        if (fallan < w.anuncios.length) {
          datos.posiciones = { Wallapop: puestos };
          await chrome.storage.local.set({ posicionesDia: dia });
        }
      }
    }
  } catch (e) {
    errores.push(e.message);
  } finally {
    if (tab) chrome.windows.remove(tab.windowId).catch(() => {});
  }
  // Si una web cambia lo que da, los anuncios llegan sin visitas o sin precio, o faltan, y esas horas ya no se
  // recuperan: se avisa en el icono y en el panel.
  const { cuantos = {} } = await chrome.storage.local.get('cuantos');
  for (const [app, lista] of Object.entries(datos.anuncios)) {
    const malos = lista.filter((a) => ![a.visitas, a.favoritos, a.precio].every(Number.isFinite)).length;
    const sinFicha = lista.filter((a) => !fichas[a.clave]).length;
    if (malos) errores.push(`${app}: ${malos} de ${lista.length} anuncios sin visitas, favoritos o precio (¿ha cambiado la web?)`);
    if (sinFicha) errores.push(`${app}: ${sinFicha} de ${lista.length} anuncios sin ficha`);
    if (cuantos[app] >= 10 && lista.length < cuantos[app] / 2) errores.push(`${app}: ${lista.length} anuncios, y en la lectura anterior ${cuantos[app]}`);
    cuantos[app] = lista.length;
  }
  await chrome.storage.local.set({ cuantos });
  // Solo se guarda lo de los anuncios y pedidos que siguen saliendo; de una app que no se pudo leer, todo.
  const vistas = new Set(Object.values(datos.anuncios).flat().map((a) => a.clave));
  const leida = { V: datos.anuncios.Vinted, W: datos.anuncios.Wallapop };
  const ventasV = new Set(datos.ventas.map((x) => x.clave));
  await chrome.storage.local.set({
    fichas: Object.fromEntries(Object.entries(fichas).filter(([k]) => !leida[k[0]] || vistas.has(k))),
    pedidos: Object.fromEntries(Object.entries(pedidos).filter(([k]) => !pedidosLeidos || ventasV.has(k))),
  });
  await chrome.storage.local.remove(['refsVinted', 'pruebaVinted']); // de la 1.1 (ahora va en fichas) y de la prueba de la 1.6

  // Cada lectura entra en la cola y la cola se manda en orden, la más vieja primero. Lo que no llega al panel
  // espera a la siguiente lectura: así no se pierde ninguna hora (hasta 1.500 lecturas, un mes; 50 por vez).
  datos.errores = errores.join('; ') || null;
  const { cola = [] } = await chrome.storage.local.get('cola');
  cola.push(datos);
  let respuesta;
  for (let enviadas = 0; cola.length && enviadas < 50; enviadas++) {
    try {
      const r = await fetch(aj.panel + '/api/ingesta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clave: aj.clave, datos: cola[0] }) });
      respuesta = await r.json().catch(() => ({}));
      if (r.status === 400) { cola.shift(); continue; } // el panel no la entiende: reintentarla no la arregla
      if (!r.ok) { errores.push(`panel: ${r.status} ${respuesta.error ?? ''}`.trim()); break; }
      cola.shift();
    } catch (e) {
      errores.push('panel: ' + e.message);
      break;
    }
  }
  if (cola.length) errores.push(`${cola.length} lecturas esperan para mandarse al panel`);
  await chrome.storage.local.set({ cola: cola.slice(-1500) });

  const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  await chrome.storage.local.set({ ultima: { hora, errores, respuesta } });
  chrome.action.setBadgeBackgroundColor({ color: '#b4402e' });
  chrome.action.setBadgeText({ text: errores.length ? '!' : '' });
  chrome.action.setTitle({ title: `Leer ahora. Última lectura: ${hora}` + (errores.length ? `, con problemas: ${errores.join('; ')}` : '') });
  await chrome.storage.session.remove('leyendo');
}
