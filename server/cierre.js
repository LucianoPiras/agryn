// Cierre automático de las alertas que no se pueden descartar (rotura y fermentación).
// Se llama cada vez que entran lecturas nuevas de un nodo: si el problema se solucionó, la alerta se cierra sola.
import { seCierraSola, patronResuelto } from './patrones.js';

export function cerrarResueltas(repo, nodoIds, ahora = Date.now()) {
  const reglas = repo.umbrales();
  let cerradas = 0;
  for (const nodoId of new Set(nodoIds)) {
    for (const a of repo.alertasActivasDe(nodoId)) {
      if (!seCierraSola(a.variable)) continue;
      if (patronResuelto(a.variable, repo.lecturasEntre(nodoId, a.ts + 1, ahora), reglas)) {
        repo.reconocerAlerta(a.id);
        cerradas++;
      }
    }
  }
  return cerradas;
}
