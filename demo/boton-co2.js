// Agrega el botón «Liberar CO₂» junto a «Reconocer» en los carteles de alarma de la demostración.
// Va por fuera del componente: la app real no tiene esta acción.
import { liberarCO2 } from './api-local.js';

const ESTILO = 'min-height:44px;padding:8px 14px;border-radius:10px;border:2px solid #FAF6E9;background:transparent;color:#FAF6E9;font:600 14px Inter,system-ui,sans-serif;cursor:pointer;margin-right:8px';

function montarBoton(reconocer) {
  const contenedor = reconocer.parentElement;
  if (!contenedor || contenedor.querySelector('[data-liberar-co2]')) return;
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.dataset.liberarCo2 = '1';
  boton.textContent = 'Liberar CO₂';
  boton.setAttribute('style', ESTILO);
  boton.onclick = () => {
    const r = liberarCO2();
    if (window.__agrynAviso) {
      window.__agrynAviso(r.ok ? 'CO₂ liberado' : 'Sin alarma para liberar', r.ok ? `${r.silo} · ${r.nodo}: el CO₂ volvió al rango normal.` : r.mensaje);
    }
  };
  contenedor.insertBefore(boton, reconocer);
}

export function activarBotonCO2() {
  const buscar = () => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Reconocer') montarBoton(b);
    }
  };
  buscar();
  new MutationObserver(buscar).observe(document.body, { childList: true, subtree: true });
}
