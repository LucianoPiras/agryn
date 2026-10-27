// Variables que mide cada nodo y su rango habitual. Son valores de ejemplo:
// hay que definirlos con el equipo técnico según el grano almacenado.
export const VARIABLES = [
  { key: 'ph', nombre: 'pH', unidad: '', min: 5.8, max: 7.2 },
  { key: 'temp', nombre: 'Temperatura', unidad: '°C', min: 10, max: 25 },
  { key: 'hum', nombre: 'Humedad', unidad: '%', min: 12, max: 14.5 },
  { key: 'co2', nombre: 'CO₂', unidad: '%', min: 0.5, max: 3 }
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
