// Contraseñas guardadas con scrypt: nunca se guarda el texto original.
import crypto from 'node:crypto';

const LARGO = 64;

export function hashClave(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clave, sal, LARGO).toString('hex');
  return `scrypt$${sal}$${hash}`;
}

export function verificarClave(clave, guardada) {
  const [alg, sal, hash] = String(guardada).split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  const obtenido = crypto.scryptSync(clave, sal, LARGO);
  return esperado.length === obtenido.length && crypto.timingSafeEqual(esperado, obtenido);
}
