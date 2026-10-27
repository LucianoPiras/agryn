import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';
import { crearNotificador, DEMORA_ATENCION } from '../server/notificaciones.js';

const CLAVE_GATEWAY = 'clave-avisos';
const ANA = { email: 'ana@agryn.test', password: 'clave-ana' };
const BRUNO = { email: 'bruno@agryn.test', password: 'clave-bruno' };

let server, base, repo, notificador;
const codigos = {};   // correo -> último código recibido para el ingreso
const enviadosPorCanal = [];

before(async () => {
  repo = crearRepo(abrirBase(':memory:'));
  const transporte = {
    sendMail: async (m) => { codigos[m.to] = m.text.match(/es (\d{6})\./)[1]; }
  };
  const canal = { nombre: 'prueba', enviar: async (aviso, para) => { enviadosPorCanal.push({ para, titulo: aviso.titulo }); } };
  repo.crearUsuario(ANA.email, ANA.password);
  repo.crearUsuario(BRUNO.email, BRUNO.password);
  notificador = crearNotificador({ repo, canales: [canal] });
  const app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', gatewayKey: CLAVE_GATEWAY, notificador });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((ok) => server.close(ok)));

async function llamar(metodo, ruta, { cuerpo, token, gateway } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (token) cab.Authorization = 'Bearer ' + token;
  if (gateway) cab['X-Api-Key'] = CLAVE_GATEWAY;
  const r = await fetch(base + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  return { status: r.status, data: texto ? JSON.parse(texto) : null };
}

async function ingresar(usuario) {
  await llamar('POST', '/api/login', { cuerpo: usuario });
  const r = await llamar('POST', '/api/verify', { cuerpo: { email: usuario.email, code: codigos[usuario.email] } });
  return r.data.token;
}

test('una alerta crítica avisa a cada usuario al instante y se envía por el canal', async () => {
  const tokenAna = await ingresar(ANA);
  const tokenBruno = await ingresar(BRUNO);
  const silo = await llamar('POST', '/api/silobolsas', { cuerpo: { nombre: 'Avisos 01', contenido: 'Soja' }, token: tokenAna });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { cuerpo: { nombre: 'Nodo A', device_id: 'AVI-1' }, token: tokenAna });

  await llamar('POST', '/api/gateway/lecturas', { cuerpo: [{ device_id: 'AVI-1', ph: 8.1 }], gateway: true });

  const ana = await llamar('GET', '/api/avisos', { token: tokenAna });
  const bruno = await llamar('GET', '/api/avisos', { token: tokenBruno });
  assert.equal(ana.data.no_leidos, 1);
  assert.equal(bruno.data.no_leidos, 1);
  assert.match(ana.data.avisos[0].silobolsa, /Avisos 01/);
  assert.equal(enviadosPorCanal.length, 2);
  assert.deepEqual(enviadosPorCanal.map((x) => x.para).sort(), [ANA.email, BRUNO.email].sort());
  assert.match(enviadosPorCanal[0].titulo, /Alerta crítica/);
});

test('una alerta de atención espera la demora antes de avisar', async () => {
  const tokenAna = await ingresar(ANA);
  const silos = await llamar('GET', '/api/silobolsas', { token: tokenAna });
  const nodo = silos.data.find((s) => s.nodos.some((n) => n.device_id === 'AVI-1')).nodos[0];
  const antes = (await llamar('GET', '/api/avisos', { token: tokenAna })).data.no_leidos;

  // Temperatura un poco fuera de rango: atención, no crítica.
  await llamar('POST', '/api/gateway/lecturas', { cuerpo: [{ device_id: 'AVI-1', temp: 27 }], gateway: true });
  assert.equal((await llamar('GET', '/api/avisos', { token: tokenAna })).data.no_leidos, antes, 'no avisa todavía');
  assert.equal(notificador.procesar(), 0, 'dentro de la demora no hay nada para avisar');

  notificador.procesar(Date.now() + DEMORA_ATENCION + 60 * 1000);
  const despues = await llamar('GET', '/api/avisos', { token: tokenAna });
  assert.equal(despues.data.no_leidos, antes + 1);
  assert.equal(despues.data.avisos[0].variable, 'temp');
  assert.ok(nodo.id > 0);
});

test('cada usuario ve y marca sus propios avisos', async () => {
  const tokenAna = await ingresar(ANA);
  const tokenBruno = await ingresar(BRUNO);
  const lista = (await llamar('GET', '/api/avisos', { token: tokenAna })).data.avisos;
  const aviso = lista[0];

  const leer = await llamar('POST', `/api/avisos/${aviso.id}/leer`, { token: tokenAna });
  assert.equal(leer.status, 200);
  assert.equal((await llamar('GET', '/api/avisos', { token: tokenAna })).data.no_leidos, lista.filter((x) => !x.leido).length - 1);
  assert.ok((await llamar('GET', '/api/avisos', { token: tokenBruno })).data.no_leidos > 0, 'el de Bruno sigue sin leer');

  await llamar('POST', '/api/avisos/leer-todos', { token: tokenAna });
  assert.equal((await llamar('GET', '/api/avisos', { token: tokenAna })).data.no_leidos, 0);
  assert.ok((await llamar('GET', '/api/avisos', { token: tokenBruno })).data.no_leidos > 0);
});

test('no se puede marcar como leído un aviso de otro usuario', async () => {
  const tokenAna = await ingresar(ANA);
  const tokenBruno = await ingresar(BRUNO);
  const aviso = (await llamar('GET', '/api/avisos', { token: tokenBruno })).data.avisos[0];
  const r = await llamar('POST', `/api/avisos/${aviso.id}/leer`, { token: tokenAna });
  assert.equal(r.status, 404);
});

test('los avisos requieren sesión', async () => {
  assert.equal((await llamar('GET', '/api/avisos')).status, 401);
});
