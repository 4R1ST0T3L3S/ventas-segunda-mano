"""Análisis de visitas y favoritos por hora, día, publicación y tipo de artículo.

Lee del panel de Vercel (POST /api/datos, formato en DATOS.md) lo que guarda la
extensión «Lector de ventas» y escribe analisis.md con siete secciones: visitas por hora del día,
por día de la semana, según la hora y el día de publicación, por tipo de artículo, anuncios flojos,
resubidas frente a productos nuevos y puesto en la búsqueda de Wallapop.
Cada sección dice en cuántos días y anuncios se apoya. Se ejecuta cada lunes:
    python -I herramientas/analisis.py
La dirección del panel y su clave (CLAVE_PANEL) van en config.json, junto a este archivo (copia config.example.json).
Los días ya guardados no cambian: se bajan una vez a datos/historial y datos/estadisticas.
"""
import json, sys, urllib.request, datetime as dt
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
D = Path(__file__).resolve().parent
UTC, H, APPS = dt.timezone.utc, dt.timedelta(hours=1), ('Vinted', 'Wallapop')
APP = {'V': 'Vinted', 'W': 'Wallapop'}
DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
try:
    CONFIG = json.loads((D / 'config.json').read_text(encoding='utf-8'))
except FileNotFoundError:
    sys.exit('Falta config.json: copia config.example.json y pon la dirección de tu panel y su clave.')
URL, CLAVE = CONFIG['panel'].rstrip('/') + '/api/datos', CONFIG['clave']
descargas = 0


def post(extra):
    cuerpo = json.dumps({'clave': CLAVE, **extra}).encode()
    pet = urllib.request.Request(URL, cuerpo, {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(pet, timeout=60) as r:
        return json.load(r)


def dia_guardado(fecha, tipo):
    """Un día del historial o de las estadísticas: de la caché, o se baja y se guarda."""
    global descargas
    f = D / 'datos' / tipo / f'{fecha}.json'
    if f.exists():
        return json.loads(f.read_text(encoding='utf-8'))
    r = post({'dia': fecha, **({'tipo': 'estadisticas'} if tipo == 'estadisticas' else {})})
    descargas += 1
    if r is not None:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(r, ensure_ascii=False), encoding='utf-8')
    return r


def hora(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(UTC)


def local(t):
    """UTC -> hora de Madrid (sin zoneinfo: en este Windows no hay tzdata). Verano: último domingo de marzo a octubre, 1:00 UTC."""
    def domingo(m):
        d = dt.datetime(t.year, m, 31, 1, tzinfo=UTC)
        return d - dt.timedelta(days=(d.weekday() + 1) % 7)
    return (t + (2 * H if domingo(3) <= t < domingo(10) else H)).replace(tzinfo=None)


def tabla(cabeza, filas):
    return '\n'.join(['| ' + ' | '.join(cabeza) + ' |', '|' + '---|' * len(cabeza)] +
                     ['| ' + ' | '.join(str(c) for c in f) + ' |' for f in filas]) + '\n'


def pie(dias, anuncios):
    aviso = ' Pocos datos, no sacar conclusiones.' if dias < 14 else ''
    return f'\n*Datos: {dias} días, {anuncios} anuncios.{aviso}*\n'


def media(xs):
    return sum(xs) / len(xs) if xs else 0


# ---------- Datos ----------
principal = post({})
fichas = principal['fichas']
dias = [d for d in (dia_guardado(f, 'historial') for f in principal['historial']) if d]
dias.append(principal['hoy'])
dias = [d for d in dias if d.get('lecturas')]
if not dias:
    sys.exit('Todavía no hay lecturas.')
ahora = {a: hora(t) for a, t in principal['ultima'].items()}
pub = {k: hora(f['publicado_en']) for k, f in fichas.items() if f.get('publicado_en')}

# Estado de cada app tras cada lectura: parte de `base` (o de lo último conocido) y aplica `c` y `fuera`.
estado, puntos = {a: {} for a in APPS}, {a: [] for a in APPS}
for d in dias:
    for a in APPS:
        if d.get('base', {}).get(a):
            estado[a] = dict(d['base'][a])
    for l in sorted(d['lecturas'], key=lambda l: l['t']):
        s = estado[l['app']]
        s.update(l.get('c') or {})
        for k in l.get('fuera') or []:
            s.pop(k, None)
        puntos[l['app']].append((hora(l['t']), dict(s)))
dias_con_datos = {local(t).date() for a in APPS for t, _ in puntos[a]}
ndias = len(dias_con_datos)

series = defaultdict(list)  # clave -> [(t, visitas, favoritos)]
for a in APPS:
    for t, s in puntos[a]:
        for k, f in s.items():
            series[k].append((t, f[0], f[1]))

# Intervalos entre lecturas seguidas: visitas ganadas por los anuncios que estaban en las dos.
# Un anuncio nuevo cuenta entero solo si se publicó dentro del intervalo.
intervalos = {a: [] for a in APPS}
for a in APPS:
    for (t1, s1), (t2, s2) in zip(puntos[a], puntos[a][1:]):
        v = 0
        for k, f in s2.items():
            if k in s1:
                v += max(0, f[0] - s1[k][0])
            elif k in pub and pub[k] >= t1:
                v += f[0]
        intervalos[a].append((t1, t2, v))
nanuncios = {a: len({k for _, s in puntos[a] for k in s}) for a in APPS}
out = [f'# Análisis de visitas ({local(max(ahora.values())):%d-%m-%Y %H:%M})\n',
       f'Lecturas de {ndias} días. Las horas y los días son de Madrid. '
       f'Anuncios vistos: {nanuncios["Vinted"]} en Vinted y {nanuncios["Wallapop"]} en Wallapop.\n']
resumen = [f'Datos: {ndias} días de lecturas, {nanuncios["Vinted"]} anuncios de Vinted y {nanuncios["Wallapop"]} de Wallapop.']

# ---------- 1. Visitas por hora del día ----------
por_hora = {a: defaultdict(lambda: [0.0, 0.0, set()]) for a in APPS}  # hora -> [visitas, horas vistas, días]
sin_hora = {a: [0, 0] for a in APPS}
for a in APPS:
    for t1, t2, v in intervalos[a]:
        if t2 - t1 > 3 * H:
            sin_hora[a][0] += v
            sin_hora[a][1] += 1
            continue
        seg, cur = (t2 - t1).total_seconds(), t1
        while cur < t2:
            fin = min(t2, cur.replace(minute=0, second=0, microsecond=0) + H)
            parte = (fin - cur).total_seconds()
            h = por_hora[a][local(cur).hour]
            h[0] += v * parte / seg
            h[1] += parte / 3600
            h[2].add(local(cur).date())
            cur = fin
out.append('## 1. Visitas por hora del día\n')
out.append('Visitas por hora observada (visitas ÷ horas en que se estuvo mirando). Entre paréntesis, los días en que se observó esa hora. '
           'Si una hora se observó menos de 3 horas en total, lleva un asterisco: no fiarse.\n')
filas = []
for h in range(24):
    celdas = []
    for a in APPS:
        v, ho, ds = por_hora[a][h] if h in por_hora[a] else (0, 0, set())
        celdas.append(f'{v / ho:.2f}{"*" if ho < 3 else ""} ({len(ds)} d)' if ho else '-')
    if any(c != '-' for c in celdas):
        filas.append([f'{h}:00-{h + 1}:00'] + celdas)
out.append(tabla(['Hora', 'Vinted', 'Wallapop'], filas))
for a in APPS:
    out.append(f'- Sin hora exacta en {a} (intervalos de más de 3 horas, como la noche): {sin_hora[a][0]} visitas en {sin_hora[a][1]} intervalos.')
out.append(pie(len(dias_con_datos), sum(nanuncios.values())))
for a in APPS:
    fiables = [(h[0] / h[1], k) for k, h in por_hora[a].items() if h[1] >= 2]
    resumen.append(f'Mejor hora en {a}: ' + (f'{max(fiables)[1]}:00 ({max(fiables)[0]:.2f} visitas/hora)' if fiables else 'aún sin horas con 2 horas observadas') + '.')

# ---------- 2. Visitas por día de la semana ----------
out.append('## 2. Visitas por día de la semana\n')
sem = {a: defaultdict(lambda: [0, 0, 0]) for a in APPS}  # dia -> [días, visitas, anuncios-día]
# Wallapop: estadísticas diarias.
ficheros = [dia_guardado(f, 'estadisticas') for f in principal['estadisticas']]
ficheros = [f for f in ficheros if f]
for f in ficheros:
    fecha = dt.date.fromisoformat(f['fecha'])
    activos = [k for k in f['anuncios'] if k not in pub or pub[k].date() <= fecha]
    w = sem['Wallapop'][fecha.weekday()]
    w[0] += 1
    w[1] += sum(f['anuncios'][k][0] for k in activos)
    w[2] += len(activos)
# Vinted: visitas de cada intervalo, en el día en que acaba; solo días con lecturas hasta las 23:00.
vdia, parciales = defaultdict(int), []
for t1, t2, v in intervalos['Vinted']:
    vdia[local(t2).date()] += v
for fecha in sorted(vdia):
    ult = max(local(t) for t, _ in puntos['Vinted'] if local(t).date() == fecha)
    if ult.hour < 23:
        parciales.append(f'{fecha} (hasta las {ult:%H:%M})')
        continue
    n = len(next(s for t, s in reversed(puntos['Vinted']) if local(t).date() == fecha))
    w = sem['Vinted'][fecha.weekday()]
    w[0] += 1
    w[1] += vdia[fecha]
    w[2] += n
filas = []
for i, n in enumerate(DIAS):
    fila = [n]
    for a in APPS:
        d, v, an = sem[a][i] if i in sem[a] else (0, 0, 0)
        fila.append(f'{v / d:.0f} por día, {v / an:.2f} por anuncio ({d} d)' if d else '-')
    filas.append(fila)
out.append(tabla(['Día', 'Vinted', 'Wallapop'], filas))
out.append('- Wallapop sale de sus estadísticas diarias. Aún no se sabe si su día es en hora de Madrid o en UTC (medianoche UTC), así que puede estar corrido 1-2 horas.')
out.append('- Vinted es la suma de las visitas ganadas entre lecturas durante el día; solo cuentan los días con lecturas hasta las 23:00.')
if parciales:
    out.append('- Días de Vinted sin contar por incompletos: ' + ', '.join(parciales) + '.')
nw, nv = sum(x[0] for x in sem['Wallapop'].values()), sum(x[0] for x in sem['Vinted'].values())
out.append(pie(max(nw, nv), len(fichas)) + f'\n(Wallapop {nw} días, Vinted {nv} días completos.)\n')
for a, n in (('Vinted', nv), ('Wallapop', nw)):
    pd = {i: x[1] / x[0] for i, x in sem[a].items() if x[0]}
    resumen_dia = f'{DIAS[max(pd, key=pd.get)]} ({pd[max(pd, key=pd.get)]:.0f} visitas/día)' if pd else 'sin días completos aún'
    resumen.append(f'Mejor día de la semana en {a}: {resumen_dia}, con {n} días.')


# ---------- 3. Hora y día de publicación ----------
def valor(serie, objetivo):
    """(visitas, favoritos) a una hora, interpolando entre dos lecturas a menos de 3 horas; None si no está cubierta."""
    for (ta, va, fa), (tb, vb, fb) in zip(serie, serie[1:]):
        if ta <= objetivo <= tb:
            if tb - ta > 3 * H:
                return None
            x = (objetivo - ta) / (tb - ta) if tb > ta else 0
            return va + (vb - va) * x, fa + (fb - fa) * x
    return None


res, pendientes = {a: [] for a in APPS}, {a: 0 for a in APPS}
for k, s in series.items():
    a, p = APP[k[0]], pub.get(k)
    if not p or s[0][0] - p > 3 * H:
        continue  # sin ficha, o ya llevaba tiempo publicado cuando se empezó a leer
    v24 = valor(s, p + 24 * H)
    if v24 is None:
        pendientes[a] += p + 24 * H > ahora[a]
        continue
    res[a].append((local(p), v24, valor(s, p + 48 * H)))
BANDAS = [(0, 8), (8, 12), (12, 15), (15, 18), (18, 21), (21, 24)]
out.append('## 3. Hora y día de publicación\n')
out.append('Visitas y favoritos en las primeras 24 y 48 horas, solo de los anuncios vistos desde su publicación y con las lecturas cubriendo toda la ventana. '
           'En Vinted la hora de publicación es la de la primera foto subida, que puede ser anterior a la publicación real.\n')
for a in APPS:
    out.append(f'### {a}\n')
    out.append(f'{len(res[a])} anuncios con 24 h completas; {pendientes[a]} más esperan a que pasen 24 h.\n')
    if not res[a]:
        continue
    for titulo, clave, etiquetas in (('Franja de publicación', lambda p: next(i for i, b in enumerate(BANDAS) if b[0] <= p.hour < b[1]),
                                      [f'{b[0]}-{b[1]} h' for b in BANDAS]),
                                     ('Día de publicación', lambda p: p.weekday(), DIAS)):
        grupos = defaultdict(list)
        for p, v24, v48 in res[a]:
            grupos[clave(p)].append((v24, v48))
        filas = []
        for i, et in enumerate(etiquetas):
            g = grupos.get(i)
            if g:
                g48 = [x[1] for x in g if x[1]]
                filas.append([et, len(g), f'{media([x[0][0] for x in g]):.1f}', f'{media([x[0][1] for x in g]):.2f}',
                              f'{media([x[0] for x in g48]):.1f} ({len(g48)})' if g48 else '-'])
        out.append(f'{titulo}:\n')
        out.append(tabla(['Grupo', 'Anuncios', 'Visitas 24 h', 'Favoritos 24 h', 'Visitas 48 h (anuncios)'], filas))
out.append(pie(ndias, sum(len(r) for r in res.values())))
resumen.append('Publicación: ' + ', '.join(f'{a} {len(res[a])} anuncios con 24 h completas ({pendientes[a]} pendientes)' for a in APPS) + '.')

# ---------- 4 y 5. Por tipo de artículo y anuncios flojos ----------
filas_a = {a: [] for a in APPS}  # datos de cada anuncio actual
for a in APPS:
    for k, f in principal['estado'].get(a, {}).items():
        ficha = fichas.get(k)
        if not ficha or k not in pub:
            continue
        dias_on = (ahora[a] - pub[k]).total_seconds() / 86400
        filas_a[a].append(dict(k=k, ficha=ficha, v=f[0], fav=f[1], precio=f[2], dias=dias_on))


def banda_precio(p):
    return '1. hasta 10 €' if p <= 10 else '2. 10-20 €' if p <= 20 else '3. 20-35 €' if p <= 35 else '4. más de 35 €'


def categoria(x):
    c = x['ficha'].get('categoria')
    return ' > '.join(c.split(' > ')[-2:]) if c else f'categoría {x["ficha"].get("categoria_id")}'


CAMPOS = [('Categoría', categoria), ('Marca', lambda x: x['ficha'].get('marca') or '(sin marca)'),
          ('Talla', lambda x: x['ficha'].get('talla') or '(sin talla)'), ('Precio', lambda x: banda_precio(x['precio']))]
out.append('## 4. Por tipo de artículo\n')
out.append('Visitas y favoritos por día desde la publicación hasta la última lectura, por anuncio, de media. '
           'Solo anuncios con 1 día o más publicados. Se muestran los grupos de 2 anuncios o más (los 12 mejores).\n')
for a in APPS:
    mios = [x for x in filas_a[a] if x['dias'] >= 1]
    out.append(f'### {a} ({len(mios)} anuncios)\n')
    for nombre, f in CAMPOS:
        g = defaultdict(list)
        for x in mios:
            g[f(x)].append(x)
        filas = [[n, len(xs), f'{media([x["v"] / x["dias"] for x in xs]):.2f}', f'{media([x["fav"] / x["dias"] for x in xs]):.3f}']
                 for n, xs in g.items() if len(xs) >= 2]
        filas = sorted(filas, key=lambda r: -float(r[2]))[:12] if nombre != 'Precio' else sorted(filas)
        if filas:
            out.append(f'{nombre}:\n')
            out.append(tabla([nombre, 'Anuncios', 'Visitas/día', 'Favoritos/día'], filas))
out.append(pie(ndias, sum(len(v) for v in filas_a.values())))

out.append('## 5. Anuncios flojos\n')
out.append('Anuncios con 7 días o más publicados y menos visitas por día. Candidatos a resubir o quitar. La REF une el mismo producto en las dos apps.\n')
flojos = {}
for a in APPS:
    viejos = sorted((x for x in filas_a[a] if x['dias'] >= 7), key=lambda x: x['v'] / x['dias'])[:10]
    flojos[a] = viejos
    out.append(f'### {a}\n')
    if viejos:
        out.append(tabla(['REF', 'Artículo', 'Precio', 'Días', 'Visitas', 'Visitas/día', 'Favoritos'],
                         [[x['ficha'].get('ref') or '-', x['ficha']['articulo'][:40], f'{x["precio"]:g} €', f'{x["dias"]:.0f}', x['v'],
                           f'{x["v"] / x["dias"]:.2f}', x['fav']] for x in viejos]))
    else:
        out.append('Ninguno con 7 días o más.\n')
out.append(pie(ndias, sum(len(v) for v in flojos.values())))
resumen.append('Más flojo: ' + '; '.join(
    f'{a} REF {flojos[a][0]["ficha"].get("ref") or "-"} ({flojos[a][0]["v"] / flojos[a][0]["dias"]:.2f} visitas/día)' if flojos[a]
    else f'{a} ningún anuncio con 7 días' for a in APPS) + '.')

# ---------- 6. Resubidas frente a productos nuevos ----------
def ventana(serie, p, horas):
    """(visitas, favoritos, hueco) a las `horas` de publicarse, interpolando; None si las lecturas no llegan.
    hueco: dentro de la ventana hay un salto de más de 3 horas entre dos lecturas."""
    fin, r, hueco = p + horas * H, None, False
    for (ta, va, fa), (tb, vb, fb) in zip(serie, serie[1:]):
        hueco = hueco or (ta < fin and tb > p and tb - ta > 3 * H)
        if ta <= fin <= tb:
            x = (fin - ta) / (tb - ta) if tb > ta else 0
            r = (va + (vb - va) * x, fa + (fb - fa) * x)
    return (*r, hueco) if r else None


notas = {f.stem.split('-')[-1] for f in (D.parent / 'auditoria').glob('resubir-*.md')}


# Un anuncio de la otra app publicado un día antes o más también cuenta: el viejo de la misma app pudo borrarse antes
# de empezar a leer (el Andyus 0214 de Vinted, cuyo primer anuncio solo queda en Wallapop).
def es_resubida(k, f):
    r = f.get('ref')
    return r in notas or bool(r and any(o != k and g.get('ref') == r and (
        g['app'] == f['app'] and g.get('visto_primero', '') < f.get('visto_primero', '')
        or pub.get(o) and pub.get(k) and pub[k] - pub[o] >= 24 * H) for o, g in fichas.items()))


filas6, sin_ventana = [], {a: 0 for a in APPS}
for k, s in series.items():
    a, p = APP[k[0]], pub.get(k)
    if not p:
        continue
    tipo = 'resubida' if es_resubida(k, fichas[k]) else 'nuevo'
    if s[0][0] - p > 3 * H:
        sin_ventana[a] += tipo == 'resubida'
        continue  # publicado antes de empezar a leer: sin ventana
    w24, w48 = ventana(s, p, 24), ventana(s, p, 48)
    if w24:
        filas6.append((a, tipo, fichas[k].get('ref') or '-', local(p), w24, w48))
out.append('## 6. Resubidas frente a productos nuevos\n')
out.append('Una resubida es un producto que ya estaba a la venta y se vuelve a subir desde cero: su REF tiene nota `auditoria/resubir-REF.md`, '
           'hay un anuncio anterior de la misma app con esa REF, o uno de cualquier app publicado al menos un día antes. Nuevo es cualquier otro publicado con las lecturas ya en marcha. Visitas y favoritos en las primeras 24 y 48 horas. '
           '"Hueco" marca las ventanas con un salto de más de 3 horas entre lecturas (el PC duerme de noche), así que casi todas lo tienen: '
           'las medias incluyen esas filas.\n')
medias6, filas = {}, []
for a in APPS:
    for tipo in ('resubida', 'nuevo'):
        g = [x for x in filas6 if x[0] == a and x[1] == tipo]
        g48 = [x[5] for x in g if x[5]]
        medias6[a, tipo] = (len(g), media([x[4][0] for x in g]))
        if g:
            filas.append([a, tipo, len(g), f'{media([x[4][0] for x in g]):.1f}', f'{media([x[4][1] for x in g]):.2f}', len(g48),
                          f'{media([x[0] for x in g48]):.1f}' if g48 else '-', f'{media([x[1] for x in g48]):.2f}' if g48 else '-',
                          sum(x[4][2] for x in g)])
out.append(tabla(['App', 'Grupo', 'Anuncios (24 h)', 'Visitas 24 h', 'Favoritos 24 h', 'Anuncios (48 h)', 'Visitas 48 h', 'Favoritos 48 h', 'Con hueco en 24 h'], filas))
out.append('Por anuncio:\n')
out.append(tabla(['REF', 'App', 'Grupo', 'Publicado (Madrid)', 'v24', 'v48', 'fav48', 'Hueco'],
                 [[x[2], x[0], x[1], f'{x[3]:%d-%m %H:%M}', f'{x[4][0]:.1f}', f'{x[5][0]:.1f}' if x[5] else '-', f'{x[5][1]:.1f}' if x[5] else '-',
                   (('24 h' if x[4][2] else '') + (' 48 h' if x[5] and x[5][2] else '')).strip() or '-']
                  for x in sorted(filas6, key=lambda x: (x[0], x[1], x[3]))]))
for a in APPS:
    r, n = medias6[a, 'resubida'], medias6[a, 'nuevo']
    out.append(f'- {a}: resubidas {r[1]:.1f} visitas en 24 h ({r[0]} anuncios) frente a {n[1]:.1f} en nuevos ({n[0]} anuncios).'
               + (f' Otras {sin_ventana[a]} resubidas sin ventana (publicadas antes de empezar a leer).' if sin_ventana[a] else ''))
out.append(pie(ndias, len(filas6)))
resumen.append('Resubidas frente a nuevos (visitas en 24 h): ' + '; '.join(
    f'{a} {medias6[a, "resubida"][1]:.1f} ({medias6[a, "resubida"][0]}) frente a {medias6[a, "nuevo"][1]:.1f} ({medias6[a, "nuevo"][0]})' for a in APPS) + '.')

# ---------- 7. Puesto en la búsqueda de Wallapop y visitas ----------
out.append('## 7. Puesto en la búsqueda de Wallapop y visitas\n')
out.append('Una vez al día se mide en qué puesto sale cada anuncio cuando alguien de tu zona busca su tipo y su marca (1 es el primero; "fuera" = no sale en los 120 primeros). '
           'Visitas de ese día: las estadísticas diarias de Wallapop si existen, y si no, las ganadas entre lecturas ese día de Madrid.\n')
vw = defaultdict(lambda: defaultdict(int))  # día de Madrid -> clave -> visitas entre lecturas
for (t1, s1), (t2, s2) in zip(puntos['Wallapop'], puntos['Wallapop'][1:]):
    for k, f in s2.items():
        if k in s1 or (k in pub and pub[k] >= t1):
            vw[local(t2).date().isoformat()][k] += max(0, f[0] - s1[k][0]) if k in s1 else f[0]
est = {f['fecha']: f['anuncios'] for f in ficheros}
reg = defaultdict(list)  # clave -> [(día, búsqueda, puesto, visitas)]
for d in dias:
    pos = d.get('posiciones', {}).get('Wallapop')
    for k, (busq, puesto) in (pos['anuncios'].items() if pos else []):
        if d['fecha'] in est:
            if k not in est[d['fecha']] or (k in pub and pub[k].date() > dt.date.fromisoformat(d['fecha'])):
                continue
            v = est[d['fecha']][k][0]
        else:
            v = vw[d['fecha']].get(k, 0)
        reg[k].append((d['fecha'], busq, puesto, v))
BANDAS7 = [('1-3', lambda p: p is not None and p <= 3), ('4-40', lambda p: p is not None and 4 <= p <= 40),
           ('41-120', lambda p: p is not None and p > 40), ('fuera', lambda p: p is None)]
filas = []
for n, f in BANDAS7:
    vs = [x[3] for r in reg.values() for x in r if f(x[2])]
    filas.append([n, len(vs), f'{media(vs):.2f}'])
out.append(tabla(['Puesto', 'Anuncios-día', 'Visitas por día'], filas))
dias_pos = sorted({x[0] for r in reg.values() for x in r})
ult = max(local(t) for t, _ in puntos['Wallapop'])
if dias_pos and dias_pos[-1] not in est and ult.hour < 23 and ult.date().isoformat() == dias_pos[-1]:
    out.append(f'- El {dias_pos[-1]} solo llega hasta las {ult:%H:%M} y sus visitas son las de ese rato: salen más bajas de lo que serán con el día entero.')
out.append('\nAnuncios cuyo puesto empeoró 10 o más lugares, o que salieron de los 120 primeros, entre su primer y último día medido (candidatos a resubir):\n')
peores = []
for k, r in reg.items():
    a, b = r[0], r[-1]
    if len(r) > 1 and ((b[2] is None and a[2] is not None) or (None not in (a[2], b[2]) and b[2] - a[2] >= 10)):
        peores.append([fichas[k].get('ref') or '-', a[1], a[2] or 'fuera', b[2] or 'fuera', f'{media([x[3] for x in r]):.1f}', f'{a[0][5:]} a {b[0][5:]}'])
out.append(tabla(['REF', 'Búsqueda', 'Primer puesto', 'Último puesto', 'Visitas/día', 'Días'], sorted(peores)) if peores else 'Ninguno.\n')
out.append(pie(len(dias_pos), len(reg)))
resumen.append('Puesto en Wallapop: ' + ', '.join(f'{f[0]} {f[2]} visitas/día ({f[1]})' for f in filas) +
               f'; {len(peores)} anuncios empeoraron 10 o más puestos, con {len(dias_pos)} días de posiciones.')

(D / 'analisis.md').write_text('\n'.join(out), encoding='utf-8')
if ndias < 14:
    resumen[0] += ' Pocos datos, no sacar conclusiones.'
print('\n'.join([resumen[0], resumen[1] + ' ' + resumen[2], resumen[3] + ' ' + resumen[4], resumen[5], resumen[6], resumen[7], resumen[8]]))
print(f'Días nuevos descargados: {descargas}. Informe en {D / "analisis.md"}')
