// Almacenamiento de AGRYN Monitoreo con SQLite (módulo integrado de Node 22).
import { DatabaseSync } from 'node:sqlite';
import { VARIABLES } from './umbrales.js';
import { hashClave, verificarClave } from './clave.js';

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
      reconocida INTEGER NOT NULL DEFAULT 0,
      creada INTEGER NOT NULL DEFAULT 0,
      notificada INTEGER NOT NULL DEFAULT 0,
      diagnostico TEXT
    );
    CREATE INDEX IF NOT EXISTS alertas_por_nodo ON alertas(nodo_id, variable, reconocida);
    CREATE TABLE IF NOT EXISTS avisos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL,
      alerta_id INTEGER NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
      creada INTEGER NOT NULL,
      leido INTEGER NOT NULL DEFAULT 0,
      UNIQUE (usuario, alerta_id)
    );
    CREATE INDEX IF NOT EXISTS avisos_por_usuario ON avisos(usuario, leido);
    CREATE TABLE IF NOT EXISTS umbrales (
      variable TEXT PRIMARY KEY,
      min REAL NOT NULL,
      max REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usuarios (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      creado INTEGER NOT NULL
    );
    -- Por defecto cada usuario recibe los avisos de todas las silobolsas; acá quedan las que silenció.
    CREATE TABLE IF NOT EXISTS silenciadas (
      usuario TEXT NOT NULL,
      silobolsa_id INTEGER NOT NULL REFERENCES silobolsas(id) ON DELETE CASCADE,
      PRIMARY KEY (usuario, silobolsa_id)
    );
    -- Un registro por dispositivo del usuario que aceptó las notificaciones push.
    CREATE TABLE IF NOT EXISTS suscripciones_push (
      endpoint TEXT PRIMARY KEY,
      usuario TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      creada INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS suscripciones_por_usuario ON suscripciones_push(usuario);
  `);
  // Umbrales de ejemplo, solo la primera vez: después los cambia el equipo desde la app.
  const sembrar = db.prepare('INSERT OR IGNORE INTO umbrales (variable, min, max) VALUES (?, ?, ?)');
  for (const v of VARIABLES) sembrar.run(v.key, v.min, v.max);
  // Bases creadas antes de los avisos: las alertas que ya existían se dan por notificadas.
  const columnas = db.prepare('PRAGMA table_info(alertas)').all().map((c) => c.name);
  if (!columnas.includes('creada')) {
    db.exec('ALTER TABLE alertas ADD COLUMN creada INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE alertas ADD COLUMN notificada INTEGER NOT NULL DEFAULT 1');
  }
  if (!columnas.includes('diagnostico')) db.exec('ALTER TABLE alertas ADD COLUMN diagnostico TEXT');
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
    nodosDe: q(`SELECT n.id, n.silobolsa_id, n.nombre, n.device_id, (SELECT MAX(ts) FROM lecturas WHERE nodo_id = n.id) AS ultima_ts
      FROM nodos n WHERE n.silobolsa_id = ? ORDER BY n.id`),
    todosNodos: q('SELECT id, silobolsa_id, nombre, device_id FROM nodos ORDER BY id'),
    nodo: q('SELECT id, silobolsa_id, nombre, device_id FROM nodos WHERE id = ?'),
    nodoPorDevice: q('SELECT id, silobolsa_id, nombre, device_id FROM nodos WHERE device_id = ?'),
    nuevoNodo: q('INSERT INTO nodos (silobolsa_id, nombre, device_id) VALUES (?, ?, ?)'),
    borraNodo: q('DELETE FROM nodos WHERE id = ?'),
    insertLectura: q('INSERT OR IGNORE INTO lecturas (nodo_id, ts, ph, temp, hum, co2) VALUES (?, ?, ?, ?, ?, ?)'),
    lecturas: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? AND ts BETWEEN ? AND ? ORDER BY ts DESC LIMIT ?'),
    ultima: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? ORDER BY ts DESC LIMIT 1'),
    entre: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? AND ts >= ? ORDER BY ts ASC'),
    entreAcotado: q('SELECT ts, ph, temp, hum, co2 FROM lecturas WHERE nodo_id = ? AND ts BETWEEN ? AND ? ORDER BY ts ASC'),
    alertaActiva: q('SELECT id FROM alertas WHERE nodo_id = ? AND variable = ? AND reconocida = 0'),
    nuevaAlerta: q('INSERT INTO alertas (nodo_id, variable, valor, nivel, ts, creada, diagnostico) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    alertasPorNotificar: q(`SELECT a.id, a.variable, a.valor, a.nivel, a.ts, a.diagnostico, n.id AS nodo_id, n.nombre AS nodo, s.id AS silobolsa_id, s.nombre AS silobolsa
      FROM alertas a JOIN nodos n ON n.id = a.nodo_id JOIN silobolsas s ON s.id = n.silobolsa_id
      WHERE a.reconocida = 0 AND a.notificada = 0 AND (a.nivel = 'crit' OR a.creada <= ?) ORDER BY a.id`),
    marcarNotificada: q('UPDATE alertas SET notificada = 1 WHERE id = ?'),
    nuevoAviso: q('INSERT OR IGNORE INTO avisos (usuario, alerta_id, creada) VALUES (?, ?, ?)'),
    avisosDe: q(`SELECT av.id, av.leido, av.creada, a.id AS alerta_id, a.variable, a.valor, a.nivel, a.ts, a.diagnostico,
      n.id AS nodo_id, n.nombre AS nodo, s.id AS silobolsa_id, s.nombre AS silobolsa
      FROM avisos av JOIN alertas a ON a.id = av.alerta_id JOIN nodos n ON n.id = a.nodo_id JOIN silobolsas s ON s.id = n.silobolsa_id
      WHERE av.usuario = ? ORDER BY av.creada DESC, av.id DESC LIMIT 100`),
    noLeidos: q('SELECT COUNT(*) AS n FROM avisos WHERE usuario = ? AND leido = 0'),
    leerAviso: q('UPDATE avisos SET leido = 1 WHERE id = ? AND usuario = ?'),
    leerTodos: q('UPDATE avisos SET leido = 1 WHERE usuario = ? AND leido = 0'),
    umbral: q('SELECT min, max FROM umbrales WHERE variable = ?'),
    editaUmbral: q('UPDATE umbrales SET min = ?, max = ? WHERE variable = ?'),
    usuarios: q('SELECT email FROM usuarios ORDER BY email'),
    claveDe: q('SELECT password_hash FROM usuarios WHERE email = ?'),
    nuevoUsuario: q('INSERT OR IGNORE INTO usuarios (email, password_hash, creado) VALUES (?, ?, ?)'),
    silenciadasDe: q('SELECT silobolsa_id FROM silenciadas WHERE usuario = ?'),
    silenciar: q('INSERT OR IGNORE INTO silenciadas (usuario, silobolsa_id) VALUES (?, ?)'),
    quitarSilencio: q('DELETE FROM silenciadas WHERE usuario = ? AND silobolsa_id = ?'),
    siguen: q(`SELECT email FROM usuarios WHERE email NOT IN
      (SELECT usuario FROM silenciadas WHERE silobolsa_id = ?) ORDER BY email`),
    alertas: q(`SELECT a.id, a.nodo_id, a.variable, a.valor, a.nivel, a.ts, a.reconocida, a.diagnostico, n.nombre AS nodo, s.id AS silobolsa_id, s.nombre AS silobolsa
      FROM alertas a JOIN nodos n ON n.id = a.nodo_id JOIN silobolsas s ON s.id = n.silobolsa_id
      WHERE a.reconocida = ? ORDER BY a.ts DESC LIMIT 200`),
    alerta: q('SELECT id, nodo_id, variable, ts, reconocida FROM alertas WHERE id = ?'),
    activasDeNodo: q('SELECT id, variable, ts FROM alertas WHERE nodo_id = ? AND reconocida = 0'),
    reconocer: q('UPDATE alertas SET reconocida = 1 WHERE id = ?'),
    suscripcionesDe: q('SELECT endpoint, p256dh, auth FROM suscripciones_push WHERE usuario = ?'),
    guardarSuscripcion: q('INSERT OR REPLACE INTO suscripciones_push (endpoint, usuario, p256dh, auth, creada) VALUES (?, ?, ?, ?, ?)'),
    quitarSuscripcion: q('DELETE FROM suscripciones_push WHERE endpoint = ? AND usuario = ?')
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
    nodos() { return st.todosNodos.all(); },
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
    crearAlerta(nodoId, variable, valor, nivel, ts, diagnostico = null) {
      st.nuevaAlerta.run(nodoId, variable, valor, nivel, ts, Date.now(), diagnostico);
    },
    // Lecturas de un nodo entre dos instantes, para armar el diagnóstico de una alarma.
    lecturasEntre(nodoId, desde, hasta) {
      return st.entreAcotado.all(nodoId, desde, hasta);
    },
    alertasPorNotificar(atencionAntesDe) { return st.alertasPorNotificar.all(atencionAntesDe); },
    marcarNotificada(id) { st.marcarNotificada.run(id); },
    crearAviso(usuario, alertaId, creada) { st.nuevoAviso.run(usuario, alertaId, creada); },
    avisos(usuario) { return st.avisosDe.all(usuario); },
    noLeidos(usuario) { return st.noLeidos.get(usuario).n; },
    leerAviso(id, usuario) { return st.leerAviso.run(id, usuario).changes > 0; },
    leerTodosAvisos(usuario) { st.leerTodos.run(usuario); },
    umbrales() {
      return VARIABLES.map((v) => {
        const r = st.umbral.get(v.key);
        return { key: v.key, nombre: v.nombre, unidad: v.unidad, objetivo: v.objetivo, min: r.min, max: r.max };
      });
    },
    editarUmbral(key, min, max) { st.editaUmbral.run(min, max, key); },
    usuarios() { return st.usuarios.all().map((u) => u.email); },
    usuariosQueSiguen(silobolsaId) { return st.siguen.all(silobolsaId).map((u) => u.email); },
    preferencias(usuario) {
      const silenciadas = new Set(st.silenciadasDe.all(usuario).map((r) => r.silobolsa_id));
      return st.silos.all().map((s) => ({ silobolsa_id: s.id, nombre: s.nombre, recibe: !silenciadas.has(s.id) }));
    },
    fijarPreferencia(usuario, silobolsaId, recibe) {
      if (recibe) st.quitarSilencio.run(usuario, silobolsaId);
      else st.silenciar.run(usuario, silobolsaId);
    },
    crearUsuario(email, clave) { st.nuevoUsuario.run(email, hashClave(clave), Date.now()); },
    verificarUsuario(email, clave) {
      const r = st.claveDe.get(email);
      return !!r && verificarClave(clave, r.password_hash);
    },
    suscripcionesDe(usuario) { return st.suscripcionesDe.all(usuario); },
    guardarSuscripcion(usuario, { endpoint, p256dh, auth }) {
      st.guardarSuscripcion.run(endpoint, usuario, p256dh, auth, Date.now());
    },
    quitarSuscripcion(endpoint, usuario) { return st.quitarSuscripcion.run(endpoint, usuario).changes > 0; },
    alertas(reconocida) { return st.alertas.all(reconocida ? 1 : 0); },
    alerta(id) { return st.alerta.get(id) || null; },
    alertasActivasDe(nodoId) { return st.activasDeNodo.all(nodoId); },
    reconocerAlerta(id) {
      if (!st.alerta.get(id)) return false;
      st.reconocer.run(id);
      return true;
    }
  };
}
