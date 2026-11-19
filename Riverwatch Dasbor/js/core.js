// Inti bersama: API aktif, waktu server, aksi kontrol, token, kepala halaman. Diimpor halaman dan app.js.
import { store } from './store.js';
import { h, toast, openSheet, fmtClock, LEVELS, setBool } from './ui.js';
import { icon } from './icons.js';

export const core = { api: null, demo: false, tClock: null };
export function setApi(a) { core.api = a; core.demo = a.mode === 'demo'; }
export const nodeOff = () => { const n = store.get('node'); return n && n.utc_offset_hours != null ? n.utc_offset_hours : 7; };

/** Perkiraan waktu mesin (detik epoch): cap bingkai terakhir + waktu yang berlalu sejak diterima. */
export function nowTs() {
  const fr = store.get('frame'), rx = store.get('frameRx');
  if (fr && rx) return fr.ts + Math.min(5, (performance.now() - rx) / 1000);
  const hello = store.get('helloNow');
  if (hello) return hello.now + (performance.now() - hello.rx) / 1000;
  return Date.now() / 1000;
}

// ---------- token ----------
export function askToken() {
  return new Promise((res) => {
    let ok = false;
    const input = h('input', { class: 'field', type: 'password', placeholder: 'Tempel token di sini', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Token kontrol' });
    const save = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } core.api.setToken(v); ok = true; sh.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const sh = openSheet({
      title: 'Token kontrol diperlukan', narrow: true, onClose: () => res(ok),
      body: [h('p', { class: 'mut' }, 'Mengubah pengaturan butuh token supaya orang lain di jaringan tidak bisa mengendalikan CCTV. Token ada di berkas ', h('code', { class: 'mono' }, 'data/token.txt'), ' di komputer Riverwatch (atau variabel RIVERWATCH_TOKEN). Membuka dasbor dengan ', h('code', { class: 'mono' }, 'python -m riverwatch run --open'), ' mengisinya otomatis.'), input],
      footer: [h('button', { class: 'btn', onclick: () => sh.close() }, 'Batal'), h('button', { class: 'btn primary', onclick: save }, 'Simpan token')]
    });
  });
}

// ---------- aksi ----------
export async function call(fn, { okMsg, quiet } = {}) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      if (await askToken()) return call(fn, { okMsg, quiet });
      return null;
    }
    if (!quiet) toast(e.message || 'Gagal.', 'err');
    return null;
  }
}
/** Kirim perubahan kontrol; perbarui keadaan lokal dari jawaban server. */
export async function control(patch, opts = {}) {
  const r = await call(() => core.api.post('/api/control', patch), opts);
  if (r && r.control) store.set('control', r.control);
  return r;
}
export async function ackEvent(id) {
  const r = await call(() => core.api.post(`/api/events/${encodeURIComponent(id)}/ack`), { okMsg: 'Kejadian dikonfirmasi.' });
  if (r && r.event) { upsertEvent(r.event); if (r.control) store.set('control', r.control); }
  return r;
}
export function simAction(body, okMsg) { return call(() => core.api.post('/api/sim', body), { okMsg }); }

// ---------- daftar kejadian ----------
export function upsertEvent(ev) {
  const list = (store.get('events') || []).slice();
  const i = list.findIndex((e) => e.id === ev.id);
  if (i >= 0) list[i] = ev; else { list.unshift(ev); list.sort((a, b) => b.ts - a.ts); }
  store.set('events', list.slice(0, 300));
}
export const isAlertEvent = (e) => !e.ack && (e.severity === 'warning' || e.severity === 'critical') && (e.kind === 'anomaly_start' || e.kind === 'level_up');

// ---------- kepala halaman ----------
export function connView() {
  const c = store.get('conn'), node = store.get('node') || {};
  if (core.demo) return { c: 'var(--lv1)', t: 'Demo', live: false };
  if (c === 'live') return node.mode === 'simulation' ? { c: 'var(--accent)', t: 'Simulasi', live: true } : { c: 'var(--lv0)', t: 'Langsung', live: true };
  if (c === 'offline') return { c: 'var(--lv3)', t: 'Terputus', live: false };
  return { c: 'var(--ink-3)', t: 'Menyambung…', live: false };
}
/** Kepala halaman: judul, subjudul, status sambungan, tingkat, jam. Mengembalikan {el, destroy}. */
export function pageHeader(title, sub, extra) {
  const dot = h('span', { class: 'dot' }), cl = h('span');
  const conn = h('div', { class: 'conn', title: 'Status sambungan' }, dot, cl);
  const lvDot = h('span', { class: 'dot' }), lvT = h('span');
  const lvPill = h('div', { class: 'pill lv', title: 'Tingkat siaga saat ini' }, lvDot, lvT);
  const clock = h('span', { class: 'clock', title: 'Waktu titik pantau' });
  const subEl = h('p', { class: 'sub' }, sub || '');
  const el = h('header', { class: 'ph' }, h('div', { class: 'ph-t' }, h('h1', null, title), subEl), h('div', { class: 'ph-r' }, extra || null, lvPill, conn, clock));
  const paint = () => {
    const v = connView(); dot.style.setProperty('--c', v.c); dot.classList.toggle('live', v.live); cl.textContent = v.t;
    const f = store.get('frame'); const lv = f ? f.level | 0 : 0;
    lvDot.style.setProperty('--c', `var(--lv${lv})`); lvT.textContent = f ? LEVELS[lv] : '–';
  };
  const tick = () => { clock.textContent = fmtClock(nowTs(), nodeOff()) + (nodeOff() === 7 ? ' WIB' : nodeOff() === 8 ? ' WITA' : nodeOff() === 9 ? ' WIT' : ''); };
  paint(); tick();
  const offs = [store.on('conn', paint), store.on('frame', paint), store.on('node', paint)];
  const iv = setInterval(tick, 500);
  return { el, setSub: (t) => { subEl.textContent = t; }, destroy() { offs.forEach((f) => f()); clearInterval(iv); } };
}

export function banner(kind, text, action) {
  return h('div', { class: `banner glass ${kind}` }, h('span', { html: icon(kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'info') }), h('span', { class: 'grow' }, text), action || null);
}
