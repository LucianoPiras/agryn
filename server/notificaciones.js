// Motor de avisos de AGRYN Monitoreo.
//
// Alerta y aviso son cosas distintas: la alerta es el estado de un nodo (se reconoce una vez);
// el aviso es una notificación personal para cada usuario (se lee o se marca como leída).
//
// Reglas:
//   - Una alerta crítica avisa al instante.
//   - Una alerta de atención avisa solo si sigue sin reconocerse después de DEMORA_ATENCION.
//   - Cada alerta genera como máximo un aviso por usuario, y se notifica una sola vez por canal.
//
// Canales: la app siempre recibe el aviso (queda en la base). Los demás canales son objetos
// { nombre, enviar(aviso, usuario) } que devuelven una promesa: correo, Telegram, WhatsApp.
import { VARIABLES } from './umbrales.js';

export const DEMORA_ATENCION = 30 * 60 * 1000;

export function textoDeAlerta(a) {
  const v = VARIABLES.find((x) => x.key === a.variable);
  const nombre = v ? v.nombre : a.variable;
  const unidad = v && v.unidad ? ' ' + v.unidad : '';
  const titulo = (a.nivel === 'crit' ? 'Alerta crítica' : 'Atención') + ' · ' + a.silobolsa + ' · ' + a.nodo;
  const detalle = nombre + ' en ' + String(a.valor).replace('.', ',') + unidad + ', fuera del rango habitual.';
  return { titulo, detalle };
}

export function crearNotificador({ repo, usuarios, canales = [] }) {
  // Revisa las alertas pendientes y crea los avisos. `ahora` se puede pasar para probar la demora.
  function procesar(ahora = Date.now()) {
    const pendientes = repo.alertasPorNotificar(ahora - DEMORA_ATENCION);
    for (const a of pendientes) {
      repo.marcarNotificada(a.id);
      const { titulo, detalle } = textoDeAlerta(a);
      for (const u of usuarios) {
        repo.crearAviso(u.email, a.id, ahora);
        for (const c of canales) {
          // Un canal caído no frena a los demás ni al resto del proceso.
          Promise.resolve()
            .then(() => c.enviar({ titulo, detalle, nivel: a.nivel }, u.email))
            .catch((e) => console.error(`No se pudo avisar por ${c.nombre} a ${u.email}:`, e.message));
        }
      }
    }
    return pendientes.length;
  }
  return { procesar };
}
