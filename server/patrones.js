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
  },
  sin_datos: {
    nombre: 'Sin datos de la central',
    descripcion: 'El nodo no envió lecturas en los últimos minutos. Revisá la conexión de la central.'
  }
};

// Nombre que se muestra para una variable o un patrón.
export function etiquetaVariable(clave) {
  if (PATRONES[clave]) return PATRONES[clave].nombre;
  const v = VARIABLES.find((x) => x.key === clave);
  return v ? v.nombre : clave;
}

// ---------- alertas que no se pueden descartar ----------
// La rotura (ingreso de aire) y la fermentación quedan a la vista hasta que el problema se soluciona:
// nadie las puede reconocer a mano. Se cierran solas cuando las variables del patrón vuelven a su
// rango habitual y se mantienen así durante CIERRE_MS.
export const VARIABLES_DEL_PATRON = { rotura: ['co2', 'hum'], fermentacion: ['temp', 'co2'] };
export const CIERRE_MS = 5 * 60 * 1000;

export function seCierraSola(variable) {
  return Object.prototype.hasOwnProperty.call(VARIABLES_DEL_PATRON, variable);
}

// ¿Se solucionó el problema de la alerta? lecturas: las del nodo posteriores a la alarma (cualquier orden).
// Hace falta una racha de lecturas dentro del rango que dure al menos `minimo` ms, sin ninguna fuera del rango después.
export function patronResuelto(variable, lecturas, reglas, minimo = CIERRE_MS) {
  const claves = VARIABLES_DEL_PATRON[variable];
  if (!claves) return false;
  const enRango = (l) => claves.every((k) => {
    const r = reglas.find((x) => x.key === k);
    return !r || l[k] == null || (l[k] >= r.min && l[k] <= r.max);
  });
  const conDatos = lecturas.filter((l) => claves.some((k) => l[k] != null)).sort((a, b) => a.ts - b.ts);
  let inicio = null;
  for (const l of conDatos) {
    if (!enRango(l)) inicio = null;
    else if (inicio == null) inicio = l.ts;
  }
  return inicio != null && conDatos[conDatos.length - 1].ts - inicio >= minimo;
}
