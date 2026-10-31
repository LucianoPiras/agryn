// API de demostración que corre en el navegador: responde las mismas rutas que el servidor,
// pero guarda todo en localStorage. Sirve para abrir AGRYN Monitoreo como un solo archivo HTML.
//
// Usa los mismos módulos que el servidor (series, umbrales, diagnóstico), así que la pantalla
// muestra lo mismo que la app conectada. Los datos son simulados.
import { VARIABLES, evaluar } from '../server/umbrales.js';
import { serie, RANGOS } from '../server/serie.js';
import { diagnosticar, VENTANA_DIAGNOSTICO } from '../server/diagnostico.js';
import { PATRONES, etiquetaVariable, seCierraSola, patronResuelto } from '../server/patrones.js';

const CLAVE_STORE = 'agryn-demo-v1';
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const CONTRASENA = '12345';   // la que se pide para borrar una silobolsa
// Ingreso a la página publicada: solo este correo y esta contraseña. La página no tiene servidor,
// así que la comparación se hace en el navegador contra la huella SHA-256 de la contraseña (no está
// escrita en el código). Sirve para que no entre cualquiera, pero no es una seguridad fuerte.
const USUARIO = 'agryn.silobolsa@gmail.com';
const HUELLA_CLAVE = 'd2d58fd9b732d7e9b6345466d7e658b1fabe91e45930e897b7d367b3942e9780';
const CLAVE_INGRESO = 'agryn-ingreso-v1';   // sesión válida de este navegador (se borra al cerrar sesión)
const DIA = 24 * HORA;

// Umbrales por defecto, los mismos que la base del servidor.
const UMBRALES_INICIALES = VARIABLES.map((v) => ({ key: v.key, nombre: v.nombre, unidad: v.unidad, objetivo: v.objetivo, min: v.min, max: v.max }));

// ---------- almacenamiento ----------
let estado = cargar() || semilla();
function cargar() {
  try {
    const raw = window.localStorage.getItem(CLAVE_STORE);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function guardar() {
  try { window.localStorage.setItem(CLAVE_STORE, JSON.stringify(estado)); } catch (e) { /* sin almacenamiento: queda en memoria */ }
}
const nuevoId = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;

// ---------- datos simulados ----------
// Una lectura cada 30 minutos con variaciones suaves dentro del rango habitual.
// Los valores normales oscilan alrededor del objetivo, dentro de la banda de ±1.
function valorSimulado(semilla, variable, ts) {
  const v = VARIABLES.find((x) => x.key === variable);
  const fase = semilla * 2.7 + variable.length;
  const onda = Math.sin((ts / (6 * HORA)) * Math.PI * 2 + fase) * 0.3;
  const ruido = Math.sin(ts / (37 * MINUTO) + fase * 3) * 0.05;
  const x = v.objetivo + (onda + ruido);
  return Number(x.toFixed(variable === 'ph' || variable === 'co2' ? 2 : 1));
}
function lecturaSimulada(semilla, ts) {
  return { ts, ph: valorSimulado(semilla, 'ph', ts), temp: valorSimulado(semilla, 'temp', ts), hum: valorSimulado(semilla, 'hum', ts), co2: valorSimulado(semilla, 'co2', ts) };
}

function semilla() {
  const ahora = Date.now();
  const silos = [
    { id: 1, nombre: 'Silobolsa 01', contenido: 'Soja', nodos: [1, 2, 3, 4].map((n) => ({ id: n, nombre: 'Nodo ' + n, device_id: 'ESP32-A' + n })) },
    { id: 2, nombre: 'Silobolsa 02', contenido: 'Maíz', nodos: [5, 6, 7].map((n) => ({ id: n, nombre: 'Nodo ' + (n - 4), device_id: 'ESP32-B' + (n - 4) })) }
  ];
  const lecturas = {};
  for (const s of silos) for (const n of s.nodos) {
    const lista = [];
    for (let ts = ahora - 15 * DIA; ts <= ahora; ts += 30 * MINUTO) lista.push(lecturaSimulada(n.id, ts));
    lecturas[n.id] = lista;
  }
  // Escenario de la demo: una rotura en el Nodo 1 de la Silobolsa 02 (CO₂ baja, humedad sube).
  const rotura = [];
  for (let i = 0; i < 25; i++) {
    const ts = ahora - (24 - i) * 5 * MINUTO;
    rotura.push({ ts, ph: 6.5, temp: 17.0, hum: Number((12.0 + (3.0 * i) / 24).toFixed(1)), co2: Number((6.5 - (4.5 * i) / 24).toFixed(2)) });
  }
  lecturas[5] = lecturas[5].filter((l) => l.ts < ahora - 2 * HORA).concat(rotura);
  const alertas = [{ id: 1, nodo_id: 5, variable: 'rotura', valor: 1.3, nivel: 'crit', ts: ahora, reconocida: 0, creada: ahora, notificada: 1, diagnostico: diagnosticar(ventanaEn(lecturas[5], ahora)) }];
  const avisos = [{ id: 1, usuario: USUARIO, alerta_id: 1, creada: ahora, leido: 0 }];
  return { silos, lecturas, alertas, avisos, umbrales: UMBRALES_INICIALES, silenciadas: [], nextId: 100 };
}

// Las lecturas de las 2 horas previas a la alarma, igual que el servidor.
function ventanaEn(lista, ts) {
  return (lista || []).filter((l) => l.ts >= ts - VENTANA_DIAGNOSTICO && l.ts <= ts);
}
function diagnosticarNodo(nodoId, ts) {
  return diagnosticar(ventanaEn(estado.lecturas[nodoId], ts));
}
function lecturas(nodoId) { return estado.lecturas[nodoId] || []; }

// ---------- lógica de la app ----------
function nodoDe(id) {
  for (const s of estado.silos) { const n = s.nodos.find((x) => x.id === id); if (n) return { nodo: n, silo: s }; }
  return null;
}
function umbralesVigentes() { return estado.umbrales; }

// Agrega una lectura, igual que el servidor: crea alertas por umbral y avisos para la demo.
function ingresarLectura(nodoId, ts, valores) {
  const lista = estado.lecturas[nodoId] || (estado.lecturas[nodoId] = []);
  if (lista.some((l) => l.ts === ts)) return;
  lista.push({ ts, ...valores });
  lista.sort((a, b) => a.ts - b.ts);
  const reglas = umbralesVigentes();
  for (const a of evaluar(valores, reglas)) {
    if (estado.alertas.some((x) => x.nodo_id === nodoId && x.variable === a.variable && !x.reconocida)) continue;
    const alerta = { id: nuevoId(estado.alertas), nodo_id: nodoId, variable: a.variable, valor: a.valor, nivel: a.nivel, ts, reconocida: 0, creada: Date.now(), notificada: 1, diagnostico: diagnosticarNodo(nodoId, ts) };
    estado.alertas.push(alerta);
    if (a.nivel === 'crit') {
      estado.avisos.push({ id: nuevoId(estado.avisos), usuario: USUARIO, alerta_id: alerta.id, creada: Date.now(), leido: 0 });
      iniciarLiberacion(nodoDe(nodoId).silo);
    }
  }
}

// Cada 30 segundos entra una lectura nueva en cada nodo: la pantalla se mueve sola.
function latir() {
  const ts = Math.floor(Date.now() / (30 * 1000)) * 30 * 1000;
  for (const s of estado.silos) for (const n of s.nodos) {
    if (recuperaciones[n.id]) continue; // mientras se corrige, sus valores los pone la recuperación
    ingresarLectura(n.id, ts, lecturaSimulada(n.id, ts));
  }
  guardar();
}

// ---------- respuestas ----------
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status, mensaje) => json({ error: mensaje }, status);

function silobolsasConNodos() {
  return estado.silos.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    contenido: s.contenido,
    creada: s.creada || 0,
    nodos: s.nodos.map((n) => {
      const l = lecturas(n.id);
      return { id: n.id, silobolsa_id: s.id, nombre: n.nombre, device_id: n.device_id, ultima_ts: l.length ? l[l.length - 1].ts : null };
    })
  }));
}

function alertasVista(reconocidas) {
  return estado.alertas.filter((a) => !!a.reconocida === reconocidas).map((a) => {
    const info = nodoDe(a.nodo_id);
    return { ...a, nodo: info ? info.nodo.nombre : '', silobolsa: info ? info.silo.nombre : '', silobolsa_id: info ? info.silo.id : null, etiqueta: etiquetaVariable(a.variable), descripcion: a.diagnostico || (PATRONES[a.variable] ? PATRONES[a.variable].descripcion : null) };
  }).sort((a, b) => b.ts - a.ts);
}

function avisosVista() {
  const lista = estado.avisos.map((av) => {
    const a = estado.alertas.find((x) => x.id === av.alerta_id);
    const info = a && nodoDe(a.nodo_id);
    return {
      id: av.id, leido: av.leido, creada: av.creada, alerta_id: av.alerta_id, variable: a ? a.variable : '', valor: a ? a.valor : 0, nivel: a ? a.nivel : 'warn', ts: a ? a.ts : av.creada,
      nodo_id: a ? a.nodo_id : null, nodo: info ? info.nodo.nombre : '', silobolsa_id: info ? info.silo.id : null, silobolsa: info ? info.silo.nombre : '',
      etiqueta: a ? etiquetaVariable(a.variable) : '', descripcion: a ? (a.diagnostico || null) : null
    };
  }).sort((x, y) => y.creada - x.creada);
  return {
    avisos: lista.slice(0, 100),
    no_leidos: estado.avisos.filter((x) => !x.leido).length,
    preferencias: estado.silos.map((s) => ({ silobolsa_id: s.id, nombre: s.nombre, recibe: !estado.silenciadas.includes(s.id) }))
  };
}

const idDe = (x) => { const n = Number(x); return Number.isInteger(n) && n > 0 ? n : null; };

// ---------- ingreso ----------
async function huella(texto) {
  const datos = new TextEncoder().encode(texto);
  const h = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sesionGuardada() { try { return window.localStorage.getItem(CLAVE_INGRESO); } catch (e) { return null; } }
export function sesionValida(token) { const g = sesionGuardada(); return !!token && !!g && token === g; }
function tokenDe(opciones) {
  const h = opciones && opciones.headers;
  const a = h && (typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization));
  return a && a.startsWith('Bearer ') ? a.slice(7) : null;
}

async function resolver(ruta, metodo, cuerpo, url, token) {
  const p = ruta.replace(/\/$/, '');
  let m;
  if (p === '/api/login' && metodo === 'POST') {
    const email = String(cuerpo?.email || '').trim().toLowerCase();
    const ok = email === USUARIO && (await huella(String(cuerpo?.password || ''))) === HUELLA_CLAVE;
    if (!ok) return error(401, 'Correo o contraseña incorrectos.');
    const nuevo = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
    try { window.localStorage.setItem(CLAVE_INGRESO, nuevo); } catch (e) { /* sin almacenamiento */ }
    return json({ ok: true, token: nuevo, email: USUARIO });
  }
  if (p === '/api/logout') { try { window.localStorage.removeItem(CLAVE_INGRESO); } catch (e) { /* nada */ } return json({ ok: true }); }
  // Todo lo demás exige haber ingresado con el correo y la contraseña.
  if (!sesionValida(token)) return error(401, 'Ingresá con tu correo y tu contraseña.');
  if (p === '/api/sesion') return json({ email: USUARIO });
  if (p === '/api/eventos/ticket') return json({ ticket: 'demo' });
  if (p === '/api/push/clave' || p === '/api/push/suscribir') return error(503, 'Las notificaciones push no están disponibles en la demostración.');

  if (p === '/api/umbrales' && metodo === 'GET') return json(estado.umbrales);
  if ((m = p.match(/^\/api\/umbrales\/(\w+)$/)) && metodo === 'PUT') {
    const u = estado.umbrales.find((x) => x.key === m[1]);
    if (!u) return error(404, 'Variable no encontrada.');
    const min = cuerpo?.min, max = cuerpo?.max;
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) return error(400, 'Mínimo y máximo tienen que ser números.');
    if (min >= max) return error(400, 'El mínimo tiene que ser menor que el máximo.');
    u.min = min; u.max = max; guardar();
    return json(estado.umbrales);
  }

  if (p === '/api/silobolsas' && metodo === 'GET') return json(silobolsasConNodos());
  if (p === '/api/silobolsas' && metodo === 'POST') {
    const nombre = String(cuerpo?.nombre || '').trim(), contenido = String(cuerpo?.contenido || 'Sin definir').trim();
    if (!nombre || nombre.length > 40 || !contenido) return error(400, 'Nombre (hasta 40 caracteres) y contenido son obligatorios.');
    const s = { id: nuevoId(estado.silos), nombre, contenido, creada: Date.now(), nodos: [] };
    estado.silos.push(s); guardar();
    return json({ ...s, nodos: [] }, 201);
  }
  if ((m = p.match(/^\/api\/silobolsas\/(\d+)$/))) {
    const id = idDe(m[1]);
    const s = estado.silos.find((x) => x.id === id);
    if (!s) return error(404, 'Silobolsa no encontrada.');
    if (metodo === 'PATCH') {
      const nombre = String(cuerpo?.nombre ?? s.nombre).trim(), contenido = String(cuerpo?.contenido ?? s.contenido).trim();
      if (!nombre || nombre.length > 40 || !contenido) return error(400, 'Nombre (hasta 40 caracteres) y contenido son obligatorios.');
      s.nombre = nombre; s.contenido = contenido; guardar();
      return json({ ...s, nodos: s.nodos });
    }
    if (metodo === 'DELETE') {
      if (String(cuerpo?.password || '') !== CONTRASENA) return error(403, 'Contraseña incorrecta. No se eliminó la silobolsa; probá de nuevo.');
      const ids = s.nodos.map((n) => n.id);
      estado.alertas = estado.alertas.filter((a) => !ids.includes(a.nodo_id));
      for (const id2 of ids) delete estado.lecturas[id2];
      estado.silos = estado.silos.filter((x) => x.id !== id);
      guardar();
      return json(null, 204);
    }
  }
  if ((m = p.match(/^\/api\/silobolsas\/(\d+)\/nodos$/)) && metodo === 'POST') {
    const id = idDe(m[1]);
    const s = estado.silos.find((x) => x.id === id);
    if (!s) return error(404, 'Silobolsa no encontrada.');
    const nombre = String(cuerpo?.nombre || '').trim(), device = String(cuerpo?.device_id || '').trim();
    if (!nombre || nombre.length > 40 || !device || device.length > 64) return error(400, 'Nombre e identificador del nodo son obligatorios.');
    if (estado.silos.some((x) => x.nodos.some((n) => n.device_id === device))) return error(409, 'Ya hay un nodo con ese identificador.');
    const nodo = { id: nuevoId(estado.silos.flatMap((x) => x.nodos)), nombre, device_id: device };
    s.nodos.push(nodo); guardar();
    return json({ ...nodo, silobolsa_id: s.id }, 201);
  }
  if ((m = p.match(/^\/api\/nodos\/(\d+)$/)) && metodo === 'DELETE') {
    const id = idDe(m[1]);
    const info = nodoDe(id);
    if (!info) return error(404, 'Nodo no encontrado.');
    info.silo.nodos = info.silo.nodos.filter((n) => n.id !== id);
    delete estado.lecturas[id];
    estado.alertas = estado.alertas.filter((a) => a.nodo_id !== id);
    guardar();
    return json(null, 204);
  }
  if ((m = p.match(/^\/api\/nodos\/(\d+)\/(serie|ultima|lecturas)$/))) {
    const id = idDe(m[1]);
    if (!nodoDe(id)) return error(404, 'Nodo no encontrado.');
    const ahora = Date.now();
    if (m[2] === 'ultima') { const l = lecturas(id); return json(l.length ? l[l.length - 1] : null); }
    if (m[2] === 'lecturas') return json(lecturas(id).slice(-500).reverse());
    const rango = new URL(url, 'http://demo').searchParams.get('rango') || '24h';
    if (!RANGOS[rango]) return error(400, 'Rango inválido. Usá 24h, 7d o 30d.');
    const desde = ahora - RANGOS[rango].n * RANGOS[rango].paso;
    return json(serie(lecturas(id).filter((l) => l.ts >= desde), rango, ahora));
  }

  if (p === '/api/alertas' && metodo === 'GET') return json(alertasVista(new URL(url, 'http://demo').searchParams.get('reconocidas') === '1'));
  if ((m = p.match(/^\/api\/alertas\/(\d+)\/reconocer$/)) && metodo === 'POST') {
    const a = estado.alertas.find((x) => x.id === Number(m[1]));
    if (!a) return error(404, 'Alerta no encontrada.');
    if (!a.reconocida && seCierraSola(a.variable)) return error(409, 'Esta alerta no se puede descartar: se cierra sola cuando los valores vuelven a la normalidad.');
    a.reconocida = 1; guardar();
    return json({ ok: true });
  }

  if (p === '/api/avisos' && metodo === 'GET') return json(avisosVista());
  if (p === '/api/avisos/leer-todos') { estado.avisos.forEach((x) => { x.leido = 1; }); guardar(); return json({ ok: true }); }
  if ((m = p.match(/^\/api\/avisos\/(\d+)\/leer$/)) && metodo === 'POST') {
    const av = estado.avisos.find((x) => x.id === Number(m[1]));
    if (!av) return error(404, 'Aviso no encontrado.');
    av.leido = 1; guardar();
    return json({ ok: true });
  }
  if ((m = p.match(/^\/api\/avisos\/preferencias\/(\d+)$/)) && metodo === 'PUT') {
    const id = idDe(m[1]);
    if (!estado.silos.some((s) => s.id === id)) return error(404, 'Silobolsa no encontrada.');
    if (typeof cuerpo?.recibe !== 'boolean') return error(400, 'Indicá si querés recibir los avisos (true o false).');
    estado.silenciadas = cuerpo.recibe ? estado.silenciadas.filter((x) => x !== id) : [...new Set([...estado.silenciadas, id])];
    guardar();
    return json({ preferencias: avisosVista().preferencias });
  }
  return error(404, 'Ruta no encontrada en la demostración.');
}

// Conexiones de eventos abiertas (la app abre una al ingresar): así el simulador les avisa al instante.
const oyentes = [];
function emitir(nombre, datos = {}) {
  for (const c of oyentes) for (const fn of c.listeners[nombre] || []) fn({ data: JSON.stringify(datos) });
}

// Simula lo que manda la central: un patrón en las últimas 2 horas y una alarma en un nodo sin alerta activa.
const PATRONES_SIMULADOS = {
  rotura: (i) => ({ ph: 6.5, temp: 17.0, hum: Number((12.0 + (3.0 * i) / 24).toFixed(1)), co2: Number((6.5 - (4.5 * i) / 24).toFixed(2)) }),
  fermentacion: (i) => ({ ph: 6.5, temp: Number((18 + (8.4 * i) / 24).toFixed(1)), hum: 12.5, co2: Number((6.0 + (4.5 * i) / 24).toFixed(2)) })
};
export function simularAnomalia(tipo) {
  const ahora = Date.now();
  const nodo = estado.silos.flatMap((s) => s.nodos).find((n) => !estado.alertas.some((a) => a.nodo_id === n.id && a.variable === tipo && !a.reconocida));
  if (!nodo) return { ok: false, mensaje: 'Todos los nodos ya tienen esa alarma activa. Esperá a que se solucione para simular otra.' };
  const patron = PATRONES_SIMULADOS[tipo];
  const nuevas = Array.from({ length: 25 }, (_, i) => ({ ts: ahora - (24 - i) * 5 * MINUTO, ...patron(i) }));
  estado.lecturas[nodo.id] = lecturas(nodo.id).filter((l) => l.ts < ahora - 2 * HORA).concat(nuevas);
  const alerta = { id: nuevoId(estado.alertas), nodo_id: nodo.id, variable: tipo, valor: nuevas.at(-1)[tipo === 'rotura' ? 'co2' : 'temp'], nivel: 'crit', ts: ahora, reconocida: 0, creada: ahora, notificada: 1, diagnostico: diagnosticar(ventanaEn(estado.lecturas[nodo.id], ahora)) };
  estado.alertas.push(alerta);
  estado.avisos.push({ id: nuevoId(estado.avisos), usuario: USUARIO, alerta_id: alerta.id, creada: ahora, leido: 0 });
  iniciarLiberacion(nodoDe(nodo.id).silo);
  guardar();
  emitir('alerta', { nuevas: 1 });
  emitir('aviso', { id: alerta.id });
  const info = nodoDe(nodo.id);
  return { ok: true, silo: info.silo.nombre, nodo: info.nodo.nombre, titulo: (ETIQUETAS[tipo] || tipo) };
}
// La central libera CO₂ sola cuando hay una alarma crítica: todos los nodos de la silobolsa
// vuelven al objetivo, de a poco. Descartar la alarma no cambia nada de esto.
export function iniciarLiberacion(silo) {
  for (const nodo of silo.nodos) {
    const ultima = lecturas(nodo.id).at(-1);
    if (!ultima) continue;
    recuperaciones[nodo.id] = { desde: { ph: ultima.ph, temp: ultima.temp, hum: ultima.hum, co2: ultima.co2 }, inicio: Date.now() };
  }
  if (!temporizadorRecuperacion) temporizadorRecuperacion = setInterval(avanzarRecuperaciones, PASO_RECUPERACION);
  guardar();
}

// ¿Hay algún nodo volviendo al objetivo ahora mismo? Lo usa el cartel de la alarma.
export function liberandoCO2() {
  return Object.keys(recuperaciones).length > 0;
}

const DURACION_RECUPERACION = 90 * 1000;
const PASO_RECUPERACION = 3 * 1000;
const recuperaciones = {};
let temporizadorRecuperacion = null;

// Cada paso mueve las lecturas del nodo un poco más hacia el centro del rango habitual.
function avanzarRecuperaciones() {
  const ahora = Date.now();
  // El último punto del gráfico promedia los últimos 30 minutos: se reemplazan esas lecturas para que el valor se vea moverse.
  const inicioVentana = ahora - 30 * MINUTO;
  for (const [nodoId, r] of Object.entries(recuperaciones)) {
    const f = Math.min(1, (ahora - r.inicio) / DURACION_RECUPERACION);
    const valores = {};
    for (const u of estado.umbrales) {
      valores[u.key] = Number((r.desde[u.key] + (u.objetivo - r.desde[u.key]) * f).toFixed(2));
    }
    const lista = (estado.lecturas[nodoId] || []).filter((l) => l.ts < inicioVentana);
    lista.push({ ts: ahora, ...valores });
    estado.lecturas[nodoId] = lista;
    if (f >= 1) { delete recuperaciones[nodoId]; cerrarResueltas(Number(nodoId)); }
  }
  guardar();
  emitir('datos', {});
  if (!Object.keys(recuperaciones).length) { clearInterval(temporizadorRecuperacion); temporizadorRecuperacion = null; }
}

// Cuando termina la liberación, las alarmas de rotura y fermentación del nodo se cierran solas
// si las variables del patrón volvieron al rango (en la demo no se espera, la liberación ya terminó).
function cerrarResueltas(nodoId) {
  let cerradas = 0;
  for (const a of estado.alertas) {
    if (a.nodo_id !== nodoId || a.reconocida || !seCierraSola(a.variable)) continue;
    if (patronResuelto(a.variable, lecturas(nodoId).filter((l) => l.ts > a.ts), estado.umbrales, 0)) { a.reconocida = 1; cerradas++; }
  }
  if (cerradas) emitir('alerta', { cerradas });
}

const ETIQUETAS = { rotura: 'Posible rotura o ingreso de aire', fermentacion: 'Posible fermentación' };

// Reemplaza fetch para las rutas /api/ y el canal de eventos en vivo, que en la demo se simula con latidos.
export function instalarApiDemo() {
  // La página no arranca con sesión: hay que ingresar con el correo y la contraseña.
  window.__agrynSesionValida = (opciones) => sesionValida(tokenDe(opciones));
  const fetchReal = window.fetch.bind(window);
  window.fetch = async (entrada, opciones = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    if (!url.startsWith('/api/')) return fetchReal(entrada, opciones);
    const metodo = (opciones.method || 'GET').toUpperCase();
    let cuerpo;
    try { cuerpo = opciones.body ? JSON.parse(opciones.body) : undefined; } catch (e) { cuerpo = undefined; }
    await new Promise((ok) => setTimeout(ok, 40));
    return resolver(url.split('?')[0], metodo, cuerpo, url, tokenDe(opciones));
  };
  window.EventSource = class {
    constructor() { this.listeners = {}; oyentes.push(this); }
    addEventListener(nombre, fn) { (this.listeners[nombre] = this.listeners[nombre] || []).push(fn); }
    close() { oyentes.splice(oyentes.indexOf(this), 1); }
  };
  // Las alarmas críticas que ya estaban sin descartar también están liberando CO₂.
  for (const a of estado.alertas) if (a.nivel === 'crit' && !a.reconocida && !liberandoCO2()) iniciarLiberacion(nodoDe(a.nodo_id).silo);
  latir();
  setInterval(latir, 30 * 1000);
}
