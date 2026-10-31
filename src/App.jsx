import React from 'react';

const VARS = [
  { key: 'ph',   name: 'pH',          unit: '',   dec: 2, min: 6, max: 8 },
  { key: 'temp', name: 'Temperatura', unit: '°C', dec: 1, min: 16,  max: 18 },
  { key: 'hum',  name: 'Humedad',     unit: '%',  dec: 1, min: 11,  max: 13 },
  { key: 'co2',  name: 'CO₂',         unit: '%',  dec: 2, min: 5.5, max: 7.5 }
];
const RANGES = {
  '24h': { n: 48, step: 30,  label: '24 h',    ticks: ['-24 h', '-18 h', '-12 h', '-6 h', 'Ahora'] },
  '7d':  { n: 84, step: 120, label: '7 días',  ticks: ['-7 d', '-6 d', '-5 d', '-4 d', '-3 d', '-2 d', '-1 d', 'Hoy'] },
  '30d': { n: 90, step: 480, label: '30 días', ticks: ['-30 d', '-24 d', '-18 d', '-12 d', '-6 d', 'Hoy'] }
};
const C = { ok: '#005A36', okBg: 'rgba(0,90,54,0.10)', warn: '#8A4D00', warnBg: 'rgba(161,92,0,0.12)', crit: '#B02A18', critBg: 'rgba(200,50,31,0.10)', text: '#0F2A1F', muted: '#4F6459' };
const SELF = 'rgba(250,246,233,0.14)', SELB = 'rgba(250,246,233,0.42)';
// Los nodos mandan una lectura cada 30 minutos; la pantalla lo muestra como próxima lectura.
const N24 = RANGES['24h'].n;
// Contenidos que ofrece el selector. Cualquier otro texto se guarda como "Otro".
const CONTENIDOS = ['Soja', 'Maíz', 'Trigo', 'Girasol', 'Sorgo', 'Cebada', 'Forraje', 'Sin definir'];
// Silobolsa vacía: se muestra mientras no hay ninguna cargada, para que la pantalla no se rompa.
const SIN_SILO = { id: -1, name: 'Sin silobolsas', content: 'Sin definir', custom: '', nodes: [] };
const SESION = 'agryn-sesion-v1';
// Variables que marca cada patrón de riesgo en los nodos.
const PATRON_VARS = { rotura: ['co2', 'hum'], fermentacion: ['temp', 'co2'] };
const CODE_TTL = 5 * 60 * 1000;
// Pasa una silobolsa de la API al formato que usa la pantalla.
function desdeApi(x) {
  const conocido = CONTENIDOS.includes(x.contenido);
  return {
    id: x.id, name: x.nombre, content: conocido ? x.contenido : 'Otro', custom: conocido ? '' : x.contenido,
    nodes: x.nodos.map((n) => ({ id: n.id, name: n.nombre, device: n.device_id, ultimaTs: n.ultima_ts }))
  };
}
function contentOf(b) { const c = b.content || 'Sin definir'; return c === 'Otro' ? ((b.custom || '').trim() || 'Otro') : c; }

// Número escrito con coma o punto; vacío o inválido da NaN.
function aNumero(x) { const t = String(x).trim().replace(',', '.'); return t === '' ? NaN : Number(t); }
// Tiempo transcurrido en segundos o minutos, para textos como «hace 12 s».
function haceTxt(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' s' : dur(s / 60); }
function fmt(v, dec) { return v == null ? '—' : v.toFixed(dec).replace('.', ','); }
function dur(min) {
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return Math.round(min) + ' min';
  if (min < 1440) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h' + (m ? ' ' + m + ' min' : ''); }
  const d = Math.floor(min / 1440), h = Math.round((min % 1440) / 60);
  return d + ' d' + (h ? ' ' + h + ' h' : '');
}
function emailValido(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function mmss(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
// Llama a la API de AGRYN (server/index.js). Nunca lanza: devuelve ok, status y un mensaje legible.
async function llamar(ruta, { metodo = 'POST', cuerpo, token } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (token) cab.Authorization = 'Bearer ' + token;
  try {
    const r = await fetch(ruta, { method: metodo, headers: cab, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d, error: d.error || 'Algo salió mal. Probá de nuevo.' };
  } catch (e) {
    return { ok: false, status: 0, data: {}, error: 'No hay conexión con el servidor. Probá de nuevo.' };
  }
}
function sesionLocal() {
  try { return window.localStorage.getItem(SESION); } catch (e) { return null; }
}

// ¿El navegador puede recibir notificaciones push con la app cerrada?
const soportaPush = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
// La clave pública llega en base64 de URL; el navegador la pide como bytes.
function claveDeServidor(base64Url) {
  const b64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
// iPhone y iPad solo reciben push si la app está instalada en la pantalla de inicio.
const iosSinInstalar = () => /iPhone|iPad/.test(navigator.userAgent) && !(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone);

export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      bags: [], datos: {}, alertas: [], view: 'overview', range: '24h', bag: null, node: null, cursor: null, tick: 0,
      nuevoNodo: '', avisoApp: '', pushActivo: false, avisos: [], noLeidos: 0, avisosAbiertos: false, preferencias: [], menuAbierto: false, umbrales: VARS, umbralesAbiertos: false, umbralEdit: {}, form: { open: false, name: '', content: 'Sin definir' },
      del: { step: null, pw: '', err: false }, confirm: null, confirmAt: 0,
      auth: { user: null, token: null, enviando: false, paso: 'login', email: '', pw: '', code: '', vence: 0, err: '', aviso: '' }
    };
    this._token = null;
  }
  componentDidMount() {
    this._k = (e) => { if (e.key === 'Escape') this.setState({ menuAbierto: false, avisosAbiertos: false }); };
    window.addEventListener('keydown', this._k);
    this._t = setInterval(() => this.setState((s) => ({ tick: s.tick + 1 })), 1000);
    this._r = setInterval(() => { if (this.state.auth.user) this.cargarTodo(); }, 60 * 1000);
    // Las alertas críticas no pueden esperar un minuto: avisos y alertas se revisan cada 15 segundos.
    this._a = setInterval(() => { if (this.state.auth.user) { this.cargarAvisos(); this.cargarAlertas(); } }, 15 * 1000);
    const token = sesionLocal();
    if (token) {
      llamar('/api/sesion', { metodo: 'GET', token: token }).then((r) => {
        if (!r.ok) { try { window.localStorage.removeItem(SESION); } catch (e) { /* ignorar */ } return; }
        this._token = token;
        this.setState((s) => ({ auth: Object.assign({}, s.auth, { user: r.data.email, token: token }) }));
        this.cargarTodo();
        this.conectarEventos();
      });
    }
  }
  componentWillUnmount() { window.removeEventListener('keydown', this._k); this.cerrarEventos(); clearInterval(this._t); clearInterval(this._r); clearInterval(this._a); clearTimeout(this._g); clearTimeout(this._e); }
  componentDidUpdate(prevProps, prevState) {
    if (prevState.range !== this.state.range && this.state.auth.user) this.cargarSeries(this.state.bags);
  }

  // Llamada a la API con la sesión actual. Si el servidor dice que la sesión venció, se cierra.
  api(ruta, { metodo = 'GET', cuerpo } = {}) {
    return llamar(ruta, { metodo: metodo, cuerpo: cuerpo, token: this._token }).then((r) => {
      if (r.status === 401) this.salir();
      return r;
    });
  }
  salir() {
    this._token = null;
    this.cerrarEventos();
    this._conocidos = null;
    try { window.localStorage.removeItem(SESION); } catch (e) { /* ignorar */ }
    this.setState((s) => ({
      auth: Object.assign({}, s.auth, { user: null, token: null, paso: 'login', email: '', pw: '', code: '', err: '', aviso: '' }),
      bags: [], datos: {}, alertas: [], avisos: [], noLeidos: 0, avisosAbiertos: false, preferencias: [], menuAbierto: false, umbralesAbiertos: false, bag: null, node: null
    }));
  }
  error(msg) {
    clearTimeout(this._e);
    this.setState({ avisoApp: msg });
    this._e = setTimeout(() => this.setState({ avisoApp: '' }), 6000);
  }

  // Carga desde la API
  async cargarSilobolsas() {
    const r = await this.api('/api/silobolsas');
    if (!r.ok) return [];
    const bags = r.data.map(desdeApi);
    this.setState((s) => {
      const bag = bags.some((b) => b.id === s.bag) ? s.bag : (bags[0] ? bags[0].id : null);
      return { bags: bags, bag: bag, node: bag === s.bag ? s.node : null };
    });
    return bags;
  }
  // Series de cada nodo: siempre 24 h (alertas y tarjetas) y el rango que se está viendo.
  async cargarSeries(bags) {
    const rangos = ['24h', this.state.range].filter((x, i, a) => a.indexOf(x) === i);
    const pedidos = [];
    bags.forEach((b) => b.nodes.forEach((nd) => rangos.forEach((rg) => {
      pedidos.push(this.api('/api/nodos/' + nd.id + '/serie?rango=' + rg).then((r) => ({ nd: nd.id, rg: rg, r: r })));
    })));
    const res = await Promise.all(pedidos);
    this.setState((s) => {
      const datos = Object.assign({}, s.datos);
      res.forEach(({ nd, rg, r }) => { if (r.ok) datos[nd] = Object.assign({}, datos[nd], { [rg]: r.data }); });
      return { datos: datos };
    });
  }
  async cargarAlertas() {
    const r = await this.api('/api/alertas');
    if (r.ok) this.setState({ alertas: r.data });
  }
  async cargarTodo() {
    const bags = await this.cargarSilobolsas();
    await Promise.all([this.cargarSeries(bags), this.cargarAlertas(), this.cargarAvisos(), this.cargarUmbrales()]);
    this.revisarPush();
  }

  // Conexión en tiempo real: la central y las anomalías llegan en el momento, sin esperar la próxima consulta
  async conectarEventos() {
    if (this._es || !this._token) return;
    const r = await this.api('/api/eventos/ticket', { metodo: 'POST' });
    if (!r.ok || this._es) return;
    const es = new EventSource('/api/eventos?ticket=' + encodeURIComponent(r.data.ticket));
    this._es = es;
    es.addEventListener('aviso', () => this.cargarAvisos());
    es.addEventListener('alerta', () => this.cargarAlertas());
    es.addEventListener('datos', async () => { const bags = await this.cargarSilobolsas(); this.cargarSeries(bags); });
    // Si se corta, se vuelve a conectar con un ticket nuevo (cada ticket sirve una sola vez).
    es.onerror = () => { es.close(); this._es = null; clearTimeout(this._re); this._re = setTimeout(() => this.conectarEventos(), 5000); };
  }
  cerrarEventos() {
    clearTimeout(this._re);
    if (this._es) { this._es.close(); this._es = null; }
  }

  // Umbrales de alerta: se leen y se guardan en la API
  async cargarUmbrales() {
    const r = await this.api('/api/umbrales');
    if (!r.ok) return;
    this.setState({ umbrales: VARS.map((v) => { const a = r.data.find((x) => x.key === v.key); return a ? Object.assign({}, v, { min: a.min, max: a.max }) : v; }) });
  }
  editarUmbral(key, campo, texto) {
    this.setState((s) => ({ umbralEdit: Object.assign({}, s.umbralEdit, { [key]: Object.assign({}, s.umbralEdit[key], { [campo]: texto, err: '', ok: '' }) }) }));
  }
  async guardarUmbral(key) {
    const e = this.state.umbralEdit[key];
    const fijar = (patch) => this.setState((s) => ({ umbralEdit: Object.assign({}, s.umbralEdit, { [key]: Object.assign({}, s.umbralEdit[key], patch) }) }));
    const min = aNumero(e.min), max = aNumero(e.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return fijar({ err: 'Ingresá dos números, por ejemplo 6,5 y 7,2.', ok: '' });
    if (min >= max) return fijar({ err: 'El mínimo tiene que ser menor que el máximo.', ok: '' });
    const r = await this.api('/api/umbrales/' + key, { metodo: 'PUT', cuerpo: { min: min, max: max } });
    if (!r.ok) return fijar({ err: r.error, ok: '' });
    fijar({ err: '', ok: 'Guardado. Aplica a las lecturas nuevas.' });
    this.cargarUmbrales();
  }

  // Avisos personales del usuario de la sesión
  async cargarAvisos() {
    const r = await this.api('/api/avisos');
    if (!r.ok) return;
    const conocidos = this._conocidos;
    this._conocidos = new Set(r.data.avisos.map((a) => a.id));
    this.setState({ avisos: r.data.avisos, noLeidos: r.data.no_leidos, preferencias: r.data.preferencias });
    // Solo avisa de lo nuevo: la primera carga de la sesión no dispara nada.
    if (conocidos) r.data.avisos.filter((a) => a.nivel === 'crit' && !a.leido && !conocidos.has(a.id)).forEach((a) => this.avisarEnEscritorio(a));
  }
  // Este dispositivo ya tiene suscripción push (local, no pide nada al servidor).
  async revisarPush() {
    if (!soportaPush()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!!sub !== this.state.pushActivo) this.setState({ pushActivo: !!sub });
  }
  // Pide permiso, guarda la suscripción de este dispositivo en el servidor y deja el aviso listo.
  async activarPush() {
    if (!soportaPush()) return this.error('Este navegador no admite notificaciones en segundo plano.');
    try {
      if ((await Notification.requestPermission()) !== 'granted') return this.error('Sin permiso no podemos avisarte. Podés cambiarlo en la configuración del navegador.');
      const clave = await this.api('/api/push/clave');
      if (!clave.ok) return this.error(clave.data?.error || 'Las notificaciones todavía no están disponibles.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveDeServidor(clave.data.clave) });
      const r = await this.api('/api/push/suscribir', { metodo: 'POST', cuerpo: sub.toJSON() });
      if (!r.ok) return this.error('No se pudo guardar este dispositivo. Probá de nuevo.');
      this.setState({ pushActivo: true });
      this.error('Listo: este celular recibe las alertas aunque la app esté cerrada.');
    } catch (e) {
      this.error('No se pudieron activar las notificaciones en este dispositivo.');
    }
  }
  avisarEnEscritorio(a) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification('Alerta crítica · ' + a.silobolsa, {
      body: a.nodo + ': ' + (a.descripcion || a.etiqueta + ' fuera de rango. Revisá la silobolsa.'),
      tag: 'aviso-' + a.id,
      requireInteraction: true
    });
  }
  async fijarPreferencia(silobolsaId, recibe) {
    const r = await this.api('/api/avisos/preferencias/' + silobolsaId, { metodo: 'PUT', cuerpo: { recibe: recibe } });
    if (!r.ok) this.error(r.error);
    this.cargarAvisos();
  }
  async leerAviso(id) {
    const r = await this.api('/api/avisos/' + id + '/leer', { metodo: 'POST' });
    if (!r.ok) this.error(r.error);
    this.cargarAvisos();
  }
  async leerTodosAvisos() {
    await this.api('/api/avisos/leer-todos', { metodo: 'POST' });
    this.cargarAvisos();
  }

  // Cambios: cada uno llama a la API y después recarga lo que cambió
  async crearSilobolsa(nombre, contenido) {
    const r = await this.api('/api/silobolsas', { metodo: 'POST', cuerpo: { nombre: nombre, contenido: contenido } });
    if (!r.ok) return this.error(r.error);
    this.setState((s) => ({ form: { open: false, name: '', content: 'Sin definir' }, bag: r.data.id, node: null }));
    this.cargarTodo();
  }
  async editarContenido(bagId, cambio) {
    this.setState((s) => ({ bags: s.bags.map((b) => b.id === bagId ? Object.assign({}, b, cambio) : b) }));
    clearTimeout(this._g);
    this._g = setTimeout(async () => {
      const b = this.state.bags.find((x) => x.id === bagId);
      if (!b) return;
      const r = await this.api('/api/silobolsas/' + bagId, { metodo: 'PATCH', cuerpo: { contenido: contentOf(b) } });
      if (!r.ok) this.error(r.error);
    }, 500);
  }
  async borrarSilobolsa(id, password) {
    const r = await this.api('/api/silobolsas/' + id, { metodo: 'DELETE', cuerpo: { password: password } });
    if (r.status === 403) return this.setState({ del: { step: 'pass', pw: '', err: true } });
    this.setState({ del: { step: null, pw: '', err: false } });
    if (!r.ok) return this.error(r.error);
    this.setState({ bag: null, node: null, view: 'overview', cursor: null });
    this.cargarTodo();
  }
  async agregarNodo(silo, deviceId) {
    const r = await this.api('/api/silobolsas/' + silo.id + '/nodos', { metodo: 'POST', cuerpo: { nombre: 'Nodo ' + (silo.nodes.length + 1), device_id: deviceId } });
    if (!r.ok) return this.error(r.error);
    this.setState({ nuevoNodo: '', node: null });
    this.cargarTodo();
  }
  async quitarNodo(id) {
    const r = await this.api('/api/nodos/' + id, { metodo: 'DELETE' });
    if (!r.ok) return this.error(r.error);
    this.setState({ node: null, cursor: null });
    this.cargarTodo();
  }
  async reconocer(id) {
    this.setState((s) => ({ alertas: s.alertas.filter((a) => a.id !== id) }));
    const r = await this.api('/api/alertas/' + id + '/reconocer', { metodo: 'POST' });
    if (!r.ok) { this.error(r.error); this.cargarAlertas(); }
  }

  // Lectura de un nodo en el índice i de la serie del rango n (N24 = 24 h, 84 = 7 d, 90 = 30 d).
  // Devuelve null si el nodo todavía no tiene lecturas.
  val(b, nd, vi, i, n) {
    if (i === n - 1 && n !== N24) return this.val(b, nd, vi, N24 - 1, N24);
    const rango = n === 84 ? '7d' : (n === 90 ? '30d' : '24h');
    const s = this.state.datos[nd.id] && this.state.datos[nd.id][rango];
    const serie = s && s.valores[VARS[vi].key];
    return serie ? serie[i] : null;
  }
  // Promedio de los nodos que tienen lectura en ese punto.
  avg(b, vi, i, n) {
    const xs = b.nodes.map((nd) => this.val(b, nd, vi, i, n)).filter((x) => x != null);
    return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null;
  }
  status(x, v) { if (x == null) return 'ok'; return x > v.max ? 'high' : (x < v.min ? 'low' : 'ok'); }
  sev(x, v) {
    const span = v.max - v.min;
    const over = x > v.max ? x - v.max : v.min - x;
    return over > span * 0.25 ? 'crit' : 'warn';
  }

  renderVals() {
    const S = this.state, self = this;
    const VARS = S.umbrales;
    const bags = S.bags;
    const bo = bags.find((b) => b.id === S.bag) || bags[0] || SIN_SILO;
    const nsel = S.node == null ? null : (bo.nodes.find((x) => x.id === S.node) || null);
    const range = RANGES[S.range], n = range.n;
    const NN = bo.nodes.length;
    const unitTxt = (v) => (v.unit ? ' ' + v.unit : '');
    const col = (sv) => (sv === 'ok' ? C.ok : (sv === 'crit' ? C.crit : C.warn));
    const pt = (vi, i, nn) => (nsel == null ? self.avg(bo, vi, i, nn) : self.val(bo, nsel, vi, i, nn));
    const scopeLabel = nsel == null ? 'Promedio de ' + NN + (NN === 1 ? ' nodo' : ' nodos') : nsel.name;
    const confirmLive = S.confirm && (Date.now() - S.confirmAt < 5000) ? S.confirm : null;

    // ---- alertas: las que trae el servidor y todavía no se reconocieron ----
    const alerts = S.alertas.map((a) => {
      const hace = 'hace ' + dur((Date.now() - a.ts) / 60000);
      if (!VARS.some((x) => x.key === a.variable)) {
        // Patrón (fermentación, rotura): no es una variable, así que no tiene rango ni gráfico propio
        return {
          id: a.id, bid: a.silobolsa_id, nid: a.nodo_id, iv: 0, vista: 'overview', sev: a.nivel, cur: a.valor, st: 'patron', acked: false, vars: PATRON_VARS[a.variable] || [],
          // Rotura y fermentación no se pueden descartar: se cierran solas cuando se soluciona el problema.
          fija: !!PATRON_VARS[a.variable],
          title: a.silobolsa + ' · ' + a.nodo + ' · ' + a.etiqueta,
          detail: a.descripcion + ' · ' + hace
        };
      }
      const iv = VARS.findIndex((x) => x.key === a.variable);
      const v = VARS[iv];
      const st = a.valor > v.max ? 'high' : 'low';
      return {
        id: a.id, bid: a.silobolsa_id, nid: a.nodo_id, iv: iv, vista: v.key, sev: a.nivel, cur: a.valor, st: st, acked: false, vars: [a.variable],
        title: a.silobolsa + ' · ' + a.nodo + ' · ' + v.name + ' ' + fmt(a.valor, v.dec) + unitTxt(v),
        detail: (st === 'high' ? 'Supera el máximo habitual (' + fmt(v.max, v.dec) + unitTxt(v) + ')' : 'Está por debajo del mínimo habitual (' + fmt(v.min, v.dec) + unitTxt(v) + ')') + ' · ' + hace
      };
    });
    alerts.sort((a, b) => (a.acked - b.acked) || ((a.sev === 'crit' ? 0 : 1) - (b.sev === 'crit' ? 0 : 1)));
    const alertaDe = (nid, key) => alerts.some((a) => !a.acked && a.nid === nid && a.vars.includes(key));
    const go = (bid, nid, view) => () => self.setState({ bag: bid, node: nid, view: view, cursor: null });
    const doAck = (id) => () => self.reconocer(id);

    // ---- umbrales de alerta: un renglón por variable ----
    const umbralesRows = VARS.map((v) => {
      const e = S.umbralEdit[v.key] || { min: '', max: '', err: '', ok: '' };
      return {
        key: v.key, nombre: v.name, unidad: v.unit, min: e.min, max: e.max, err: e.err, ok: e.ok,
        onMin: (ev) => self.editarUmbral(v.key, 'min', ev.target.value),
        onMax: (ev) => self.editarUmbral(v.key, 'max', ev.target.value),
        onKey: (ev) => { if (ev.key === 'Enter') self.guardarUmbral(v.key); },
        guardar: () => self.guardarUmbral(v.key)
      };
    });

    // ---- preferencias: de qué silobolsas recibe avisos quien está logueado ----
    const preferenciasList = S.preferencias.map((p) => ({
      id: p.silobolsa_id, nombre: p.nombre, recibe: p.recibe,
      cambiar: (ev) => self.fijarPreferencia(p.silobolsa_id, ev.target.checked)
    }));

    // ---- centro de avisos: avisos personales de quien está logueado ----
    const avisosList = S.avisos.map((a) => {
      const iv = Math.max(0, VARS.findIndex((x) => x.key === a.variable));
      const v = VARS[iv];
      const detalleBase = a.descripcion || (v.name + ' en ' + fmt(a.valor, v.dec) + unitTxt(v));
      return {
        id: a.id, leido: !!a.leido,
        titulo: (a.nivel === 'crit' ? 'Alerta crítica' : 'Atención') + ' · ' + a.silobolsa + ' · ' + a.nodo,
        detalle: detalleBase + ' · hace ' + dur((Date.now() - a.creada) / 60000),
        estado: a.leido ? 'Leído' : 'Nuevo',
        leer: () => self.leerAviso(a.id),
        ver: go(a.silobolsa_id, a.nodo_id, a.descripcion ? 'overview' : v.key)
      };
    });

    const alertRows = alerts.map((a) => ({
      sev: a.sev === 'crit' ? 'Crítica' : 'Atención',
      pillBg: a.sev === 'crit' ? C.critBg : C.warnBg,
      pillFg: a.sev === 'crit' ? C.crit : C.warn,
      border: a.sev === 'crit' && !a.acked ? 'rgba(200,50,31,0.55)' : '#DCE5E0',
      title: a.title, detail: a.detail,
      canAck: !a.acked && !a.fija, isAcked: a.acked, fija: !a.acked && !!a.fija,
      open: go(a.bid, a.nid, a.vista), ack: doAck(a.id)
    }));
    // Un banner por cada alerta sin reconocer, uno debajo del otro: así se ven todas a la vez.
    const unacked = alerts.filter((a) => !a.acked);
    const banners = unacked.map((a) => {
      const crit = a.sev === 'crit';
      return {
      id: a.id,
      bg: crit ? '#B02A18' : '#FFF4DD',
      border: crit ? '#7A1B0F' : '#B7791F',
      accent: crit ? '#FAF6E9' : '#8A4D00',
      fg: crit ? '#FAF6E9' : '#0F2A1F',
      iconFg: crit ? '#B02A18' : '#FAF6E9',
      iconBg: crit ? '#FAF6E9' : '#8A4D00',
      detailColor: crit ? '#FAF6E9' : '#2E453A',
      kicker: crit ? 'Alerta crítica' : 'Atención',
      title: a.title,
      detail: a.detail,
      canAck: !a.fija, fija: !!a.fija,
      open: go(a.bid, a.nid, a.vista), ack: doAck(a.id)
      };
    });

    // ---- gráficos ----
    const chart = (vi) => {
      const v = VARS[vi], vals = [];
      for (let i = 0; i < n; i++) vals.push(pt(vi, i, n));
      const conDatos = vals.filter((x) => x != null), hay = conDatos.length > 0, cuenta = Math.max(conDatos.length, 1);
      let mn = hay ? Infinity : v.min, mx = hay ? -Infinity : v.max, sum = 0, out = 0;
      conDatos.forEach((x) => { mn = Math.min(mn, x); mx = Math.max(mx, x); sum += x; if (x > v.max || x < v.min) out++; });
      const span = v.max - v.min;
      const dmin = Math.min(v.min - span * 0.45, mn - span * 0.05);
      const dmax = Math.max(v.max + span * 0.45, mx + span * 0.08);
      const Y = (x) => ((dmax - x) / (dmax - dmin)) * 100;
      const X = (i) => (i / (n - 1)) * 600;
      let line = '', dots = '', primero = true;
      vals.forEach((x, i) => {
        if (x == null) return;
        line += (primero ? 'M' : 'L') + X(i).toFixed(1) + ' ' + Y(x).toFixed(2) + ' ';
        primero = false;
        if (x > v.max || x < v.min) dots += 'M' + X(i).toFixed(1) + ' ' + Y(x).toFixed(2) + ' h0 ';
      });
      const curV = vals[n - 1], st = self.status(curV, v);
      const sv = st === 'ok' ? 'ok' : self.sev(curV, v);
      const idx = Math.min(S.cursor == null ? n - 1 : S.cursor, n - 1);
      const cx = X(idx), cv = vals[idx], cst = self.status(cv, v);
      const nodeVals = bo.nodes.map((nd) => self.val(bo, nd, vi, N24 - 1, N24));
      const outNodes = [];
      nodeVals.forEach((x, k) => { if (self.status(x, v) !== 'ok' || alertaDe(bo.nodes[k].id, v.key)) outNodes.push(k); });
      const anyCrit = outNodes.some((k) => alertaDe(bo.nodes[k].id, v.key) || self.sev(nodeVals[k], v) === 'crit');
      const alertados = bo.nodes.filter((nd) => alertaDe(nd.id, v.key)).map((nd) => nd.name);
      let note, noteColor;
      if (nsel == null) {
        note = outNodes.length ? 'Fuera de rango: ' + outNodes.map((k) => bo.nodes[k].name).join(', ') : (NN === 1 ? 'El nodo está dentro del rango' : 'Los ' + NN + ' nodos están dentro del rango');
        noteColor = outNodes.length ? (anyCrit ? C.crit : C.warn) : C.muted;
      } else {
        note = 'Lectura de ' + nsel.name; noteColor = C.muted;
      }
      return {
        key: v.key, name: v.name, unit: v.unit,
        value: fmt(curV, v.dec), valColor: alertados.length ? C.crit : (st === 'ok' ? C.text : col(sv)),
        statusLabel: alertados.length ? 'Alerta en ' + alertados.join(', ') : (st === 'ok' ? 'Normal' : (st === 'high' ? 'Sobre el máximo' : 'Bajo el mínimo')),
        chipBg: alertados.length ? C.critBg : (sv === 'ok' ? C.okBg : (sv === 'crit' ? C.critBg : C.warnBg)), chipFg: alertados.length ? C.crit : col(sv),
        border: st === 'ok' ? '#DCE5E0' : (sv === 'crit' ? 'rgba(200,50,31,0.55)' : 'rgba(161,92,0,0.5)'),
        note, noteColor,
        line, area: line ? line + 'L600 100 L0 100 Z' : '', dots,
        last: curV == null ? '' : 'M600 ' + Y(curV).toFixed(2) + ' h0', lastColor: st === 'ok' ? C.ok : '#C8321F',
        lineColor: alertados.length ? '#C8321F' : C.ok,
        bandY: Y(v.max), bandH: Y(v.min) - Y(v.max),
        statMin: fmt(hay ? mn : null, v.dec) + unitTxt(v), statMax: fmt(hay ? mx : null, v.dec) + unitTxt(v), statAvg: fmt(hay ? sum / cuenta : null, v.dec) + unitTxt(v),
        rangeText: fmt(v.min, v.dec) + ' a ' + fmt(v.max, v.dec) + unitTxt(v),
        open: go(bo.id, S.node, v.key), openLabel: 'Ver detalle de ' + v.name,
        limitLines: 'M0 ' + Y(v.max).toFixed(2) + ' H600 M0 ' + Y(v.min).toFixed(2) + ' H600',
        grid: [0, 1, 2, 3, 4].map((k) => 'M0 ' + (k * 25) + ' H600').join(' '),
        yTicks: [0, 1, 2, 3, 4].map((k) => ({ top: k * 25, label: fmt(dmax - k * (dmax - dmin) / 4, v.dec) })),
        xTicks: range.ticks.map((l) => ({ label: l })),
        maxTop: Y(v.max), minTop: Y(v.min), maxText: fmt(v.max, v.dec) + unitTxt(v), minText: fmt(v.min, v.dec) + unitTxt(v),
        cursorIdx: idx, maxIdx: n - 1,
        cursorLine: 'M' + cx.toFixed(1) + ' 0 V100', cursorDot: cv == null ? '' : 'M' + cx.toFixed(1) + ' ' + Y(cv).toFixed(2) + ' h0',
        curColor: cst === 'ok' ? C.ok : '#C8321F',
        lineColor: (nsel ? alertaDe(nsel.id, v.key) : alertados.length > 0) ? '#C8321F' : C.ok,
        curText: fmt(cv, v.dec) + unitTxt(v),
        curWhen: idx === n - 1 ? 'Última lectura' : 'Hace ' + dur((n - 1 - idx) * range.step),
        chartLabel: 'Historial de ' + v.name + ' en ' + bo.name + ', ' + scopeLabel + ', ' + range.label,
        stats: [
          { label: 'Mínimo del período', value: fmt(hay ? mn : null, v.dec) + unitTxt(v), color: mn < v.min ? C.crit : C.text },
          { label: 'Promedio', value: fmt(hay ? sum / cuenta : null, v.dec) + unitTxt(v), color: C.text },
          { label: 'Máximo del período', value: fmt(hay ? mx : null, v.dec) + unitTxt(v), color: mx > v.max ? C.crit : C.text },
          { label: 'Tiempo fuera de rango', value: out ? dur(out * range.step) : 'Ninguno', color: out ? C.crit : C.ok }
        ],
        nodeCompare: bo.nodes.map((nd, k) => {
          const x = nodeVals[k], alertado = alertaDe(nd.id, v.key), s2 = self.status(x, v), sv2 = alertado ? 'crit' : (s2 === 'ok' ? 'ok' : self.sev(x, v)), selected = nsel && nsel.id === nd.id;
          return {
            name: nd.name, value: fmt(x, v.dec) + unitTxt(v),
            color: s2 === 'ok' && !alertado ? C.text : col(sv2), dot: col(sv2),
            bg: selected ? '#F1F6F3' : 'transparent', border: selected ? '#B9CCC2' : 'transparent',
            pick: () => self.setState({ node: nd.id, cursor: null })
          };
        }),
        compare: bags.map((b) => {
          const x = self.avg(b, vi, N24 - 1, N24);
          const mine = alerts.filter((a) => a.bid === b.id && a.iv === vi && a.st !== 'patron');
          const worst = mine.some((a) => a.sev === 'crit') ? 'crit' : (mine.length ? 'warn' : 'ok');
          return {
            name: b.name, value: fmt(x, v.dec) + unitTxt(v),
            color: worst === 'ok' ? C.text : col(worst), dot: col(worst),
            bg: b.id === bo.id ? '#F1F6F3' : 'transparent', border: b.id === bo.id ? '#B9CCC2' : 'transparent',
            pick: go(b.id, null, v.key)
          };
        })
      };
    };

    const isOverview = S.view === 'overview';
    const cards = isOverview ? VARS.map((v, vi) => chart(vi)) : [];
    const dIdx = isOverview ? 0 : Math.max(0, VARS.findIndex((v) => v.key === S.view));
    const d = chart(dIdx);

    // ---- nodos ----
    const nodeCards = [];
    const nodeChips = [{
      label: 'Promedio', pressed: nsel == null,
      bg: nsel == null ? C.ok : '#FAF6E9', fg: nsel == null ? '#FAF6E9' : C.text, border: nsel == null ? C.ok : '#DCE5E0',
      dot: 'transparent', ring: 'transparent',
      pick: () => self.setState({ node: null, cursor: null })
    }];
    bo.nodes.forEach((nd) => {
      const rows = []; let outC = 0, crit = false;
      VARS.forEach((v, vi) => {
        const x = self.val(bo, nd, vi, N24 - 1, N24), alertado = alertaDe(nd.id, v.key), st = alertado ? 'alerta' : self.status(x, v), sv = st === 'ok' ? 'ok' : (alertado ? 'crit' : self.sev(x, v));
        if (st !== 'ok') { outC++; if (sv === 'crit') crit = true; }
        rows.push({ label: v.name, value: fmt(x, v.dec) + unitTxt(v), color: st === 'ok' ? C.text : col(sv), dot: col(sv) });
      });
      const hay = VARS.some((v, vi) => self.val(bo, nd, vi, N24 - 1, N24) != null);
      const sv = outC === 0 ? 'ok' : (crit ? 'crit' : 'warn'), selected = !!(nsel && nsel.id === nd.id);
      const ckey = 'node-' + bo.id + '-' + nd.id;
      const asking = confirmLive === ckey;
      nodeCards.push({
        name: nd.name, rows,
        ultimaTexto: nd.ultimaTs ? 'Última lectura hace ' + haceTxt(Date.now() - nd.ultimaTs) : 'Sin lecturas todavía',
        statusLabel: !hay ? 'Sin lecturas todavía' : (outC === 0 ? 'Normal' : (outC === 1 ? '1 valor fuera de rango' : outC + ' valores fuera de rango')),
        chipBg: sv === 'ok' ? C.okBg : (sv === 'crit' ? C.critBg : C.warnBg), chipFg: col(sv),
        bg: selected ? '#F1F6F3' : '#FAF6E9',
        border: selected ? C.ok : (sv === 'ok' ? '#DCE5E0' : (sv === 'crit' ? 'rgba(200,50,31,0.55)' : 'rgba(161,92,0,0.5)')),
        pressed: selected, btnBg: selected ? C.ok : '#FAF6E9', btnFg: selected ? '#FAF6E9' : C.text,
        btnLabel: selected ? 'Viendo este nodo' : 'Ver este nodo',
        pick: () => self.setState({ node: nd.id, cursor: null }),
        cantRemove: NN <= 1,
        removeLabel: asking ? '¿Seguro? Tocá de nuevo para quitar' : 'Quitar nodo',
        removeFg: asking ? C.crit : C.muted,
        remove: () => {
          if (asking) {
            self.setState({ confirm: null, cursor: null });
            self.quitarNodo(nd.id);
          } else self.setState({ confirm: ckey, confirmAt: Date.now() });
        }
      });
      nodeChips.push({
        label: nd.name, pressed: selected,
        bg: selected ? C.ok : '#FAF6E9', fg: selected ? '#FAF6E9' : C.text, border: selected ? C.ok : '#DCE5E0',
        dot: sv === 'ok' ? '#2E9E6B' : (sv === 'crit' ? '#C8321F' : '#D98E04'), ring: selected ? '#FAF6E9' : 'transparent',
        pick: () => self.setState({ node: nd.id, cursor: null })
      });
    });

    // ---- alta y baja de silobolsas / nodos ----
    const addNode = () => {
      const device = S.nuevoNodo.trim();
      if (!device) return self.error('Ingresá el identificador LoRa del nodo nuevo.');
      if (bo.id < 0) return self.error('Primero creá una silobolsa.');
      self.agregarNodo(bo, device);
    };
    const onNuevoNodo = (e) => { const val = e.target.value; self.setState({ nuevoNodo: val }); };
    const onNuevoNodoKey = (e) => { if (e.key === 'Enter') addNode(); };
    // ---- eliminar silobolsa: aviso + contraseña ----
    const openDel = () => self.setState({ del: { step: 'warn', pw: '', err: false } });
    const delCancel = () => self.setState({ del: { step: null, pw: '', err: false } });
    const delContinue = () => self.setState({ del: { step: 'pass', pw: '', err: false } });
    const onDelPw = (e) => { const val = e.target.value; self.setState((s) => ({ del: Object.assign({}, s.del, { pw: val, err: false }) })); };

    const delSubmit = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      self.borrarSilobolsa(bo.id, self.state.del.pw);
    };
    const bagAlerts = alerts.filter((a) => a.bid === bo.id).length;
    const delSummary = bo.name + ' contiene ' + contentOf(bo) + ' y tiene ' + NN + (NN === 1 ? ' nodo' : ' nodos') + (bagAlerts ? ' (' + bagAlerts + (bagAlerts === 1 ? ' alerta activa' : ' alertas activas') + ')' : '') + '.';
    const setBagField = (field) => (e) => { if (bo.id < 0) return; self.editarContenido(bo.id, { [field]: e.target.value }); };
    const submitBag = () => {
      const nombre = (S.form.name || '').trim() || ('Silobolsa ' + String(bags.length + 1).padStart(2, '0'));
      self.crearSilobolsa(nombre.slice(0, 40), S.form.content || 'Sin definir');
    };

    // ---- navegación ----
    const bagList = bags.map((b) => {
      const mine = alerts.filter((a) => a.bid === b.id);
      const worst = mine.some((a) => a.sev === 'crit') ? 'crit' : (mine.length ? 'warn' : 'ok');
      return {
        name: b.name,
        sub: contentOf(b) + ' · ' + (mine.length ? (mine.length === 1 ? '1 alerta activa' : mine.length + ' alertas activas') : b.nodes.length + (b.nodes.length === 1 ? ' nodo' : ' nodos') + ' · todo normal'),
        subColor: worst === 'crit' ? '#FFB4A6' : (worst === 'warn' ? '#FFD98A' : 'rgba(250,246,233,0.82)'),
        dot: worst === 'ok' ? '#8CF0C4' : (worst === 'crit' ? '#FF9C8C' : '#FFD36E'),
        pressed: b.id === bo.id, bg: b.id === bo.id ? SELF : 'transparent', border: b.id === bo.id ? SELB : 'transparent',
        pick: () => self.setState({ bag: b.id, node: null, cursor: null })
      };
    });
    const varNav = VARS.map((v, vi) => {
      const x = pt(vi, N24 - 1, N24), st = self.status(x, v), sv = bo.nodes.some((nd) => alertaDe(nd.id, v.key)) ? 'crit' : (st === 'ok' ? 'ok' : self.sev(x, v));
      return {
        name: v.name, value: fmt(x, v.dec) + unitTxt(v),
        valColor: sv === 'ok' ? 'rgba(250,246,233,0.85)' : (sv === 'crit' ? '#FFB4A6' : '#FFD98A'),
        dot: sv === 'ok' ? '#8CF0C4' : (sv === 'crit' ? '#FF9C8C' : '#FFD36E'),
        pressed: S.view === v.key, bg: S.view === v.key ? SELF : 'transparent', border: S.view === v.key ? SELB : 'transparent',
        pick: () => self.setState({ view: v.key, cursor: null })
      };
    });
    const rangeList = Object.keys(RANGES).map((k) => ({
      label: RANGES[k].label, pressed: S.range === k,
      bg: S.range === k ? C.ok : 'transparent', fg: S.range === k ? '#FAF6E9' : C.text,
      pick: () => self.setState({ range: k, cursor: null })
    }));
    const ultimaMax = Math.max(0, ...bags.flatMap((b) => b.nodes.map((n) => n.ultimaTs || 0)));
    const ultimaRecepcion = ultimaMax ? 'última lectura hace ' + haceTxt(Date.now() - ultimaMax) : 'sin lecturas todavía';

    // ---- inicio de sesión: el servidor valida y envía el código por correo ----
    const A = S.auth;
    const setAuth = (patch) => self.setState((s) => ({ auth: Object.assign({}, s.auth, patch) }));
    const onAuthField = (campo) => (e) => { const val = e.target.value; setAuth({ [campo]: val, err: '', aviso: '' }); };
    const onLoginCodigo = (e) => { const val = e.target.value.replace(/\D/g, '').slice(0, 6); setAuth({ code: val, err: '', aviso: '' }); };
    const pedirCodigo = async () => {
      if (A.enviando) return;
      const email = A.email.trim().toLowerCase();
      if (!emailValido(email)) { setAuth({ err: 'Ingresá un correo válido, por ejemplo nombre@dominio.com.', aviso: '' }); return; }
      if (!A.pw) { setAuth({ err: 'Ingresá tu contraseña.', aviso: '' }); return; }
      setAuth({ enviando: true, err: '', aviso: '' });
      const r = await llamar('/api/login', { cuerpo: { email: email, password: A.pw } });
      if (!r.ok) { setAuth({ enviando: false, err: r.error, pw: r.status === 401 ? '' : A.pw }); return; }
      setAuth({ enviando: false, paso: 'codigo', email: email, pw: '', code: '', vence: Date.now() + CODE_TTL, err: '', aviso: 'Te mandamos el código a ' + email + '. Si no lo ves, revisá la carpeta de spam.' });
    };
    const reenviarCodigo = async () => {
      if (A.enviando) return;
      setAuth({ enviando: true, err: '', aviso: '' });
      const r = await llamar('/api/codigo/reenviar', { cuerpo: { email: A.email } });
      if (!r.ok) { setAuth({ enviando: false, err: r.error, ...(r.data.volverLogin ? { paso: 'login', email: '', code: '' } : {}) }); return; }
      setAuth({ enviando: false, code: '', vence: Date.now() + CODE_TTL, err: '', aviso: 'Enviamos un código nuevo a ' + A.email + '.' });
    };
    const confirmarCodigo = async () => {
      if (A.enviando) return;
      setAuth({ enviando: true, err: '', aviso: '' });
      const r = await llamar('/api/verify', { cuerpo: { email: A.email, code: A.code } });
      if (!r.ok) { setAuth({ enviando: false, code: '', err: r.error, ...(r.data.volverLogin ? { paso: 'login', email: '', vence: 0 } : {}) }); return; }
      try { window.localStorage.setItem(SESION, r.data.token); } catch (e) { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
      self._token = r.data.token;
      setAuth({ enviando: false, user: r.data.email, token: r.data.token, paso: 'login', email: '', pw: '', code: '', vence: 0, err: '', aviso: '' });
      self.cargarTodo();
      self.conectarEventos();
    };
    const volverLogin = () => setAuth({ paso: 'login', code: '', err: '', aviso: '' });
    const cerrarSesion = async () => {
      await llamar('/api/logout', { token: self._token });
      self.salir();
    };
    const restan = Math.max(0, A.vence - Date.now());

    return {
      bagName: bo.name, scopeLabel, ultimaRecepcion,
      logueado: !!A.user, usuario: A.user || '', avisoApp: S.avisoApp, nuevoNodo: S.nuevoNodo, onNuevoNodo, onNuevoNodoKey,
      avisosList, preferenciasList, noLeidos: S.noLeidos, avisosAbiertos: S.avisosAbiertos,
      menuAbierto: S.menuAbierto,
      toggleMenu: () => self.setState((s) => ({ menuAbierto: !s.menuAbierto })),
      cerrarMenu: () => self.setState({ menuAbierto: false }),
      permisoAvisos: typeof Notification === 'undefined' ? 'no-disponible' : Notification.permission,
      pedirPermisoAvisos: () => self.activarPush(),
      pushActivo: S.pushActivo,
      mostrarPush: soportaPush() && !S.pushActivo && typeof Notification !== 'undefined' && Notification.permission !== 'denied',
      iosSinInstalar: iosSinInstalar(),
      umbralesRows, umbralesAbiertos: S.umbralesAbiertos,
      toggleUmbrales: () => {
        if (S.umbralesAbiertos) return self.setState({ umbralesAbiertos: false });
        self.setState({
          umbralesAbiertos: true,
          umbralEdit: Object.fromEntries(S.umbrales.map((v) => [v.key, { min: String(v.min).replace('.', ','), max: String(v.max).replace('.', ','), err: '', ok: '' }]))
        });
      },
      toggleAvisos: () => {
        const abrir = !S.avisosAbiertos;
        self.setState({ avisosAbiertos: abrir, menuAbierto: false });
        if (abrir) {
          self.cargarAvisos();
          setTimeout(() => { const el = document.getElementById('centro-avisos'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
        }
      },
      leerTodos: () => self.leerTodosAvisos(),
      loginIsCodigo: A.paso === 'codigo', loginEmail: A.email, loginPw: A.pw, loginCodigo: A.code,
      loginDestino: A.email, loginErr: A.err, loginAviso: A.aviso, enviando: A.enviando,
      loginVence: mmss(restan), loginVencido: A.paso === 'codigo' && restan === 0,
      onLoginEmail: onAuthField('email'), onLoginPw: onAuthField('pw'), onLoginCodigo,
      onLoginKey: (e) => { if (e.key === 'Enter') pedirCodigo(); },
      onCodigoKey: (e) => { if (e.key === 'Enter') confirmarCodigo(); },
      pedirCodigo, reenviarCodigo, confirmarCodigo, volverLogin, cerrarSesion,
      headline: isOverview ? 'Tu cosecha, bajo control' : VARS[dIdx].name,
      isOverview, isDetail: !isOverview,
      overviewPressed: isOverview, overviewBg: isOverview ? SELF : 'transparent', overviewBorder: isOverview ? SELB : 'transparent',
      goOverview: () => self.setState({ view: 'overview', cursor: null }),
      bagList, varNav, rangeList, nodeChips, nodeCards,
      cards, d,
      hasBanner: banners.length > 0, banners,
      alertRows, noAlerts: alerts.length === 0,
      alertSummary: alerts.length === 0 ? 'Sin alertas' : alerts.length + (alerts.length === 1 ? ' alerta en toda la planta' : ' alertas en toda la planta'),
      onCursor: (e) => self.setState({ cursor: parseInt(e.target.value, 10) }),
      resetCursor: () => self.setState({ cursor: null }),
      // administración
      addNode, submitBag, openDel, delCancel, delContinue, onDelPw, delSubmit, delSummary,
      cantRemoveBag: bags.length <= 1,
      contentLabel: contentOf(bo), contentValue: bo.content || 'Sin definir', contentIsOther: bo.content === 'Otro', contentCustom: bo.custom || '',
      onContent: setBagField('content'), onContentCustom: setBagField('custom'),
      formContent: S.form.content || 'Sin definir',
      delBorder: S.del.err ? '#C8321F' : '#B9CCC2', onDelKey: (e) => { if (e && e.key === 'Enter') delSubmit(e); },
      delOpen: !!S.del.step, delWarn: S.del.step === 'warn', delPass: S.del.step === 'pass', delErr: S.del.err, delPw: S.del.pw,
      formOpen: S.form.open,
      formLabel: S.form.open ? 'Cancelar' : 'Agregar silobolsa',
      formName: S.form.name,
      toggleForm: () => self.setState((s) => ({ form: { open: !s.form.open, name: '', content: 'Sin definir' } })),
      onFormName: (e) => { const val = e.target.value; self.setState((s) => ({ form: Object.assign({}, s.form, { name: val }) })); },
      onFormContent: (e) => { const val = e.target.value; self.setState((s) => ({ form: Object.assign({}, s.form, { content: val }) })); }
    };
  }

  renderLogin(v) {
    const alerta = { padding: "10px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "600" };
    return (
      <div style={{ minHeight: "100vh", boxSizing: "border-box", padding: "24px 16px", background: "#F3F0E4", color: "#0F2A1F", fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: "14px", lineHeight: "1.45", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <main style={{ width: "100%", maxWidth: "380px", boxSizing: "border-box", padding: "28px 24px", borderRadius: "18px", background: "#FAF6E9", boxShadow: "0 1px 3px rgba(15,42,31,0.08)", display: "flex", flexDirection: "column", gap: "18px" }}>
      <img src="/logos/agryn-logo.png" alt="AGRYN, inteligencia en cada bolsa" style={{ display: "block", width: "min(200px, 70%)", height: "auto", margin: "0 auto" }} />
      <div style={{ textAlign: "center" }}>
      <h1 style={{ margin: "0", font: "700 22px/1.2 'Inter', system-ui, sans-serif", color: "#005A36" }}>
      {v.loginIsCodigo ? "Confirmá tu identidad" : "Ingresá a AGRYN Monitoreo"}
      </h1>
      <p style={{ margin: "6px 0 0", color: "#4F6459" }}>
      {v.loginIsCodigo ? "Te mandamos un código de 6 dígitos a " + v.loginDestino + "." : "Tu cosecha, bajo control."}
      </p>
      </div>
      {!v.loginIsCodigo && (<>
      <label htmlFor="login-email" style={{ fontSize: "13px", fontWeight: "600" }}>
      Correo electrónico
      </label>
      <input id="login-email" type="email" className="field" autoComplete="username" value={v.loginEmail} onChange={v.onLoginEmail} onKeyDown={v.onLoginKey} />
      <label htmlFor="login-pw" style={{ fontSize: "13px", fontWeight: "600" }}>
      Contraseña
      </label>
      <input id="login-pw" type="password" className="field" autoComplete="current-password" value={v.loginPw} onChange={v.onLoginPw} onKeyDown={v.onLoginKey} />
      </>)}
      {v.loginIsCodigo && (<>
      <label htmlFor="login-codigo" style={{ fontSize: "13px", fontWeight: "600" }}>
      Código de confirmación
      </label>
      <input id="login-codigo" type="text" inputMode="numeric" autoComplete="one-time-code" className="field" value={v.loginCodigo} onChange={v.onLoginCodigo} onKeyDown={v.onCodigoKey} style={{ letterSpacing: "0.3em", fontSize: "18px", fontWeight: "700" }} />
      <p style={{ margin: "0", fontSize: "13px", color: v.loginVencido ? "#8F2113" : "#4F6459", fontWeight: v.loginVencido ? "600" : "500" }}>
      {v.loginVencido ? "El código venció. Pedí uno nuevo." : "Vence en " + v.loginVence + "."}
      </p>
      </>)}
      {v.loginErr && (<div role="alert" style={{ ...alerta, background: "#FDECE8", border: "1px solid #C8321F", color: "#8F2113" }}>
      {v.loginErr}
      </div>)}
      {v.loginAviso && (<div role="status" style={{ ...alerta, background: "#E4EDE8", border: "1px solid #B9CCC2", color: "#005A36" }}>
      {v.loginAviso}
      </div>)}
      {v.loginIsCodigo ? (<>
      <button type="button" className="btn primary" onClick={v.confirmarCodigo} disabled={v.enviando} style={{ width: "100%" }}>
      {v.enviando ? "Verificando…" : "Confirmar y entrar"}
      </button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button type="button" className="btn" onClick={v.reenviarCodigo} disabled={v.enviando} style={{ flex: "1 1 140px" }}>
      Reenviar código
      </button>
      <button type="button" className="btn" onClick={v.volverLogin} style={{ flex: "1 1 140px" }}>
      Volver
      </button>
      </div>
      </>) : (
      <button type="button" className="btn primary" onClick={v.pedirCodigo} disabled={v.enviando} style={{ width: "100%" }}>
      {v.enviando ? "Enviando código…" : "Continuar"}
      </button>
      )}
      </main>
      </div>
    );
  }

  render() {
    const v = this.renderVals();
    if (!v.logueado) return this.renderLogin(v);
    return (
      <div className="app" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", background: "#F3F0E4", color: "#0F2A1F", fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: "14px", lineHeight: "1.45" }}>
      <header className="barra">
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "0" }}>
      <img src="/logos/agryn-hoja-reversa.png" alt="" aria-hidden="true" style={{ width: "28px", height: "28px", flex: "none" }} />
      <span style={{ font: "700 16px/1 'Inter', sans-serif", letterSpacing: "0.04em" }}>AGRYN</span>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
      <button type="button" className="btn" onClick={v.toggleAvisos} aria-expanded={v.avisosAbiertos} style={{ background: "transparent", color: "#FAF6E9", borderColor: "rgba(250,246,233,0.42)" }}>
      {v.noLeidos ? "Avisos (" + v.noLeidos + ")" : "Avisos"}
      </button>
      <button type="button" className="btn" onClick={v.toggleMenu} aria-expanded={v.menuAbierto} aria-controls="menu-silobolsas" style={{ background: "transparent", color: "#FAF6E9", borderColor: "rgba(250,246,233,0.42)" }}>
      Menú
      </button>
      </div>
      </header>
      <div className="hook" aria-hidden="true">
      <img className="tile" src="/logos/agryn-hoja-reversa.png" alt="" style={{ display: "block", width: "min(210px, 40vw)", height: "auto" }} />
      </div>
      <aside id="menu-silobolsas" className={"side" + (v.menuAbierto ? " abierto" : "")} onClick={(e) => { if (e.target.closest && e.target.closest('button')) this.setState({ menuAbierto: false }); }} style={{ flex: "1 1 260px", minWidth: "0", boxSizing: "border-box", padding: "24px 16px", background: "#005A36", color: "#FAF6E9", display: "flex", flexDirection: "column", gap: "28px" }}>
      <div className="logo-card bleed">
      <img src="/logos/agryn-logo.png" alt="AGRYN, inteligencia en cada bolsa" />
      </div>
      <nav aria-label="Silobolsas" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <h2 style={{ margin: "0 12px 8px", font: "600 12px/1 'Montserrat', sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(250,246,233,0.78)" }}>
      Silobolsas
      </h2>
      {v.bagList.map((b, $index) => (<React.Fragment key={$index}>
      <button className="row-btn" onClick={b.pick} aria-pressed={b.pressed} style={{ background: `${b.bg}`, borderColor: `${b.border}` }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "999px", flex: "none", background: `${b.dot}` }} aria-hidden="true">
      </span>
      <span style={{ flex: "1", minWidth: "0" }}>
      <span style={{ display: "block", fontWeight: "600" }}>
      {b.name}
      </span>
      <span style={{ display: "block", fontSize: "12px", color: `${b.subColor}` }}>
      {b.sub}
      </span>
      </span>
      </button>
      </React.Fragment>))}
      <button className="row-btn" onClick={v.toggleForm} aria-expanded={v.formOpen} style={{ marginTop: "4px", justifyContent: "center", fontWeight: "600", border: "1px dashed rgba(250,246,233,0.55)" }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#FAF6E9" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
      </svg>
      {v.formLabel}
      </button>
      {v.formOpen && (<>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "4px", padding: "14px 12px", borderRadius: "10px", background: "rgba(250,246,233,0.10)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label htmlFor="bag-name" style={{ fontSize: "12px", fontWeight: "600" }}>
      Nombre
      </label>
      <input id="bag-name" type="text" maxLength="40" placeholder="Ej.: Silobolsa 05" value={v.formName} onChange={v.onFormName} style={{ minHeight: "44px", boxSizing: "border-box", padding: "0 12px", borderRadius: "8px", border: "1px solid transparent", font: "500 14px 'Montserrat', sans-serif", color: "#0F2A1F", background: "#FAF6E9" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label htmlFor="bag-content" style={{ fontSize: "12px", fontWeight: "600" }}>
      Contenido
      </label>
      <select id="bag-content" className="field" value={v.formContent} onChange={v.onFormContent}>
      <option value="Soja">
      Soja
      </option>
      <option value="Maíz">
      Maíz
      </option>
      <option value="Trigo">
      Trigo
      </option>
      <option value="Girasol">
      Girasol
      </option>
      <option value="Sorgo">
      Sorgo
      </option>
      <option value="Cebada">
      Cebada
      </option>
      <option value="Forraje">
      Forraje
      </option>
      <option value="Sin definir">
      Sin definir
      </option>
      </select>
      </div>
      <button className="btn" onClick={v.submitBag}>
      Crear silobolsa
      </button>
      </div>
      </>)}
      </nav>
      <nav aria-label="Variables" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <h2 style={{ margin: "0 12px 8px", font: "600 12px/1 'Montserrat', sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(250,246,233,0.78)" }}>
      Variables
      </h2>
      <button className="row-btn" onClick={v.goOverview} aria-pressed={v.overviewPressed} style={{ background: `${v.overviewBg}`, borderColor: `${v.overviewBorder}` }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#FAF6E9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
      <span style={{ flex: "1", fontWeight: "600" }}>
      Resumen
      </span>
      </button>
      {v.varNav.map((n, $index) => (<React.Fragment key={$index}>
      <button className="row-btn" onClick={n.pick} aria-pressed={n.pressed} style={{ background: `${n.bg}`, borderColor: `${n.border}` }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "999px", flex: "none", background: `${n.dot}` }} aria-hidden="true">
      </span>
      <span style={{ flex: "1", fontWeight: "600" }}>
      {n.name}
      </span>
      <span style={{ font: "600 13px/1 'Inter', sans-serif", color: `${n.valColor}` }}>
      {n.value}
      </span>
      </button>
      </React.Fragment>))}
      </nav>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "auto" }}>
      <button className="row-btn" onClick={v.toggleUmbrales} aria-expanded={v.umbralesAbiertos} style={{ justifyContent: "center", fontWeight: "600", border: "1px solid rgba(250,246,233,0.42)" }}>
      Umbrales de alerta
      </button>
      <button className="row-btn" onClick={v.toggleAvisos} aria-expanded={v.avisosAbiertos} style={{ justifyContent: "center", fontWeight: "600", border: "1px solid rgba(250,246,233,0.42)" }}>
      {v.noLeidos ? "Avisos · " + v.noLeidos + " sin leer" : "Avisos"}
      </button>
      <p style={{ margin: "0 12px", fontSize: "12px", color: "rgba(250,246,233,0.82)", overflowWrap: "anywhere" }}>
      Sesión iniciada como {v.usuario}
      </p>
      <button className="row-btn" onClick={v.cerrarSesion} style={{ justifyContent: "center", fontWeight: "600", border: "1px solid rgba(250,246,233,0.42)" }}>
      Cerrar sesión
      </button>
      </div>
      </aside>
      <div className={"menu-fondo" + (v.menuAbierto ? " abierto" : "")} onClick={v.cerrarMenu} aria-hidden="true" />
      <main style={{ flex: "999 1 560px", minWidth: "0", boxSizing: "border-box", padding: "clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: "24px" }}>
      {v.avisoApp && (<div role="alert" style={{ padding: "10px 12px", borderRadius: "8px", background: "#FDECE8", border: "1px solid #C8321F", color: "#8F2113", fontSize: "13px", fontWeight: "600" }}>
      {v.avisoApp}
      </div>)}
      {v.umbralesAbiertos && (<section aria-label="Umbrales de alerta" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px 20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
      <h2 style={{ margin: "0", font: "700 20px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Umbrales de alerta
      </h2>
      <button type="button" className="btn" onClick={v.toggleUmbrales}>
      Cerrar
      </button>
      </div>
      <p style={{ margin: "0", fontSize: "13px", color: "#4F6459" }}>
      Fuera de este rango salta una alerta. Los cambios valen para las lecturas que llegan de ahora en adelante.
      </p>
      {v.umbralesRows.map((r, $index) => (<React.Fragment key={$index}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end", padding: "12px", borderRadius: "8px", border: "1px solid #DCE5E0" }}>
      <p style={{ margin: "0", flex: "1 1 140px", fontWeight: "600" }}>
      {r.nombre}{r.unidad ? " (" + r.unidad + ")" : ""}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 110px" }}>
      <label htmlFor={"umb-min-" + r.key} style={{ fontSize: "12px", fontWeight: "600" }}>
      Mínimo de {r.nombre}
      </label>
      <input id={"umb-min-" + r.key} type="text" inputMode="decimal" className="field" value={r.min} onChange={r.onMin} onKeyDown={r.onKey} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 110px" }}>
      <label htmlFor={"umb-max-" + r.key} style={{ fontSize: "12px", fontWeight: "600" }}>
      Máximo de {r.nombre}
      </label>
      <input id={"umb-max-" + r.key} type="text" inputMode="decimal" className="field" value={r.max} onChange={r.onMax} onKeyDown={r.onKey} />
      </div>
      <button type="button" className="btn primary" onClick={r.guardar}>
      Guardar
      </button>
      {r.err && (<div role="alert" style={{ flex: "1 1 100%", padding: "8px 10px", borderRadius: "8px", background: "#FDECE8", border: "1px solid #C8321F", color: "#8F2113", fontSize: "13px", fontWeight: "600" }}>
      {r.err}
      </div>)}
      {r.ok && (<p role="status" style={{ flex: "1 1 100%", margin: "0", fontSize: "13px", fontWeight: "600", color: "#005A36" }}>
      {r.ok}
      </p>)}
      </div>
      </React.Fragment>))}
      </section>)}
      {v.avisosAbiertos && (<section id="centro-avisos" aria-label="Centro de avisos" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
      <h2 style={{ margin: "0", font: "700 20px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Centro de avisos
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button type="button" className="btn" onClick={v.leerTodos} disabled={!v.noLeidos}>
      Marcar todos como leídos
      </button>
      <button type="button" className="btn" onClick={v.toggleAvisos}>
      Cerrar
      </button>
      </div>
      </div>
      {v.mostrarPush && (<div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", padding: "12px", borderRadius: "8px", background: "#F1F6F3" }}>
      <p style={{ margin: "0", flex: "1 1 220px", fontSize: "13px" }}>
      {v.iosSinInstalar ? "En iPhone, primero agregá AGRYN a la pantalla de inicio (botón Compartir) y abrila desde ahí para recibir las alertas." : "Activá las notificaciones de este celular para enterarte de las alertas críticas aunque la app esté cerrada."}
      </p>
      {!v.iosSinInstalar && (<button type="button" className="btn primary" onClick={v.pedirPermisoAvisos}>
      Activar notificaciones
      </button>)}
      </div>)}
      {v.permisoAvisos === 'denied' && (<p role="note" style={{ margin: "0", fontSize: "13px", color: "#8F2113", fontWeight: "600" }}>
      Las notificaciones de este navegador están bloqueadas. Para verlas, habilitalas en la configuración del navegador. Mientras tanto, las alertas críticas aparecen en el banner rojo de la app y llegan por correo.
      </p>)}
      {v.preferenciasList.length > 0 && (<fieldset style={{ margin: "0", padding: "12px", borderRadius: "8px", border: "1px solid #DCE5E0", display: "flex", flexDirection: "column", gap: "4px" }}>
      <legend style={{ padding: "0 4px", fontSize: "13px", fontWeight: "600" }}>
      Silobolsas de las que querés recibir avisos
      </legend>
      {v.preferenciasList.map((p, $index) => (<React.Fragment key={$index}>
      <label style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", cursor: "pointer" }}>
      <input type="checkbox" checked={p.recibe} onChange={p.cambiar} style={{ width: "20px", height: "20px", accentColor: "#005A36", flex: "none" }} />
      <span>
      {p.nombre}{p.recibe ? "" : " (silenciada)"}
      </span>
      </label>
      </React.Fragment>))}
      </fieldset>)}
      {v.avisosList.length === 0 && (<p style={{ margin: "0", color: "#4F6459" }}>
      Todavía no hay avisos. Te llegan cuando una alerta sigue sin reconocerse.
      </p>)}
      {v.avisosList.map((a, $index) => (<React.Fragment key={$index}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "8px", border: "1px solid #DCE5E0", background: a.leido ? "transparent" : "#F1F6F3" }}>
      <div style={{ flex: "1 1 220px", minWidth: "0" }}>
      <p style={{ margin: "0", fontWeight: "600" }}>
      {a.titulo}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#4F6459" }}>
      {a.estado} · {a.detalle}
      </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button type="button" className="btn" onClick={a.ver}>
      Ver nodo
      </button>
      {!a.leido && (<button type="button" className="btn" onClick={a.leer}>
      Marcar como leído
      </button>)}
      </div>
      </div>
      </React.Fragment>))}
      </section>)}
      <header style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "0" }}>
      <p style={{ margin: "0", font: "600 13px/1 'Montserrat', sans-serif", letterSpacing: "0.1em", textTransform: "uppercase", color: "#4F6459" }}>
      {v.bagName} · {v.contentLabel} · {v.scopeLabel}
      </p>
      <h1 style={{ margin: "0", font: "700 clamp(30px, 5vw, 44px)/1.05 'Inter', sans-serif", letterSpacing: "-0.03em" }}>
      {v.headline}
      </h1>
      {v.isOverview && (<>
      <p style={{ margin: "4px 0 0", maxWidth: "56ch", color: "#4F6459" }}>
      Seguimos el pH, la temperatura, la humedad y el CO₂ de cada nodo dentro de la silobolsa, y te avisamos al instante si algo se sale de lo normal.
      </p>
      </>)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#4F6459" }}>
      <span className="pulse" style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#005A36" }} aria-hidden="true">
      </span>
      Datos de la central · {v.ultimaRecepcion}
      </span>
      <div role="group" aria-label="Rango de tiempo" style={{ display: "inline-flex", padding: "4px", gap: "4px", background: "#FAF6E9", border: "1px solid #DCE5E0", borderRadius: "10px" }}>
      {v.rangeList.map((r, $index) => (<React.Fragment key={$index}>
      <button className="btn" onClick={r.pick} aria-pressed={r.pressed} style={{ minWidth: "76px", borderColor: "transparent", background: `${r.bg}`, color: `${r.fg}` }}>
      {r.label}
      </button>
      </React.Fragment>))}
      </div>
      </div>
      </header>
      <div role="group" aria-label="Ver datos de" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "13px", color: "#4F6459", marginRight: "4px" }}>
      Ver datos de:
      </span>
      {v.nodeChips.map((c, $index) => (<React.Fragment key={$index}>
      <button className="btn" onClick={c.pick} aria-pressed={c.pressed} style={{ background: `${c.bg}`, color: `${c.fg}`, borderColor: `${c.border}` }}>
      <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: `${c.dot}`, boxShadow: `0 0 0 2px ${c.ring}` }} aria-hidden="true">
      </span>
      {c.label}
      </button>
      </React.Fragment>))}
      </div>
      {v.hasBanner && (<>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {v.banners.map((b) => (<React.Fragment key={b.id}>
      <section role="alert" aria-live="assertive" className="flash" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px", padding: "16px 20px", borderRadius: "12px", background: `${b.bg}`, border: `1px solid ${b.border}`, color: `${b.fg}` }}>
      <span style={{ width: "44px", height: "44px", flex: "none", borderRadius: "999px", background: `${b.iconBg}`, color: `${b.iconFg}`, display: "grid", placeItems: "center" }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
      </svg>
      </span>
      <div style={{ flex: "1 1 300px", minWidth: "0" }}>
      <p style={{ margin: "0", font: "700 13px/1 'Montserrat', sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: `${b.accent}` }}>
      {b.kicker}
      </p>
      <p style={{ margin: "6px 0 0", font: "700 22px/1.15 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      {b.title}
      </p>
      <p style={{ margin: "4px 0 0", color: `${b.detailColor}` }}>
      {b.detail}
      </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button className="btn" onClick={b.open}>
      Ver detalle
      </button>
      {b.canAck && (<>
      <button className="btn primary" onClick={b.ack}>
      Reconocer
      </button>
      </>)}
      {b.fija && (<>
      <span style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${b.accent}`, color: `${b.fg}`, fontSize: "13px", fontWeight: "600" }}>
      Se cierra sola cuando se solucione
      </span>
      </>)}
      </div>
      </section>
      </React.Fragment>))}
      </div>
      </>)}
      {v.isOverview && (<>
      <section aria-label="Contenido de la silobolsa" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px", padding: "16px 20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <div style={{ flex: "1 1 220px", minWidth: "0" }}>
      <p style={{ margin: "0", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#4F6459" }}>
      Contenido almacenado
      </p>
      <p style={{ margin: "6px 0 0", font: "700 26px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      {v.contentLabel}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#4F6459" }}>
      Cambialo cuando cargues otro cultivo en {v.bagName}.
      </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 200px", maxWidth: "280px" }}>
      <label htmlFor="content-sel" style={{ fontSize: "12px", fontWeight: "600", color: "#2E453A" }}>
      Cambiar contenido
      </label>
      <select id="content-sel" className="field" value={v.contentValue} onChange={v.onContent}>
      <option value="Soja">
      Soja
      </option>
      <option value="Maíz">
      Maíz
      </option>
      <option value="Trigo">
      Trigo
      </option>
      <option value="Girasol">
      Girasol
      </option>
      <option value="Sorgo">
      Sorgo
      </option>
      <option value="Cebada">
      Cebada
      </option>
      <option value="Forraje">
      Forraje
      </option>
      <option value="Otro">
      Otro
      </option>
      <option value="Sin definir">
      Sin definir
      </option>
      </select>
      </div>
      {v.contentIsOther && (<>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 200px", maxWidth: "280px" }}>
      <label htmlFor="content-custom" style={{ fontSize: "12px", fontWeight: "600", color: "#2E453A" }}>
      ¿Qué contiene?
      </label>
      <input id="content-custom" type="text" maxLength="40" className="field" placeholder="Ej.: Cebada cervecera" value={v.contentCustom} onChange={v.onContentCustom} />
      </div>
      </>)}
      </section>
      <section aria-label="Variables medidas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(250px, 100%), 1fr))", gap: "16px" }}>
      {v.cards.map((c, $index) => (<React.Fragment key={$index}>
      <article style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "12px", background: "#FAF6E9", border: `1px solid ${c.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <h3 style={{ margin: "0", font: "600 16px/1 'Montserrat', sans-serif", color: "#2E453A" }}>
      {c.name}
      </h3>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: "600", background: `${c.chipBg}`, color: `${c.chipFg}` }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: `${c.chipFg}` }} aria-hidden="true">
      </span>
      {c.statusLabel}
      </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      <span style={{ font: "700 52px/0.95 'Inter', sans-serif", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: `${c.valColor}` }}>
      {c.value}
      </span>
      <span style={{ font: "500 20px/1 'Inter', sans-serif", color: "#4F6459" }}>
      {c.unit}
      </span>
      </div>
      <div style={{ position: "relative", height: "84px" }}>
      <svg viewBox="0 0 600 100" preserveAspectRatio="none" style={{ position: "absolute", inset: "0", width: "100%", height: "100%" }} aria-hidden="true">
      <rect x="0" y={c.bandY} width="600" height={c.bandH} fill="rgba(0,90,54,0.08)" />
      <path d={c.area} fill="rgba(0,90,54,0.08)" />
      <path d={c.line} fill="none" stroke={c.lineColor} strokeWidth={c.lineColor === '#C8321F' ? 3 : 2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={c.dots} fill="none" stroke="#C8321F" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={c.last} fill="none" stroke={c.lastColor} strokeWidth="9" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      </div>
      <dl style={{ margin: "0", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
      <div>
      <dt style={{ fontSize: "12px", color: "#4F6459" }}>
      Mín.
      </dt>
      <dd style={{ margin: "0", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
      {c.statMin}
      </dd>
      </div>
      <div>
      <dt style={{ fontSize: "12px", color: "#4F6459" }}>
      Prom.
      </dt>
      <dd style={{ margin: "0", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
      {c.statAvg}
      </dd>
      </div>
      <div>
      <dt style={{ fontSize: "12px", color: "#4F6459" }}>
      Máx.
      </dt>
      <dd style={{ margin: "0", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
      {c.statMax}
      </dd>
      </div>
      </dl>
      <p style={{ margin: "0", fontSize: "13px", fontWeight: "600", color: `${c.noteColor}` }}>
      {c.note}
      </p>
      <p style={{ margin: "-8px 0 0", fontSize: "12px", color: "#4F6459" }}>
      Rango habitual {c.rangeText}
      </p>
      <button className="btn" onClick={c.open} aria-label={c.openLabel}>
      Ver detalle
      </button>
      </article>
      </React.Fragment>))}
      </section>
      <section aria-label="Nodos de la silobolsa" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
      <div>
      <h2 style={{ margin: "0", font: "700 24px/1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Nodos de {v.bagName}
      </h2>
      <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#4F6459" }}>
      Cada nodo mide los mismos cuatro valores.
      </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
      <input id="nodo-device" type="text" maxLength="64" className="field" aria-label="Identificador LoRa del nodo nuevo" placeholder="Identificador LoRa, ej.: ESP32-A1" value={v.nuevoNodo} onChange={v.onNuevoNodo} onKeyDown={v.onNuevoNodoKey} style={{ maxWidth: "240px" }} />
      <button className="btn primary" onClick={v.addNode}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#FAF6E9" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
      </svg>
      Agregar nodo
      </button>
      <button className="btn" onClick={v.openDel} disabled={v.cantRemoveBag} style={{ color: "#B02A18", borderColor: "rgba(200,50,31,0.45)" }}>
      Eliminar silobolsa
      </button>
      </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "16px" }}>
      {v.nodeCards.map((nd, $index) => (<React.Fragment key={$index}>
      <article style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px", borderRadius: "12px", background: `${nd.bg}`, border: `1px solid ${nd.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <h3 style={{ margin: "0", font: "700 18px/1 'Inter', sans-serif", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
      {nd.name}
      </h3>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: "600", background: `${nd.chipBg}`, color: `${nd.chipFg}` }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: `${nd.chipFg}` }} aria-hidden="true">
      </span>
      {nd.statusLabel}
      </span>
      </div>
      <p style={{ margin: "0", fontSize: "12px", color: "#4F6459" }}>
      {nd.ultimaTexto}
      </p>
      <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
      {nd.rows.map((r, $index) => (<React.Fragment key={$index}>
      <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#2E453A" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: `${r.dot}` }} aria-hidden="true">
      </span>
      {r.label}
      </span>
      <span style={{ fontWeight: "700", fontVariantNumeric: "tabular-nums", color: `${r.color}` }}>
      {r.value}
      </span>
      </li>
      </React.Fragment>))}
      </ul>
      <button className="btn" onClick={nd.pick} aria-pressed={nd.pressed} style={{ background: `${nd.btnBg}`, color: `${nd.btnFg}` }}>
      {nd.btnLabel}
      </button>
      <button className="btn" onClick={nd.remove} disabled={nd.cantRemove} style={{ borderColor: "transparent", background: "transparent", fontSize: "12px", color: `${nd.removeFg}` }}>
      {nd.removeLabel}
      </button>
      </article>
      </React.Fragment>))}
      </div>
      </section>
      <section aria-label="Alertas" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
      <h2 style={{ margin: "0", font: "700 24px/1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Alertas activas
      </h2>
      <span style={{ fontSize: "13px", color: "#4F6459" }}>
      {v.alertSummary}
      </span>
      </div>
      {v.noAlerts && (<>
      <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "12px 0" }}>
      <img src="/logos/agryn-hoja.png" alt="" style={{ width: "48px", height: "auto", flex: "none" }} />
      <p style={{ margin: "0", color: "#4F6459" }}>
      Todo en orden: ningún nodo tiene valores fuera del rango habitual.
      </p>
      </div>
      </>)}
      <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
      {v.alertRows.map((a, $index) => (<React.Fragment key={$index}>
      <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "10px", background: "#F1F6F3", border: `1px solid ${a.border}` }}>
      <span style={{ flex: "none", minWidth: "78px", textAlign: "center", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", background: `${a.pillBg}`, color: `${a.pillFg}` }}>
      {a.sev}
      </span>
      <div style={{ flex: "1 1 260px", minWidth: "0" }}>
      <p style={{ margin: "0", fontWeight: "600" }}>
      {a.title}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#4F6459" }}>
      {a.detail}
      </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
      <button className="btn" onClick={a.open}>
      Ver detalle
      </button>
      {a.canAck && (<>
      <button className="btn" onClick={a.ack}>
      Reconocer
      </button>
      </>)}
      {a.isAcked && (<>
      <span style={{ fontSize: "13px", color: "#4F6459", padding: "0 8px" }}>
      Reconocida
      </span>
      </>)}
      {a.fija && (<>
      <span style={{ fontSize: "13px", color: "#4F6459", padding: "0 8px" }}>
      Se cierra sola cuando se solucione
      </span>
      </>)}
      </div>
      </li>
      </React.Fragment>))}
      </ul>
      </section>
      </>)}
      {v.isDetail && (<>
      <section style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px", borderRadius: "12px", background: "#FAF6E9", border: `1px solid ${v.d.border}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
      <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
      <span style={{ font: "700 68px/0.95 'Inter', sans-serif", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: `${v.d.valColor}` }}>
      {v.d.value}
      </span>
      <span style={{ font: "500 26px/1 'Inter', sans-serif", color: "#4F6459" }}>
      {v.d.unit}
      </span>
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "10px", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: "600", background: `${v.d.chipBg}`, color: `${v.d.chipFg}` }}>
      <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: `${v.d.chipFg}` }} aria-hidden="true">
      </span>
      {v.d.statusLabel}
      </span>
      <p style={{ margin: "8px 0 0", fontSize: "13px", fontWeight: "600", color: `${v.d.noteColor}` }}>
      {v.d.note}
      </p>
      </div>
      <div style={{ padding: "12px 16px", borderRadius: "10px", background: "#F1F6F3", minWidth: "200px" }}>
      <p style={{ margin: "0", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#4F6459" }}>
      Lectura seleccionada
      </p>
      <p style={{ margin: "4px 0 0", font: "700 26px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: `${v.d.curColor}` }}>
      {v.d.curText}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#4F6459" }}>
      {v.d.curWhen}
      </p>
      </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
      <div style={{ position: "relative", width: "52px", flex: "none", height: "340px" }} aria-hidden="true">
      {v.d.yTicks.map((t, $index) => (<React.Fragment key={$index}>
      <span style={{ position: "absolute", right: "0", top: `${t.top}%`, transform: "translateY(-50%)", fontSize: "12px", color: "#4F6459", fontVariantNumeric: "tabular-nums" }}>
      {t.label}
      </span>
      </React.Fragment>))}
      </div>
      <div style={{ flex: "1", minWidth: "0" }}>
      <div style={{ position: "relative", height: "340px", borderRadius: "8px", background: "#F6F9F7", overflow: "hidden" }}>
      <svg viewBox="0 0 600 100" preserveAspectRatio="none" style={{ position: "absolute", inset: "0", width: "100%", height: "100%" }} role="img" aria-label={v.d.chartLabel}>
      <rect x="0" y={v.d.bandY} width="600" height={v.d.bandH} fill="rgba(0,90,54,0.07)" />
      <path d={v.d.grid} fill="none" stroke="rgba(0,90,54,0.10)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={v.d.limitLines} fill="none" stroke="#B7791F" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
      <path d={v.d.area} fill="rgba(0,90,54,0.08)" />
      <path d={v.d.line} fill="none" stroke={v.d.lineColor} strokeWidth={v.d.lineColor === '#C8321F' ? 4 : 2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={v.d.dots} fill="none" stroke="#C8321F" strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={v.d.cursorLine} fill="none" stroke="#0F2A1F" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={v.d.cursorDot} fill="none" stroke={v.d.curColor} strokeWidth="12" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: "absolute", right: "10px", top: `${v.d.maxTop}%`, transform: "translateY(-110%)", padding: "1px 6px", borderRadius: "4px", background: "#FAF6E9", fontSize: "12px", fontWeight: "600", color: "#8A4D00" }}>
      Máx. {v.d.maxText}
      </span>
      <span style={{ position: "absolute", right: "10px", top: `${v.d.minTop}%`, transform: "translateY(10%)", padding: "1px 6px", borderRadius: "4px", background: "#FAF6E9", fontSize: "12px", fontWeight: "600", color: "#8A4D00" }}>
      Mín. {v.d.minText}
      </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", fontSize: "12px", color: "#4F6459" }} aria-hidden="true">
      {v.d.xTicks.map((x, $index) => (<React.Fragment key={$index}>
      <span>
      {x.label}
      </span>
      </React.Fragment>))}
      </div>
      </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", paddingLeft: "60px" }}>
      <label htmlFor="cursor" style={{ fontSize: "13px", color: "#4F6459", flex: "none" }}>
      Recorrer historial
      </label>
      <input id="cursor" type="range" min="0" max={v.d.maxIdx} value={v.d.cursorIdx} onChange={v.onCursor} style={{ flex: "1 1 240px", minHeight: "44px", minWidth: "0" }} />
      <button className="btn" onClick={v.resetCursor}>
      Volver al presente
      </button>
      </div>
      </section>
      <section aria-label="Estadísticas del período" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "16px" }}>
      {v.d.stats.map((s, $index) => (<React.Fragment key={$index}>
      <div style={{ padding: "16px 20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <p style={{ margin: "0", fontSize: "13px", color: "#4F6459" }}>
      {s.label}
      </p>
      <p style={{ margin: "6px 0 0", font: "700 30px/1 'Inter', sans-serif", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: `${s.color}` }}>
      {s.value}
      </p>
      </div>
      </React.Fragment>))}
      </section>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-start" }}>
      <section style={{ flex: "1 1 280px", minWidth: "0", padding: "20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <h2 style={{ margin: "0 0 12px", font: "700 20px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      {v.d.name} en cada nodo
      </h2>
      <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
      {v.d.nodeCompare.map((k, $index) => (<React.Fragment key={$index}>
      <li>
      <button className="row-btn" onClick={k.pick} style={{ background: `${k.bg}`, borderColor: `${k.border}` }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "999px", flex: "none", background: `${k.dot}` }} aria-hidden="true">
      </span>
      <span style={{ flex: "1", fontWeight: "600" }}>
      {k.name}
      </span>
      <span style={{ font: "700 18px/1 'Inter', sans-serif", fontVariantNumeric: "tabular-nums", color: `${k.color}` }}>
      {k.value}
      </span>
      </button>
      </li>
      </React.Fragment>))}
      </ul>
      </section>
      <section style={{ flex: "1 1 280px", minWidth: "0", padding: "20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <h2 style={{ margin: "0 0 12px", font: "700 20px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      {v.d.name} en cada silobolsa
      </h2>
      <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
      {v.d.compare.map((k, $index) => (<React.Fragment key={$index}>
      <li>
      <button className="row-btn" onClick={k.pick} style={{ background: `${k.bg}`, borderColor: `${k.border}` }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "999px", flex: "none", background: `${k.dot}` }} aria-hidden="true">
      </span>
      <span style={{ flex: "1", fontWeight: "600" }}>
      {k.name}
      </span>
      <span style={{ font: "700 18px/1 'Inter', sans-serif", fontVariantNumeric: "tabular-nums", color: `${k.color}` }}>
      {k.value}
      </span>
      </button>
      </li>
      </React.Fragment>))}
      </ul>
      <p style={{ margin: "12px 0 0", fontSize: "12px", color: "#4F6459" }}>
      Promedio de los nodos de cada silobolsa.
      </p>
      </section>
      <section style={{ flex: "1 1 280px", minWidth: "0", padding: "20px", borderRadius: "12px", background: "#FAF6E9", border: "1px solid #DCE5E0" }}>
      <h2 style={{ margin: "0 0 12px", font: "700 20px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Umbrales de alerta
      </h2>
      <dl style={{ margin: "0", display: "grid", gridTemplateColumns: "1fr auto", gap: "10px 16px" }}>
      <dt style={{ color: "#4F6459" }}>
      Mínimo habitual
      </dt>
      <dd style={{ margin: "0", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
      {v.d.minText}
      </dd>
      <dt style={{ color: "#4F6459" }}>
      Máximo habitual
      </dt>
      <dd style={{ margin: "0", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>
      {v.d.maxText}
      </dd>
      <dt style={{ color: "#4F6459" }}>
      Aviso
      </dt>
      <dd style={{ margin: "0", fontWeight: "600" }}>
      Al instante
      </dd>
      </dl>
      <p style={{ margin: "14px 0 0", fontSize: "12px", color: "#4F6459" }}>
      Valores de ejemplo: ajustalos según el grano almacenado y el criterio del equipo técnico.
      </p>
      </section>
      </div>
      </>)}
      <section aria-label="Origen de los datos" style={{ padding: "16px 20px", borderRadius: "12px", border: "1px dashed #B9CCC2", marginTop: "auto" }}>
      <p style={{ margin: "0", fontSize: "13px", color: "#4F6459" }}>
      La central manda los datos cada 30 segundos. Las alertas saltan al instante y quedan hasta que las reconozcas. Las alertas saltan al instante y quedan hasta que las reconozcas.
      </p>
      </section>
      </main>
      {v.delOpen && (<>
      <div style={{ position: "fixed", inset: "0", zIndex: "60", background: "rgba(15,42,31,0.6)", display: "grid", placeItems: "center", padding: "16px", overflow: "auto" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="del-title" style={{ width: "min(480px, 100%)", boxSizing: "border-box", background: "#FAF6E9", color: "#0F2A1F", borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
      {v.delWarn && (<>
      <span style={{ width: "48px", height: "48px", borderRadius: "999px", background: "#B02A18", color: "#FAF6E9", display: "grid", placeItems: "center" }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
      </svg>
      </span>
      <h2 id="del-title" style={{ margin: "0", font: "700 26px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Vas a eliminar {v.bagName}
      </h2>
      <p style={{ margin: "0", color: "#2E453A" }}>
      {v.delSummary}
      </p>
      <ul style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px", color: "#2E453A" }}>
      <li>
      Se borran sus nodos y todo el historial de lecturas.
      </li>
      <li>
      Deja de monitorearse y no vas a recibir más alertas de esta silobolsa.
      </li>
      <li style={{ fontWeight: "700", color: "#B02A18" }}>
      Esta acción no se puede deshacer.
      </li>
      </ul>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
      <button className="btn" onClick={v.delCancel}>
      Cancelar
      </button>
      <button className="btn danger" onClick={v.delContinue}>
      Entiendo, continuar
      </button>
      </div>
      </>)}
      {v.delPass && (<>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h2 id="del-title" style={{ margin: "0", font: "700 26px/1.1 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      Confirmá con tu contraseña
      </h2>
      <p style={{ margin: "0", color: "#2E453A" }}>
      Para eliminar {v.bagName} ingresá la contraseña de usuario.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label htmlFor="del-pw" style={{ fontSize: "13px", fontWeight: "600" }}>
      Contraseña
      </label>
      <input id="del-pw" type="password" className="field" autoComplete="off" autoFocus={true} value={v.delPw} onChange={v.onDelPw} onKeyDown={v.onDelKey} aria-invalid={v.delErr} style={{ borderColor: `${v.delBorder}` }} />
      {v.delErr && (<>
      <div role="alert" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "8px", background: "#FDECE8", border: "1px solid #C8321F", color: "#8F2113", fontSize: "13px", fontWeight: "600" }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5.5M12 16.3h.01" />
      </svg>
      <span>
      Contraseña incorrecta. No se eliminó la silobolsa; probá de nuevo.
      </span>
      </div>
      </>)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
      <button type="button" className="btn" onClick={v.delCancel}>
      Cancelar
      </button>
      <button type="button" className="btn danger" onClick={v.delSubmit}>
      Eliminar definitivamente
      </button>
      </div>
      </div>
      </>)}
      </div>
      </div>
      </>)}
      </div>
    );
  }

}
