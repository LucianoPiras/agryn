// Vigilancia de los nodos: si una silobolsa deja de mandar datos, hay que enterarse enseguida.
export const SIN_DATOS_MS = 3 * 60 * 1000;

// Un nodo que ya reportó y lleva más de SIN_DATOS_MS sin mandar nada genera una alerta crítica.
// Se llama cada pocos segundos desde el servidor.
export function verificarSinDatos(repo, bus, notificador, ahora = Date.now()) {
  let nuevas = 0;
  for (const nodo of repo.nodos()) {
    const ultima = repo.ultimaLectura(nodo.id);
    if (!ultima || ahora - ultima.ts <= SIN_DATOS_MS) continue;
    if (repo.alertaActiva(nodo.id, 'sin_datos')) continue;
    repo.crearAlerta(nodo.id, 'sin_datos', 0, 'crit', ultima.ts);
    nuevas++;
  }
  if (nuevas) {
    bus.emitirATodos('alerta', { nuevas });
    notificador.procesar(ahora);
  }
  return nuevas;
}
