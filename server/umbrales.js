// Variables que mide cada nodo y su rango habitual. Son valores de ejemplo:
// hay que definirlos con el equipo técnico según el grano almacenado.
export const VARIABLES = [
  { key: 'ph', nombre: 'pH', unidad: '', min: 5.8, max: 7.2 },
  { key: 'temp', nombre: 'Temperatura', unidad: '°C', min: 10, max: 25 },
  { key: 'hum', nombre: 'Humedad', unidad: '%', min: 12, max: 14.5 },
  { key: 'co2', nombre: 'CO₂', unidad: '%', min: 0.5, max: 3 }
];

// Devuelve las alertas de una lectura. Atención si se sale del rango;
// crítica si se pasa más de un 25 % del ancho del rango.
export function evaluar(valores) {
  const alertas = [];
  for (const v of VARIABLES) {
    const x = valores[v.key];
    if (x == null || (x >= v.min && x <= v.max)) continue;
    const span = v.max - v.min;
    const desvio = x > v.max ? x - v.max : v.min - x;
    alertas.push({ variable: v.key, valor: x, nivel: desvio > span * 0.25 ? 'crit' : 'warn' });
  }
  return alertas;
}
