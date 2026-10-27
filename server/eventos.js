// Eventos en tiempo real hacia la pantalla abierta (Server-Sent Events).
// El servidor empuja avisos y alertas en cuanto ocurren, sin que la pantalla tenga que preguntar.
import crypto from 'node:crypto';

const TICKET_TTL = 60 * 1000;   // el ticket sirve para abrir una conexión, una sola vez y por un minuto
const PULSO = 25 * 1000;        // comentario cada 25 s para que la conexión no se corte por inactividad

export function crearBus() {
  const porUsuario = new Map(); // correo -> Set de respuestas abiertas
  const tickets = new Map();    // ticket -> { email, vence }

  const escribir = (res, nombre, datos) => {
    res.write(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`);
  };

  const pulso = setInterval(() => {
    for (const set of porUsuario.values()) for (const res of set) res.write(': pulso\n\n');
  }, PULSO);
  pulso.unref();

  return {
    crearTicket(email) {
      const t = crypto.randomBytes(24).toString('hex');
      tickets.set(t, { email, vence: Date.now() + TICKET_TTL });
      return t;
    },
    // Devuelve el correo del ticket y lo quema: no se puede volver a usar.
    usarTicket(t) {
      const r = tickets.get(t);
      tickets.delete(t);
      if (!r || Date.now() > r.vence) return null;
      return r.email;
    },
    conectar(email, res) {
      if (!porUsuario.has(email)) porUsuario.set(email, new Set());
      porUsuario.get(email).add(res);
      res.on('close', () => {
        const set = porUsuario.get(email);
        if (set) { set.delete(res); if (!set.size) porUsuario.delete(email); }
      });
    },
    // Evento para un usuario (por ejemplo, un aviso nuevo).
    emitirA(email, nombre, datos) {
      for (const res of porUsuario.get(email) || []) escribir(res, nombre, datos);
    },
    // Evento para todos los usuarios conectados (alertas, lecturas nuevas).
    emitirATodos(nombre, datos) {
      for (const set of porUsuario.values()) for (const res of set) escribir(res, nombre, datos);
    },
    cerrar() { clearInterval(pulso); }
  };
}
