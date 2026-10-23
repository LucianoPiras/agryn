import React from 'react';

const VARS = [
  { key: 'ph',   name: 'pH',          unit: '',   dec: 2, min: 5.8, max: 7.2 },
  { key: 'temp', name: 'Temperatura', unit: '°C', dec: 1, min: 10,  max: 25 },
  { key: 'hum',  name: 'Humedad',     unit: '%',  dec: 1, min: 12,  max: 14.5 },
  { key: 'co2',  name: 'CO₂',         unit: '%',  dec: 2, min: 0.5, max: 3 }
];
const BASEOFF = {
  0: { ph: 0.1,   temp: -0.2, hum: 0.15, co2: -0.1 },
  1: { ph: -0.15, temp: 0.1,  hum: -0.2, co2: 0.2 },
  2: { ph: 0.05,  temp: 0.25, hum: 0.1,  co2: 0.1 },
  3: { ph: -0.05, temp: -0.1, hum: 0.05, co2: -0.2 }
};
const RANGES = {
  '24h': { n: 96, step: 15,  label: '24 h',    ticks: ['-24 h', '-18 h', '-12 h', '-6 h', 'Ahora'] },
  '7d':  { n: 84, step: 120, label: '7 días',  ticks: ['-7 d', '-6 d', '-5 d', '-4 d', '-3 d', '-2 d', '-1 d', 'Hoy'] },
  '30d': { n: 90, step: 480, label: '30 días', ticks: ['-30 d', '-24 d', '-18 d', '-12 d', '-6 d', 'Hoy'] }
};
const C = { ok: '#005A36', okBg: 'rgba(0,90,54,0.10)', warn: '#8A4D00', warnBg: 'rgba(161,92,0,0.12)', crit: '#B02A18', critBg: 'rgba(200,50,31,0.10)', text: '#0F2A1F', muted: '#4F6459' };
const SELF = 'rgba(250,246,233,0.14)', SELB = 'rgba(250,246,233,0.42)';
const QUARTER = 15 * 60 * 1000;
const STORE = 'agryn-planta-v1';
const DEMO_PASSWORD = '12345';
const SESION = 'agryn-sesion-v1';
const CODE_TTL = 5 * 60 * 1000;
function contentOf(b) { const c = b.content || 'Sin definir'; return c === 'Otro' ? ((b.custom || '').trim() || 'Otro') : c; }

function rnd(s) { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function fmt(v, dec) { return v.toFixed(dec).replace('.', ','); }
function dur(min) {
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return Math.round(min) + ' min';
  if (min < 1440) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h + ' h' + (m ? ' ' + m + ' min' : ''); }
  const d = Math.floor(min / 1440), h = Math.round((min % 1440) / 60);
  return d + ' d' + (h ? ' ' + h + ' h' : '');
}
function mkNodes(n) { const a = []; for (let k = 0; k < n; k++) a.push({ id: k, name: 'Nodo ' + (k + 1) }); return a; }
function initialBags() {
  const cont = ['Soja', 'Maíz', 'Trigo', 'Forraje'];
  return [0, 1, 2, 3].map((i) => ({ id: i, name: 'Silobolsa 0' + (i + 1), content: cont[i], nodes: mkNodes(4) }));
}
function loadBags() {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a) && a.length && a.every((b) => b && typeof b.id === 'number' && typeof b.name === 'string' && Array.isArray(b.nodes) && b.nodes.length && b.nodes.every((x) => x && typeof x.id === 'number' && typeof x.name === 'string'))) return a;
    }
  } catch (e) { /* sin almacenamiento: arranca con los datos de ejemplo */ }
  return initialBags();
}
function maxId(list) { return list.reduce((m, x) => Math.max(m, x.id), -1); }
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

export default class App extends React.Component {
  constructor(props) {
    super(props);
    const bags = loadBags();
    this.state = { bags: bags, view: 'overview', range: '24h', bag: bags[0].id, node: null, cursor: null, ack: {}, sim: null, simAt: 0, tick: 0, form: { open: false, name: '', nodes: 4, content: 'Sin definir' }, del: { step: null, pw: '', err: false }, confirm: null, confirmAt: 0, auth: { user: null, token: null, enviando: false, paso: 'login', email: '', pw: '', code: '', vence: 0, err: '', aviso: '' } };
    if (bags.some((b) => b.id === 2)) this.state.bag = 2;
  }
  componentDidMount() {
    this._t = setInterval(() => this.setState((s) => ({ tick: s.tick + 1 })), 1000);
    const token = sesionLocal();
    if (token) {
      llamar('/api/sesion', { metodo: 'GET', token: token }).then((r) => {
        if (r.ok) this.setState((s) => ({ auth: Object.assign({}, s.auth, { user: r.data.email, token: token }) }));
        else { try { window.localStorage.removeItem(SESION); } catch (e) { /* ignorar */ } }
      });
    }
  }
  componentWillUnmount() { clearInterval(this._t); }
  componentDidUpdate(prevProps, prevState) {
    if (prevState.bags !== this.state.bags) {
      try { window.localStorage.setItem(STORE, JSON.stringify(this.state.bags)); } catch (e) { /* ignorar */ }
    }
  }

  // lectura de un nodo; el valor "actual" solo cambia cada 15 min
  val(b, nd, vi, i, n) {
    if (i === n - 1 && n !== 96) return this.val(b, nd, vi, 95, 96);
    const v = VARS[vi], S = this.state;
    const t = i / (n - 1), mid = (v.min + v.max) / 2, half = (v.max - v.min) / 2;
    const base = BASEOFF[b.id] ? BASEOFF[b.id][v.key] : (rnd(b.id * 37 + vi * 5) - 0.5) * 0.5;
    const off = base + (rnd(nd.id * 53 + vi * 11 + b.id * 7) - 0.5) * 0.5;
    const wave = Math.sin(t * Math.PI * 2 * (1 + vi * 0.5) + b.id * 1.3 + vi + nd.id * 0.7) * 0.35;
    const noise = (rnd(i * 7 + b.id * 131 + vi * 17 + nd.id * 977) - 0.5) * 0.35;
    let x = mid + (off + wave + noise) * half * 0.9;
    if (b.id === 2 && nd.id === 2 && v.key === 'temp') x += Math.max(0, (t - 0.8) / 0.2) * half * 1.0;
    if (S.sim && S.sim.bag === b.id && S.sim.node === nd.id && S.sim.vi === vi) {
      const k = 6;
      if (i >= n - k) {
        const r = (i - (n - k) + 1) / k;
        x = x + (v.max + (v.max - v.min) * 0.45 - x) * r;
      }
    }
    if (i === n - 1) {
      const bucket = Math.floor(Date.now() / QUARTER);
      x += Math.sin(bucket * 1.9 + vi * 3 + nd.id * 1.3 + b.id) * half * 0.04;
    }
    return x;
  }
  avg(b, vi, i, n) {
    let s = 0;
    b.nodes.forEach((nd) => { s += this.val(b, nd, vi, i, n); });
    return s / b.nodes.length;
  }
  status(x, v) { return x > v.max ? 'high' : (x < v.min ? 'low' : 'ok'); }
  sev(x, v) {
    const span = v.max - v.min;
    const over = x > v.max ? x - v.max : v.min - x;
    return over > span * 0.25 ? 'crit' : 'warn';
  }

  renderVals() {
    const S = this.state, self = this;
    const bags = S.bags;
    const bo = bags.find((b) => b.id === S.bag) || bags[0];
    const nsel = S.node == null ? null : (bo.nodes.find((x) => x.id === S.node) || null);
    const range = RANGES[S.range], n = range.n;
    const NN = bo.nodes.length;
    const unitTxt = (v) => (v.unit ? ' ' + v.unit : '');
    const col = (sv) => (sv === 'ok' ? C.ok : (sv === 'crit' ? C.crit : C.warn));
    const pt = (vi, i, nn) => (nsel == null ? self.avg(bo, vi, i, nn) : self.val(bo, nsel, vi, i, nn));
    const scopeLabel = nsel == null ? 'Promedio de ' + NN + (NN === 1 ? ' nodo' : ' nodos') : nsel.name;
    const confirmLive = S.confirm && (Date.now() - S.confirmAt < 5000) ? S.confirm : null;

    // ---- alertas: cada nodo, cada variable, al instante ----
    const alerts = [];
    bags.forEach((b) => {
      b.nodes.forEach((nd) => {
        VARS.forEach((v, iv) => {
          const cur = self.val(b, nd, iv, 95, 96);
          const st = self.status(cur, v);
          if (st === 'ok') return;
          let run = 0;
          for (let i = 95; i >= 0; i--) { if (self.status(self.val(b, nd, iv, i, 96), v) !== 'ok') run++; else break; }
          const isSim = !!(S.sim && S.sim.bag === b.id && S.sim.node === nd.id && S.sim.vi === iv);
          const secs = Math.max(0, Math.floor((Date.now() - S.simAt) / 1000));
          const since = isSim ? (secs < 60 ? 'hace ' + secs + ' s' : 'hace ' + Math.floor(secs / 60) + ' min') : 'hace ' + dur(run * 15);
          const sev = self.sev(cur, v);
          const id = b.id + '-' + nd.id + '-' + iv;
          alerts.push({
            id, bid: b.id, nid: nd.id, iv, sev, cur, st, acked: !!S.ack[id],
            title: b.name + ' · ' + nd.name + ' · ' + v.name + ' ' + fmt(cur, v.dec) + unitTxt(v),
            detail: (st === 'high' ? 'Supera el máximo habitual (' + fmt(v.max, v.dec) + unitTxt(v) + ')' : 'Está por debajo del mínimo habitual (' + fmt(v.min, v.dec) + unitTxt(v) + ')') + ' · ' + since
          });
        });
      });
    });
    alerts.sort((a, b) => (a.acked - b.acked) || ((a.sev === 'crit' ? 0 : 1) - (b.sev === 'crit' ? 0 : 1)));
    const go = (bid, nid, view) => () => self.setState({ bag: bid, node: nid, view: view, cursor: null });
    const doAck = (id) => () => self.setState((s) => ({ ack: Object.assign({}, s.ack, { [id]: true }) }));

    const alertRows = alerts.map((a) => ({
      sev: a.sev === 'crit' ? 'Crítica' : 'Atención',
      pillBg: a.sev === 'crit' ? C.critBg : C.warnBg,
      pillFg: a.sev === 'crit' ? C.crit : C.warn,
      border: a.sev === 'crit' && !a.acked ? 'rgba(200,50,31,0.55)' : '#DCE5E0',
      title: a.title, detail: a.detail,
      canAck: !a.acked, isAcked: a.acked,
      open: go(a.bid, a.nid, VARS[a.iv].key), ack: doAck(a.id)
    }));
    const unacked = alerts.filter((a) => !a.acked);
    const top = unacked[0];
    const banner = top ? {
      bg: top.sev === 'crit' ? '#FDECE8' : '#FFF4DD',
      border: top.sev === 'crit' ? '#C8321F' : '#B7791F',
      accent: top.sev === 'crit' ? '#B02A18' : '#8A4D00',
      kicker: (top.sev === 'crit' ? 'Alerta crítica' : 'Atención') + (unacked.length > 1 ? ' · +' + (unacked.length - 1) + ' más' : ''),
      title: top.title,
      detail: top.detail,
      open: go(top.bid, top.nid, VARS[top.iv].key), ack: doAck(top.id)
    } : { bg: '', border: '', accent: '', kicker: '', title: '', detail: '', open: null, ack: null };

    // ---- gráficos ----
    const chart = (vi) => {
      const v = VARS[vi], vals = [];
      for (let i = 0; i < n; i++) vals.push(pt(vi, i, n));
      let mn = Infinity, mx = -Infinity, sum = 0, out = 0;
      vals.forEach((x) => { mn = Math.min(mn, x); mx = Math.max(mx, x); sum += x; if (x > v.max || x < v.min) out++; });
      const span = v.max - v.min;
      const dmin = Math.min(v.min - span * 0.45, mn - span * 0.05);
      const dmax = Math.max(v.max + span * 0.45, mx + span * 0.08);
      const Y = (x) => ((dmax - x) / (dmax - dmin)) * 100;
      const X = (i) => (i / (n - 1)) * 600;
      let line = '', dots = '';
      vals.forEach((x, i) => {
        line += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x).toFixed(2) + ' ';
        if (x > v.max || x < v.min) dots += 'M' + X(i).toFixed(1) + ' ' + Y(x).toFixed(2) + ' h0 ';
      });
      const curV = vals[n - 1], st = self.status(curV, v);
      const sv = st === 'ok' ? 'ok' : self.sev(curV, v);
      const idx = Math.min(S.cursor == null ? n - 1 : S.cursor, n - 1);
      const cx = X(idx), cv = vals[idx], cst = self.status(cv, v);
      const nodeVals = bo.nodes.map((nd) => self.val(bo, nd, vi, 95, 96));
      const outNodes = [];
      nodeVals.forEach((x, k) => { if (self.status(x, v) !== 'ok') outNodes.push(k); });
      const anyCrit = outNodes.some((k) => self.sev(nodeVals[k], v) === 'crit');
      let note, noteColor;
      if (nsel == null) {
        note = outNodes.length ? 'Fuera de rango: ' + outNodes.map((k) => bo.nodes[k].name).join(', ') : (NN === 1 ? 'El nodo está dentro del rango' : 'Los ' + NN + ' nodos están dentro del rango');
        noteColor = outNodes.length ? (anyCrit ? C.crit : C.warn) : C.muted;
      } else {
        note = 'Lectura de ' + nsel.name; noteColor = C.muted;
      }
      return {
        key: v.key, name: v.name, unit: v.unit,
        value: fmt(curV, v.dec), valColor: st === 'ok' ? C.text : col(sv),
        statusLabel: st === 'ok' ? 'Normal' : (st === 'high' ? 'Sobre el máximo' : 'Bajo el mínimo'),
        chipBg: sv === 'ok' ? C.okBg : (sv === 'crit' ? C.critBg : C.warnBg), chipFg: col(sv),
        border: st === 'ok' ? '#DCE5E0' : (sv === 'crit' ? 'rgba(200,50,31,0.55)' : 'rgba(161,92,0,0.5)'),
        note, noteColor,
        line, area: line + 'L600 100 L0 100 Z', dots,
        last: 'M600 ' + Y(curV).toFixed(2) + ' h0', lastColor: st === 'ok' ? C.ok : '#C8321F',
        bandY: Y(v.max), bandH: Y(v.min) - Y(v.max),
        statMin: fmt(mn, v.dec) + unitTxt(v), statMax: fmt(mx, v.dec) + unitTxt(v), statAvg: fmt(sum / n, v.dec) + unitTxt(v),
        rangeText: fmt(v.min, v.dec) + ' a ' + fmt(v.max, v.dec) + unitTxt(v),
        open: go(bo.id, S.node, v.key), openLabel: 'Ver detalle de ' + v.name,
        limitLines: 'M0 ' + Y(v.max).toFixed(2) + ' H600 M0 ' + Y(v.min).toFixed(2) + ' H600',
        grid: [0, 1, 2, 3, 4].map((k) => 'M0 ' + (k * 25) + ' H600').join(' '),
        yTicks: [0, 1, 2, 3, 4].map((k) => ({ top: k * 25, label: fmt(dmax - k * (dmax - dmin) / 4, v.dec) })),
        xTicks: range.ticks.map((l) => ({ label: l })),
        maxTop: Y(v.max), minTop: Y(v.min), maxText: fmt(v.max, v.dec) + unitTxt(v), minText: fmt(v.min, v.dec) + unitTxt(v),
        cursorIdx: idx, maxIdx: n - 1,
        cursorLine: 'M' + cx.toFixed(1) + ' 0 V100', cursorDot: 'M' + cx.toFixed(1) + ' ' + Y(cv).toFixed(2) + ' h0',
        curColor: cst === 'ok' ? C.ok : '#C8321F',
        curText: fmt(cv, v.dec) + unitTxt(v),
        curWhen: idx === n - 1 ? 'Última lectura' : 'Hace ' + dur((n - 1 - idx) * range.step),
        chartLabel: 'Historial de ' + v.name + ' en ' + bo.name + ', ' + scopeLabel + ', ' + range.label,
        stats: [
          { label: 'Mínimo del período', value: fmt(mn, v.dec) + unitTxt(v), color: mn < v.min ? C.crit : C.text },
          { label: 'Promedio', value: fmt(sum / n, v.dec) + unitTxt(v), color: C.text },
          { label: 'Máximo del período', value: fmt(mx, v.dec) + unitTxt(v), color: mx > v.max ? C.crit : C.text },
          { label: 'Tiempo fuera de rango', value: out ? dur(out * range.step) : 'Ninguno', color: out ? C.crit : C.ok }
        ],
        nodeCompare: bo.nodes.map((nd, k) => {
          const x = nodeVals[k], s2 = self.status(x, v), sv2 = s2 === 'ok' ? 'ok' : self.sev(x, v), selected = nsel && nsel.id === nd.id;
          return {
            name: nd.name, value: fmt(x, v.dec) + unitTxt(v),
            color: s2 === 'ok' ? C.text : col(sv2), dot: col(sv2),
            bg: selected ? '#F1F6F3' : 'transparent', border: selected ? '#B9CCC2' : 'transparent',
            pick: () => self.setState({ node: nd.id, cursor: null })
          };
        }),
        compare: bags.map((b) => {
          const x = self.avg(b, vi, 95, 96);
          const mine = alerts.filter((a) => a.bid === b.id && a.iv === vi);
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
        const x = self.val(bo, nd, vi, 95, 96), st = self.status(x, v), sv = st === 'ok' ? 'ok' : self.sev(x, v);
        if (st !== 'ok') { outC++; if (sv === 'crit') crit = true; }
        rows.push({ label: v.name, value: fmt(x, v.dec) + unitTxt(v), color: st === 'ok' ? C.text : col(sv), dot: col(sv) });
      });
      const sv = outC === 0 ? 'ok' : (crit ? 'crit' : 'warn'), selected = !!(nsel && nsel.id === nd.id);
      const ckey = 'node-' + bo.id + '-' + nd.id;
      const asking = confirmLive === ckey;
      nodeCards.push({
        name: nd.name, rows,
        statusLabel: outC === 0 ? 'Normal' : (outC === 1 ? '1 valor fuera de rango' : outC + ' valores fuera de rango'),
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
            self.setState((s) => ({
              bags: s.bags.map((b) => b.id === bo.id ? Object.assign({}, b, { nodes: b.nodes.filter((x) => x.id !== nd.id) }) : b),
              node: s.node === nd.id ? null : s.node, sim: s.sim && s.sim.bag === bo.id && s.sim.node === nd.id ? null : s.sim, confirm: null, cursor: null
            }));
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
    const addNode = () => self.setState((s) => ({
      bags: s.bags.map((b) => {
        if (b.id !== bo.id) return b;
        const id = maxId(b.nodes) + 1;
        return Object.assign({}, b, { nodes: b.nodes.concat([{ id: id, name: 'Nodo ' + (id + 1) }]) });
      }),
      node: null
    }));
    // ---- eliminar silobolsa: aviso + contraseña ----
    const openDel = () => self.setState({ del: { step: 'warn', pw: '', err: false } });
    const delCancel = () => self.setState({ del: { step: null, pw: '', err: false } });
    const delContinue = () => self.setState({ del: { step: 'pass', pw: '', err: false } });
    const onDelPw = (e) => { const val = e.target.value; self.setState((s) => ({ del: Object.assign({}, s.del, { pw: val, err: false }) })); };
    const delSubmit = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (self.state.del.pw !== DEMO_PASSWORD) { self.setState((s) => ({ del: Object.assign({}, s.del, { pw: '', err: true }) })); return; }
      self.setState((s) => {
        const rest = s.bags.filter((b) => b.id !== bo.id);
        if (!rest.length) return { del: { step: null, pw: '', err: false } };
        return { bags: rest, bag: rest[0].id, node: null, view: 'overview', cursor: null, del: { step: null, pw: '', err: false }, sim: s.sim && s.sim.bag === bo.id ? null : s.sim };
      });
    };
    const bagAlerts = alerts.filter((a) => a.bid === bo.id).length;
    const delSummary = bo.name + ' contiene ' + contentOf(bo) + ' y tiene ' + NN + (NN === 1 ? ' nodo' : ' nodos') + (bagAlerts ? ' (' + bagAlerts + (bagAlerts === 1 ? ' alerta activa' : ' alertas activas') + ')' : '') + '.';
    const setBagField = (field) => (e) => { const val = e.target.value; self.setState((s) => ({ bags: s.bags.map((b) => b.id === bo.id ? Object.assign({}, b, { [field]: val }) : b) })); };
    const submitBag = () => self.setState((s) => {
      const id = maxId(s.bags) + 1;
      const name = (s.form.name || '').trim() || ('Silobolsa ' + (id + 1 < 10 ? '0' : '') + (id + 1));
      const cnt = Math.max(1, Math.min(12, parseInt(s.form.nodes, 10) || 1));
      return { bags: s.bags.concat([{ id: id, name: name.slice(0, 40), content: s.form.content || 'Sin definir', nodes: mkNodes(cnt) }]), bag: id, node: null, view: 'overview', cursor: null, form: { open: false, name: '', nodes: 4, content: 'Sin definir' } };
    });

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
      const x = pt(vi, 95, 96), st = self.status(x, v), sv = st === 'ok' ? 'ok' : self.sev(x, v);
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
    const simNode = nsel || bo.nodes[0];
    const simButtons = VARS.map((v, vi) => ({
      name: v.name,
      run: () => self.setState((s) => {
        const ack = Object.assign({}, s.ack); delete ack[bo.id + '-' + simNode.id + '-' + vi];
        return { sim: { bag: bo.id, node: simNode.id, vi: vi }, simAt: Date.now(), ack: ack };
      })
    }));
    const nextIn = 15 - Math.floor((Date.now() % QUARTER) / 60000);

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
      setAuth({ enviando: false, user: r.data.email, token: r.data.token, paso: 'login', email: '', pw: '', code: '', vence: 0, err: '', aviso: '' });
    };
    const volverLogin = () => setAuth({ paso: 'login', code: '', err: '', aviso: '' });
    const cerrarSesion = async () => {
      await llamar('/api/logout', { token: A.token });
      try { window.localStorage.removeItem(SESION); } catch (e) { /* ignorar */ }
      setAuth({ user: null, token: null, paso: 'login', email: '', pw: '', code: '', err: '', aviso: '' });
    };
    const restan = Math.max(0, A.vence - Date.now());

    return {
      bagName: bo.name, scopeLabel, nextIn,
      logueado: !!A.user, usuario: A.user || '',
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
      bagList, varNav, rangeList, simButtons, nodeChips, nodeCards,
      simTarget: bo.name + ' · ' + simNode.name,
      cards, d,
      hasBanner: !!top, banner,
      alertRows, noAlerts: alerts.length === 0,
      alertSummary: alerts.length === 0 ? 'Sin alertas' : alerts.length + (alerts.length === 1 ? ' alerta en toda la planta' : ' alertas en toda la planta'),
      onCursor: (e) => self.setState({ cursor: parseInt(e.target.value, 10) }),
      resetCursor: () => self.setState({ cursor: null }),
      resetSim: () => self.setState({ sim: null, ack: {} }),
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
      formName: S.form.name, formNodes: S.form.nodes,
      toggleForm: () => self.setState((s) => ({ form: { open: !s.form.open, name: '', nodes: 4, content: 'Sin definir' } })),
      onFormName: (e) => { const val = e.target.value; self.setState((s) => ({ form: Object.assign({}, s.form, { name: val }) })); },
      onFormNodes: (e) => { const val = e.target.value; self.setState((s) => ({ form: Object.assign({}, s.form, { nodes: val }) })); },
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
      <div style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", background: "#F3F0E4", color: "#0F2A1F", fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: "14px", lineHeight: "1.45" }}>
      <div className="hook" aria-hidden="true">
      <img className="tile" src="/logos/agryn-hoja-reversa.png" alt="" style={{ display: "block", width: "min(210px, 40vw)", height: "auto" }} />
      </div>
      <aside className="side" style={{ flex: "1 1 260px", minWidth: "0", boxSizing: "border-box", padding: "24px 16px", background: "#005A36", color: "#FAF6E9", display: "flex", flexDirection: "column", gap: "28px" }}>
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
      <label htmlFor="bag-nodes" style={{ fontSize: "12px", fontWeight: "600" }}>
      Cantidad de nodos (1 a 12)
      </label>
      <input id="bag-nodes" type="number" min="1" max="12" value={v.formNodes} onChange={v.onFormNodes} style={{ minHeight: "44px", boxSizing: "border-box", padding: "0 12px", borderRadius: "8px", border: "1px solid transparent", font: "500 14px 'Montserrat', sans-serif", color: "#0F2A1F", background: "#FAF6E9" }} />
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
      <p style={{ margin: "0 12px", fontSize: "12px", color: "rgba(250,246,233,0.82)", overflowWrap: "anywhere" }}>
      Sesión iniciada como {v.usuario}
      </p>
      <button className="row-btn" onClick={v.cerrarSesion} style={{ justifyContent: "center", fontWeight: "600", border: "1px solid rgba(250,246,233,0.42)" }}>
      Cerrar sesión
      </button>
      </div>
      </aside>
      <main style={{ flex: "999 1 560px", minWidth: "0", boxSizing: "border-box", padding: "clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: "24px" }}>
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
      Lecturas cada 15 min · próxima en {v.nextIn} min
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
      <section role="alert" aria-live="assertive" className="flash" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px", padding: "16px 20px", borderRadius: "12px", background: `${v.banner.bg}`, border: `1px solid ${v.banner.border}` }}>
      <span style={{ width: "44px", height: "44px", flex: "none", borderRadius: "999px", background: `${v.banner.accent}`, color: "#FAF6E9", display: "grid", placeItems: "center" }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
      </svg>
      </span>
      <div style={{ flex: "1 1 300px", minWidth: "0" }}>
      <p style={{ margin: "0", font: "700 13px/1 'Montserrat', sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: `${v.banner.accent}` }}>
      {v.banner.kicker}
      </p>
      <p style={{ margin: "6px 0 0", font: "700 22px/1.15 'Inter', sans-serif", letterSpacing: "-0.02em" }}>
      {v.banner.title}
      </p>
      <p style={{ margin: "4px 0 0", color: "#2E453A" }}>
      {v.banner.detail}
      </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button className="btn" onClick={v.banner.open}>
      Ver detalle
      </button>
      <button className="btn primary" onClick={v.banner.ack}>
      Reconocer
      </button>
      </div>
      </section>
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
      <path d={c.line} fill="none" stroke="#005A36" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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
      <button className="btn" onClick={nd.remove} disabled={nd.cantRemove} style={{ minHeight: "36px", borderColor: "transparent", background: "transparent", fontSize: "12px", color: `${nd.removeFg}` }}>
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
      <path d={v.d.line} fill="none" stroke="#005A36" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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
      <section aria-label="Modo demostración" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "16px 20px", borderRadius: "12px", border: "1px dashed #B9CCC2", marginTop: "auto" }}>
      <div style={{ flex: "1 1 260px", minWidth: "0" }}>
      <p style={{ margin: "0", fontWeight: "600" }}>
      Modo demostración
      </p>
      <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#4F6459" }}>
      Los datos son simulados. Probá cómo salta la alerta en {v.simTarget}.
      </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {v.simButtons.map((s, $index) => (<React.Fragment key={$index}>
      <button className="btn" onClick={s.run}>
      Simular desvío de {s.name}
      </button>
      </React.Fragment>))}
      <button className="btn" onClick={v.resetSim}>
      Restablecer
      </button>
      </div>
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
