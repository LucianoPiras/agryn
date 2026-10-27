// Genera el par de claves VAPID para las notificaciones push de AGRYN.
// Correlo una sola vez en tu computadora y cargá los valores en Render (o en tu .env).
// La clave privada es secreta: no la subas al repo ni la compartas en un chat.
//
// Uso: node tools/generar-claves-push.js
import { generarClavesVapid } from '../server/push.js';

const { publicKey, privateKey } = generarClavesVapid();
console.log('AGRYN_VAPID_PUBLIC=' + publicKey);
console.log('AGRYN_VAPID_PRIVATE=' + privateKey);
