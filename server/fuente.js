// Fuente de datos externa: la aplicación de Apps Script que recibe las cápsulas del Heltec tracker.
// El servidor consulta cada 30 segundos su API (?api=datos) y guarda las lecturas en el nodo
// que corresponde a cada cápsula. Cada cápsula se asocia a un nodo cuyo identificador es "cap-<id>".
//
// Campos que usamos: temp, hum, ph y gas (que es el CO₂ dentro de la bolsa, en %).
// La lectura más nueva y el historial se guardan sin repetir (la base ignora las marcas de tiempo ya cargadas).
export const PREFIJO_CAPSULA = 'cap-';
const CADA = 30 * 1000;

export function lecturaDeCapsula(cap) {
  return { ph: cap.ph, temp: cap.temp, hum: cap.hum, co2: cap.gas };
}

// Lee la API una vez y guarda lo nuevo. Devuelve cuántas lecturas se agregaron.
export async function sincronizarFuente({ url, repo, bus, fetchFn = fetch }) {
  const r = await fetchFn(url + (url.includes('?') ? '&' : '?') + 'api=datos');
  if (!r.ok) throw new Error(`La fuente respondió ${r.status}`);
  const datos = await r.json();
  let nuevas = 0;
  for (const cap of datos.capsulas || []) {
    const nodo = repo.nodoPorDevice(PREFIJO_CAPSULA + cap.id);
    if (!nodo) continue;
    const lecturas = [...(cap.hist || []).map((h) => ({ ts: h.t, ph: h.ph, temp: h.temp, hum: h.hum, co2: h.gas })), { ts: cap.fecha, ...lecturaDeCapsula(cap) }];
    for (const l of lecturas) {
      if (typeof l.ts !== 'number') continue;
      if (repo.guardarLectura(nodo.id, Math.round(l.ts), { ph: l.ph, temp: l.temp, hum: l.hum, co2: l.co2 })) nuevas++;
    }
  }
  if (nuevas && bus) bus.emitirATodos('datos', { aceptadas: nuevas });
  return nuevas;
}

// Arranca la consulta periódica. Si la fuente no responde, se registra y se intenta de nuevo en el próximo ciclo.
export function iniciarFuente(opciones) {
  const ciclo = () => sincronizarFuente(opciones).catch((e) => console.error('Fuente de datos:', e.message));
  ciclo();
  return setInterval(ciclo, CADA);
}
