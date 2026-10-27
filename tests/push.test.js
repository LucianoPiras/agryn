import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';
import { crearCanalPush } from '../server/push.js';

const ANA = { email: 'ana@agryn.test', password: 'clave-ana-push' };
const CLAVE_PUBLICA = 'BElXqRpublicaDePrueba-clave_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
const SUSCRIPCION = { endpoint: 'https://push.ejemplo.test/dispositivo-1', keys: { p256dh: 'p256-prueba', auth: 'auth-prueba' } };

let server, base, repo, app;
const codigos = {};

before(async () => {
  repo = crearRepo(abrirBase(':memory:'));
  const transporte = { sendMail: async (m) => { codigos[m.to] = m.text.match(/es (\d{6})\./)[1]; } };
  repo.crearUsuario(ANA.email, ANA.password);
  app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', vapidPublica: CLAVE_PUBLICA });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((ok) => server.close(ok)));

async function llamar(metodo, ruta, { cuerpo, token } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (token) cab.Authorization = 'Bearer ' + token;
  const r = await fetch(base + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  return { status: r.status, data: texto ? JSON.parse(texto) : null };
}

async function ingresar() {
  await llamar('POST', '/api/login', { cuerpo: ANA });
  const r = await llamar('POST', '/api/verify', { cuerpo: { email: ANA.email, code: codigos[ANA.email] } });
  return r.data.token;
}

test('las rutas de push requieren sesión', async () => {
  assert.equal((await llamar('GET', '/api/push/clave')).status, 401);
  assert.equal((await llamar('POST', '/api/push/suscribir', { cuerpo: SUSCRIPCION })).status, 401);
});

test('el celular pide la clave pública para suscribirse', async () => {
  const token = await ingresar();
  const r = await llamar('GET', '/api/push/clave', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.clave, CLAVE_PUBLICA);
});

test('sin claves configuradas, el servidor avisa que push no está disponible', async () => {
  const sinClaves = crearApp({ repo, transporte: { sendMail: async (m) => { codigos[m.to] = m.text.match(/es (\d{6})\./)[1]; } }, remitente: 'x@x.test' });
  await new Promise((ok) => { sinClaves.srv = sinClaves.listen(0, '127.0.0.1', ok); });
  const url = `http://127.0.0.1:${sinClaves.srv.address().port}`;
  const post = (ruta, cuerpo, token) => fetch(url + ruta, { method: cuerpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  await post('/api/login', ANA);
  const token = (await (await post('/api/verify', { email: ANA.email, code: codigos[ANA.email] })).json()).token;
  const r = await fetch(url + '/api/push/clave', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(r.status, 503);
  sinClaves.srv.close();
});

test('una suscripción inválida se rechaza', async () => {
  const token = await ingresar();
  const sinHttps = await llamar('POST', '/api/push/suscribir', { cuerpo: { ...SUSCRIPCION, endpoint: 'http://inseguro.test' }, token });
  assert.equal(sinHttps.status, 400);
  const sinClaves = await llamar('POST', '/api/push/suscribir', { cuerpo: { endpoint: SUSCRIPCION.endpoint }, token });
  assert.equal(sinClaves.status, 400);
});

test('se guarda la suscripción del dispositivo y se puede quitar', async () => {
  const token = await ingresar();
  assert.equal((await llamar('POST', '/api/push/suscribir', { cuerpo: SUSCRIPCION, token })).status, 200);
  assert.equal(repo.suscripcionesDe(ANA.email).length, 1);
  // Volver a suscribir el mismo dispositivo no duplica.
  await llamar('POST', '/api/push/suscribir', { cuerpo: SUSCRIPCION, token });
  assert.equal(repo.suscripcionesDe(ANA.email).length, 1);
  assert.equal((await llamar('DELETE', '/api/push/suscribir', { cuerpo: { endpoint: SUSCRIPCION.endpoint }, token })).status, 200);
  assert.equal(repo.suscripcionesDe(ANA.email).length, 0);
});

test('el canal manda a cada dispositivo del usuario y borra los que ya no existen', async () => {
  repo.guardarSuscripcion(ANA.email, { endpoint: 'https://push.ejemplo.test/vivo', p256dh: 'a', auth: 'b' });
  repo.guardarSuscripcion(ANA.email, { endpoint: 'https://push.ejemplo.test/muerto', p256dh: 'c', auth: 'd' });
  const enviados = [];
  const canal = crearCanalPush({
    repo,
    enviar: async (suscripcion, carga) => {
      enviados.push({ endpoint: suscripcion.endpoint, carga: JSON.parse(carga) });
      if (suscripcion.endpoint.endsWith('/muerto')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    }
  });
  await canal.enviar({ titulo: 'Alerta crítica · Silo 1', detalle: 'pH alto', nivel: 'crit' }, ANA.email);
  assert.equal(enviados.length, 2);
  assert.equal(enviados[0].carga.titulo, 'Alerta crítica · Silo 1');
  assert.equal(enviados[0].carga.nivel, 'crit');
  assert.deepEqual(repo.suscripcionesDe(ANA.email).map((s) => s.endpoint), ['https://push.ejemplo.test/vivo']);
});

test('un error que no es de dispositivo no borra la suscripción', async () => {
  const canal = crearCanalPush({
    repo,
    enviar: async () => { throw Object.assign(new Error('caído'), { statusCode: 500 }); }
  });
  await canal.enviar({ titulo: 'x', detalle: 'y', nivel: 'warn' }, ANA.email);
  assert.equal(repo.suscripcionesDe(ANA.email).length, 1);
});
