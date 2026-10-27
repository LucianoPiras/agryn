// Diagnóstico orientativo de una alarma, a partir de los factores que subieron o bajaron.
//
// La central detecta la anomalía; la app solo explica qué factores cambiaron antes de la alarma
// y, si el cambio encaja con un patrón conocido, lo nombra. Es una pista para revisar, no una certeza.
import { VARIABLES } from './umbrales.js';
import { PATRONES } from './patrones.js';

export const VENTANA_DIAGNOSTICO = 2 * 60 * 60 * 1000;
const MINIMO_LECTURAS = 6;

// Cambio mínimo, en la unidad de cada variable, para considerarlo un cambio real y no ruido.
const CAMBIO_MINIMO = { ph: 0.2, temp: 1, hum: 1, co2: 0.2 };

const promedio = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Compara el primer y el último tercio de las lecturas (ordenadas por tiempo) de cada variable.
export function tendencias(lecturas) {
  const tercio = Math.floor(lecturas.length / 3);
  const cambios = {};
  for (const v of VARIABLES) {
    const inicio = lecturas.slice(0, tercio).map((l) => l[v.key]).filter((x) => x != null);
    const fin = lecturas.slice(-tercio).map((l) => l[v.key]).filter((x) => x != null);
    if (!inicio.length || !fin.length) continue;
    const delta = promedio(fin) - promedio(inicio);
    if (Math.abs(delta) < CAMBIO_MINIMO[v.key]) continue;
    cambios[v.key] = delta;
  }
  return cambios;
}

// Qué patrón encaja con los cambios. Las reglas son orientativas: hay que validarlas con el equipo técnico.
function causaDe(cambios) {
  if (cambios.temp > 0 && cambios.co2 > 0) return 'fermentacion';
  if (cambios.co2 < 0 && cambios.hum > 0) return 'rotura';
  return null;
}

const numero = (x) => Math.abs(x).toFixed(1).replace('.', ',');

function frase(key, delta) {
  const v = VARIABLES.find((x) => x.key === key);
  const unidad = v.unidad ? ' ' + v.unidad : '';
  const sentido = delta > 0 ? 'subió' : 'bajó';
  return `${v.nombre} ${sentido} ${numero(delta)}${unidad}`;
}

// Arma el texto del diagnóstico. Devuelve null si no hay lecturas suficientes para decir algo.
// `lecturas` son las de la ventana previa a la alarma, ordenadas por ts.
export function diagnosticar(lecturas) {
  if (lecturas.length < MINIMO_LECTURAS) return null;
  const cambios = tendencias(lecturas);
  const factores = Object.keys(cambios).map((k) => frase(k, cambios[k]));
  if (!factores.length) return 'Sin cambios claros en las últimas 2 h. Revisá el nodo.';
  const causa = causaDe(cambios);
  const detalle = 'Factores en las últimas 2 h: ' + factores.join(', ') + '.';
  if (causa) return PATRONES[causa].descripcion + ' ' + detalle;
  return 'No alcanza para un patrón claro. ' + detalle + ' Revisá la silobolsa.';
}
