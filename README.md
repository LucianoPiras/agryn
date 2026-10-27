# AGRYN Monitoreo

App de monitoreo interno de **silobolsas inteligentes**. Cada silobolsa tiene varios nodos, y cada nodo mide **pH, temperatura, humedad y CO₂**. La app muestra el historial en gráficos, el detalle de cada variable y dispara alertas al instante cuando un valor se sale de su rango habitual.

> Estado actual: **prototipo con datos simulados**. Todavía no está conectado a los nodos reales.

## Cómo correrla

Requiere Node 18 o superior.

```bash
npm install
npm run dev        # desarrollo, en http://localhost:5173
npm run build      # versión para publicar, en /dist
npm run preview    # probar la versión compilada
```

## Backend y gateway LoRa

El servidor guarda silobolsas, nodos, lecturas y alertas en SQLite (`data/agryn.db`, o `AGRYN_DB`). Las reglas de rango viven en `server/umbrales.js`.

**Gateway LoRa (ESP32).** Recibe las lecturas de los nodos y las envía al servidor:

```http
POST /api/gateway/lecturas
X-Api-Key: <AGRYN_GATEWAY_KEY>
Content-Type: application/json

[{"device_id": "ESP32-A1", "ph": 6.5, "temp": 18.2, "hum": 13.1, "co2": 1.2, "ts": 1761550000000}]
```

- Acepta una lectura o un lote de hasta 500. `ts` en milisegundos; si falta, usa la hora del servidor.
- `device_id` tiene que estar cargado como nodo de una silobolsa.
- Repetir el mismo nodo y `ts` no duplica la lectura, así que los reintentos son seguros.
- Si una lectura se sale del rango, se crea una alerta (Atención o Crítica). No se repite mientras no se reconozca.

**API de la app** (`/api/...`, requiere sesión): `silobolsas` (CRUD), `silobolsas/:id/nodos`, `nodos/:id/lecturas?desde=&hasta=&limite=`, `nodos/:id/ultima`, `alertas?reconocidas=0|1`, `alertas/:id/reconocer` y `umbrales`.

Serie para graficar: `GET /api/nodos/:id/serie?rango=24h|7d|30d` devuelve los puntos promediados por intervalo (96, 84 y 90 puntos, como en la pantalla), con los huecos rellenados.

**Simulador de nodos** (sin hardware): manda lecturas al gateway como lo haría el ESP32. Los nodos tienen que existir en la app antes.

```bash
AGRYN_GATEWAY_KEY=... node tools/simulador.js --dispositivos ESP32-A1,ESP32-A2 --horas 48          # historial
AGRYN_GATEWAY_KEY=... node tools/simulador.js --dispositivos ESP32-A1 --en-vivo 60                 # en vivo
```

Pruebas: `npm test`.

## Correo y servidor

El ingreso manda el código de confirmación por correo desde **Agryn.silobolsa@gmail.com** usando Gmail SMTP. Por eso hace falta un servidor (`server/index.js`) que corra junto a la app.

Variables de entorno (en un archivo `.env` que no se sube al repo, o en el panel del servicio donde se publique):

```bash
GMAIL_USER=Agryn.silobolsa@gmail.com
GMAIL_APP_PASSWORD=...        # contraseña de aplicación de esa cuenta (requiere verificación en dos pasos)
AGRYN_USUARIOS=[{"email":"...","password":"..."}]
```

```bash
npm run server     # API y pantalla en http://localhost:3001 (después de `npm run build`)
npm run dev        # en otra terminal: desarrollo con Vite; /api va al servidor del puerto 3001
```

Para probar sin enviar correos: `AGRYN_MAIL=json npm run server` no manda nada y muestra el código en la consola del servidor.

## Qué hace

- **Inicio de sesión** con correo y contraseña, y después un código de 6 dígitos de confirmación (vence en 5 min, 3 intentos). Hoy el código se muestra en pantalla como prototipo.
- **Resumen** de la silobolsa elegida: una tarjeta por variable con valor actual, estado, historial (24 h, 7 días o 30 días) y mínimo, promedio y máximo.
- **Detalle por variable**: gráfico grande con el rango habitual, recorrido del historial, estadísticas del período y comparación entre nodos y entre silobolsas.
- **Nodos**: se ve el promedio de la silobolsa o un nodo en particular. Se pueden agregar y quitar nodos.
- **Silobolsas**: se pueden agregar (nombre, cantidad de nodos y contenido) y eliminar.
- **Contenido** de cada silobolsa (soja, maíz, trigo, forraje, otro…), editable.
- **Alertas al instante** por nodo y por variable, con dos niveles (Atención y Crítica) y opción de reconocerlas.
- **Lecturas cada 15 minutos**: el valor actual se actualiza una vez cada 15 min; las alertas saltan apenas hay una lectura fuera de rango.
- **Eliminar silobolsa** con aviso de lo que se va a perder y contraseña.
- **Datos reales**: los valores, el historial y las alertas vienen del servidor. Las alertas quedan hasta que las reconozcas.

## Estructura

```
src/App.jsx        Toda la lógica y la pantalla (un solo componente de clase)
src/index.css      Estilos globales, animaciones y pantalla de carga
src/main.jsx       Punto de entrada
public/logos/      Logos de AGRYN (fondo transparente) y hoja invertida para fondo verde
brand-originals/   Archivos originales de los logos
```

## Cómo llegan los datos a la pantalla

- `val()` en `src/App.jsx` lee la serie del nodo desde `state.datos`, que se carga de `/api/nodos/:id/serie` (24 h y el rango que se está viendo). Si el nodo no tiene lecturas, el valor es `null` y se muestra «—».
- `avg()` promedia los nodos de una silobolsa que tienen lectura.
- Las silobolsas, los nodos, el contenido y las alertas se leen y se guardan en la API. Se recargan al entrar y cada minuto.
- Al dar de alta un nodo hay que indicar su identificador LoRa (el mismo que manda el gateway).
- Los umbrales están en `server/umbrales.js` y en la constante `VARS` de la pantalla. **Son valores de ejemplo**: hay que definirlos con el equipo técnico según el grano almacenado.
- `DEMO_PASSWORD` (`12345`) sigue en el navegador para confirmar la eliminación de una silobolsa. **No protege nada de verdad**: la API no la pide.

## Identidad de marca

- Colores: verde esmeralda `#005A36` y marfil `#FAF6E9` (no se usa blanco puro).
- Tipografías: **Inter** para títulos y **Montserrat** para textos (Google Fonts).
- Tono: moderno y limpio, en español rioplatense (voseo), pensado para dueños de campos argentinos.
- Pantalla de carga: solo la hoja de AGRYN sobre fondo esmeralda, un par de segundos.
