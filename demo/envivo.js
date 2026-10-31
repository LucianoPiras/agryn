// Datos EN VIVO para la demostración publicada en GitHub Pages.
//
// La demo corre sola en el navegador con datos simulados (demo/api-local.js). Este módulo le suma
// una silobolsa más, «Cápsulas AGRYN (en vivo)», con los datos reales de las cápsulas del Heltec:
// la central los sube a la app de Apps Script y acá se leen cada 15 s desde ?api=datos.
// El estado «sin señal» usa la misma regla que la app del celular y avanza solo con el reloj.
//
// No necesita compilarse: scripts/armar-demo.mjs lo agrega al final del HTML, después de la demo,
// y envuelve fetch y EventSource para responder las rutas de la silobolsa en vivo.
// Para probar otra URL sin tocar el código: agregá ?fuente=<url de Apps Script> a la dirección.

const FUENTE_PREDETERMINADA = 'https://script.google.com/macros/s/AKfycbzMfk8j1Q4qsvsCr0kwvBb2uk2Crt7xV_5lg_UmU8Hx4fcw5hS_rzTzD_UEsaap8Y1i/exec';
const CADA = 15 * 1000;
const LIMITE_PREDETERMINADO = 150;   // s sin datos para «sin señal» (si la app no manda el suyo)
const CLAVE = 'agryn-envivo-v1';
const SILO_ID = 900;                 // ids altos para no chocar con los de la demo
const BASE_NODO = 9000;              // nodo de la cápsula N = 9000 + N
const BASE_ALERTA = 90000;
const MIN = 60 * 1000, DIA = 24 * 60 * MIN;
const RANGOS = { '24h': { n: 48, paso: 30 * MIN }, '7d': { n: 84, paso: 120 * MIN }, '30d': { n: 90, paso: 480 * MIN } };
const VARS = ['ph', 'temp', 'hum', 'co2'];

// pH: el que manda la central es simulado y no es real, así que NO se copia. Se simula acá,
// oscilando suave alrededor del objetivo (7,0), entre 6,67 y 7,33: siempre dentro del rango habitual (6 a 8).
// Depende solo de la hora de la lectura: la misma lectura da siempre el mismo valor.
// Es la misma fórmula que server/fuente.js (phSimulado); si cambia una, cambiá la otra.
const PH_OBJETIVO = 7;
function phSimulado(ts) {
  const x = PH_OBJETIVO + 0.25 * Math.sin((ts / (180 * MIN)) * Math.PI * 2) + 0.08 * Math.sin(ts / (11 * MIN));
  return Number(x.toFixed(2));
}

function urlFuente() {
  try { const q = new URLSearchParams(window.location.search).get('fuente'); if (q) return q; } catch (e) { /* nada */ }
  return FUENTE_PREDETERMINADA;
}

// ---------- almacenamiento (solo en este navegador) ----------
let est = cargar();
function cargar() {
  try {
    const r = window.localStorage.getItem(CLAVE);
    if (r) {
      const e = JSON.parse(r);
      // Las lecturas guardadas antes tenían el pH de la central: se reemplaza por el simulado.
      for (const c of Object.values(e.capsulas || {})) for (const l of c.lecturas || []) l.ph = phSimulado(l.ts);
      return e;
    }
  } catch (e) { /* nada */ }
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
  let nuevas = 0, alertasNuevas = 0, alertasCerradas = 0;
  const reglas = await umbralesVigentes();
  for (const cap of datos.capsulas || []) {
    const c = est.capsulas[cap.id] || (est.capsulas[cap.id] = { lecturas: [] });
    c.ultima = { fecha: cap.fecha, online: !!cap.online, motivo: cap.motivo || '', hace: num(cap.hace) ?? 0, recibido: Date.now(),
      limite: num(datos.limiteCapsula) ?? LIMITE_PREDETERMINADO,
      alerta: !!cap.alerta, valvula: Number(cap.valvula) || 0, gas: num(cap.gas), lat: num(cap.lat), lon: num(cap.lon),
      ph: phSimulado(cap.fecha), temp: num(cap.temp), hum: num(cap.hum) };
    const conocidas = new Set(c.lecturas.map((l) => l.ts));
    const entrantes = [...(cap.hist || []).map((h) => ({ ts: h.t, ph: phSimulado(h.t), temp: num(h.temp), hum: num(h.hum), co2: num(h.gas) })),
      { ts: cap.fecha, ph: phSimulado(cap.fecha), temp: num(cap.temp), hum: num(cap.hum), co2: num(cap.gas) }];
    for (const l of entrantes) {
      if (typeof l.ts !== 'number' || conocidas.has(l.ts)) continue;
      c.lecturas.push(l); conocidas.add(l.ts); nuevas++;
    }
    c.lecturas.sort((a, b) => a.ts - b.ts);
    const limite = Date.now() - 31 * DIA;
    c.lecturas = c.lecturas.filter((l) => l.ts >= limite);

    // Alerta de aire: una por episodio. No se puede descartar: se cierra sola cuando la cápsula,
    // en línea, deja de marcar la alerta (el problema se solucionó).
    const nodoId = BASE_NODO + Number(cap.id);
    if (cap.alerta && enLinea(c) && !est.alertas.some((a) => a.nodo_id === nodoId && a.variable === 'rotura' && !a.reconocida)) {
      const ahora = Date.now();
      const valvula = Number(cap.valvula) >= 1;
      est.alertas.push({
        id: nuevoIdAlerta(), nodo_id: nodoId, variable: 'rotura', etiqueta: 'Alerta de aire', valor: num(cap.gas) ?? 0, nivel: 'crit',
        ts: cap.fecha || ahora, reconocida: 0, creada: ahora, notificada: 1, leido: 0,
        diagnostico: 'Alerta de aire: la cápsula ' + cap.id + ' detectó un aumento brusco de gases dentro de la bolsa.' +
          (valvula ? ' La válvula de CO₂ se abrió 3 segundos.' : '')
      });
      alertasNuevas++;
      if (window.__agrynAviso) window.__agrynAviso('Alerta de aire · Cápsula ' + cap.id, valvula ? 'Válvula abierta: se inyectó CO₂.' : 'Revisá la silobolsa.');
    }
    // La alerta de aire de la cápsula se cierra sola cuando la cápsula, en línea, deja de marcarla.
    if (!cap.alerta && enLinea(c)) {
      for (const a of est.alertas) if (a.nodo_id === nodoId && a.origen !== 'valores' && a.variable === 'rotura' && !a.reconocida) { a.reconocida = 1; alertasCerradas++; }
    }
    // Alertas por los valores: rotura, fermentación y cada variable fuera de su rango.
    if (enLinea(c) && reglas.length) {
      const r = revisarValores(Number(cap.id), c, reglas);
      alertasNuevas += r.nuevas; alertasCerradas += r.cerradas;
    }
  }
  est.ultimaOk = Date.now();
  guardar();
  if (nuevas) emitir('datos');
  if (alertasNuevas) { emitir('alerta'); emitir('aviso'); }
  else if (alertasCerradas) emitir('alerta');
  revisarSenal();
}

// ---------- señal: «en línea» o «sin señal», igual que la app del celular ----------
// En línea solo si la app de Apps Script la marcó en línea Y desde ese dato no pasó el límite.
// Como se recalcula con el reloj, pasa sola a «sin señal» aunque no llegue nada nuevo
// (por ejemplo, si se corta internet o la app de Apps Script no responde).
function segundosSinDatos(c) {
  const u = c.ultima;
  if (!u) return Infinity;
  return u.hace + Math.max(0, (Date.now() - u.recibido) / 1000);
}
function enLinea(c) { return !!(c.ultima && c.ultima.online && segundosSinDatos(c) < c.ultima.limite); }
function nuevoIdAlerta() { return BASE_ALERTA + 1 + est.alertas.reduce((m, a) => Math.max(m, a.id - BASE_ALERTA), 0); }
function haceTexto(seg) {
  if (seg < 60) return Math.round(seg) + ' s';
  if (seg < 3600) return Math.floor(seg / 60) + ' min';
  if (seg < 86400) return Math.floor(seg / 3600) + ' h';
  return Math.floor(seg / 86400) + ' d';
}

// Crea un aviso «Sin señal» cuando una cápsula deja de reportar y lo cierra solo cuando vuelve.
function revisarSenal() {
  let cambio = false;
  for (const cid of idsCapsulas()) {
    const c = est.capsulas[cid], nodoId = BASE_NODO + cid;
    const abierta = est.alertas.find((a) => a.nodo_id === nodoId && a.variable === 'sin_datos' && !a.reconocida);
    const vivo = enLinea(c);
    if (c.enLinea !== vivo) { c.enLinea = vivo; cambio = true; }
    if (!vivo && !abierta && c.ultima) {
      const ahora = Date.now(), motivo = c.ultima.motivo || 'no llegan datos nuevos';
      est.alertas.push({
        id: nuevoIdAlerta(), nodo_id: nodoId, variable: 'sin_datos', etiqueta: 'Sin señal', valor: 0, nivel: 'warn',   // advertencia: no se libera CO₂
        ts: ahora, reconocida: 0, creada: ahora, notificada: 1, leido: 0,
        diagnostico: 'Sin señal: ' + motivo + '. Último dato hace ' + haceTexto(segundosSinDatos(c)) + '; los valores que ves son los últimos recibidos.'
      });
      if (window.__agrynAviso) window.__agrynAviso('Sin señal · Cápsula ' + cid, 'La cápsula dejó de mandar datos.');
      cambio = true;
    } else if (vivo && abierta) {
      abierta.reconocida = 1; abierta.leido = 1;   // volvió la señal: se cierra sola
      cambio = true;
    }
  }
  if (cambio) { guardar(); emitir('datos'); emitir('alerta'); emitir('aviso'); }
}

// ---------- alertas por los valores de la cápsula ----------
// Usa los mismos umbrales que se editan en la app. Como en el resto de AGRYN:
//   rotura o ingreso de aire = CO₂ bajo el mínimo y humedad sobre el máximo;
//   fermentación             = temperatura y CO₂ sobre el máximo.
// Esas dos no se pueden descartar: se cierran solas cuando las variables del patrón vuelven al rango
// y se mantienen así SOSTENIDO ms. Si una variable está fuera de rango y no forma parte de un patrón
// activo, se avisa sola (esa sí se puede descartar, y no vuelve a aparecer hasta un nuevo episodio).
const PATRON_VARS = { rotura: ['co2', 'hum'], fermentacion: ['temp', 'co2'] };
const PATRON_NOMBRE = { rotura: 'Posible rotura o ingreso de aire', fermentacion: 'Posible fermentación' };
const SOSTENIDO = 60 * 1000;
const NOMBRES = { ph: ['pH', ''], temp: ['Temperatura', ' °C'], hum: ['Humedad', ' %'], co2: ['CO₂', ' %'] };

async function umbralesVigentes() {
  try { const r = await fetchDemo('/api/umbrales'); return r.ok ? await r.json() : []; } catch (e) { return []; }
}
const regla = (reglas, k) => reglas.find((x) => x.key === k);
function lado(x, r) { if (x == null || !r) return null; return x > r.max ? 'alto' : (x < r.min ? 'bajo' : null); }
const coma = (x, d) => x.toFixed(d).replace('.', ',');
function textoValor(k, x, r) {
  const [nombre, u] = NOMBRES[k], d = k === 'ph' || k === 'co2' ? 2 : 1;
  return nombre + ' ' + coma(x, d) + u + (x > r.max ? ' (sobre el máximo de ' + coma(r.max, d) + u + ')' : ' (bajo el mínimo de ' + coma(r.min, d) + u + ')');
}
// Último valor conocido de cada variable (el historial a veces trae campos vacíos).
function actual(c) {
  const v = {};
  for (let i = c.lecturas.length - 1; i >= 0 && Object.keys(v).length < VARS.length; i--) {
    const l = c.lecturas[i];
    for (const k of VARS) if (v[k] == null && l[k] != null) v[k] = l[k];
  }
  return v;
}
function resuelto(c, a, reglas) {
  let inicio = null, ultimo = null;
  for (const l of c.lecturas) {
    if (l.ts <= a.ts) continue;
    const ok = PATRON_VARS[a.variable].every((k) => l[k] == null || lado(l[k], regla(reglas, k)) == null);
    if (!ok) inicio = null; else if (inicio == null) inicio = l.ts;
    ultimo = l.ts;
  }
  return inicio != null && ultimo - inicio >= SOSTENIDO;
}
function revisarValores(cid, c, reglas) {
  const nodoId = BASE_NODO + cid, ahora = Date.now(), v = actual(c);
  const activa = (variable) => est.alertas.find((a) => a.nodo_id === nodoId && a.variable === variable && !a.reconocida);
  const ts = c.lecturas.length ? c.lecturas[c.lecturas.length - 1].ts : ahora;
  let nuevas = 0, cerradas = 0;
  // 1) Patrones que se solucionaron: se cierran solos.
  for (const a of est.alertas) {
    if (a.nodo_id !== nodoId || a.reconocida || a.origen !== 'valores' || !PATRON_VARS[a.variable]) continue;
    if (resuelto(c, a, reglas)) { a.reconocida = 1; cerradas++; }
  }
  // 2) Patrones nuevos.
  const L = (k) => lado(v[k], regla(reglas, k));
  const patrones = { rotura: L('co2') === 'bajo' && L('hum') === 'alto', fermentacion: L('temp') === 'alto' && L('co2') === 'alto' };
  for (const [tipo, hay] of Object.entries(patrones)) {
    if (!hay || activa(tipo)) continue;
    est.alertas.push({
      id: nuevoIdAlerta(), nodo_id: nodoId, variable: tipo, etiqueta: PATRON_NOMBRE[tipo], origen: 'valores', valor: v.co2, nivel: 'crit',
      ts, reconocida: 0, creada: ahora, notificada: 1, leido: 0,
      diagnostico: PATRON_NOMBRE[tipo] + ' en la cápsula ' + cid + ': ' + PATRON_VARS[tipo].map((k) => textoValor(k, v[k], regla(reglas, k))).join(', ') +
        '. No se puede descartar: se cierra sola cuando los valores vuelven al rango.'
    });
    nuevas++;
    if (window.__agrynAviso) window.__agrynAviso(PATRON_NOMBRE[tipo] + ' · Cápsula ' + cid, 'Revisá la silobolsa.');
  }
  // 3) Variables sueltas fuera de rango que no explica un patrón activo.
  c.episodio = c.episodio || {};
  const cubiertas = new Set(Object.keys(PATRON_VARS).filter((t) => activa(t)).flatMap((t) => PATRON_VARS[t]));
  for (const k of VARS) {
    const r = regla(reglas, k), l = lado(v[k], r);
    const abierta = activa(k);
    if (!l) { c.episodio[k] = false; if (abierta) { abierta.reconocida = 1; cerradas++; } continue; }   // volvió al rango
    if (cubiertas.has(k) || abierta || c.episodio[k]) continue;
    const span = r.max - r.min, desvio = l === 'alto' ? v[k] - r.max : r.min - v[k];
    est.alertas.push({
      id: nuevoIdAlerta(), nodo_id: nodoId, variable: k, etiqueta: NOMBRES[k][0], origen: 'valores', valor: v[k], nivel: desvio > span * 0.25 ? 'crit' : 'warn',
      ts, reconocida: 0, creada: ahora, notificada: 1, leido: 0, diagnostico: null
    });
    c.episodio[k] = true;   // si la descartás, no vuelve hasta que el valor regrese al rango y salga de nuevo
    nuevas++;
  }
  return { nuevas, cerradas };
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
// La app muestra como «valor actual» el último punto de la serie. Sin esto sería el promedio
// de la última media hora y no coincidiría con la app del celular, que muestra el último dato.
function serieConUltimo(lecturas, rango, ahora = Date.now()) {
  const r = serie(lecturas, rango, ahora);
  const ult = lecturas[lecturas.length - 1];
  if (ult && ult.ts >= r.desde) for (const k of VARS) if (ult[k] != null) r.valores[k][r.n - 1] = ult[k];
  return r;
}

// ---------- respuestas para la silobolsa en vivo ----------
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const lecturasDe = (nodoId) => (est.capsulas[nodoId - BASE_NODO] || { lecturas: [] }).lecturas;
const esNodoVivo = (id) => id > BASE_NODO && est.capsulas[id - BASE_NODO];

function siloVivo() {
  return {
    id: SILO_ID, nombre: 'Cápsulas AGRYN (en vivo)', contenido: 'Soja', creada: 0,
    nodos: idsCapsulas().map((cid) => {
      const c = est.capsulas[cid], l = c.lecturas;
      const ultimaTs = (c.ultima && c.ultima.fecha) || (l.length ? l[l.length - 1].ts : null);
      return { id: BASE_NODO + cid, silobolsa_id: SILO_ID, nombre: 'Cápsula ' + cid + (enLinea(c) ? ' · en línea' : ' · sin señal'),
        device_id: 'cap-' + cid, ultima_ts: ultimaTs };
    })
  };
}
function alertaVista(a) {
  return { ...a, nodo: 'Cápsula ' + (a.nodo_id - BASE_NODO), silobolsa: 'Cápsulas AGRYN (en vivo)', silobolsa_id: SILO_ID, etiqueta: a.etiqueta || 'Alerta de aire', descripcion: a.diagnostico };
}
function avisoVista(a) {
  return { id: a.id, leido: a.leido, creada: a.creada, alerta_id: a.id, variable: a.variable, valor: a.valor, nivel: a.nivel, ts: a.ts,
    nodo_id: a.nodo_id, nodo: 'Cápsula ' + (a.nodo_id - BASE_NODO), silobolsa_id: SILO_ID, silobolsa: 'Cápsulas AGRYN (en vivo)', etiqueta: a.etiqueta || 'Alerta de aire', descripcion: a.diagnostico };
}

async function responder(url, metodo, opciones) {
  const p = url.split('?')[0].replace(/\/$/, '');
  let m;
  // Sin haber ingresado con el correo y la contraseña, no se muestra nada de las cápsulas:
  // la demo responde (y rechaza) todos los pedidos.
  if (window.__agrynSesionValida && !window.__agrynSesionValida(opciones)) return fetchDemo(url, opciones);
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
    return json(serieConUltimo(l.filter((x) => x.ts >= desde), rango, ahora));
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
    if (!a.reconocida && PATRON_VARS[a.variable]) return json({ error: 'Esta alerta no se puede descartar: se cierra sola cuando se soluciona el problema.' }, 409);
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
  const ciclo = () => sincronizar().catch((e) => { console.warn('Cápsulas en vivo:', e.message); revisarSenal(); });
  ciclo();
  setInterval(ciclo, CADA);
  setInterval(revisarSenal, 5000);   // aunque no llegue nada, a los pocos segundos pasa a «sin señal»
})();
