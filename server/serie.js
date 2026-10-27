// Convierte las lecturas crudas de un nodo en series de puntos para los gráficos.
// Cada rango tiene la misma cantidad de puntos que usa la pantalla.
import { VARIABLES } from './umbrales.js';

const MIN = 60 * 1000;
export const RANGOS = {
  '24h': { n: 96, paso: 15 * MIN },
  '7d': { n: 84, paso: 120 * MIN },
  '30d': { n: 90, paso: 480 * MIN }
};

// Rellena los huecos con el valor más cercano: hacia adelante y, para el principio, hacia atrás.
function rellenar(vals) {
  const out = vals.slice();
  let ultimo = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) out[i] = ultimo; else ultimo = out[i];
  }
  let siguiente = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = siguiente; else siguiente = out[i];
  }
  return out;
}

// Promedia las lecturas de cada intervalo. El último intervalo termina en `ahora`.
export function serie(lecturas, rango, ahora = Date.now()) {
  const { n, paso } = RANGOS[rango];
  const inicio = ahora - n * paso;
  const suma = Array.from({ length: n }, () => ({}));
  for (const l of lecturas) {
    const i = Math.floor((l.ts - inicio) / paso);
    if (i < 0 || i >= n || l.ts > ahora) continue;
    for (const v of VARIABLES) {
      if (l[v.key] == null) continue;
      const celda = suma[i][v.key] || (suma[i][v.key] = { s: 0, c: 0 });
      celda.s += l[v.key];
      celda.c += 1;
    }
  }
  const valores = {};
  for (const v of VARIABLES) {
    const crudos = suma.map((celda) => (celda[v.key] ? celda[v.key].s / celda[v.key].c : null));
    valores[v.key] = crudos.every((x) => x == null) ? crudos : rellenar(crudos);
  }
  return { rango, n, paso, desde: inicio, hasta: ahora, valores };
}
