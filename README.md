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
- **Modo demostración** (al pie): fuerza un desvío en una variable para ver cómo salta la alerta.

## Estructura

```
src/App.jsx        Toda la lógica y la pantalla (un solo componente de clase)
src/index.css      Estilos globales, animaciones y pantalla de carga
src/main.jsx       Punto de entrada
public/logos/      Logos de AGRYN (fondo transparente) y hoja invertida para fondo verde
brand-originals/   Archivos originales de los logos
```

## Dónde tocar para pasar a datos reales

1. **Lecturas**: hoy salen de `val()` en `src/App.jsx`, que genera series simuladas. Hay que reemplazarla por lecturas reales de cada nodo (una cada 15 min). `avg()` calcula el promedio de los nodos de una silobolsa.
2. **Modelo de datos**: `state.bags` es una lista de silobolsas con `id`, `name`, `content`, `custom` (si el contenido es "Otro") y `nodes` (`id`, `name`). Hoy se guarda en `localStorage` bajo la clave `agryn-planta-v1`; con datos reales debería vivir en un backend.
3. **Umbrales**: están en la constante `VARS` (mínimo y máximo habitual de cada variable). **Son valores de ejemplo**: hay que definirlos con el equipo técnico según el grano almacenado. Las unidades también deben coincidir con las de los sensores reales.
4. **Alertas**: se calculan en `renderVals()` recorriendo todos los nodos. Con datos reales conviene calcularlas en el servidor y enviar notificaciones (push, mail o WhatsApp).
5. **Inicio de sesión**: la lista `USUARIOS` y el código de confirmación (`nuevoCodigo()`) viven en el navegador. En la versión real: validar en el servidor y enviar el código por correo con un servicio de mail.
6. **Contraseña de eliminación**: la constante `DEMO_PASSWORD` (`12345`) está en el código del navegador, así que **no protege nada de verdad**. En la versión real hay que validar usuario y contraseña en un servidor.

## Identidad de marca

- Colores: verde esmeralda `#005A36` y marfil `#FAF6E9` (no se usa blanco puro).
- Tipografías: **Inter** para títulos y **Montserrat** para textos (Google Fonts).
- Tono: moderno y limpio, en español rioplatense (voseo), pensado para dueños de campos argentinos.
- Pantalla de carga: solo la hoja de AGRYN sobre fondo esmeralda, un par de segundos.
