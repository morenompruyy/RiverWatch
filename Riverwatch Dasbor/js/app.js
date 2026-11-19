// Riverwatch · pintu masuk dasbor: menyambung ke server (atau mode demo), navigasi, aliran data waktu nyata.
import { LiveApi } from './api.js';
import { store, prefs } from './store.js';
import { core, setApi, upsertEvent, isAlertEvent, nowTs } from './core.js';
import { h, $, $$, initSpotlight, toast, LEVELS } from './ui.js';
import { icon } from './icons.js';

const ROUTES = [
  { id: 'pantau', label: 'Pantau', icon: 'eye', page: './pages/pantau.js' },
  { id: 'kembar', label: 'Kembar 3D', icon: 'cube', page: './pages/kembar.js' },
  { id: 'riwayat', label: 'Riwayat', icon: 'clock', page: './pages/riwayat.js' },
  { id: 'kesehatan', label: 'Kesehatan', icon: 'pulse', page: './pages/kesehatan.js' },
  { id: 'kontrol', label: 'Kontrol', icon: 'sliders', page: './pages/kontrol.js' }
];
const root = document.documentElement;
const main = $('#main');
let current = null, navLinks = {}, navInd = null, navBadge = null, navSeq = 0;

// ---------- navigasi ----------
function buildNav() {
  const nav = $('#nav');
  navInd = h('i', { class: 'nav-ind init' });
  navBadge = h('span', { class: 'bd', hidden: true });
  const list = h('div', { class: 'nav-list' }, navInd, ROUTES.map((r) => {
    const a = h('a', { class: 'ni', href: `#${r.id}`, 'data-id': r.id }, h('span', { html: icon(r.icon), style: 'display:inline-flex' }), h('span', null, r.label), r.id === 'riwayat' ? navBadge : null);
    navLinks[r.id] = a; return a;
  }));
  const nodeDot = h('span', { class: 'dot', style: { '--c': 'var(--ink-3)' } }), nodeName = h('b', null, 'Titik pantau'), nodeSub = h('span', null, 'menyambung…');
  const levelEl = h('span', { class: 'pill lv', style: 'height:24px;padding:0 10px;font-size:12px' }, '–');
  nav.append(
    h('div', { class: 'brand' }, h('div', { class: 'brand-mark', html: icon('logo') }), h('div', { class: 'brand-t' }, h('b', null, 'Riverwatch'), h('span', null, 'Pemantau sungai'))),
    list,
    h('div', { class: 'nav-foot' }, h('div', { class: 'node-card' }, nodeDot, h('div', { class: 't' }, nodeName, nodeSub), levelEl)));
  const paint = () => {
    const node = store.get('node'), c = store.get('conn');
    nodeName.textContent = node ? node.name || node.id : 'Titik pantau';
    nodeSub.textContent = core.demo ? 'mode demo' : c === 'live' ? (node && node.mode === 'simulation' ? 'simulasi' : 'langsung') : c === 'offline' ? 'terputus' : 'menyambung…';
    nodeDot.style.setProperty('--c', core.demo ? 'var(--lv1)' : c === 'live' ? 'var(--lv0)' : c === 'offline' ? 'var(--lv3)' : 'var(--ink-3)');
    nodeDot.classList.toggle('live', c === 'live' || core.demo);
    const f = store.get('frame'); const lv = f ? f.level | 0 : 0;
    levelEl.textContent = f ? LEVELS[lv] : '–';
  };
  store.on('conn', paint); store.on('node', paint); store.on('frame', paint);
  const badge = () => {
    const now = nowTs();
    const n = (store.get('events') || []).filter((e) => isAlertEvent(e) && now - e.ts < 12 * 3600).length;
    navBadge.hidden = n === 0; navBadge.textContent = n > 9 ? '9+' : String(n);
  };
  store.on('events', badge);
  addEventListener('resize', () => placeInd(false));
}
function placeInd(anim = true) {
  const a = navLinks[current && current.id]; if (!a || !navInd) return;
  const mobile = matchMedia('(max-width: 879px)').matches;
  navInd.classList.toggle('init', !anim);
  if (mobile) { navInd.style.setProperty('--x', a.offsetLeft + 'px'); navInd.style.setProperty('--w', a.offsetWidth + 'px'); }
  else { navInd.style.setProperty('--y', a.offsetTop + 'px'); navInd.style.setProperty('--h', a.offsetHeight + 'px'); }
  if (!anim) requestAnimationFrame(() => navInd.classList.remove('init'));
}

// ---------- pengarah halaman ----------
async function route() {
  const id = (location.hash.replace(/^#\/?/, '').split(/[/?&]/)[0] || 'pantau');
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  if (current && current.id === r.id) return;
  const seq = ++navSeq;
  const first = !current;
  if (current && current.inst && current.inst.destroy) { try { current.inst.destroy(); } catch (e) { console.error(e); } }
  current = { id: r.id, inst: null };
  Object.values(navLinks).forEach((a) => a.removeAttribute('aria-current'));
  navLinks[r.id].setAttribute('aria-current', 'page');
  placeInd(!first);
  document.title = `${r.label} · Riverwatch`;
  main.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'skel', style: 'height:44px;width:260px' }), h('div', { class: 'skel', style: 'height:320px' })));
  let mod;
  try { mod = (await import(r.page)).default; } catch (e) { console.error(e); if (seq === navSeq) main.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card glass' }, h('b', null, 'Halaman gagal dimuat'), h('p', { class: 'cap' }, String(e && e.message || e))))); return; }
  if (seq !== navSeq) return;
  const page = h('div', { class: 'page enter' });
  main.replaceChildren(page);
  try { current.inst = await mod.mount(page, { api: core.api, store }); } catch (e) { console.error(e); page.append(h('div', { class: 'card glass' }, h('b', null, 'Terjadi galat pada halaman'), h('p', { class: 'cap' }, String(e && e.message || e)))); }
  if (!first) { window.scrollTo({ top: 0 }); }
}

// ---------- aliran data ----------
let imgBusy = false, imgNext = null;
async function loadImage(frame) {
  if (imgBusy) { imgNext = frame; return; }
  imgBusy = true;
  try {
    const img = await core.api.frameImage(frame);
    store.set('shot', { frame, image: img });
  } catch (e) { /* bingkai gagal: lewati */ } finally {
    imgBusy = false;
    if (imgNext) { const f = imgNext; imgNext = null; loadImage(f); }
  }
}
function applyFrame(f) {
  store.set('frame', f); store.set('frameRx', performance.now());
  root.dataset.level = String(f.level | 0);
  loadImage(f);
}
function onStream(kind, d) {
  switch (kind) {
    case 'open': store.set('conn', 'live'); break;
    case 'down': store.set('conn', 'offline'); break;
    case 'hello':
      store.set('conn', 'live'); store.set('node', d.node); store.set('helloNow', { now: d.now, rx: performance.now() });
      if (core.api.readNeedsToken !== undefined) core.api.readNeedsToken = !!(d.node.auth && d.node.auth.read_requires_token);
      if (d.state) {
        if (d.state.control) store.set('control', d.state.control);
        if (d.state.health) store.set('health', d.state.health);
        if (d.state.telemetry) store.set('telemetry', d.state.telemetry);
        if (d.state.stats) store.set('stats', d.state.stats);
        if (d.state.frame) applyFrame(d.state.frame);
      }
      refreshEvents();
      break;
    case 'frame': applyFrame(d); break;
    case 'event': {
      upsertEvent(d);
      const fresh = nowTs() - d.ts < 30;
      if (fresh && (d.kind === 'anomaly_start' || d.kind === 'level_up')) toast(d.title, d.severity === 'critical' ? 'err' : 'info', 5200);
      break;
    }
    case 'telemetry': store.set('telemetry', d.telemetry); if (d.health) store.set('health', Object.assign({}, store.get('health') || {}, d.health)); break;
    case 'control': store.set('control', d); break;
    case 'ping': if (d.viewers != null) store.set('viewers', d.viewers); if (d.now) store.set('helloNow', { now: d.now, rx: performance.now() }); break;
  }
}
async function refreshEvents() {
  try { const r = await core.api.get('/api/events', { limit: 120 }); store.set('events', r.events || []); } catch (e) { /* tampilan akan mencoba lagi */ }
}

// ---------- tampilan: tema, mode ringan ----------
// Bila halaman dibuka di dalam penampil yang memasang data-theme sendiri (mis. penampil Artifact), tema "Otomatis" mengikutinya.
let hostTheme = window.__rwHostTheme || null, lastSet = null;
function applyPrefs() {
  const theme = prefs.get('theme', 'auto');
  const light = matchMedia('(prefers-color-scheme: light)').matches;
  lastSet = theme === 'dark' || (theme === 'auto' && (hostTheme ? hostTheme === 'dark' : !light)) ? 'dark' : 'light';
  root.setAttribute('data-theme', lastSet);
  if (prefs.get('lite', '0') === '1') root.setAttribute('data-lite', '1'); else root.removeAttribute('data-lite');
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', root.getAttribute('data-theme') === 'dark' ? '#061620' : '#D5E8EE');
  store.set('prefs', { theme, lite: prefs.get('lite', '0') === '1' });
}
export { applyPrefs };
new MutationObserver(() => {
  const v = root.getAttribute('data-theme');
  if (v === lastSet) return;
  hostTheme = v === 'dark' || v === 'light' ? v : null;
  applyPrefs();
}).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyPrefs);
document.addEventListener('visibilitychange', () => { root.dataset.paused = document.hidden ? '1' : '0'; });

// ---------- mulai ----------
async function boot() {
  applyPrefs();
  initSpotlight();
  buildNav();
  store.set('conn', 'connecting');
  // Mode demo dipaksa lewat alamat (?demo) atau lewat <meta name="rw-demo"> (dipakai halaman pratinjau yang tidak punya server).
  const forceDemo = /[?&#]demo\b/.test(location.search + location.hash) || !!document.querySelector('meta[name="rw-demo"]');
  let api = new LiveApi();
  let ok = !forceDemo && (await api.ping());
  if (!ok) {
    const { DemoApi } = await import('./demo.js');
    api = new DemoApi();
  }
  setApi(api);
  if (!location.hash || location.hash === '#') location.hash = '#pantau';
  try {
    const node = await api.get('/api/node');
    store.set('node', node);
    if (api.mode === 'live') api.readNeedsToken = !!(node.auth && node.auth.read_requires_token);
  } catch (e) {
    store.set('conn', 'offline');
    toast(e.message, 'err', 6000);
  }
  buildMobileHint();
  window.addEventListener('hashchange', route);
  await route();
  placeInd(false);
  api.stream(onStream);
  document.fonts && document.fonts.ready && document.fonts.ready.then(() => placeInd(false));
}
function buildMobileHint() { /* ruang untuk petunjuk pasang sebagai aplikasi di masa depan */ }
boot();
