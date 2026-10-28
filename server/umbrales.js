// Variables que mide cada nodo y su rango habitual. Son valores de ejemplo:
// hay que definirlos con el equipo técnico según el grano almacenado.
// Cada variable tiene un valor objetivo y se considera normal si está a menos de 1 unidad de él.
// Los objetivos son valores por defecto para que el equipo técnico los ajuste por tipo de grano.
// Fuera de ese rango la app ofrece liberar CO₂ y los valores vuelven al objetivo.
const BANDA = 1;
const objetivo = (key, nombre, unidad, valor, dec) => ({ key, nombre, unidad, objetivo: valor, min: Number((valor - BANDA).toFixed(dec)), max: Number((valor + BANDA).toFixed(dec)) });
export const VARIABLES = [
  objetivo('ph', 'pH', '', 6.5, 2),
  objetivo('temp', 'Temperatura', '°C', 17, 1),
  objetivo('hum', 'Humedad', '%', 12, 1),
  objetivo('co2', 'CO₂', '%', 6.5, 2)
];

// Devuelve las alertas de una lectura según los umbrales vigentes (reglas: { key, min, max }).
// Atención si se sale del rango; crítica si se pasa más de un 25 % del ancho del rango.
export function evaluar(valores, reglas) {
  const alertas = [];
  for (const r of reglas) {
    const x = valores[r.key];
    if (x == null || (x >= r.min && x <= r.max)) continue;
    const span = r.max - r.min;
    const desvio = x > r.max ? x - r.max : r.min - x;
    alertas.push({ variable: r.key, valor: x, nivel: desvio > span * 0.25 ? 'crit' : 'warn' });
  }
  return alertas;
}
