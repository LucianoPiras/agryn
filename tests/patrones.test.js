import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';
import { crearNotificador } from '../server/notificaciones.js';

const CLAVE_GATEWAY = 'clave-patrones';
const CLAVE_CENTRAL = 'clave-central';
const USUARIO = { email: 'central@agryn.test', password: 'clave-central-usuario' };
const HORA = 60 * 60 * 1000;

let server, base, repo, token;
const enviados = [];
const correos = [];

before(async () => {
  repo = crearRepo(abrirBase(':memory:'));
  repo.crearUsuario(USUARIO.email, USUARIO.password);
  const canal = { nombre: 'prueba', enviar: async (aviso, para) => { enviados.push({ para, titulo: aviso.titulo, detalle: aviso.detalle, nivel: aviso.nivel }); } };
  const notificador = crearNotificador({ repo, canales: [canal] });
  const transporte = { sendMail: async (m) => { correos.push(m); } };
  const app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', gatewayKey: CLAVE_GATEWAY, centralKey: CLAVE_CENTRAL, notificador });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
  await llamar('POST', '/api/login', { cuerpo: USUARIO });
  const codigo = correos.at(-1).text.match(/es (\d{6})\./)[1];
  token = (await llamar('POST', '/api/verify', { cuerpo: { email: USUARIO.email, code: codigo } })).data.token;
  const silo = await llamar('POST', '/api/silobolsas', { cuerpo: { nombre: 'Silo Central', contenido: 'Maíz' }, token });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { cuerpo: { nombre: 'Nodo C', device_id: 'CEN-1' }, token });
});

after(() => new Promise((ok) => server.close(ok)));

async function llamar(metodo, ruta, { cuerpo, token: t, clave } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (t) cab.Authorization = 'Bearer ' + t;
  if (clave) cab['X-Api-Key'] = clave;
  const r = await fetch(base + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

test('la central exige su clave: la de los gateways no sirve', async () => {
  const r = await llamar('POST', '/api/central/anomalias', { cuerpo: [{ device_id: 'CEN-1', tipo: 'fermentacion' }], clave: CLAVE_GATEWAY });
  assert.equal(r.status, 401);
});

test('una anomalía de la central crea una alerta crítica y avisa al instante', async () => {
  const r = await llamar('POST', '/api/central/anomalias', { cuerpo: [{ device_id: 'CEN-1', tipo: 'fermentacion', valor: 3.2 }], clave: CLAVE_CENTRAL });
  assert.equal(r.status, 200);
  assert.equal(r.data.nuevas, 1);

  const alertas = (await llamar('GET', '/api/alertas', { token })).data;
  const fermentacion = alertas.find((a) => a.variable === 'fermentacion');
  assert.equal(fermentacion.nivel, 'crit');
  assert.equal(fermentacion.etiqueta, 'Posible fermentación');
  assert.match(fermentacion.descripcion, /Revisá la silobolsa/);
  assert.ok(enviados.some((e) => e.para === USUARIO.email && e.nivel === 'crit' && /fermentación/i.test(e.titulo + e.detalle)));
});

test('una anomalía repetida no genera otra alerta mientras siga sin reconocerse', async () => {
  const antes = enviados.length;
  const r = await llamar('POST', '/api/central/anomalias', { cuerpo: [{ device_id: 'CEN-1', tipo: 'fermentacion' }], clave: CLAVE_CENTRAL });
  assert.equal(r.data.nuevas, 0);
  assert.equal(enviados.length, antes);
});

test('la central rechaza nodos y tipos desconocidos', async () => {
  const r = await llamar('POST', '/api/central/anomalias', { cuerpo: [
    { device_id: 'NO-EXISTE', tipo: 'rotura' },
    { device_id: 'CEN-1', tipo: 'magia' }
  ], clave: CLAVE_CENTRAL });
  assert.equal(r.status, 422);
  assert.deepEqual(r.data.rechazadas.map((x) => x.motivo), ['nodo desconocido', 'tipo desconocido']);
});

test('una anomalía de atención espera la demora, como cualquier alerta de atención', async () => {
  const antes = enviados.length;
  await llamar('POST', '/api/central/anomalias', { cuerpo: [{ device_id: 'CEN-1', tipo: 'rotura', nivel: 'warn' }], clave: CLAVE_CENTRAL });
  assert.equal(enviados.length, antes, 'no avisa todavía');
});

test('la app no detecta patrones por su cuenta: lecturas que suben juntas no generan alerta', async () => {
  const t0 = Date.now() - 3 * HORA;
  await llamar('POST', '/api/gateway/lecturas', { cuerpo: [
    { device_id: 'CEN-1', temp: 20, co2: 1.0, hum: 13, ts: t0 },
    { device_id: 'CEN-1', temp: 24, co2: 1.6, hum: 13, ts: t0 + HORA }
  ], clave: CLAVE_GATEWAY });
  const alertas = (await llamar('GET', '/api/alertas', { token })).data;
  assert.equal(alertas.filter((a) => a.variable === 'fermentacion').length, 1, 'solo la de la central');
});

test('rotura y fermentación no se pueden descartar a mano', async () => {
  const alertas = (await llamar('GET', '/api/alertas', { token })).data;
  const fermentacion = alertas.find((a) => a.variable === 'fermentacion');
  const r = await llamar('POST', `/api/alertas/${fermentacion.id}/reconocer`, { token });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /se cierra sola/);
  assert.ok((await llamar('GET', '/api/alertas', { token })).data.some((a) => a.id === fermentacion.id), 'sigue activa');
});

test('la alerta de rotura se cierra sola cuando los valores vuelven al rango y se mantienen', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { cuerpo: { nombre: 'Silo Cierre', contenido: 'Soja' }, token });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { cuerpo: { nombre: 'Nodo R', device_id: 'CIE-1' }, token });
  const t0 = Date.now() - HORA;
  await llamar('POST', '/api/central/anomalias', { cuerpo: [{ device_id: 'CIE-1', tipo: 'rotura', ts: t0 }], clave: CLAVE_CENTRAL });
  const activa = () => llamar('GET', '/api/alertas', { token }).then((r) => r.data.find((a) => a.variable === 'rotura' && a.nodo === 'Nodo R'));
  assert.ok(await activa());
  const lectura = (min, co2, hum) => ({ device_id: 'CIE-1', ts: t0 + min * 60 * 1000, ph: 7, temp: 17, hum, co2 });
  // Todavía fuera de rango y después solo 2 minutos dentro: no alcanza para darla por solucionada.
  await llamar('POST', '/api/central/lecturas', { cuerpo: [lectura(1, 3.0, 15), lectura(2, 6.5, 12), lectura(4, 6.5, 12)], clave: CLAVE_CENTRAL });
  assert.ok(await activa(), 'sigue activa con 2 min dentro del rango');
  // Cinco minutos seguidos dentro del rango: se cierra sola.
  await llamar('POST', '/api/central/lecturas', { cuerpo: [lectura(7, 6.5, 12)], clave: CLAVE_CENTRAL });
  assert.equal(await activa(), undefined, 'se cerró sola');
});
