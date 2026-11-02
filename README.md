# Ventas de segunda mano: panel para Vinted y Wallapop

Un panel para seguir tus ventas de segunda mano en Vinted y Wallapop (España): lo cobrado, lo pendiente, las visitas y los favoritos de cada anuncio, a qué hora llegan las visitas y qué anuncios flojean. Se instala en el móvil y en el PC como una app.

Cada persona monta el suyo, gratis, en su propia cuenta de Vercel. Tus datos no pasan por nadie más.

## Cómo funciona

- **`lector-chrome/`, extensión de Chrome «Lector de ventas».** Cada 30 minutos, de 8:00 a 24:00, lee tus anuncios, tus ventas y tus chats con la sesión que ya tienes abierta en Vinted y Wallapop, y lo manda a tu panel. No escribe nada en las apps ni abre los chats que no has leído.
- **`web/`, el panel.** Una página con su API, que se publica en Vercel y guarda los datos en Vercel Blob. Se puede instalar como app.
- **`herramientas/`, scripts de Python (opcionales).**
  - `preparar.py` endereza, recorta y reduce las fotos de un producto.
  - `analisis.py` saca un informe semanal de visitas por hora, por día y por tipo de anuncio.
- **`pc/`, opcional (Windows).** Despierta el PC a las 8:00 para no perder las lecturas de la mañana.

El formato de los datos está en [DATOS.md](DATOS.md).

## Antes de usarlo

- **Vinted y Wallapop no tienen una API pública.** La extensión usa las mismas llamadas que sus webs, así que puede dejar de funcionar cuando cambien algo. Las dos plataformas prohíben los bots: la extensión solo lee, a ritmo de persona, pero **lo usas bajo tu responsabilidad**.
- Solo funciona con vinted.es y es.wallapop.com.
- La extensión solo lee mientras el PC está encendido y Chrome abierto.

## Instalación

Necesitas una cuenta de [GitHub](https://github.com) y otra de [Vercel](https://vercel.com) (el plan Hobby, gratuito, basta), y Google Chrome.

### 1. Tu copia del proyecto

En GitHub, pulsa **Fork** (arriba a la derecha) para tener tu propia copia.

### 2. El panel en Vercel

1. En Vercel: **Add New… > Project**, e importa tu copia del repositorio.
2. En **Root Directory** pulsa **Edit** y elige `web`. Vercel propone otra carpeta (`herramientas`): cámbiala. Pulsa **Deploy**.
3. En el proyecto, abre **Storage > Create Database > Blob**. Ponle un nombre, elige la región más cercana (en España, París, `cdg1`) y en **Access** marca **Public**: el panel no funciona con un almacén privado. Pulsa **Create**. El almacén queda conectado al proyecto y Vercel añade solo sus variables.
4. En **Settings > Environment Variables**, añade estas tres variables:

   | Variable | Qué poner |
   |---|---|
   | `CLAVE_PANEL` | Una contraseña larga para entrar al panel. |
   | `CLAVE_LECTOR` | Otra contraseña larga, distinta, para la extensión. |
   | `DATOS_RUTA` | El nombre del archivo de datos, con letras al azar, por ejemplo `ventas-k3j9x2m7q8.json`. |

   Los archivos de Vercel Blob son públicos para quien sepa su dirección. Por eso `DATOS_RUTA` tiene que llevar una parte al azar que nadie pueda adivinar.

   Para inventar una contraseña larga, por ejemplo: `node -e "console.log(crypto.randomUUID())"`.
5. En **Deployments**, vuelve a desplegar (los tres puntos del último despliegue > **Redeploy**) para que el panel use las variables.

Tu panel queda en `https://<tu-proyecto>.vercel.app`.

### 3. La extensión

1. Descarga el proyecto (**Code > Download ZIP**) y descomprímelo.
2. En Chrome, abre `chrome://extensions`, activa el **Modo de desarrollador** y pulsa **Cargar descomprimida**. Elige la carpeta `lector-chrome`.
3. Se abren las opciones. Rellena:
   - la dirección de tu panel;
   - la `CLAVE_LECTOR`;
   - tu número de Vinted (el de la dirección de tu perfil, `vinted.es/member/123456789`);
   - si quieres, tu ubicación, para saber en qué puesto salen tus anuncios en las búsquedas de Wallapop de tu zona.

   Cuando Chrome lo pida, acepta el permiso para tu panel.
4. Inicia sesión en vinted.es y es.wallapop.com en ese mismo Chrome.
5. Pulsa el icono de la extensión para hacer la primera lectura. Si sale «!», pon el ratón encima para ver qué falló.

### 4. El panel en el móvil y en el PC

Abre la dirección de tu panel y escribe la `CLAVE_PANEL` (una vez en cada aparato).

- **Android (Chrome):** menú ⋮ > **Instalar aplicación**.
- **iPhone (Safari):** botón Compartir > **Añadir a pantalla de inicio**.
- **PC (Chrome o Edge):** el icono de instalar de la barra de direcciones.

### 5. Herramientas de Python (opcional)

Con Python 3.10 o superior:

```bash
pip install -r herramientas/requirements.txt
```

- **Fotos:**
  - Vista previa: `python -I herramientas/preparar.py "<carpeta del producto>"`. No toca nada y deja la hoja de contactos en `herramientas/hoja.jpg`.
  - Para quedarte con el resultado, añade `--aplicar`. **Cuidado:** borra los originales. Si la carpeta está en Google Drive, van a su papelera; en un disco normal se borran del todo. Haz antes una copia.
- **Informe semanal:** copia `herramientas/config.example.json` como `config.json`, pon la dirección de tu panel y la `CLAVE_PANEL`, y ejecuta `python -I herramientas/analisis.py`. Escribe `herramientas/analisis.md`.

## Actualizar

En GitHub, en tu copia, pulsa **Sync fork**. Vercel vuelve a desplegar el panel solo. Para la extensión, descarga el proyecto de nuevo, sustituye la carpeta `lector-chrome` y pulsa el botón de recargar en `chrome://extensions`.

## Licencia

[MIT](LICENSE): puedes usarlo, cambiarlo y compartirlo libremente.
