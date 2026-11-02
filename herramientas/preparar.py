"""Prepara las fotos de un producto para Vinted y Wallapop, en su misma carpeta REF.

Uso:
    python -I preparar.py "<carpeta REF>"            vista previa: no toca la carpeta
    python -I preparar.py "<carpeta REF>" --aplicar  deja en la carpeta solo las fotos preparadas

Las fotos nuevas son las del último día de toma (fecha EXIF de la cámara o, si no la tienen, la
fecha del nombre del archivo, como en las de WhatsApp). Las de días anteriores, las que no tienen
fecha y las ya preparadas antes (01.jpg, 02.jpg...) son viejas. Si ninguna foto tiene fecha, todas
cuentan como nuevas.

Con --aplicar se borran los originales, las viejas y edicion.txt. Si la carpeta está en Google Drive,
van a su papelera, que los guarda 30 días; en un disco normal se borran del todo, así que haz antes
una copia. Si alguno no se deja borrar, se queda y se ignora: solo se suben a Vinted y Wallapop
las 01.jpg, 02.jpg...

Para cada foto nueva (en orden de nombre):
- gira según la orientación de la cámara (EXIF) y pasa el color a sRGB;
- aplica los ajustes manuales de edicion.txt, si existe;
- recorta al producto con margen, en 3:4 vertical si cabe. Si no distingue el producto del
  fondo (por ejemplo, en un detalle de cerca), no recorta;
- reduce a 1600 px de lado largo y la guarda sin metadatos (EXIF, GPS, número de serie).
La hoja de contactos para revisarlas va a Sistema/fotos/hoja.jpg (una sola, se sobrescribe).

No toca color, brillo, contraste ni nitidez. Vinted prohíbe editar las fotos ("deben presentar
el artículo tal y como es") y Wallapop prohíbe fotos que no se correspondan con el producto. El
color se ajusta en la cámara (balance de blancos personalizado con cartulina gris o blanca).

edicion.txt (opcional), una línea por foto; se borra al aplicar:
    IMG_0012.JPG rot=1.5        endereza girando 1,5° en sentido antihorario (negativo = horario)
    IMG_0013.JPG rot=90         gira la foto entera 90° (antihorario)
    IMG_0014.JPG recorte=no     no recorta
    IMG_0016.JPG recorte=0,0.05,0.97,0.85   recorte a mano: izquierda, arriba, derecha, abajo, en
                                            fracción de la foto (ya girada). Para quitar el techo y
                                            los laterales del armario cuando el automático falla
    IMG_0017.JPG orden=1        posición en el anuncio (las que no lo llevan van detrás, por nombre)
    IMG_0015.JPG fuera          no la usa (se borra al aplicar)
Se pueden juntar varias en una línea: "IMG_0016.JPG orden=1 recorte=0,0.05,0.97,0.85".
El nombre puede llevar espacios ("WhatsApp Image 2026-10-26 at 10.48.37.jpeg orden=9").
"""
import io, re, site, sys, math
from pathlib import Path

sys.path.append(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageCms, ImageDraw, ImageFilter, ImageOps

LADO = 1600          # lado largo de salida en px
RATIO = 3 / 4        # ancho / alto
MARGEN = 0.08        # margen alrededor del producto, fracción de su tamaño
HOJA = Path(__file__).with_name('hoja.jpg')
PREPARADA = re.compile(r'^\d{2}\.jpg$', re.I)   # nombre de las fotos que deja este script

sys.stdout.reconfigure(encoding='utf-8')


def ajustes(carpeta):
    a = {}
    f = carpeta / 'edicion.txt'
    if f.exists():
        for linea in f.read_text(encoding='utf-8').splitlines():
            p = linea.split()
            i = next((k for k, x in enumerate(p) if '=' in x or x == 'fuera'), len(p))   # el nombre puede tener espacios
            if i:
                a[' '.join(p[:i]).lower()] = {k: v for k, _, v in (x.partition('=') for x in p[i:])}
    return a


def dia(p):
    """Día de la toma según el EXIF de la cámara o, si no lo tiene, según el nombre del archivo
    ("WhatsApp Image 2026-10-26 at...", "IMG_20240104_..."). None si no hay ninguno."""
    try:
        exif = Image.open(p).getexif()
        d = exif.get_ifd(0x8769).get(36867) or exif.get(306)   # DateTimeOriginal o DateTime
        if d:
            return d[:10].replace(':', '-')
    except Exception:
        pass
    m = re.search(r'(20\d\d)-?(\d\d)-?(\d\d)', p.name)
    return '-'.join(m.groups()) if m else None


def abrir(p):
    im = Image.open(p)
    icc = im.info.get('icc_profile')
    im = ImageOps.exif_transpose(im).convert('RGB')
    if icc:
        try:
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                                           ImageCms.createProfile('sRGB'), outputMode='RGB')
        except ImageCms.PyCMSError:
            pass
    return im


def girar(im, grados):
    if grados % 90 == 0:                          # foto entera de lado o boca abajo
        return im.rotate(grados, expand=True)
    w, h = im.size
    im = im.rotate(grados, resample=Image.BICUBIC)
    s = math.sin(math.radians(abs(grados)))
    dx, dy = math.ceil(h * s), math.ceil(w * s)   # quita las esquinas vacías
    return im.crop((dx, dy, w - dx, h - dy))


def caja_producto(im):
    """Caja del producto, o None si no se distingue del fondo (color mediano del borde)."""
    peq = im.copy()
    peq.thumbnail((400, 400))
    a = np.asarray(peq, dtype=np.float32)
    h, w, _ = a.shape
    b = max(2, int(min(h, w) * 0.04))
    borde = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3),
                            a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    fondo = np.median(borde, axis=0)
    dist = np.linalg.norm(a - fondo, axis=2)
    umbral = max(28.0, float(np.percentile(np.linalg.norm(borde - fondo, axis=1), 90)) * 1.6)
    m = Image.fromarray(((dist > umbral) * 255).astype(np.uint8))
    m = np.asarray(m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5))) > 0
    filas = np.where(m.mean(axis=1) > 0.01)[0]
    cols = np.where(m.mean(axis=0) > 0.01)[0]
    if not len(filas) or not len(cols):
        return None
    x0, x1, y0, y1 = cols[0], cols[-1] + 1, filas[0], filas[-1] + 1
    frac = (x1 - x0) * (y1 - y0) / (w * h)
    if not 0.05 < frac < 0.92:
        return None
    k = im.width / w
    return (x0 * k, y0 * k, x1 * k, y1 * k)


def recorte(W, H, caja):
    """Caja 3:4 con el producto y su margen. Si el producto no cabe en 3:4 dentro de la foto,
    recorta solo al producto con margen, sin forzar la proporción (nunca corta el producto)."""
    x0, y0, x1, y1 = caja
    pw, ph = x1 - x0, y1 - y0   # el producto sin margen: esto es lo que no se puede cortar
    mx, my = pw * MARGEN, ph * MARGEN
    x0, y0, x1, y1 = max(x0 - mx, 0), max(y0 - my, 0), min(x1 + mx, W), min(y1 + my, H)
    bw, bh = x1 - x0, y1 - y0
    if bw / bh > RATIO:
        bh = bw / RATIO
    else:
        bw = bh * RATIO
    if bh > H:
        bh, bw = H, H * RATIO
    if bw > W:
        bw, bh = W, W / RATIO
    if bw < pw or bh < ph:
        return tuple(round(v) for v in (x0, y0, x1, y1)), False
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    l = min(max(cx - bw / 2, 0), W - bw)
    t = min(max(cy - bh / 2, 0), H - bh)
    return tuple(round(v) for v in (l, t, l + bw, t + bh)), True


def hoja(fotos, destino):
    th = [f.copy() for f in fotos]
    for t in th:
        t.thumbnail((300, 400))
    cols = 4
    filas = math.ceil(len(th) / cols)
    h = Image.new('RGB', (cols * 310, filas * 430), 'white')
    d = ImageDraw.Draw(h)
    for i, t in enumerate(th):
        x, y = (i % cols) * 310 + 5, (i // cols) * 430 + 5
        h.paste(t, (x, y))
        d.text((x, y + 405), f'{i + 1:02d}', fill='black')
    h.save(destino, quality=85)


def main(carpeta, aplicar):
    carpeta = Path(carpeta)
    aj = ajustes(carpeta)
    fotos = sorted(p for p in carpeta.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg'))
    dias = {p: dia(p) for p in fotos if not PREPARADA.match(p.name)}
    if not dias:
        print('No hay fotos nuevas: solo las ya preparadas.')
        return
    # Las nuevas son las del último día con fecha de cámara. Sin fecha (capturas, fotos
    # reenviadas) solo cuentan como nuevas si ninguna foto la tiene.
    fechas = [d for d in dias.values() if d]
    ultimo = max(fechas) if fechas else None
    nuevas = [p for p in dias if dias[p] == ultimo]
    for p in fotos:
        if p not in nuevas:
            print(f'{p.name}: vieja ({dias.get(p, "ya preparada") or "sin fecha"}), se borra al aplicar')
    nuevas.sort(key=lambda p: float(aj.get(p.name.lower(), {}).get('orden', 999)))
    hechas = []
    for p in nuevas:
        a = aj.get(p.name.lower(), {})
        if 'fuera' in a:
            print(f'{p.name}: fuera')
            continue
        im = abrir(p)
        if 'rot' in a:
            im = girar(im, float(a['rot']))
        caja = caja_producto(im)
        nota = []
        if ',' in a.get('recorte', ''):
            x0, y0, x1, y1 = (float(v) for v in a['recorte'].split(','))
            im = im.crop((round(x0 * im.width), round(y0 * im.height),
                          round(x1 * im.width), round(y1 * im.height)))
            nota.append('recorte manual')
        elif caja and a.get('recorte') != 'no':
            r, es34 = recorte(im.width, im.height, caja)
            im = im.crop(r)
            nota.append('recorte 3:4' if es34 else 'recorte con margen (no cabe en 3:4)')
        im.thumbnail((LADO, LADO), Image.LANCZOS)
        hechas.append(im)
        print(f'{len(hechas):02d} <- {p.name}: {im.width}x{im.height}, {", ".join(nota) or "sin recorte"}')
    if not hechas:
        return
    hoja(hechas, HOJA)
    print(f'Hoja de contactos: {HOJA}')
    if not aplicar:
        print('Vista previa: la carpeta no se ha tocado. Para dejar solo estas fotos: --aplicar')
        return
    temporales = []
    for i, im in enumerate(hechas, 1):   # primero se guardan las nuevas y luego se quita lo viejo
        t = carpeta / f'.nueva-{i:02d}.jpg'
        im.save(t, quality=88, optimize=True, progressive=True)
        temporales.append(t)
    # Lo viejo se borra si se deja; si no, se queda y se ignora.
    quedan = []
    for p in fotos + [carpeta / 'edicion.txt']:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            quedan.append(p.name)
    for i, t in enumerate(temporales, 1):
        t.replace(carpeta / f'{i:02d}.jpg')
    print(f'{len(temporales)} fotos en {carpeta}' + (f'; no se pudieron borrar: {quedan}' if quedan else ''))


if __name__ == '__main__':
    main(sys.argv[1], '--aplicar' in sys.argv[2:])
