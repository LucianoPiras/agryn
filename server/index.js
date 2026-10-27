// Arranque del servidor de AGRYN Monitoreo. Toda la configuración viene del entorno.
//
// Variables de entorno:
//   GMAIL_USER          cuenta que envía los correos de ingreso (Agryn.silobolsa@gmail.com)
//   GMAIL_APP_PASSWORD  contraseña de aplicación de esa cuenta (no es la contraseña normal)
//   AGRYN_USUARIOS      lista JSON de usuarios, por ejemplo [{"email":"...","password":"..."}]
//   AGRYN_GATEWAY_KEY   clave que manda el gateway LoRa en el header X-Api-Key
//   AGRYN_CENTRAL_KEY   clave del ESP32 central, para mandar anomalías (otra clave, distinta)
//   AGRYN_DB            archivo SQLite (por defecto data/agryn.db)
//   AGRYN_MAIL=json     modo de prueba: no envía correos y muestra el código en la consola
//   PORT                puerto del servidor (3001 por defecto)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { abrirBase, crearRepo } from './db.js';
import { crearApp } from './app.js';
import { crearNotificador } from './notificaciones.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const REMITENTE = process.env.GMAIL_USER || 'Agryn.silobolsa@gmail.com';

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

const transporte = process.env.AGRYN_MAIL === 'json'
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({ service: 'gmail', auth: { user: REMITENTE, pass: process.env.GMAIL_APP_PASSWORD } });

const ruta = process.env.AGRYN_DB || path.join(here, '..', 'data', 'agryn.db');
const repo = crearRepo(abrirBase(ruta));

// Usuarios del entorno: se cargan a la base la primera vez. Después se administran ahí;
// cambiar AGRYN_USUARIOS no cambia una contraseña que ya está guardada.
for (const u of cargarUsuarios()) repo.crearUsuario(u.email, u.password);

// Canal de correo: además del aviso en la app, cada usuario recibe un mail por alerta.
const correo = {
  nombre: 'correo',
  enviar: ({ titulo, detalle }, para) => transporte.sendMail({
    from: `"AGRYN Monitoreo" <${REMITENTE}>`,
    to: para,
    subject: '[AGRYN] ' + titulo,
    text: detalle + '\n\nRevisá la app para ver el nodo y reconocer la alerta.'
  })
};
const notificador = crearNotificador({ repo, canales: [correo] });
// Revisa cada minuto las alertas de atención que siguen sin reconocerse.
setInterval(() => notificador.procesar(), 60 * 1000);

const app = crearApp({
  repo,
  transporte,
  remitente: REMITENTE,
  gatewayKey: process.env.AGRYN_GATEWAY_KEY || '',
  centralKey: process.env.AGRYN_CENTRAL_KEY || '',
  notificador
});

app.listen(PORT, () => {
  console.log(`AGRYN Monitoreo escuchando en http://localhost:${PORT} (base: ${ruta})`);
  if (!process.env.AGRYN_GATEWAY_KEY) console.warn('Aviso: AGRYN_GATEWAY_KEY no está definida; el gateway LoRa no podrá enviar lecturas.');
});
