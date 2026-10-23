# AGRYN Monitoreo: contexto para Claude Code

## Qué es
App web de monitoreo interno de silobolsas inteligentes de AGRYN. Cada silobolsa tiene varios nodos; cada nodo mide pH, temperatura, humedad y CO₂. Hay historial en gráficos, detalle por variable y alertas instantáneas cuando un valor sale de su rango habitual.

## La empresa
- AGRYN la forma un grupo de 7 alumnos.
- Objetivo: ganar una competencia institucional llevando la empresa a la mayor profesionalidad posible.
- Diferencial: valor tecnológico muy alto para el mercado al que apuntan.
- Público: personas dueñas de campos, por ahora argentinas.

## Reglas de estética (no romper)
- Colores de marca: verde esmeralda `#005A36` y **marfil `#FAF6E9` en lugar de blanco**. No usar blanco puro (`#fff`).
- Fuentes: **Inter** para títulos y **Montserrat** para textos.
- Representar pureza y modernidad: limpio, con aire, sin adornos de más.
- Siempre un "gancho" de 1 o 2 segundos antes de explicar el proyecto (hoy: pantalla de carga con la hoja de AGRYN y, ya adentro, el título "Tu cosecha, bajo control").
- Logos en `public/logos/`. Sobre fondo esmeralda se usa la hoja invertida (`agryn-hoja-reversa.png`), porque la hoja oscura original se pierde sobre el verde.
- Accesibilidad: botones reales (`<button>`), etiquetas en los campos, contraste suficiente, objetivos táctiles de al menos 44 px. Los estados no dependen solo del color (llevan texto).

## Idioma y tono
Todo el texto de la interfaz va en español rioplatense (voseo: "Cambialo", "Probá", "Ingresá"). Comentarios y documentación también en español.

## Código
- Un solo componente de clase en `src/App.jsx`. `renderVals()` arma el modelo de la vista y `render()` lo dibuja en JSX.
- Los gráficos son SVG hechos a mano (sin librerías). Las series se calculan en `val()`.
- Por ahora los datos son **simulados**. El valor actual cambia cada 15 minutos; las alertas son instantáneas.
- No usar `<form>` con botón de envío para acciones de la app: en el editor de diseño de origen los formularios estaban bloqueados. Usar botones con `onClick` y manejar Enter con `onKeyDown`.
- `DEMO_PASSWORD` es solo para el prototipo. No es seguridad real.

## Pendientes pensados
- Conectar con los nodos reales y un backend (lecturas cada 15 min, silobolsas y nodos guardados en servidor).
- Definir umbrales reales por tipo de grano.
- Notificaciones de alerta fuera de la app (push, mail o WhatsApp).
- Pantalla para editar umbrales y vista de celular con alertas.
- Pantalla de presentación para el jurado (equipo y problema que resuelven).
