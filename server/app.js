// API de AGRYN Monitoreo. Se arma con sus dependencias para poder probarla sin correo real ni archivo.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { VARIABLES, evaluar } from './umbrales.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_INTENTOS = 3;
const MAX_LOTE = 500;

export function crearApp({ repo, transporte, usuarios, gatewayKey, remitente, dist = path.join(here, '..', 'dist') }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const pendientes = new Map(); // correo -> { codigo, vence, intentos }
  const sesiones = new Map();   // token -> { email, vence }

  // ---------- ingreso (correo, contraseña y código) ----------
  const nuevoCodigo = () => String(crypto.randomInt(100000, 1000000));

  async function generarYEnviar(email) {
    const codigo = nuevoCodigo();
    if (process.env.AGRYN_MAIL === 'json') console.log('[prueba] código para ' + email + ': ' + codigo);
    await transporte.sendMail({
      from: `"AGRYN Monitoreo" <${remitente}>`,
      to: email,
      subject: `${codigo} es tu código de confirmación`,
      text: `Tu código de confirmación de AGRYN Monitoreo es ${codigo}. Vence en 5 minutos.\n\nSi no intentaste ingresar, ignorá este mensaje.`
    });
    pendientes.set(email, { codigo, vence: Date.now() + CODE_TTL, intentos: 0 });
  }

  const normalizarEmail = (x) => String(x || '').trim().toLowerCase();

  app.post('/api/login', async (req, res) => {
    const email = normalizarEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!usuarios.some((u) => u.email === email && u.password === password)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    try {
      await generarYEnviar(email);
      res.json({ ok: true, destino: email });
    } catch (e) {
      console.error('No se pudo enviar el código:', e.message);
      res.status(502).json({ error: 'No pudimos enviar el código. Probá de nuevo en unos minutos.' });
    }
  });

  app.post('/api/codigo/reenviar', async (req, res) => {
    const email = normalizarEmail(req.body?.email);
    if (!pendientes.has(email)) return res.status(400).json({ error: 'Volvé a ingresar tus datos.', volverLogin: true });
    try {
      await generarYEnviar(email);
      res.json({ ok: true, destino: email });
    } catch (e) {
      console.error('No se pudo reenviar el código:', e.message);
      res.status(502).json({ error: 'No pudimos enviar el código. Probá de nuevo en unos minutos.' });
    }
  });

  app.post('/api/verify', (req, res) => {
    const email = normalizarEmail(req.body?.email);
    const codigo = String(req.body?.code || '').trim();
    const p = pendientes.get(email);
    if (!p) return res.status(400).json({ error: 'Pedí un código nuevo.', volverLogin: true });
    if (Date.now() > p.vence) {
      pendientes.delete(email);
      return res.status(410).json({ error: 'El código venció. Pedí uno nuevo.' });
    }
    if (codigo !== p.codigo) {
      p.intentos += 1;
      if (p.intentos >= MAX_INTENTOS) {
        pendientes.delete(email);
        return res.status(429).json({ error: 'Superaste los intentos permitidos. Volvé a ingresar tus datos.', volverLogin: true });
      }
      const quedan = MAX_INTENTOS - p.intentos;
      return res.status(401).json({ error: 'El código no coincide. Te ' + (quedan === 1 ? 'queda 1 intento.' : 'quedan ' + quedan + ' intentos.'), quedan });
    }
    pendientes.delete(email);
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, { email, vence: Date.now() + SESSION_TTL });
    res.json({ ok: true, email, token });
  });

  function sesionDe(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const s = sesiones.get(token);
    if (!s) return null;
    if (Date.now() > s.vence) { sesiones.delete(token); return null; }
    return { token, ...s };
  }

  app.get('/api/sesion', (req, res) => {
    const s = sesionDe(req);
    if (!s) return res.status(401).json({ error: 'Sesión vencida.' });
    res.json({ email: s.email });
  });

  app.post('/api/logout', (req, res) => {
    const s = sesionDe(req);
    if (s) sesiones.delete(s.token);
    res.json({ ok: true });
  });

  // ---------- API de la app (requiere sesión) ----------
  const requiereSesion = (req, res, next) => (sesionDe(req) ? next() : res.status(401).json({ error: 'Iniciá sesión para continuar.' }));
  const api = express.Router();
  api.use(requiereSesion);

  const idDe = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : null; };
  const textoValido = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max;
  const noEncontrado = (res, que) => res.status(404).json({ error: que + ' no encontrada.' });

  api.get('/umbrales', (req, res) => res.json(VARIABLES));

  api.get('/silobolsas', (req, res) => res.json(repo.silobolsas()));

  api.post('/silobolsas', (req, res) => {
    const { nombre, contenido = 'Sin definir' } = req.body || {};
    if (!textoValido(nombre, 40) || !textoValido(contenido, 60)) return res.status(400).json({ error: 'Nombre (hasta 40 caracteres) y contenido son obligatorios.' });
    res.status(201).json(repo.crearSilobolsa(nombre.trim(), contenido.trim()));
  });

  api.patch('/silobolsas/:id', (req, res) => {
    const id = idDe(req.params.id);
    const actual = id && repo.silobolsa(id);
    if (!actual) return noEncontrado(res, 'Silobolsa');
    const nombre = req.body?.nombre ?? actual.nombre;
    const contenido = req.body?.contenido ?? actual.contenido;
    if (!textoValido(nombre, 40) || !textoValido(contenido, 60)) return res.status(400).json({ error: 'Nombre (hasta 40 caracteres) y contenido son obligatorios.' });
    res.json(repo.editarSilobolsa(id, { nombre: nombre.trim(), contenido: contenido.trim() }));
  });

  api.delete('/silobolsas/:id', (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !repo.borrarSilobolsa(id)) return noEncontrado(res, 'Silobolsa');
    res.status(204).end();
  });

  api.post('/silobolsas/:id/nodos', (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !repo.silobolsa(id)) return noEncontrado(res, 'Silobolsa');
    const { nombre, device_id: deviceId } = req.body || {};
    if (!textoValido(nombre, 40) || !textoValido(deviceId, 64)) return res.status(400).json({ error: 'Nombre y identificador del nodo son obligatorios.' });
    if (repo.nodoPorDevice(deviceId.trim())) return res.status(409).json({ error: 'Ya hay un nodo con ese identificador.' });
    res.status(201).json(repo.crearNodo(id, nombre.trim(), deviceId.trim()));
  });

  api.delete('/nodos/:id', (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !repo.borrarNodo(id)) return noEncontrado(res, 'Nodo');
    res.status(204).end();
  });

  api.get('/nodos/:id/lecturas', (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !repo.nodo(id)) return noEncontrado(res, 'Nodo');
    const hasta = Number(req.query.hasta) || Date.now();
    const desde = Number(req.query.desde) || hasta - 24 * 3600 * 1000;
    const limite = Math.min(Math.max(Number(req.query.limite) || 500, 1), 5000);
    res.json(repo.lecturas(id, desde, hasta, limite));
  });

  api.get('/nodos/:id/ultima', (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !repo.nodo(id)) return noEncontrado(res, 'Nodo');
    res.json(repo.ultimaLectura(id));
  });

  api.get('/alertas', (req, res) => {
    res.json(repo.alertas(req.query.reconocidas === '1'));
  });

  api.post('/alertas/:id/reconocer', (req, res) => {
    const id = idDe(req.params.id);
    if (!id || !repo.reconocerAlerta(id)) return noEncontrado(res, 'Alerta');
    res.json({ ok: true });
  });

  // ---------- gateway LoRa: el ESP32 gateway envía las lecturas acá ----------
  // Recibe una lectura o un lote. Cada lectura: { device_id, ph?, temp?, hum?, co2?, ts? (ms) }.
  // Los duplicados (mismo nodo y mismo ts) se ignoran, así que los reintentos son seguros.
  function valoresDe(it) {
    const v = {};
    for (const k of VARIABLES.map((x) => x.key)) {
      if (it[k] == null) continue;
      if (typeof it[k] !== 'number' || !Number.isFinite(it[k])) return null;
      v[k] = it[k];
    }
    return Object.keys(v).length ? v : null;
  }

  app.post('/api/gateway/lecturas', (req, res) => {
    if (!gatewayKey || req.get('X-Api-Key') !== gatewayKey) return res.status(401).json({ error: 'Clave de gateway inválida.' });
    const lote = Array.isArray(req.body) ? req.body : [req.body];
    if (lote.length === 0 || lote.length > MAX_LOTE) return res.status(400).json({ error: 'Enviá entre 1 y ' + MAX_LOTE + ' lecturas por pedido.' });

    const rechazadas = [];
    let aceptadas = 0, alertasNuevas = 0, duplicadas = 0;
    repo.transaccion(() => {
      lote.forEach((it, indice) => {
        const deviceId = typeof it?.device_id === 'string' ? it.device_id.trim() : '';
        const nodo = deviceId && repo.nodoPorDevice(deviceId);
        if (!nodo) return rechazadas.push({ indice, motivo: 'nodo desconocido' });
        const valores = valoresDe(it);
        if (!valores) return rechazadas.push({ indice, motivo: 'valores inválidos o vacíos' });
        const ts = typeof it.ts === 'number' && Number.isFinite(it.ts) ? Math.round(it.ts) : Date.now();
        if (!repo.guardarLectura(nodo.id, ts, valores)) return duplicadas++;
        aceptadas++;
        for (const a of evaluar(valores)) {
          if (repo.alertaActiva(nodo.id, a.variable)) continue;
          repo.crearAlerta(nodo.id, a.variable, a.valor, a.nivel, ts);
          alertasNuevas++;
        }
      });
    });
    res.status(rechazadas.length === lote.length ? 422 : 200).json({ aceptadas, duplicadas, rechazadas, alertas_nuevas: alertasNuevas });
  });

  // El router de la app va después del gateway: su clave es distinta de la sesión.
  app.use('/api', api);

  // ---------- pantalla ----------
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) next(); });
  });

  return app;
}
