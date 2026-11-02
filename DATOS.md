# Datos del panel de ventas

Lo que la extensión «Lector de ventas» manda al panel, cómo se guarda y cómo leerlo. Si cambia algo de aquí, hay que cambiar a la vez la extensión (`lector-chrome/`) y la API (`web/api/`).

## Límites de Vercel Blob (plan Hobby)

Al mes se pueden hacer 2.000 operaciones avanzadas (`put`, `list`, `copy`) y 10.000 simples (`head`, o leer un archivo que no está en la caché), y transferir 10 GB. **Si se pasa uno de estos límites, el almacén se bloquea 30 días.** En los 30 días anteriores al 29-10-2026 se gastaron 104 avanzadas y 521 simples.

- Cada lectura de la extensión cuesta un `put` (unos 32 al día, unos 1.000 al mes). El historial añade un `put` al día, y las estadísticas de Wallapop otro (7 la primera vez).
- El almacén es privado y se lee con `get()`. `cargar()` sale de la caché (hasta 60 s de retraso, sin gastar operaciones); solo la ingesta y los avisos, que cambian el JSON, lo leen sin caché con `cargar(true)`, y cada una de esas lecturas es una operación simple.
- No usar `list()` para buscar días: las fechas están en `historial`.
- El panel no debe pedir datos con la página oculta.

## El JSON principal

Es un solo archivo, cuyo nombre está en la variable `DATOS_RUTA` (`ventas.json` si no se pone). Las horas van en ISO y en UTC (`2026-10-29T12:19:17.000Z`); los días, en hora de Madrid (`AAAA-MM-DD`).

| Campo | Qué es |
|---|---|
| `ventas` | `{clave: venta}`, todas las ventas. |
| `lecturas` | `{AAAA-MM-DD: {Vinted: [anuncio], Wallapop: [anuncio]}}`, la **última** lectura de cada día. La usa `calcular`. Solo el último día de cada app va entero; los anteriores se quedan en `{clave, visitas, favoritos}`, que es lo que `calcular` usa de ellos (desde el 29-10-2026: así el JSON crece unos 4 KB al día en vez de 30). Se borra lo que tiene más de 400 días. |
| `estado` | `{Vinted \| Wallapop: {clave: fila}}`, cómo estaba cada anuncio en la última lectura de su app. |
| `hoy` | Todas las lecturas de hoy con su hora (ver abajo). |
| `historial` | `[AAAA-MM-DD]`, los días ya guardados aparte. |
| `fichas` | `{clave: ficha}`, lo que no cambia de cada anuncio, también de los que ya no están. |
| `ultima` | `{Vinted \| Wallapop: hora}`, la última lectura anotada de cada app. |
| `estadisticas` | `[AAAA-MM-DD]`, los días de estadísticas de Wallapop ya guardados aparte (ver abajo). |
| `avisos`, `siguiente` | Ventas nuevas, canceladas y cerradas para el vigilante de Claude (`/api/avisos`). |
| `origenes` | `{lector \| claude: {ultima, errores, notas?, sinLeer?}}`, la última lectura de cada origen y sus problemas. `notas`: lo último que el origen dejó apuntado aparte (por ejemplo, el resultado de una prueba); se conserva hasta la siguiente nota. `sinLeer` (desde la 1.8): `{Vinted \| Wallapop: {n, desde}}`, cuántos chats sin leer hay en cada app y la hora (ISO, UTC) del último mensaje del más antiguo, `null` si no hay ninguno. Si una app no se pudo mirar, se queda lo último que se supo de ella. |
| `errores` | `[{t, origen, e}]` (desde el 31-10-2026), cada lectura que tuvo algún problema, con su hora y el texto de `errores`. Se quedan las 300 últimas. En `origenes` solo está la última; aquí se ven los problemas que van y vienen. |

### anuncio (en `lecturas`)

`{clave, url, articulo, precio, publicado, publicado_en, visitas, favoritos, chats, ofertas?, estado, ref}`

- `clave`: `V` + id de Vinted, o `W` + el número del final del enlace de Wallapop.
- `publicado`: el día; `publicado_en`: la hora exacta. En Vinted es la hora a la que se subió la primera foto, porque Vinted no da otra; en Wallapop, la de publicación.
- `visitas`, `favoritos`: los totales que da la app. `chats`: los chats del anuncio. En Wallapop los cuenta la app. En Vinted (desde la 1.6) los cuenta la extensión en la bandeja: sin los chats en los que compras tú, y sin los que aún no has leído, que la extensión no abre para no marcarlos como leídos. `ofertas`: las ofertas recibidas en esos chats (solo Vinted).
- `estado`: `activo`, `oculto` (solo Vinted) o `reservado`.
- `ref`: la REF de la descripción. `null` si no tiene una sola REF; sin el campo, aún no se ha mirado. Une los anuncios de un mismo producto en las dos apps.

### fila (en `estado`, `hoy` e historial)

`[visitas, favoritos, precio, estado, chats, ofertas?]`. `chats` es `null` en Vinted antes de la 1.6. `ofertas` solo está en Vinted.

### hoy y los días del historial

```
{ fecha: "2026-10-29",
  base: {Vinted: {clave: fila}, Wallapop: {clave: fila}},   // el estado al empezar el día
  lecturas: [ {t, app, n, c?, fuera?} ],
  posiciones?: {Wallapop: {t, anuncios: {clave: [búsqueda, puesto]}}} }
```

- Hay una entrada por cada lectura de cada app (cada 30 minutos, de 8:00 a 24:00, si el PC y Chrome están encendidos). Desde la 1.6, de 0:00 a 8:00 hay además una lectura de Wallapop cada 3 horas, más o menos, que reparte las visitas de la noche.
- `posiciones`: una vez al día, en la primera lectura de Wallapop de 8:00 en adelante, el puesto de cada anuncio cuando alguien de tu zona (la ubicación de las opciones de la extensión) busca en Wallapop su tipo y su marca (`jersey scorzzo`; sin marca, las dos primeras palabras del título), por relevancia como la web. `puesto` es 1 el primero y `null` si no sale en los 120 primeros. Es la búsqueda pública, sin tu sesión.
- `t`: la hora de la lectura; `n`: cuántos anuncios había.
- `c`: `{clave: fila}`, **solo los anuncios que cambiaron** desde la lectura anterior de esa app, y los nuevos.
- `fuera`: los anuncios que ya no salen (vendidos, borrados o pausados).
- Una entrada sin `c` ni `fuera` significa que esa media hora se miró y no cambió nada. Si una media hora no tiene entrada, no se miró: no hay que contarla como cero.
- Para saber cómo estaba todo a una hora: partir de `base` y aplicar en orden `c` y `fuera` de las lecturas hasta esa hora.
- Las visitas de un anuncio en un intervalo son la resta de dos filas suyas. Hasta la 1.5, las de 0:00 a 8:00 llegaban todas juntas en la primera lectura de la mañana; en Vinted sigue siendo así.

Con la primera lectura de un día nuevo, `hoy` se guarda aparte, en `rutaHistorial(fecha)` = `<DATOS_RUTA sin .json>/historial/AAAA-MM-DD.json`, y su fecha se añade a `historial`. Ese archivo ya no cambia, así que `leerArchivo(ruta)` lo lee desde la caché.

### Estadísticas de Wallapop por día

Wallapop da, para cada anuncio publicado, las visitas, los favoritos y los chats de cada uno de los últimos 7 días (la gráfica "Estadísticas de la semana" de su página de estadísticas). Vinted no tiene nada parecido.

- La extensión las pide una vez al día, en la primera lectura de Wallapop, un anuncio tras otro con pausas (unos 2 minutos).
- Cada día terminado se guarda una sola vez en `rutaEstadisticas(fecha)` = `<DATOS_RUTA sin .json>/estadisticas/AAAA-MM-DD.json` y su fecha pasa a `estadisticas`:
  ```
  { fecha: "2026-10-28", app: "Wallapop", anuncios: {clave: [visitas, favoritos, chats]} }
  ```
- Son las visitas de ese día, no el total. Sirven para los días en que el PC estuvo apagado: al encenderlo, la extensión recupera hasta 7 días atrás.
- La fecha es la que da Wallapop: la medianoche en UTC. Aún no se sabe si Wallapop cuenta el día en hora de España o en UTC.
- Solo salen los anuncios que estaban publicados cuando se pidió. Un anuncio aparece con ceros en los días anteriores a su publicación (`publicado_en` de su ficha).

### ficha

`{app, url, articulo, ref, publicado_en, categoria, categoria_id, marca, talla, color, estado_prenda, medidas, id_app, visto_primero, visto_ultimo}`

- La extensión pide la ficha una sola vez por anuncio (como mucho 10 por lectura). Las primeras lecturas tras instalarla la van completando.
- `categoria`: el nombre completo de la categoría, solo en Wallapop (`Moda y accesorios > Mujer > Ropa > Jerséis y sudaderas > Jerséis`). En Vinted solo hay `categoria_id` (el número de catálogo, por ejemplo 529).
- `estado_prenda`: el estado del artículo según la app (`Muy bueno`, `Buen estado`…).
- `medidas`: `{largo, ancho}` en cm, del recuadro "Medidas" de Vinted. `null` si no se rellenó.
- `id_app`: el id interno de Wallapop, con el que se pide la ficha.
- `visto_primero` y `visto_ultimo`: la primera y la última lectura en que salió el anuncio. `visto_ultimo` de un anuncio que ya no está es, más o menos, cuando se vendió o se quitó.

### venta

`{fecha, app, articulo, importe, estado, entrega, codigo, hora, anuncios, pedido}`

- `estado`: `Cobrado`, `Pendiente` o `Perdido`. `codigo`: `C` cerrada, `W` en camino, `N` sin enviar, `X` cancelada, `A` reembolso automático, `D` devuelta.
- `hora`: la hora de compra. Solo en Vinted; Wallapop solo da el día.
- `fecha`: el día de compra, en hora de Madrid. Las ventas de Vinted de antes del 29-10-2026 llevaban el día en UTC; se corrigen solas en la siguiente lectura si son de los últimos 60 días.
- `anuncios`: las claves de los anuncios vendidos (varias si es un lote). En Wallapop solo se sabe si el anuncio aún tiene foto.
- `pedido`: el id del seguimiento del envío de Wallapop.
- `entrega`: `Envío` o `En mano`. Las ventas en mano de Wallapop salen de "Tu catálogo > Vendidos", que también tiene las vendidas con envío: el panel solo se queda con las que no tienen una venta con envío (no perdida) del mismo anuncio o del mismo comienzo de título. Su clave es `M<día en que se marcó vendido>-<12 primeras letras del título>`, como en `estadisticas/panel.py`; su fecha es ese día y su importe, el precio del anuncio.
- Las claves de Wallapop son `W<fecha>-<12 primeras letras del título>`. No se cambian para no duplicar ventas viejas.

## Lo que manda la extensión (`POST /api/ingesta`)

```
{ clave, datos: {
    origen: "lector", errores,
    horas: {Vinted?: t, Wallapop?: t},          // cuándo se leyó cada app
    anuncios: {Vinted?: [anuncio], Wallapop?: [anuncio]},
    fichas: {clave: ficha},                     // de los anuncios leídos
    ventas: [venta con clave],
    estadisticas?: {Wallapop: {clave: [[AAAA-MM-DD, visitas, favoritos, chats]]}},   // una vez al día
    posiciones?: {Wallapop: {clave: [búsqueda, puesto]}},                           // una vez al día
    notas?,
    sinLeer?: {Vinted?: {n, desde}, Wallapop?: {n, desde}} } }   // de día, desde la 1.8
```

- Si el panel no responde, la lectura espera en una cola de la extensión y se manda en la siguiente, en orden. Caben hasta 1.500 lecturas (un mes) y se mandan 50 cada vez.
- El servidor se salta las lecturas que ya tiene o que son más viejas que la última anotada de su app.
- Claude puede mandar lecturas con `origen: "claude"`. Si no lleva `horas`, se usa la hora de llegada.

## Leer los datos guardados (`POST /api/datos`)

Para analizar, con la clave del panel. Lee el JSON principal (una operación simple del almacén) o un archivo de un día.

- `{clave}`: `{hoy, historial, estadisticas, fichas, estado, ultima, origenes, errores, bytes}`. `bytes` es lo que ocupa el JSON principal.
- `{clave, dia: "AAAA-MM-DD"}`: ese día del historial, con la forma de `hoy`. `null` si no está guardado.
- `{clave, dia, tipo: "estadisticas"}`: ese día de las estadísticas de Wallapop.
