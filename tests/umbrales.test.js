import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';

const CLAVE_GATEWAY = 'clave-umbrales';
const USUARIO = { email: 'umbrales@agryn.test', password: 'clave-umbrales' };

let server, base, token;
const correos = [];

before(async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  repo.crearUsuario(USUARIO.email, USUARIO.password);
  const transporte = { sendMail: async (m) => { correos.push(m); } };
  const app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', gatewayKey: CLAVE_GATEWAY });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
  await llamar('POST', '/api/login', USUARIO);
  const codigo = correos.at(-1).text.match(/es (\d{6})\./)[1];
  token = (await llamar('POST', '/api/verify', { email: USUARIO.email, code: codigo })).data.token;
});

after(() => new Promise((ok) => server.close(ok)));

async function llamar(metodo, ruta, cuerpo, { sinSesion = false, gateway = false } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (token && !sinSesion) cab.Authorization = 'Bearer ' + token;
  if (gateway) cab['X-Api-Key'] = CLAVE_GATEWAY;
  const r = await fetch(base + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  return { status: r.status, data: texto ? JSON.parse(texto) : null };
}

test('los umbrales arrancan con los valores de ejemplo', async () => {
  const r = await llamar('GET', '/api/umbrales');
  assert.equal(r.status, 200);
  const ph = r.data.find((u) => u.key === 'ph');
  assert.equal(ph.min, 5.8);
  assert.equal(ph.max, 7.2);
  assert.equal(r.data.length, 4);
});

test('editar un umbral valida que sea un rango posible', async () => {
  assert.equal((await llamar('PUT', '/api/umbrales/ph', { min: 7, max: 6 })).status, 400);
  assert.equal((await llamar('PUT', '/api/umbrales/ph', { min: '6', max: 7 })).status, 400);
  assert.equal((await llamar('PUT', '/api/umbrales/nada', { min: 1, max: 2 })).status, 404);
  assert.equal((await llamar('PUT', '/api/umbrales/ph', { min: 6, max: 7 }, { sinSesion: true })).status, 401);
});

test('un umbral nuevo cambia las alertas de las lecturas que llegan después', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { nombre: 'Umbrales 01', contenido: 'Soja' });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { nombre: 'Nodo U', device_id: 'UMB-1' });

  // Con el máximo en 7.2, un pH de 7.1 está dentro del rango.
  let r = await llamar('POST', '/api/gateway/lecturas', [{ device_id: 'UMB-1', ph: 7.1 }], { gateway: true });
  assert.equal(r.data.alertas_nuevas, 0);

  // Bajamos el máximo a 7.0: el mismo valor pasa a ser atención.
  const nuevo = await llamar('PUT', '/api/umbrales/ph', { min: 6, max: 7 });
  assert.equal(nuevo.status, 200);
  assert.equal(nuevo.data.find((u) => u.key === 'ph').max, 7);
  r = await llamar('POST', '/api/gateway/lecturas', [{ device_id: 'UMB-1', ph: 7.1, ts: Date.now() + 1000 }], { gateway: true });
  assert.equal(r.data.alertas_nuevas, 1);
  const alertas = (await llamar('GET', '/api/alertas')).data;
  assert.equal(alertas.find((a) => a.variable === 'ph' && a.valor === 7.1).nivel, 'warn');
});
