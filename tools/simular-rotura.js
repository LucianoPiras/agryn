// Simulación de una rotura para mostrar la app: carga 2 horas de lecturas con el patrón de una
// rotura (el CO₂ baja y la humedad sube) y después manda la alarma que encuentra la central.
// La app tiene que avisar y mostrar el diagnóstico.
//
// Uso (con el servidor corriendo y las claves en el entorno):
//   AGRYN_GATEWAY_KEY=... AGRYN_CENTRAL_KEY=... AGRYN_DB=data/agryn.db node tools/simular-rotura.js
//
// Opciones:
//   --url   servidor (http://localhost:3001 por defecto)
//
// Si ya hay una alarma de rotura sin reconocer en el nodo, la central no la repite:
// reconocela en la app y volvé a correr el script.
import { parseArgs } from 'node:util';
import { abrirBase, crearRepo } from '../server/db.js';

const { values: op } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:3001' } } });

const GATEWAY = process.env.AGRYN_GATEWAY_KEY;
const CENTRAL = process.env.AGRYN_CENTRAL_KEY;
const RUTA_DB = process.env.AGRYN_DB || 'data/agryn.db';
if (!GATEWAY || !CENTRAL) { console.error('Faltan AGRYN_GATEWAY_KEY o AGRYN_CENTRAL_KEY en el entorno.'); process.exit(1); }

const SILO = 'Silobolsa Demo';
const DEVICE = 'DEMO-ROTURA-1';
const MINUTO = 60 * 1000;

// Crea la silobolsa y el nodo de demo si no existen, directamente en la base del servidor.
function asegurarNodo() {
  const repo = crearRepo(abrirBase(RUTA_DB));
  const existente = repo.nodoPorDevice(DEVICE);
  if (existente) return existente;
  const silo = repo.silobolsas().find((s) => s.nombre === SILO) || repo.crearSilobolsa(SILO, 'Soja');
  return repo.crearNodo(silo.id, 'Nodo Demo', DEVICE);
}

// Interpolación lineal entre dos valores a lo largo de la serie, con un poco de ruido.
function serie(desde, hasta, i, n) {
  const ruido = (Math.random() - 0.5) * 0.02;
  return Number((desde + ((hasta - desde) * i) / (n - 1) + ruido).toFixed(2));
}

async function enviar(ruta, clave, cuerpo) {
  const r = await fetch(op.url + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': clave },
    body: JSON.stringify(cuerpo)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}: ${d.error || 'sin detalle'}`);
  return d;
}

async function main() {
  asegurarNodo();
  const ahora = Date.now();
  const n = 25; // una lectura cada 5 minutos durante 2 horas
  const lecturas = Array.from({ length: n }, (_, i) => ({
    device_id: DEVICE,
    ts: ahora - (n - 1 - i) * 5 * MINUTO,
    ph: serie(6.5, 6.5, i, n),
    temp: serie(18, 18.2, i, n),
    hum: serie(12.6, 14.2, i, n),   // la humedad sube, dentro del rango para no disparar alertas por umbral
    co2: serie(2.0, 1.3, i, n)      // el CO₂ baja, también dentro del rango
  }));
  const carga = await enviar('/api/gateway/lecturas', GATEWAY, lecturas);
  console.log(`Lecturas cargadas: ${carga.aceptadas} (duplicadas: ${carga.duplicadas})`);

  const alarma = await enviar('/api/central/anomalias', CENTRAL, [
    { device_id: DEVICE, tipo: 'rotura', nivel: 'crit', valor: 1.3, ts: ahora }
  ]);
  console.log(`Alarma enviada. Nuevas: ${alarma.nuevas}`);
  console.log('Ahora abrí la app en el navegador con la cuenta de prueba y mirá el aviso y el diagnóstico.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
