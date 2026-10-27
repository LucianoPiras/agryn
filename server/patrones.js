// Nombres y descripciones de los patrones de riesgo que informa el ESP32 central.
//
// La app NO analiza las mediciones: la central procesa los datos y, si encuentra una anomalía,
// la manda a POST /api/central/anomalias. Acá solo guardamos cómo se muestra cada patrón.
import { VARIABLES } from './umbrales.js';

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
