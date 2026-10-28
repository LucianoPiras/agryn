// Cartel de la alarma en la demostración: debajo de la alarma muestra «Liberando CO₂» mientras la
// central libera el gas, y el botón de reconocer se llama «Descartar». Va por fuera del componente,
// así que la app real no cambia.
import { liberandoCO2 } from './api-local.js';

const ETIQUETA = 'Liberando CO₂';

// Busca el cartel de cada alarma crítica: el bloque que contiene el rótulo «ALERTA CRÍTICA» y el botón «Reconocer».
function carteles() {
  const encontrados = [];
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent.trim() !== 'Reconocer') continue;
    let bloque = b.parentElement;
    for (let i = 0; i < 6 && bloque && !bloque.innerText.toUpperCase().includes('ALERTA CRÍTICA'); i++) bloque = bloque.parentElement;
    if (bloque) encontrados.push({ boton: b, bloque });
  }
  return encontrados;
}

function actualizar() {
  for (const { boton, bloque } of carteles()) {
    if (boton.textContent !== 'Descartar') boton.textContent = 'Descartar';
    // La columna de texto es el padre del rótulo «ALERTA CRÍTICA».
    const rotulo = [...bloque.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim().toUpperCase() === 'ALERTA CRÍTICA');
    const columna = rotulo ? rotulo.parentElement : bloque;
    let linea = columna.querySelector('[data-liberando-co2]');
    if (!linea) {
      linea = document.createElement('p');
      linea.dataset.liberandoCo2 = '1';
      linea.setAttribute('role', 'status');
      linea.setAttribute('style', 'margin:6px 0 0;font:700 15px Inter,system-ui,sans-serif;color:#FAF6E9');
      linea.textContent = ETIQUETA;
      columna.appendChild(linea);
    }
    linea.style.display = liberandoCO2() ? '' : 'none';
  }
}

export function activarCartelLiberacion() {
  actualizar();
  new MutationObserver(actualizar).observe(document.body, { childList: true, subtree: true });
  setInterval(actualizar, 1000);
}
