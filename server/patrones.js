// Patrones de riesgo dentro de la silobolsa: combinan varios sensores a lo largo de un tramo de tiempo.
//
// ATENCIÓN: son reglas de ejemplo para validar con el equipo técnico. No son un diagnóstico:
// indican que conviene revisar la silobolsa, no que haya una rotura o una fermentación confirmada.
import { VARIABLES } from './umbrales.js';

export const VENTANA = 2 * 60 * 60 * 1000;

// Cuánto tiene que cambiar cada variable dentro de la ventana para disparar el patrón.
export const UMBRALES_PATRON = {
  fermentacion: { temp: 3, co2: 0.5 },   // la temperatura y el CO₂ suben juntos
  rotura: { co2: 0.5, hum: 1 }           // el CO₂ baja de golpe y la humedad sube (entra aire)
};

export const PATRONES = {
  fermentacion: {
    nombre: 'Posible fermentación',
    descripcion: 'La temperatura y el CO₂ subieron juntos en poco tiempo. Revisá la silobolsa.'
  },
  rotura: {
    nombre: 'Posible rotura o ingreso de aire',
    descripcion: 'El CO₂ bajó de golpe y la humedad subió. Revisá si hay una rotura o una pérdida.'
  }
};

// Nombre que se muestra para una variable o un patrón.
export function etiquetaVariable(clave) {
  if (PATRONES[clave]) return PATRONES[clave].nombre;
  const v = VARIABLES.find((x) => x.key === clave);
  return v ? v.nombre : clave;
}

// `lecturas`: las lecturas de la ventana, ordenadas por tiempo. Compara la primera con la última.
export function detectarPatrones(lecturas) {
  const validas = lecturas.filter((l) => l);
  if (validas.length < 2) return [];
  const primera = validas[0], ultima = validas.at(-1);
  const cambio = (k) => (primera[k] != null && ultima[k] != null ? ultima[k] - primera[k] : null);
  const dT = cambio('temp'), dC = cambio('co2'), dH = cambio('hum');
  const hallados = [];
  if (dT != null && dC != null && dT >= UMBRALES_PATRON.fermentacion.temp && dC >= UMBRALES_PATRON.fermentacion.co2) {
    hallados.push({ variable: 'fermentacion', valor: Math.round(dT * 10) / 10 });
  }
  if (dC != null && dH != null && -dC >= UMBRALES_PATRON.rotura.co2 && dH >= UMBRALES_PATRON.rotura.hum) {
    hallados.push({ variable: 'rotura', valor: Math.round(dC * 100) / 100 });
  }
  return hallados;
}
