import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { sincronizarFuente } from '../server/fuente.js';

const URL_FUENTE = 'https://ejemplo.test/exec';
const HORA = 60 * 60 * 1000;

function fuenteFalsa(respuesta) {
  const pedidos = [];
  const fetchFn = async (url) => { pedidos.push(url); return { ok: true, json: async () => respuesta }; };
  return { fetchFn, pedidos };
}

test('guarda el historial y la lectura nueva de cada cápsula, sin repetir', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const silo = repo.crearSilobolsa('Silo Fuente', 'Maíz');
  repo.crearNodo(silo.id, 'Cápsula 1', 'cap-1');
  const t0 = Date.now() - 3 * HORA;
  const datos = { centrales: [], capsulas: [{ id: 1, fecha: t0 + 2 * HORA, temp: 17.2, hum: 12.1, gas: 6.4, ph: 6.9, hist: [
    { t: t0, temp: 17.0, hum: 12.0, gas: 6.5, ph: 7.0 },
    { t: t0 + HORA, temp: 17.1, hum: 12.0, gas: 6.5, ph: 6.9 }
  ] }] };
  const { fetchFn, pedidos } = fuenteFalsa(datos);
  const bus = { emitidas: [], emitirATodos(nombre) { this.emitidas.push(nombre); } };
  const nuevas = await sincronizarFuente({ url: URL_FUENTE, repo, bus, fetchFn });
  assert.equal(nuevas, 3);
  assert.equal(pedidos[0], URL_FUENTE + '?api=datos');
  assert.deepEqual(bus.emitidas, ['datos']);
  const nodo = repo.nodoPorDevice('cap-1');
  const ultima = repo.ultimaLectura(nodo.id);
  assert.equal(ultima.co2, 6.4, 'gas se guarda como CO₂');
  assert.equal(ultima.ts, t0 + 2 * HORA);
  // Una segunda consulta con los mismos datos no agrega nada.
  assert.equal(await sincronizarFuente({ url: URL_FUENTE, repo, bus, fetchFn }), 0);
});

test('las cápsulas sin nodo asociado se ignoran', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const { fetchFn } = fuenteFalsa({ capsulas: [{ id: 9, fecha: Date.now(), temp: 17, hum: 12, gas: 6.5, ph: 7, hist: [] }] });
  assert.equal(await sincronizarFuente({ url: URL_FUENTE, repo, fetchFn }), 0);
});

test('si la fuente responde con error, lo informa', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const fetchFn = async () => ({ ok: false, status: 500 });
  await assert.rejects(sincronizarFuente({ url: URL_FUENTE, repo, fetchFn }), /500/);
});
