"""Dibuja el icono del panel en SVG y lo pasa a PNG con Chrome sin ventana, a cada tamaño exacto.

Uso: python -I iconos/generar.py   (desde cualquier carpeta)
Escribe iconos/icono.svg e iconos/icono-maskable.svg, y en web/ los PNG que pide el manifest.

El dibujo: una etiqueta de precio blanca con el punto rojo de la marca en el agujero y una flecha hacia
arriba recortada, sobre negro con un brillo azul (Vinted) arriba y naranja (Wallapop) abajo.
"""
import pathlib
import subprocess
import tempfile

RAIZ = pathlib.Path(__file__).resolve().parent.parent
CHROME = pathlib.Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')

# Etiqueta horizontal con la punta a la izquierda, centrada en (0, 0); luego se gira 45° (punta arriba a la izquierda).
ETIQUETA = ('M -35,-95 L 122,-95 Q 150,-95 150,-67 L 150,67 Q 150,95 122,95 L -35,95 Q -55,95 -69.1,80.9 '
            'L -138.7,11.3 Q -150,0 -138.7,-11.3 L -69.1,-80.9 Q -55,-95 -35,-95 Z')
# Flecha en vertical: con el giro queda apuntando arriba a la derecha.
FLECHA = 'M 48,66 L 48,-46 M 8,-6 L 48,-46 L 88,-6'


def svg(lleno, escala):
    """lleno: fondo hasta los bordes (maskable e iOS, que recortan ellos). Si no, cuadrado redondeado."""
    fondo = ('<rect width="512" height="512" fill="url(#base)"/>' if lleno
             else '<rect width="512" height="512" rx="112" fill="url(#base)"/>')
    recorte = '' if lleno else '<clipPath id="forma"><rect width="512" height="512" rx="112"/></clipPath>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
  {recorte}
  <linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16161b"/><stop offset="1" stop-color="#050506"/></linearGradient>
  <radialGradient id="azul" cx="0.2" cy="0.16" r="0.62"><stop offset="0" stop-color="#5c7cfa" stop-opacity="0.62"/><stop offset="1" stop-color="#5c7cfa" stop-opacity="0"/></radialGradient>
  <radialGradient id="naranja" cx="0.86" cy="0.9" r="0.6"><stop offset="0" stop-color="#e46a12" stop-opacity="0.55"/><stop offset="1" stop-color="#e46a12" stop-opacity="0"/></radialGradient>
  <linearGradient id="papel" gradientUnits="userSpaceOnUse" x1="-110" y1="-110" x2="110" y2="110"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d8dce4"/></linearGradient>
  <mask id="corte" maskUnits="userSpaceOnUse" x="-200" y="-200" width="400" height="400">
    <path d="{ETIQUETA}" fill="#fff"/>
    <path d="{FLECHA}" fill="none" stroke="#000" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
  </mask>
  <filter id="sombra" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000" flood-opacity="0.6"/></filter>
  <filter id="brillo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<g{' clip-path="url(#forma)"' if not lleno else ''}>
  {fondo}
  <rect width="512" height="512" fill="url(#azul)"/>
  <rect width="512" height="512" fill="url(#naranja)"/>
</g>
<g filter="url(#sombra)">
  <g transform="translate(256 256) scale({escala}) translate(-33.5 -33.5) rotate(45)">
    <path d="{ETIQUETA}" fill="url(#papel)" mask="url(#corte)"/>
    <circle cx="-102" cy="0" r="20" fill="#ff1a1a" filter="url(#brillo)"/>
  </g>
</g>
</svg>
'''


def png(origen, destino, lado):
    """Abre el SVG en Chrome sin ventana, a ese tamaño exacto, y guarda la captura con fondo transparente."""
    html = f'<html><body style="margin:0;background:transparent"><img src="{origen.as_uri()}" width="{lado}" height="{lado}" style="display:block"></body></html>'
    with tempfile.TemporaryDirectory() as tmp:
        pagina = pathlib.Path(tmp) / 'icono.html'
        pagina.write_text(html, encoding='utf-8')
        subprocess.run([str(CHROME), '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                        '--default-background-color=00000000', f'--user-data-dir={tmp}', f'--window-size={lado},{lado}',
                        f'--screenshot={destino}', pagina.as_uri()], check=True, capture_output=True, timeout=60)


carpeta, web = RAIZ / 'iconos', RAIZ / 'web'
normal, maskable = carpeta / 'icono.svg', carpeta / 'icono-maskable.svg'
normal.write_text(svg(lleno=False, escala=1.12), encoding='utf-8')
# Maskable: Android recorta en círculo o en otras formas, así que el dibujo va dentro del círculo seguro (80 %).
maskable.write_text(svg(lleno=True, escala=0.85), encoding='utf-8')
png(normal, web / 'icon-192.png', 192)
png(normal, web / 'icon-512.png', 512)
png(maskable, web / 'icon-maskable-512.png', 512)
png(maskable, web / 'apple-touch-icon.png', 180)  # iOS redondea las esquinas él solo
print('hecho')
