import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { crearApp } from '../server/app.js';
import { crearNotificador } from '../server/notificaciones.js';
import { detectarPatrones } from '../server/patrones.js';

const CLAVE_GATEWAY = 'clave-patrones';
const USUARIO = { email: 'patrones@agryn.test', password: 'clave-patrones' };
const HORA = 60 * 60 * 1000;

test('detecta fermentación cuando la temperatura y el CO₂ suben juntos', () => {
  const r = detectarPatrones([{ temp: 20, co2: 1.0, hum: 13 }, { temp: 24, co2: 1.6, hum: 13 }]);
  assert.deepEqual(r.map((x) => x.variable), ['fermentacion']);
});

test('detecta rotura cuando el CO₂ baja de golpe y la humedad sube', () => {
  const r = detectarPatrones([{ temp: 20, co2: 2.0, hum: 13 }, { temp: 20, co2: 1.2, hum: 14.5 }]);
  assert.deepEqual(r.map((x) => x.variable), ['rotura']);
});

test('no detecta nada si los valores casi no cambian', () => {
  assert.deepEqual(detectarPatrones([{ temp: 20, co2: 1.0, hum: 13 }, { temp: 20.5, co2: 1.1, hum: 13.2 }]), []);
  assert.deepEqual(detectarPatrones([{ temp: 20, co2: 1.0, hum: 13 }]), []);
});

test('del gateway a la notificación: fermentación avisa al instante, sin esperar la demora', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  repo.crearUsuario(USUARIO.email, USUARIO.password);
  const enviados = [];
  const canal = { nombre: 'prueba', enviar: async (aviso, para) => { enviados.push({ para, titulo: aviso.titulo, detalle: aviso.detalle, nivel: aviso.nivel }); } };
  const notificador = crearNotificador({ repo, canales: [canal] });
  const correos = [];
  const transporte = { sendMail: async (m) => { correos.push(m); } };
  const app = crearApp({ repo, transporte, remitente: 'Agryn.silobolsa@gmail.com', gatewayKey: CLAVE_GATEWAY, notificador });
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const llamar = async (metodo, ruta, cuerpo, token, gateway) => {
    const cab = { 'Content-Type': 'application/json' };
    if (token) cab.Authorization = 'Bearer ' + token;
    if (gateway) cab['X-Api-Key'] = CLAVE_GATEWAY;
    const r = await fetch(base + ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  try {
    await llamar('POST', '/api/login', USUARIO);
    const token = (await llamar('POST', '/api/verify', { email: USUARIO.email, code: correos.at(-1).text.match(/es (\d{6})\./)[1] })).data.token;
    const silo = await llamar('POST', '/api/silobolsas', { nombre: 'Silo Riesgo', contenido: 'Maíz' }, token);
    await llamar('POST', `/api/silobolsas/${silo.data.id}/nodos`, { nombre: 'Nodo R', device_id: 'PAT-1' }, token);

    const t0 = Date.now() - 3 * HORA;
    const lecturas = [
      { device_id: 'PAT-1', temp: 20, co2: 1.0, hum: 13, ts: t0 },
      { device_id: 'PAT-1', temp: 22, co2: 1.3, hum: 13, ts: t0 + HORA },
      { device_id: 'PAT-1', temp: 24, co2: 1.6, hum: 13, ts: t0 + 1.5 * HORA }
    ];
    const r = await llamar('POST', '/api/gateway/lecturas', lecturas, null, true);
    assert.equal(r.status, 200);
    assert.ok(r.data.alertas_nuevas >= 1);

    const alertas = (await llamar('GET', '/api/alertas', null, token)).data;
    const fermentacion = alertas.find((a) => a.variable === 'fermentacion');
    assert.ok(fermentacion, 'se crea la alerta de fermentación');
    assert.equal(fermentacion.nivel, 'crit');
    assert.equal(fermentacion.etiqueta, 'Posible fermentación');

    // Aviso inmediato: no hizo falta esperar la demora de 30 minutos.
    const avisos = (await llamar('GET', '/api/avisos', null, token)).data;
    assert.ok(avisos.avisos.some((a) => a.variable === 'fermentacion' && a.leido === 0));
    assert.ok(enviados.some((e) => e.para === USUARIO.email && e.nivel === 'crit' && /fermentación/i.test(e.titulo + e.detalle)));

    // Mismo patrón con alerta sin reconocer: no se repite.
    const antes = enviados.length;
    await llamar('POST', '/api/gateway/lecturas', [{ device_id: 'PAT-1', temp: 25, co2: 1.8, hum: 13, ts: t0 + 2 * HORA }], null, true);
    assert.equal(enviados.length, antes);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
