// Une el build de la demostración en un solo HTML: JavaScript, CSS y logos van adentro del archivo.
// Uso: npm run build:demo && node scripts/armar-demo.mjs ruta/del/salida.html
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve('dist-demo');
const salida = process.argv[2] || path.resolve('agryn-demo.html');
let html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const logos = ['agryn-hoja.png', 'agryn-hoja-reversa.png', 'agryn-logo.png'];
const uri = (f) => 'data:image/png;base64,' + fs.readFileSync(path.resolve('public/logos', f)).toString('base64');

html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_, ruta) => {
  let js = fs.readFileSync(path.join(raiz, ruta), 'utf8');
  for (const f of logos) js = js.split('/logos/' + f).join(uri(f));
  return `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, ruta) => `<style>${fs.readFileSync(path.join(raiz, ruta), 'utf8')}</style>`);
html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="${uri('agryn-hoja.png')}" />`);

// Datos en vivo de las cápsulas (app de Apps Script): va después de la demo, sin compilar.
const envivo = fs.readFileSync(path.resolve('demo/envivo.js'), 'utf8');
html = html.replace('</body>', `<script type="module">${envivo.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);

fs.writeFileSync(salida, html, 'utf8');
console.log('escrito', salida, (html.length / 1024).toFixed(0), 'KB');
