// Notificaciones push de AGRYN Monitoreo: llegan al celular aunque la app esté cerrada.
//
// Cada usuario puede tener varios dispositivos suscriptos. Si un dispositivo ya no es válido
// (el navegador revocó el permiso o desinstalaron la app), su suscripción se borra.
import webpush from 'web-push';

export function generarClavesVapid() {
  return webpush.generateVAPIDKeys();
}

// Canal de avisos: el mismo contrato que el correo, { nombre, enviar(aviso, usuario) }.
// `enviar` se puede cambiar para probar sin salir a internet.
export function crearCanalPush({ repo, publica, privada, contacto, enviar }) {
  const mandar = enviar || ((suscripcion, carga) => webpush.sendNotification(suscripcion, carga, { TTL: 60 * 60, urgency: 'high' }));
  if (publica && privada) webpush.setVapidDetails(contacto, publica, privada);

  return {
    nombre: 'push',
    async enviar(aviso, usuario) {
      const carga = JSON.stringify({ titulo: aviso.titulo, detalle: aviso.detalle, nivel: aviso.nivel, url: '/' });
      const envios = repo.suscripcionesDe(usuario).map((s) =>
        mandar({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga).catch((e) => {
          // 404 o 410: el dispositivo dejó de existir para el navegador; la suscripción ya no sirve.
          if (e.statusCode === 404 || e.statusCode === 410) repo.quitarSuscripcion(s.endpoint, usuario);
          else console.error(`No se pudo mandar push a ${usuario}:`, e.statusCode || e.message);
        })
      );
      await Promise.all(envios);
    }
  };
}
