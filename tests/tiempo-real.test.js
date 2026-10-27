import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';
import { crearBus } from '../server/eventos.js';
import { crearNotificador } from '../server/notificaciones.js';
import { verificarSinDatos, SIN_DATOS_MS } from '../server/salud.js';

const CLAVE_CENTRAL = 'clave-tiempo-real';
const CLAVE_GATEWAY = 'clave-gw-tiempo-real';
const USUARIO = { email: 'vigilancia@agryn.test', password: 'clave-vigilancia' };
const MIN = 60 * 1000;

let server, base, token, repo, bus, notificador, lectores = [];
const correos = [];
const avisosDelCanal = [];

before(async () => {
  repo = crearRepo(abrirBase(':memory:'));
  repo.crearUsuario(USUARIO.email, USUARIO.password);
  bus = crearBus();
  const canal = { nombre: 'prueba', enviar: async (aviso) => { avisosDelCanal.push(aviso); } };
  notificador = crearNotificador({ repo, canales: [canal], bus });
  const transporte = { sendMail: async (m) => { correos.push(m); } };
  const app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', gatewayKey: CLAVE_GATEWAY, centralKey: CLAVE_CENTRAL, notificador, bus });
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
  await llamar('POST', '/api/login', { cuerpo: USUARIO });
  const codigo = correos.at(-1).text.match(/es (\d{6})\./)[1];
  token = (await llamar('POST', '/api/verify', { cuerpo: { email: USUARIO.email, code: codigo } })).data.token;
  const silo = await llamar('POST', '/api/silobolsas', { cuerpo: { nombre: 'Silo Vigilado', contenido: 'Soja' }, token });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { cuerpo: { nombre: 'Nodo V', device_id: 'VIG-1' }, token });
});

after(async () => {
  for (const l of lectores) await l.cancelar();
  bus.cerrar();
  await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); });
});

async function llamar(metodo, ruta, { cuerpo, token: t, clave } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (t) cab.Authorization = 'Bearer ' + t;
  if (clave) cab['X-Api-Key'] = clave;
  const r = await fetch(base + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// Abre la conexión en tiempo real como lo haría la pantalla, y entrega cada evento con la hora de llegada.
async function abrirEventos(onEvento) {
  const ticket = (await llamar('POST', '/api/eventos/ticket', { token })).data.ticket;
  const r = await fetch(base + '/api/eventos?ticket=' + ticket);
  const lector = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', cancelado = false;
  (async () => {
    while (!cancelado) {
      const { value, done } = await lector.read().catch(() => ({ done: true }));
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        const nombre = bloque.match(/^event: (.+)$/m), datos = bloque.match(/^data: (.+)$/m);
        if (nombre) onEvento(nombre[1], datos ? JSON.parse(datos[1]) : {}, performance.now());
      }
    }
  })();
  const lector2 = { cancelar: async () => { cancelado = true; await lector.cancel().catch(() => {}); } };
  lectores.push(lector2);
  return lector2;
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('una anomalía de la central llega a la pantalla en menos de 3 segundos', async () => {
  const recibidos = [];
  await abrirEventos((nombre, datos, hora) => recibidos.push({ nombre, datos, hora }));
  await esperar(100);
  assert.ok(recibidos.some((e) => e.nombre === 'listo'), 'la conexión queda abierta');

  const inicio = performance.now();
  const r = await llamar('POST', '/api/central/anomalias', { cuerpo: [{ device_id: 'VIG-1', tipo: 'fermentacion', valor: 3 }], clave: CLAVE_CENTRAL });
  assert.equal(r.data.nuevas, 1);
  await esperar(150);

  const aviso = recibidos.find((e) => e.nombre === 'aviso' && /Alerta crítica/.test(e.datos.titulo));
  assert.ok(aviso, 'la pantalla recibe el aviso');
  const demora = aviso.hora - inicio;
  console.log(`   latencia anomalía → pantalla: ${demora.toFixed(1)} ms`);
  assert.ok(demora < 3000, `demora ${demora} ms`);
});

test('la central manda lecturas con su clave y la pantalla se entera del lote', async () => {
  const recibidos = [];
  await abrirEventos((nombre) => recibidos.push(nombre));
  await esperar(100);
  const ahora = Date.now();
  const r = await llamar('POST', '/api/central/lecturas', { cuerpo: [{ device_id: 'VIG-1', ph: 6.5, temp: 18, hum: 13, co2: 1.1, ts: ahora }], clave: CLAVE_CENTRAL });
  assert.equal(r.status, 200);
  await esperar(100);
  assert.ok(recibidos.includes('datos'));
  assert.equal((await llamar('POST', '/api/central/lecturas', { cuerpo: [{ device_id: 'VIG-1', ph: 6.5 }], clave: CLAVE_GATEWAY })).status, 401, 'la clave del gateway no sirve para la central');
});

test('el ticket de la conexión sirve una sola vez', async () => {
  const ticket = (await llamar('POST', '/api/eventos/ticket', { token })).data.ticket;
  const primera = await fetch(base + '/api/eventos?ticket=' + ticket);
  assert.equal(primera.status, 200);
  await primera.body.cancel();
  const segunda = await fetch(base + '/api/eventos?ticket=' + ticket);
  assert.equal(segunda.status, 401);
});

test('un nodo que deja de mandar datos genera la alerta "Sin datos de la central"', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { cuerpo: { nombre: 'Silo Cortado', contenido: 'Trigo' }, token });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { cuerpo: { nombre: 'Nodo Cortado', device_id: 'COR-1' }, token });
  const ahora = Date.now();
  // Su último dato es de hace más que el límite.
  await llamar('POST', '/api/central/lecturas', { cuerpo: [{ device_id: 'COR-1', ph: 6.5, ts: ahora - (SIN_DATOS_MS + MIN) }], clave: CLAVE_CENTRAL });
  assert.equal(verificarSinDatos(repo, bus, notificador, ahora), 1);
  assert.equal(verificarSinDatos(repo, bus, notificador, ahora), 0, 'no repite la alerta');

  const sin = (await llamar('GET', '/api/alertas', { token })).data.find((a) => a.variable === 'sin_datos' && a.nodo === 'Nodo Cortado');
  assert.equal(sin.etiqueta, 'Sin datos de la central');
  assert.equal(sin.nivel, 'crit');
});

test('un nodo con datos recientes no genera alerta de corte', async () => {
  const silo = await llamar('POST', '/api/silobolsas', { cuerpo: { nombre: 'Silo Sano', contenido: 'Maíz' }, token });
  await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { cuerpo: { nombre: 'Nodo Sano', device_id: 'SANO-1' }, token });
  const ahora = Date.now();
  await llamar('POST', '/api/central/lecturas', { cuerpo: [{ device_id: 'SANO-1', ph: 6.5, ts: ahora }], clave: CLAVE_CENTRAL });
  assert.equal(verificarSinDatos(repo, bus, notificador, ahora + 60 * 1000), 0, 'dato de hace un minuto: está bien');
  const alertas = (await llamar('GET', '/api/alertas', { token })).data;
  assert.equal(alertas.some((a) => a.nodo === 'Nodo Sano' && a.variable === 'sin_datos'), false);
});
