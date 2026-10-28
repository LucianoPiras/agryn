// Variables que mide cada nodo y su rango habitual. Son valores de ejemplo:
// hay que definirlos con el equipo técnico según el grano almacenado.
// Rangos orientativos para granos almacenados en silo bolsa (fuentes: INTA y estudios de almacenamiento
// hermético). Humedad: el grano seco se guarda con humedad menor al 13 % (soja), 15 % (maíz) y 12 % (trigo).
// CO₂ dentro de la bolsa: en grano seco ronda el 3 al 10 %; por encima indica actividad biológica.
// La temperatura del grano sigue a la del ambiente. El pH no tiene una referencia confiable: queda provisorio.
// Hay que validar estos rangos con el equipo técnico y por tipo de grano.
export const VARIABLES = [
  { key: 'ph', nombre: 'pH', unidad: '', min: 5.8, max: 7.2 },
  { key: 'temp', nombre: 'Temperatura', unidad: '°C', min: 10, max: 25 },
  { key: 'hum', nombre: 'Humedad', unidad: '%', min: 10, max: 14 },
  { key: 'co2', nombre: 'CO₂', unidad: '%', min: 3, max: 10 }
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
