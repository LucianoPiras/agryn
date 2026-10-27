// Simula nodos LoRa de AGRYN y manda sus lecturas al gateway, como lo haría el ESP32 gateway.
// Sirve para probar el backend y la pantalla sin hardware.
//
// Uso:
//   AGRYN_GATEWAY_KEY=... node tools/simulador.js --dispositivos ESP32-A1,ESP32-A2 --horas 48
//   (después, para seguir mandando en vivo cada 60 s:)
//   AGRYN_GATEWAY_KEY=... node tools/simulador.js --dispositivos ESP32-A1 --en-vivo 60
//
// Opciones:
//   --url        servidor (http://localhost:3001 por defecto)
//   --dispositivos  identificadores de nodo, separados por coma (deben existir en la app)
//   --horas      cuántas horas de historial cargar antes de empezar (0 = nada)
//   --paso       minutos entre lecturas del historial (15 por defecto, como el nodo real)
//   --en-vivo    segundos entre envíos en vivo; sin esta opción el script termina tras el historial
//   --anomalia   fuerza un pH alto en el último tramo, para ver una alerta
import { parseArgs } from 'node:util';
import { VARIABLES } from '../server/umbrales.js';

const { values: op } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3001' },
    dispositivos: { type: 'string', default: '' },
    horas: { type: 'string', default: '0' },
    paso: { type: 'string', default: '30' },
    'en-vivo': { type: 'string' },
    anomalia: { type: 'boolean', default: false }
  }
});

const CLAVE = process.env.AGRYN_GATEWAY_KEY;
if (!CLAVE) { console.error('Falta AGRYN_GATEWAY_KEY en el entorno.'); process.exit(1); }
const dispositivos = op.dispositivos.split(',').map((x) => x.trim()).filter(Boolean);
if (!dispositivos.length) { console.error('Indicá al menos un dispositivo con --dispositivos.'); process.exit(1); }

// Semilla fija por dispositivo: cada nodo tiene su propio "clima" dentro del rango habitual.
function semilla(texto) {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}

// Valor de una variable en un instante: onda lenta alrededor del centro del rango, más un poco de ruido.
function valorEn(dispositivo, v, ts) {
  const medio = (v.min + v.max) / 2, mitad = (v.max - v.min) / 2;
  const fase = semilla(dispositivo + v.key) * Math.PI * 2;
  const onda = Math.sin(ts / (6 * 3600 * 1000) * Math.PI * 2 + fase) * 0.5;
  const ruido = (Math.random() - 0.5) * 0.2;
  const x = medio + mitad * (onda + ruido);
  return Number(x.toFixed(v.key === 'ph' || v.key === 'co2' ? 2 : 1));
}

function lectura(dispositivo, ts, anomalia = false) {
  const item = { device_id: dispositivo, ts };
  for (const v of VARIABLES) item[v.key] = valorEn(dispositivo, v, ts);
  if (anomalia) item.ph = 8.1;
  return item;
}

async function enviar(lote) {
  const r = await fetch(op.url + '/api/gateway/lecturas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': CLAVE },
    body: JSON.stringify(lote)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`El gateway respondió ${r.status}: ${d.error || 'sin detalle'}`);
  return d;
}

async function enviarPorLotes(lecturas) {
  const total = { aceptadas: 0, duplicadas: 0, rechazadas: 0, alertas_nuevas: 0 };
  for (let i = 0; i < lecturas.length; i += 500) {
    const d = await enviar(lecturas.slice(i, i + 500));
    total.aceptadas += d.aceptadas;
    total.duplicadas += d.duplicadas;
    total.rechazadas += d.rechazadas.length;
    total.alertas_nuevas += d.alertas_nuevas;
  }
  return total;
}

async function main() {
  const horas = Number(op.horas);
  const paso = Number(op.paso) * 60 * 1000;
  if (horas > 0) {
    const ahora = Date.now();
    const desde = ahora - horas * 3600 * 1000;
    const lecturas = [];
    for (let ts = desde; ts <= ahora; ts += paso) {
      for (const d of dispositivos) lecturas.push(lectura(d, ts, op.anomalia && ts > ahora - 2 * 3600 * 1000));
    }
    console.log(`Historial: ${lecturas.length} lecturas para ${dispositivos.length} nodo(s) durante ${horas} h`);
    console.log(JSON.stringify(await enviarPorLotes(lecturas)));
  }

  if (op['en-vivo']) {
    const cada = Number(op['en-vivo']) * 1000;
    console.log(`En vivo: un envío cada ${op['en-vivo']} s. Cortá con Ctrl+C.`);
    const ciclo = async () => {
      const ts = Date.now();
      const lecturas = dispositivos.map((d) => lectura(d, ts, op.anomalia));
      try {
        console.log(new Date(ts).toISOString(), JSON.stringify(await enviarPorLotes(lecturas)));
      } catch (e) {
        console.error(new Date(ts).toISOString(), e.message);
      }
    };
    await ciclo();
    setInterval(ciclo, cada);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
