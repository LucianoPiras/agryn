// Servidor de AGRYN Monitoreo: valida el ingreso, envía el código de confirmación por correo
// y maneja la sesión. Las credenciales nunca viajan al navegador.
//
// Variables de entorno:
//   GMAIL_USER          cuenta que envía los correos (Agryn.silobolsa@gmail.com)
//   GMAIL_APP_PASSWORD  contraseña de aplicación de esa cuenta (no es la contraseña normal)
//   AGRYN_USUARIOS      lista JSON de usuarios, por ejemplo [{"email":"...","password":"..."}]
//   PORT                puerto del servidor (3001 por defecto)
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import nodemailer from 'nodemailer';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const REMITENTE = process.env.GMAIL_USER || 'Agryn.silobolsa@gmail.com';
const CODE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_INTENTOS = 3;

// Usuarios autorizados. Sin AGRYN_USUARIOS no hay nadie que pueda entrar.
function cargarUsuarios() {
  try {
    const lista = JSON.parse(process.env.AGRYN_USUARIOS || '[]');
    return lista.filter((u) => u && typeof u.email === 'string' && typeof u.password === 'string')
      .map((u) => ({ email: u.email.trim().toLowerCase(), password: u.password }));
  } catch (e) {
    console.error('AGRYN_USUARIOS no es un JSON válido');
    return [];
  }
}
const USUARIOS = cargarUsuarios();

// Transporte de correo. AGRYN_MAIL=json solo sirve para pruebas locales: no envía nada.
const transporte = process.env.AGRYN_MAIL === 'json'
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
    service: 'gmail',
    auth: { user: REMITENTE, pass: process.env.GMAIL_APP_PASSWORD }
  });

const pendientes = new Map(); // correo -> { codigo, vence, intentos }
const sesiones = new Map();   // token -> { email, vence }

function nuevoCodigo() { return String(crypto.randomInt(100000, 1000000)); }

async function enviarCodigo(email, codigo) {
  // Solo en modo de prueba (AGRYN_MAIL=json): no se envía nada, así que el código se muestra en el log.
  if (process.env.AGRYN_MAIL === 'json') console.log('[prueba] código para ' + email + ': ' + codigo);
  await transporte.sendMail({
    from: `"AGRYN Monitoreo" <${REMITENTE}>`,
    to: email,
    subject: `${codigo} es tu código de confirmación`,
    text: `Tu código de confirmación de AGRYN Monitoreo es ${codigo}. Vence en 5 minutos.\n\nSi no intentaste ingresar, ignorá este mensaje.`,
    html: `<div style="font-family:Montserrat,Arial,sans-serif;color:#0F2A1F;background:#FAF6E9;padding:24px">
      <h2 style="font-family:Inter,Arial,sans-serif;color:#005A36;margin:0 0 12px">Confirmá tu identidad</h2>
      <p>Tu código de confirmación de AGRYN Monitoreo es:</p>
      <p style="font:700 28px/1.2 Inter,Arial,sans-serif;letter-spacing:0.25em;color:#005A36">${codigo}</p>
      <p>Vence en 5 minutos. Si no intentaste ingresar, ignorá este mensaje.</p>
    </div>`
  });
}

async function generarYEnviar(email) {
  const codigo = nuevoCodigo();
  await enviarCodigo(email, codigo);
  pendientes.set(email, { codigo, vence: Date.now() + CODE_TTL, intentos: 0 });
}

const app = express();
app.use(express.json());

// Paso 1: correo y contraseña. Si son correctos, se envía el código.
app.post('/api/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const usuario = USUARIOS.find((u) => u.email === email && u.password === password);
  if (!usuario) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  try {
    await generarYEnviar(email);
    res.json({ ok: true, destino: email });
  } catch (e) {
    console.error('No se pudo enviar el código:', e.message);
    res.status(502).json({ error: 'No pudimos enviar el código. Probá de nuevo en unos minutos.' });
  }
});

// Reenvío: genera un código nuevo solo si hay un ingreso en curso.
app.post('/api/codigo/reenviar', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!pendientes.has(email)) return res.status(400).json({ error: 'Volvé a ingresar tus datos.', volverLogin: true });
  try {
    await generarYEnviar(email);
    res.json({ ok: true, destino: email });
  } catch (e) {
    console.error('No se pudo reenviar el código:', e.message);
    res.status(502).json({ error: 'No pudimos enviar el código. Probá de nuevo en unos minutos.' });
  }
});

// Paso 2: confirmar el código. Al entrar, se crea una sesión con token.
app.post('/api/verify', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
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

// En producción el mismo servidor entrega la app compilada.
const dist = path.join(here, '..', 'dist');
app.use(express.static(dist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) next(); });
});

app.listen(PORT, () => {
  console.log(`AGRYN Monitoreo escuchando en http://localhost:${PORT}`);
  if (!USUARIOS.length) console.warn('Aviso: AGRYN_USUARIOS está vacío, nadie puede ingresar.');
});
