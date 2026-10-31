// Datos EN VIVO para la demostración publicada en GitHub Pages.
//
// La demo corre sola en el navegador con datos simulados (demo/api-local.js). Este módulo le suma
// una silobolsa más, «Cápsulas AGRYN (en vivo)», con los datos reales de las cápsulas del Heltec:
// la central los sube a la app de Apps Script y acá se leen cada 30 s desde ?api=datos.
//
// No necesita compilarse: scripts/armar-demo.mjs lo agrega al final del HTML, después de la demo,
// y envuelve fetch y EventSource para responder las rutas de la silobolsa en vivo.
// Para probar otra URL sin tocar el código: agregá ?fuente=<url de Apps Script> a la dirección.

const FUENTE_PREDETERMINADA = 'https://script.google.com/macros/s/AKfycbzMfk8j1Q4qsvsCr0kwvBb2uk2Crt7xV_5lg_UmU8Hx4fcw5hS_rzTzD_UEsaap8Y1i/exec';
const CADA = 30 * 1000;
const CLAVE = 'agryn-envivo-v1';
const SILO_ID = 900;                 // ids altos para no chocar con los de la demo
const BASE_NODO = 9000;              // nodo de la cápsula N = 9000 + N
const BASE_ALERTA = 90000;
const MIN = 60 * 1000, DIA = 24 * 60 * MIN;
const RANGOS = { '24h': { n: 48, paso: 30 * MIN }, '7d': { n: 84, paso: 120 * MIN }, '30d': { n: 90, paso: 480 * MIN } };
const VARS = ['ph', 'temp', 'hum', 'co2'];

function urlFuente() {
  try { const q = new URLSearchParams(window.location.search).get('fuente'); if (q) return q; } catch (e) { /* nada */ }
  return FUENTE_PREDETERMINADA;
}

// ---------- almacenamiento (solo en este navegador) ----------
let est = cargar();
function cargar() {
  try { const r = window.localStorage.getItem(CLAVE); if (r) return JSON.parse(r); } catch (e) { /* nada */ }
  return { capsulas: {}, alertas: [], silenciada: false, ultimaOk: 0 };
}
function guardar() { try { window.localStorage.setItem(CLAVE, JSON.stringify(est)); } catch (e) { /* queda en memoria */ } }

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const idsCapsulas = () => Object.keys(est.capsulas).map(Number).sort((a, b) => a - b);
const hayEnVivo = () => idsCapsulas().length > 0;

// ---------- lectura de la app de Apps Script ----------
let fetchDemo = null;   // fetch de la demo (para /api/ simuladas)
let fetchRed = null;    // fetch real del navegador (para internet)

async function sincronizar() {
  const url = urlFuente();
  const r = await fetchRed(url + (url.includes('?') ? '&' : '?') + 'api=datos', { cache: 'no-store' });
  if (!r.ok) throw new Error('la app de las cápsulas respondió ' + r.status);
  const datos = await r.json();
  let nuevas = 0, alertasNuevas = 0;
  for (const cap of datos.capsulas || []) {
    const c = est.capsulas[cap.id] || (est.capsulas[cap.id] = { lecturas: [] });
    c.ultima = { fecha: cap.fecha, online: !!cap.online, alerta: !!cap.alerta, valvula: Number(cap.valvula) || 0, gas: num(cap.gas), lat: num(cap.lat), lon: num(cap.lon) };
    const conocidas = new Set(c.lecturas.map((l) => l.ts));
    const entrantes = [...(cap.hist || []).map((h) => ({ ts: h.t, ph: num(h.ph), temp: num(h.temp), hum: num(h.hum), co2: num(h.gas) })),
      { ts: cap.fecha, ph: num(cap.ph), temp: num(cap.temp), hum: num(cap.hum), co2: num(cap.gas) }];
    for (const l of entrantes) {
      if (typeof l.ts !== 'number' || conocidas.has(l.ts)) continue;
      c.lecturas.push(l); conocidas.add(l.ts); nuevas++;
    }
    c.lecturas.sort((a, b) => a.ts - b.ts);
    const limite = Date.now() - 31 * DIA;
    c.lecturas = c.lecturas.filter((l) => l.ts >= limite);

    // Alerta de aire: una por episodio, hasta que la reconozcas.
    const nodoId = BASE_NODO + Number(cap.id);
    if (cap.alerta && cap.online && !est.alertas.some((a) => a.nodo_id === nodoId && !a.reconocida)) {
      const ahora = Date.now();
      const valvula = Number(cap.valvula) >= 1;
      est.alertas.push({
        id: BASE_ALERTA + est.alertas.length + 1, nodo_id: nodoId, variable: 'rotura', valor: num(cap.gas) ?? 0, nivel: 'crit',
        ts: cap.fecha || ahora, reconocida: 0, creada: ahora, notificada: 1, leido: 0,
        diagnostico: 'Alerta de aire: la cápsula ' + cap.id + ' detectó un aumento brusco de gases dentro de la bolsa.' +
          (valvula ? ' La válvula de CO₂ se abrió 3 segundos.' : '')
      });
      alertasNuevas++;
      if (window.__agrynAviso) window.__agrynAviso('Alerta de aire · Cápsula ' + cap.id, valvula ? 'Válvula abierta: se inyectó CO₂.' : 'Revisá la silobolsa.');
    }
  }
  est.ultimaOk = Date.now();
  guardar();
  if (nuevas) emitir('datos');
  if (alertasNuevas) { emitir('alerta'); emitir('aviso'); }
}

// ---------- serie para los gráficos (igual que server/serie.js) ----------
function rellenar(vals) {
  const out = vals.slice();
  let u = null;
  for (let i = 0; i < out.length; i++) { if (out[i] == null) out[i] = u; else u = out[i]; }
  let s = null;
  for (let i = out.length - 1; i >= 0; i--) { if (out[i] == null) out[i] = s; else s = out[i]; }
  return out;
}
function serie(lecturas, rango, ahora = Date.now()) {
  const { n, paso } = RANGOS[rango];
  const inicio = ahora - n * paso;
  const suma = Array.from({ length: n }, () => ({}));
  for (const l of lecturas) {
    const i = Math.floor((l.ts - inicio) / paso);
    if (i < 0 || i >= n || l.ts > ahora) continue;
    for (const k of VARS) {
      if (l[k] == null) continue;
      const c = suma[i][k] || (suma[i][k] = { s: 0, c: 0 });
      c.s += l[k]; c.c += 1;
    }
  }
  const valores = {};
  for (const k of VARS) {
    const crudos = suma.map((c) => (c[k] ? c[k].s / c[k].c : null));
    valores[k] = crudos.every((x) => x == null) ? crudos : rellenar(crudos);
  }
  return { rango, n, paso, desde: inicio, hasta: ahora, valores };
}

// ---------- respuestas para la silobolsa en vivo ----------
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const lecturasDe = (nodoId) => (est.capsulas[nodoId - BASE_NODO] || { lecturas: [] }).lecturas;
const esNodoVivo = (id) => id > BASE_NODO && est.capsulas[id - BASE_NODO];

function siloVivo() {
  return {
    id: SILO_ID, nombre: 'Cápsulas AGRYN (en vivo)', contenido: 'Soja', creada: 0,
    nodos: idsCapsulas().map((cid) => {
      const l = est.capsulas[cid].lecturas;
      return { id: BASE_NODO + cid, silobolsa_id: SILO_ID, nombre: 'Cápsula ' + cid, device_id: 'cap-' + cid, ultima_ts: l.length ? l[l.length - 1].ts : null };
    })
  };
}
function alertaVista(a) {
  return { ...a, nodo: 'Cápsula ' + (a.nodo_id - BASE_NODO), silobolsa: 'Cápsulas AGRYN (en vivo)', silobolsa_id: SILO_ID, etiqueta: 'Alerta de aire', descripcion: a.diagnostico };
}
function avisoVista(a) {
  return { id: a.id, leido: a.leido, creada: a.creada, alerta_id: a.id, variable: a.variable, valor: a.valor, nivel: a.nivel, ts: a.ts,
    nodo_id: a.nodo_id, nodo: 'Cápsula ' + (a.nodo_id - BASE_NODO), silobolsa_id: SILO_ID, silobolsa: 'Cápsulas AGRYN (en vivo)', etiqueta: 'Alerta de aire', descripcion: a.diagnostico };
}

async function responder(url, metodo, opciones) {
  const p = url.split('?')[0].replace(/\/$/, '');
  let m;
  // Silobolsas: la en vivo va primera, así es la que se ve al entrar.
  if (p === '/api/silobolsas' && metodo === 'GET') {
    const r = await fetchDemo(url, opciones);
    const lista = await r.json();
    return json(hayEnVivo() ? [siloVivo(), ...lista] : lista);
  }
  if ((m = p.match(/^\/api\/silobolsas\/(\d+)(\/nodos)?$/)) && Number(m[1]) === SILO_ID) {
    if (metodo === 'GET') return json(siloVivo());
    return json({ error: 'La silobolsa en vivo muestra las cápsulas reales: no se puede editar ni borrar desde la demo.' }, 403);
  }
  if ((m = p.match(/^\/api\/nodos\/(\d+)(\/(serie|ultima|lecturas))?$/)) && esNodoVivo(Number(m[1]))) {
    const id = Number(m[1]);
    const l = lecturasDe(id);
    if (!m[3]) return json({ error: 'Las cápsulas en vivo no se pueden borrar desde la demo.' }, 403);
    if (m[3] === 'ultima') return json(l.length ? l[l.length - 1] : null);
    if (m[3] === 'lecturas') return json(l.slice(-500).reverse());
    const rango = new URL(url, 'http://demo').searchParams.get('rango') || '24h';
    if (!RANGOS[rango]) return json({ error: 'Rango inválido. Usá 24h, 7d o 30d.' }, 400);
    const ahora = Date.now();
    const desde = ahora - RANGOS[rango].n * RANGOS[rango].paso;
    return json(serie(l.filter((x) => x.ts >= desde), rango, ahora));
  }
  // Alertas y avisos: se suman las de las cápsulas a las de la demo.
  if (p === '/api/alertas' && metodo === 'GET') {
    const reconocidas = new URL(url, 'http://demo').searchParams.get('reconocidas') === '1';
    const lista = await (await fetchDemo(url, opciones)).json();
    const vivas = est.alertas.filter((a) => !!a.reconocida === reconocidas).map(alertaVista);
    return json([...vivas, ...lista].sort((a, b) => b.ts - a.ts));
  }
  if ((m = p.match(/^\/api\/alertas\/(\d+)\/reconocer$/)) && Number(m[1]) > BASE_ALERTA) {
    const a = est.alertas.find((x) => x.id === Number(m[1]));
    if (!a) return json({ error: 'Alerta no encontrada.' }, 404);
    a.reconocida = 1; a.leido = 1; guardar();
    return json({ ok: true });
  }
  if (p === '/api/avisos' && metodo === 'GET') {
    const d = await (await fetchDemo(url, opciones)).json();
    const mios = est.silenciada ? [] : est.alertas.map(avisoVista);
    const pref = hayEnVivo() ? [{ silobolsa_id: SILO_ID, nombre: 'Cápsulas AGRYN (en vivo)', recibe: !est.silenciada }] : [];
    return json({
      avisos: [...mios, ...(d.avisos || [])].sort((x, y) => y.creada - x.creada).slice(0, 100),
      no_leidos: (d.no_leidos || 0) + mios.filter((x) => !x.leido).length,
      preferencias: [...pref, ...(d.preferencias || [])]
    });
  }
  if ((m = p.match(/^\/api\/avisos\/(\d+)\/leer$/)) && Number(m[1]) > BASE_ALERTA) {
    const a = est.alertas.find((x) => x.id === Number(m[1]));
    if (a) { a.leido = 1; guardar(); }
    return json({ ok: true });
  }
  if (p === '/api/avisos/leer-todos') { est.alertas.forEach((a) => { a.leido = 1; }); guardar(); return fetchDemo(url, opciones); }
  if ((m = p.match(/^\/api\/avisos\/preferencias\/(\d+)$/)) && Number(m[1]) === SILO_ID) {
    let cuerpo = {};
    try { cuerpo = JSON.parse(opciones.body || '{}'); } catch (e) { /* nada */ }
    est.silenciada = cuerpo.recibe === false; guardar();
    const d = await (await fetchDemo('/api/avisos', { method: 'GET' })).json();
    return json({ preferencias: [{ silobolsa_id: SILO_ID, nombre: 'Cápsulas AGRYN (en vivo)', recibe: !est.silenciada }, ...(d.preferencias || [])] });
  }
  return fetchDemo(url, opciones);
}

// ---------- eventos en vivo: se suman a los de la demo ----------
const conexiones = [];
function emitir(nombre) {
  for (const c of conexiones) for (const fn of (c.listeners && c.listeners[nombre]) || []) fn({ data: '{}' });
}

// ---------- instalación ----------
// Se ejecuta después de la demo (que ya reemplazó fetch y EventSource) y antes de que la app pida datos.
(function instalar() {
  fetchDemo = window.fetch.bind(window);
  fetchRed = (window.__agrynFetchRed || fetchDemo);   // la demo deja pasar a internet lo que no es /api/
  window.fetch = (entrada, opciones = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    if (!url.startsWith('/api/')) return fetchDemo(entrada, opciones);
    return responder(url, (opciones.method || 'GET').toUpperCase(), opciones);
  };
  const ESDemo = window.EventSource;
  window.EventSource = class extends ESDemo {
    constructor(...a) { super(...a); conexiones.push(this); }
    close() { const i = conexiones.indexOf(this); if (i >= 0) conexiones.splice(i, 1); if (super.close) super.close(); }
  };
  const ciclo = () => sincronizar().catch((e) => console.warn('Cápsulas en vivo:', e.message));
  ciclo();
  setInterval(ciclo, CADA);
})();
