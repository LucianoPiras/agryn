// Almacenamiento de AGRYN Monitoreo con SQLite (módulo integrado de Node 22).
import { DatabaseSync } from 'node:sqlite';

export function abrirBase(ruta = ':memory:') {
  const db = new DatabaseSync(ruta);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS silobolsas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      contenido TEXT NOT NULL DEFAULT 'Sin definir',
      creada INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nodos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      silobolsa_id INTEGER NOT NULL REFERENCES silobolsas(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      device_id TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS lecturas (
      nodo_id INTEGER NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      ph REAL, temp REAL, hum REAL, co2 REAL,
      PRIMARY KEY (nodo_id, ts)
    );
    CREATE TABLE IF NOT EXISTS alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nodo_id INTEGER NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
      variable TEXT NOT NULL,
      valor REAL NOT NULL,
      nivel TEXT NOT NULL,
      ts INTEGER NOT NULL,
      reconocida INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS alertas_por_nodo ON alertas(nodo_id, variable, reconocida);
  `);
  return db;
}

export function crearRepo(db) {
  const q = (sql) => db.prepare(sql);
  const st = {
    silos: q('SELECT id, nombre, contenido, creada FROM silobolsas ORDER BY id'),
    silo: q('SELECT id, nombre, contenido, creada FROM silobolsas WHERE id = ?'),
    nuevaSilo: q('INSERT INTO silobolsas (nombre, contenido, creada) VALUES (?, ?, ?)'),
    editaSilo: q('UPDATE silobolsas SET nombre = ?, contenido = ? WHERE id = ?'),
    borraSilo: q('DELETE FROM silobolsas WHERE id = ?'),
    nodosDe: q('SELECT id, silobolsa_id, nombre, device_id FROM nodos WHERE silobolsa_id = ? ORDER BY id'),
    nodo: q('SELECT id, silobolsa_id, nombre, device_id FROM nodos WHERE id = ?'),
    nodoPorDevice: q('SELECT id, silobolsa_id, nombre, device_id FROM nodos WHERE device_id = ?'),
    nuevoNodo: q('INSERT INTO nodos (silobolsa_id, nombre, device_id) VALUES (?, ?, ?)'),
    borraNodo: q('DELETE FROM nodos WHERE id = ?'),
    insertLectura: q('INSERT OR IGNORE INTO lecturas (nodo_id, ts, ph, temp, hum, co2) VALUES (?, ?, ?, ?, ?, ?)'),
    lecturas: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? AND ts BETWEEN ? AND ? ORDER BY ts DESC LIMIT ?'),
    ultima: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? ORDER BY ts DESC LIMIT 1'),
    entre: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? AND ts >= ? ORDER BY ts ASC'),
    alertaActiva: q('SELECT id FROM alertas WHERE nodo_id = ? AND variable = ? AND reconocida = 0'),
    nuevaAlerta: q('INSERT INTO alertas (nodo_id, variable, valor, nivel, ts) VALUES (?, ?, ?, ?, ?)'),
    alertas: q(`SELECT a.id, a.nodo_id, a.variable, a.valor, a.nivel, a.ts, a.reconocida, n.nombre AS nodo, s.id AS silobolsa_id, s.nombre AS silobolsa
      FROM alertas a JOIN nodos n ON n.id = a.nodo_id JOIN silobolsas s ON s.id = n.silobolsa_id
      WHERE a.reconocida = ? ORDER BY a.ts DESC LIMIT 200`),
    alerta: q('SELECT id FROM alertas WHERE id = ?'),
    reconocer: q('UPDATE alertas SET reconocida = 1 WHERE id = ?')
  };

  return {
    transaccion(fn) {
      db.exec('BEGIN');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    silobolsas() {
      return st.silos.all().map((s) => ({ ...s, nodos: st.nodosDe.all(s.id) }));
    },
    silobolsa(id) {
      const s = st.silo.get(id);
      return s ? { ...s, nodos: st.nodosDe.all(id) } : null;
    },
    crearSilobolsa(nombre, contenido) {
      const info = st.nuevaSilo.run(nombre, contenido, Date.now());
      return this.silobolsa(Number(info.lastInsertRowid));
    },
    editarSilobolsa(id, { nombre, contenido }) {
      st.editaSilo.run(nombre, contenido, id);
      return this.silobolsa(id);
    },
    borrarSilobolsa(id) { return st.borraSilo.run(id).changes > 0; },
    nodo(id) { return st.nodo.get(id) || null; },
    nodoPorDevice(deviceId) { return st.nodoPorDevice.get(deviceId) || null; },
    crearNodo(silobolsaId, nombre, deviceId) {
      const info = st.nuevoNodo.run(silobolsaId, nombre, deviceId);
      return st.nodo.get(Number(info.lastInsertRowid));
    },
    borrarNodo(id) { return st.borraNodo.run(id).changes > 0; },
    guardarLectura(nodoId, ts, v) {
      return st.insertLectura.run(nodoId, ts, v.ph ?? null, v.temp ?? null, v.hum ?? null, v.co2 ?? null).changes > 0;
    },
    lecturas(nodoId, desde, hasta, limite) {
      return st.lecturas.all(nodoId, desde, hasta, limite);
    },
    ultimaLectura(nodoId) { return st.ultima.get(nodoId) || null; },
    lecturasDesde(nodoId, desde) { return st.entre.all(nodoId, desde); },
    alertaActiva(nodoId, variable) { return !!st.alertaActiva.get(nodoId, variable); },
    crearAlerta(nodoId, variable, valor, nivel, ts) { st.nuevaAlerta.run(nodoId, variable, valor, nivel, ts); },
    alertas(reconocida) { return st.alertas.all(reconocida ? 1 : 0); },
    reconocerAlerta(id) {
      if (!st.alerta.get(id)) return false;
      st.reconocer.run(id);
      return true;
    }
  };
}
