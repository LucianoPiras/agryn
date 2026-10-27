import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';

const CLAVE_GATEWAY = 'clave-de-prueba';
const USUARIO = { email: 'operadora@agryn.test', password: 'clave-segura' };

let server, base, token;
const correos = [];

before(async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  // Transporte falso: guarda los correos en memoria en vez de enviarlos.
  const transporte = { sendMail: async (m) => { correos.push(m); } };
  const app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', usuarios: [USUARIO], gatewayKey: CLAVE_GATEWAY });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;

  // Ingreso completo: contraseña, código del correo y token de sesión.
  await llamar('POST', '/api/login', { email: USUARIO.email, password: USUARIO.password });
  const codigo = correos.at(-1).text.match(/es (\d{6})\./)[1];
  const r = await llamar('POST', '/api/verify', { email: USUARIO.email, code: codigo });
  token = r.data.token;
});

after(() => new Promise((ok) => server.close(ok)));

async function llamar(metodo, ruta, cuerpo, { cabeceras = {} } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token && !cabeceras.sinSesion ? { Authorization: 'Bearer ' + token } : {}), ...cabeceras.extra },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const texto = await r.text();
  return { status: r.status, data: texto ? JSON.parse(texto) : null };
}

const gateway = (cuerpo) => llamar('POST', '/api/gateway/lecturas', cuerpo, { cabeceras: { sinSesion: true, extra: { 'X-Api-Key': CLAVE_GATEWAY } } });

test('la API pide sesión', async () => {
  const r = await llamar('GET', '/api/silobolsas', null, { cabeceras: { sinSesion: true } });
  assert.equal(r.status, 401);
});

test('crea silobolsas y nodos, y no repite identificadores de nodo', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { nombre: 'Silobolsa 01', contenido: 'Soja' });
  assert.equal(silo.status, 201);
  const nodo = await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { nombre: 'Nodo 1', device_id: 'ESP32-A1' });
  assert.equal(nodo.status, 201);
  const repetido = await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { nombre: 'Nodo 2', device_id: 'ESP32-A1' });
  assert.equal(repetido.status, 409);
  const lista = await llamar('GET', '/api/silobolsas');
  assert.equal(lista.data.find((s) => s.id === silo.data.id).nodos.length, 1);
});

test('valida los datos de una silobolsa', async () => {
  const r = await llamar('POST', '/api/silobolsas', { nombre: '   ', contenido: 'Maíz' });
  assert.equal(r.status, 400);
});

test('el gateway exige la clave', async () => {
  const r = await llamar('POST', '/api/gateway/lecturas', { device_id: 'ESP32-A1', ph: 6.5 }, { cabeceras: { sinSesion: true, extra: { 'X-Api-Key': 'mala' } } });
  assert.equal(r.status, 401);
});

test('recibe un lote, rechaza lo inválido y dispara alertas', async () => {
  const ahora = Date.now();
  const r = await gateway([
    { device_id: 'ESP32-A1', ph: 6.5, temp: 18, hum: 13, co2: 1.2, ts: ahora - 60000 },
    { device_id: 'ESP32-A1', ph: 8.0, temp: 18, ts: ahora },                 // pH fuera de rango: crítica
    { device_id: 'NO-EXISTE', ph: 6.5, ts: ahora },                          // nodo desconocido
    { device_id: 'ESP32-A1', temp: 'alta', ts: ahora }                       // valor no numérico
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.data.aceptadas, 2);
  assert.equal(r.data.alertas_nuevas, 1);
  assert.deepEqual(r.data.rechazadas.map((x) => x.indice), [2, 3]);
});

test('un reintento con el mismo ts no duplica lecturas', async () => {
  const ts = Date.now() - 120000;
  await gateway([{ device_id: 'ESP32-A1', ph: 6.6, ts }]);
  const r = await gateway([{ device_id: 'ESP32-A1', ph: 6.6, ts }]);
  assert.equal(r.data.duplicadas, 1);
  assert.equal(r.data.aceptadas, 0);
});

test('no repite una alerta que sigue sin reconocer', async () => {
  const r = await gateway([{ device_id: 'ESP32-A1', ph: 8.1, ts: Date.now() + 1000 }]);
  assert.equal(r.data.alertas_nuevas, 0);
});

test('lista, reconoce y oculta las alertas', async () => {
  const activas = await llamar('GET', '/api/alertas');
  assert.equal(activas.data.length, 1);
  assert.equal(activas.data[0].nivel, 'crit');
  assert.equal(activas.data[0].variable, 'ph');

  const ok = await llamar('POST', `/api/alertas/${activas.data[0].id}/reconocer`);
  assert.equal(ok.status, 200);
  assert.equal((await llamar('GET', '/api/alertas')).data.length, 0);
  assert.equal((await llamar('GET', '/api/alertas?reconocidas=1')).data.length, 1);
});

test('devuelve el historial y la última lectura de un nodo', async () => {
  const lista = await llamar('GET', '/api/silobolsas');
  const nodoId = lista.data[0].nodos[0].id;
  const historial = await llamar('GET', `/api/nodos/${nodoId}/lecturas?desde=0&hasta=${Date.now() + 60000}`);
  assert.ok(historial.data.length >= 2);
  assert.ok(historial.data[0].ts >= historial.data[1].ts, 'ordenado del más nuevo al más viejo');
  const ultima = await llamar('GET', `/api/nodos/${nodoId}/ultima`);
  assert.equal(ultima.data.ts, historial.data[0].ts);
});

test('borrar una silobolsa borra sus nodos y lecturas', async () => {
  const lista = await llamar('GET', '/api/silobolsas');
  const silo = lista.data[0];
  const nodoId = silo.nodos[0].id;
  assert.equal((await llamar('DELETE', `/api/silobolsas/${silo.id}`)).status, 204);
  assert.equal((await llamar('GET', `/api/nodos/${nodoId}/ultima`)).status, 404);
});

test('edita una silobolsa', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { nombre: 'Temporal', contenido: 'Trigo' });
  const r = await llamar('PATCH', `/api/silobolsas/${silo.data.id}`, { contenido: 'Forraje' });
  assert.equal(r.status, 200);
  assert.equal(r.data.contenido, 'Forraje');
  assert.equal(r.data.nombre, 'Temporal');
});

test('la serie promedia por intervalo y rellena los huecos', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { nombre: 'Serie', contenido: 'Soja' });
  const nodo = await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { nombre: 'Nodo S', device_id: 'ESP32-S1' });
  const ahora = Date.now();
  await gateway([
    { device_id: 'ESP32-S1', ph: 6.4, ts: ahora - 90 * 60000 },
    { device_id: 'ESP32-S1', ph: 6.0, ts: ahora - 5 * 60000 },
    { device_id: 'ESP32-S1', ph: 6.2, ts: ahora - 3 * 60000 }
  ]);
  const r = await llamar('GET', `/api/nodos/${nodo.data.id}/serie?rango=24h`);
  assert.equal(r.status, 200);
  assert.equal(r.data.n, 96);
  assert.equal(r.data.valores.ph.length, 96);
  assert.ok(Math.abs(r.data.valores.ph[95] - 6.1) < 1e-9, 'el último intervalo promedia las dos lecturas recientes');
  assert.equal(r.data.valores.ph[0], 6.4, 'los huecos del principio toman el primer valor conocido');
  assert.equal(r.data.valores.temp.every((x) => x == null), true, 'sin lecturas de temperatura, la serie queda vacía');
  assert.equal((await llamar('GET', `/api/nodos/${nodo.data.id}/serie?rango=1y`)).status, 400);
});
