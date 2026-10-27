import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase, crearRepo } from '../server/db.js';
import { diagnosticar, tendencias } from '../server/diagnostico.js';

// Serie de lecturas de 2 h: cada variable va de `desde` a `hasta` de forma lineal.
function serie({ ph = [7, 7], temp = [20, 20], hum = [13, 13], co2 = [1, 1] } = {}, n = 12) {
  const lin = ([a, b], i) => a + ((b - a) * i) / (n - 1);
  return Array.from({ length: n }, (_, i) => ({
    ts: i * 10 * 60 * 1000,
    ph: lin(ph, i), temp: lin(temp, i), hum: lin(hum, i), co2: lin(co2, i)
  }));
}

test('temperatura y CO₂ subiendo juntos se leen como fermentación', () => {
  const texto = diagnosticar(serie({ temp: [18, 22], co2: [1, 1.6] }));
  assert.match(texto, /subieron juntos/);
  assert.match(texto, /Temperatura subió \d,\d °C/);
  assert.match(texto, /CO₂ subió \d,\d %/);
});

test('CO₂ bajando con humedad subiendo se lee como posible rotura', () => {
  const texto = diagnosticar(serie({ co2: [1.8, 1], hum: [12.2, 13.8] }));
  assert.match(texto, /CO₂ bajó de golpe/);
  assert.match(texto, /Humedad subió/);
});

test('un cambio que no encaja con ningún patrón se dice sin inventar una causa', () => {
  const texto = diagnosticar(serie({ temp: [18, 23] }));
  assert.match(texto, /No alcanza para un patrón claro/);
  assert.doesNotMatch(texto, /fermentación|rotura/);
});

test('sin cambios claros lo informa', () => {
  assert.match(diagnosticar(serie()), /Sin cambios claros/);
});

test('con pocas lecturas no hay diagnóstico', () => {
  assert.equal(diagnosticar(serie({}, 3)), null);
});

test('las tendencias ignoran variaciones menores al mínimo', () => {
  const cambios = tendencias(serie({ temp: [20, 20.4], co2: [1, 1.1] }));
  assert.deepEqual(cambios, {});
});

test('el repositorio devuelve solo las lecturas de la ventana pedida', () => {
  const repo = crearRepo(abrirBase(':memory:'));
  const silo = repo.crearSilobolsa('Ventana', 'Soja');
  const nodo = repo.crearNodo(silo.id, 'Nodo V', 'VEN-1');
  for (let ts = 0; ts <= 4 * 60 * 60 * 1000; ts += 30 * 60 * 1000) repo.guardarLectura(nodo.id, ts, { temp: 20 });
  const dentro = repo.lecturasEntre(nodo.id, 60 * 60 * 1000, 2 * 60 * 60 * 1000);
  assert.equal(dentro.length, 3);
  assert.equal(dentro[0].ts, 60 * 60 * 1000);
  assert.equal(dentro.at(-1).ts, 2 * 60 * 60 * 1000);
});
