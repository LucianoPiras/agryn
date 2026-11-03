import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { sincronizarFuente, phSimulado } from '../server/fuente.js';

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
  const datos = { centrales: [], capsulas: [{ id: 1, fecha: t0 + 2 * HORA, temp: 17.2, hum: 12.1, gas: 6.4, co2: 410, ph: 6.9, hist: [
    { t: t0, temp: 17.0, hum: 12.0, gas: 6.5, co2: 430, ph: 7.0 },
    { t: t0 + HORA, temp: 17.1, hum: 12.0, gas: 6.5, co2: 420, ph: 6.9 }
  ] }] };
  const { fetchFn, pedidos } = fuenteFalsa(datos);
  const bus = { emitidas: [], emitirATodos(nombre) { this.emitidas.push(nombre); } };
  const nuevas = await sincronizarFuente({ url: URL_FUENTE, repo, bus, fetchFn });
  assert.equal(nuevas, 3);
  assert.equal(pedidos[0], URL_FUENTE + '?api=datos');
  assert.deepEqual(bus.emitidas, ['datos']);
  const nodo = repo.nodoPorDevice('cap-1');
  const ultima = repo.ultimaLectura(nodo.id);
  assert.equal(ultima.co2, 410, 'el CO₂ (ppm) viene calculado por la app de Apps Script');
  assert.equal(ultima.etanol, 6.4, 'el gas del sensor MQ se guarda como etanol');
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

test('el pH de la central no se copia: se simula dentro del rango habitual', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const silo = repo.crearSilobolsa('Silo pH', 'Soja');
  repo.crearNodo(silo.id, 'Cápsula 2', 'cap-2');
  const t0 = Date.now() - 6 * HORA;
  const hist = Array.from({ length: 40 }, (_, i) => ({ t: t0 + i * 9 * 60 * 1000, temp: 25, hum: 60, gas: 8, ph: i % 2 ? 12.95 : 0.15 }));
  const { fetchFn } = fuenteFalsa({ capsulas: [{ id: 2, fecha: t0 + 6 * HORA, temp: 25, hum: 60, gas: 8, ph: 13.5, hist }] });
  await sincronizarFuente({ url: URL_FUENTE, repo, fetchFn });
  const nodo = repo.nodoPorDevice('cap-2');
  const lecturas = repo.lecturasEntre(nodo.id, 0, Date.now());
  assert.equal(lecturas.length, 41);
  for (const l of lecturas) assert.ok(l.ph >= 6.5 && l.ph <= 7.5, `pH ${l.ph} fuera del rango`);
  assert.equal(lecturas.at(-1).ph, phSimulado(t0 + 6 * HORA), 'mismo valor para la misma hora');
});

test('el gas del sensor MQ es el etanol (un negativo se toma como 0); sin co2 de la app, el CO₂ queda vacío', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const silo = repo.crearSilobolsa('Silo CO2', 'Soja');
  repo.crearNodo(silo.id, 'Cápsula 3', 'cap-3');
  const t0 = Date.now() - HORA;
  const { fetchFn } = fuenteFalsa({ capsulas: [{ id: 3, fecha: t0 + 60000, temp: 17, hum: 12, gas: -0.2, hist: [{ t: t0, temp: 17, hum: 12, gas: -76.8 }, { t: t0 + 30000, temp: 17, hum: 12, gas: null }] }] });
  await sincronizarFuente({ url: URL_FUENTE, repo, fetchFn });
  const l = repo.lecturasEntre(repo.nodoPorDevice('cap-3').id, 0, Date.now());
  assert.deepEqual(l.map((x) => x.etanol), [0, null, 0], 'etanol negativo → 0');
  assert.deepEqual(l.map((x) => x.co2), [null, null, null]);
});

test('ninguna medición negativa: CO₂, temperatura y humedad negativos se guardan como 0', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const silo = repo.crearSilobolsa('Silo Negativos', 'Soja');
  repo.crearNodo(silo.id, 'Cápsula 5', 'cap-5');
  const t0 = Date.now() - HORA;
  const { fetchFn } = fuenteFalsa({ capsulas: [{ id: 5, fecha: t0, temp: -1.5, hum: -3, co2: -12, gas: 25, hist: [] }] });
  await sincronizarFuente({ url: URL_FUENTE, repo, fetchFn });
  const [l] = repo.lecturasEntre(repo.nodoPorDevice('cap-5').id, 0, Date.now());
  assert.deepEqual([l.temp, l.hum, l.co2, l.etanol], [0, 0, 0, 25]);
});

test('el etanol de la cápsula se guarda junto a las demás variables', async () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const silo = repo.crearSilobolsa('Silo Etanol', 'Soja');
  repo.crearNodo(silo.id, 'Cápsula 4', 'cap-4');
  const t0 = Date.now() - HORA;
  const { fetchFn } = fuenteFalsa({ capsulas: [{ id: 4, fecha: t0 + 60000, temp: 17, hum: 12, gas: 6.5, etanol: 12.5, hist: [{ t: t0, temp: 17, hum: 12, gas: 6.5, etanol: 3 }, { t: t0 + 30000, temp: 17, hum: 12, gas: 6.5 }] }] });
  await sincronizarFuente({ url: URL_FUENTE, repo, fetchFn });
  const l = repo.lecturasEntre(repo.nodoPorDevice('cap-4').id, 0, Date.now());
  assert.deepEqual(l.map((x) => x.etanol), [3, 6.5, 12.5], 'si no viene «etanol», se usa el gas del sensor MQ');
});
