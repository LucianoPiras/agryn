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
      // Va justo debajo del título de la alarma y es lo primero que se lee después de él.
      linea.setAttribute('style', 'display:inline-block;align-self:flex-start;margin:10px 0 4px;padding:8px 16px;border:3px solid #FAF6E9;border-radius:12px;background:#FAF6E9;color:#B02A18;font:800 22px/1.1 Inter,system-ui,sans-serif;letter-spacing:0.01em;box-shadow:0 0 0 4px rgba(250,246,233,0.25)');
      linea.append(ETIQUETA + ' ');
      const puntos = document.createElement('span');
      puntos.className = 'puntos';
      puntos.setAttribute('aria-hidden', 'true');
      for (let k = 0; k < 3; k++) { const punto = document.createElement('span'); punto.className = 'punto'; punto.textContent = '.'; puntos.appendChild(punto); }
      linea.appendChild(puntos);
      const titulo = [...columna.children].find((h) => h !== rotulo && h.textContent.includes(' · '));
      if (titulo) titulo.insertAdjacentElement('afterend', linea);
      else columna.appendChild(linea);
    }
    linea.style.display = liberandoCO2() ? '' : 'none';
  }
}

// Secuencia de los tres puntos: se apaga el primero, luego el segundo, luego el tercero,
// y cada vez que se apaga uno vuelve a encenderse el anterior.
const SECUENCIA = [[1, 1, 1], [0, 1, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 1, 0]];
let paso = 0;
function moverPuntos() {
  paso = (paso + 1) % SECUENCIA.length;
  document.querySelectorAll('[data-liberando-co2] .puntos').forEach((grupo) => {
    grupo.querySelectorAll('.punto').forEach((punto, k) => { punto.style.opacity = SECUENCIA[paso][k] ? '1' : '0.15'; });
  });
}

export function activarCartelLiberacion() {
  actualizar();
  new MutationObserver(actualizar).observe(document.body, { childList: true, subtree: true });
  setInterval(actualizar, 1000);
  setInterval(moverPuntos, 450);
}
