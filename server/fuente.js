// Fuente de datos externa: la aplicación de Apps Script que recibe las cápsulas del Heltec tracker.
// El servidor consulta cada 30 segundos su API (?api=datos) y guarda las lecturas en el nodo
// que corresponde a cada cápsula. Cada cápsula se asocia a un nodo cuyo identificador es "cap-<id>".
//
// Campos que usamos: temp, hum y gas (que es el CO₂ dentro de la bolsa, en %).
// El pH que manda la central es simulado y no es real, así que NO se copia: la app lo simula
// alrededor del objetivo, siempre dentro del rango habitual (phSimulado).
// La lectura más nueva y el historial se guardan sin repetir (la base ignora las marcas de tiempo ya cargadas).
import { VARIABLES } from './umbrales.js';
import { cerrarResueltas } from './cierre.js';

export const PREFIJO_CAPSULA = 'cap-';
const CADA = 30 * 1000;
const MINUTO = 60 * 1000;
const PH = VARIABLES.find((v) => v.key === 'ph');

// pH simulado: oscila suave alrededor del objetivo (7,0), entre 6,67 y 7,33. Depende solo de la hora
// de la lectura, así que la misma lectura da siempre el mismo valor. Hasta que haya un sensor de pH real.
export function phSimulado(ts, objetivo = PH.objetivo) {
  const x = objetivo + 0.25 * Math.sin((ts / (180 * MINUTO)) * Math.PI * 2) + 0.08 * Math.sin(ts / (11 * MINUTO));
  return Number(x.toFixed(2));
}

const numero = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function lecturaDeCapsula(cap, ts = cap.fecha) {
  return { ph: phSimulado(ts), temp: numero(cap.temp), hum: numero(cap.hum), co2: numero(cap.gas) };
}

// Lee la API una vez y guarda lo nuevo. Devuelve cuántas lecturas se agregaron.
export async function sincronizarFuente({ url, repo, bus, fetchFn = fetch }) {
  const r = await fetchFn(url + (url.includes('?') ? '&' : '?') + 'api=datos');
  if (!r.ok) throw new Error(`La fuente respondió ${r.status}`);
  const datos = await r.json();
  let nuevas = 0;
  const nodosConDatos = [];
  for (const cap of datos.capsulas || []) {
    const nodo = repo.nodoPorDevice(PREFIJO_CAPSULA + cap.id);
    if (!nodo) continue;
    const lecturas = [...(cap.hist || []).map((h) => ({ ts: h.t, ...lecturaDeCapsula({ temp: h.temp, hum: h.hum, gas: h.gas }, h.t) })), { ts: cap.fecha, ...lecturaDeCapsula(cap) }];
    for (const l of lecturas) {
      if (typeof l.ts !== 'number') continue;
      if (repo.guardarLectura(nodo.id, Math.round(l.ts), { ph: l.ph, temp: l.temp, hum: l.hum, co2: l.co2 })) { nuevas++; nodosConDatos.push(nodo.id); }
    }
  }
  const cerradas = cerrarResueltas(repo, nodosConDatos);
  if (nuevas && bus) bus.emitirATodos('datos', { aceptadas: nuevas });
  if (cerradas && bus) bus.emitirATodos('alerta', { cerradas });
  return nuevas;
}

// Arranca la consulta periódica. Si la fuente no responde, se registra y se intenta de nuevo en el próximo ciclo.
export function iniciarFuente(opciones) {
  const ciclo = () => sincronizarFuente(opciones).catch((e) => console.error('Fuente de datos:', e.message));
  ciclo();
  return setInterval(ciclo, CADA);
}
