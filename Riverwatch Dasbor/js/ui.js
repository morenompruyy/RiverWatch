// Alat antarmuka: pembuat elemen, format angka/waktu, toast, lembar, kontrol segmen, sakelar, penggeser, tooltip.
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const LEVELS = ['Aman', 'Waspada', 'Peringatan', 'Kritis'];
export const MODE_LABELS = { low: 'Hemat', normal: 'Normal', high: 'Tinggi', max: 'Maksimum' };
export const MODES = ['low', 'normal', 'high', 'max'];
export const lvColor = (l) => `var(--lv${clamp(l | 0, 0, 3)})`;

/** h('div', {class:'x', onclick: fn}, 'teks', child) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const p of Object.keys(v)) { if (v[p] == null) continue; if (p.startsWith('--')) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; }
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
export function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k of Object.keys(attrs)) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  return el;
}
export const ico = (name, cls) => h('span', { class: 'ico' + (cls ? ' ' + cls : ''), html: icon(name), style: 'display:inline-flex' });
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
/** Ganti isi elemen; mengabaikan null/false dan meratakan larik (replaceChildren asli menulis "null"). */
export function fill(el, ...kids) { clear(el); add(el, kids); return el; }

// ---------- format ----------
const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const nfs = [nf(0), nf(1), nf(2), nf(3)];
export const fmtNum = (x, d = 0) => (x == null || !isFinite(x) ? '–' : nfs[d].format(x));
export const fmtPct = (x, d = 1) => (x == null || !isFinite(x) ? '–' : nfs[d].format(x * 100) + '%');
export const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function nodeDate(ts, off = 7) { return new Date((ts + off * 3600) * 1000); }
export function fmtClock(ts, off = 7, sec = true) {
  const d = nodeDate(ts, off);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` + (sec ? `:${pad2(d.getUTCSeconds())}` : '');
}
export function fmtDay(ts, off = 7) { const d = nodeDate(ts, off); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
export function dayKey(ts, off = 7) { const d = nodeDate(ts, off); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
export function fmtDateTime(ts, off = 7) { return `${fmtDay(ts, off)}, ${fmtClock(ts, off, false)}`; }
export function dayLabel(ts, now, off = 7) {
  const a = dayKey(ts, off), b = dayKey(now, off), y = dayKey(now - 86400, off);
  return a === b ? 'Hari ini' : a === y ? 'Kemarin' : fmtDay(ts, off);
}
export function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt` + (s % 60 && m < 10 ? ` ${s % 60} dtk` : '');
  const hh = Math.floor(m / 60);
  if (hh < 48) return `${hh} jam` + (m % 60 ? ` ${m % 60} mnt` : '');
  return `${Math.floor(hh / 24)} hari ${hh % 24} jam`;
}
export function fmtAgo(ts, now) {
  const d = Math.max(0, now - ts);
  if (d < 10) return 'baru saja';
  if (d < 60) return `${Math.round(d)} dtk lalu`;
  if (d < 3600) return `${Math.floor(d / 60)} mnt lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return `${Math.floor(d / 86400)} hari lalu`;
}
export function fmtBytes(b) {
  if (b == null || !isFinite(b)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${fmtNum(b, b < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// ---------- angka yang bergulir ----------
export function tween(el, to, { dur = 600, fmt = (v) => String(Math.round(v)) } = {}) {
  const from = el._tv ?? to;
  el._tv = to;
  if (el._ta) cancelAnimationFrame(el._ta);
  if (from === to || document.documentElement.dataset.lite === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(lerp(from, to, e));
    if (k < 1) el._ta = requestAnimationFrame(step);
  };
  el._ta = requestAnimationFrame(step);
}

// ---------- toast ----------
export function toast(msg, kind = 'info', ms = 3600) {
  const box = $('#toasts'); if (!box) return;
  const el = h('div', { class: `toast glass strong ${kind}`, role: 'status' }, h('span', { html: icon(kind === 'ok' ? 'checkc' : kind === 'err' ? 'alert' : 'info') }), h('span', { class: 'm' }, msg));
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  const t = setTimeout(done, ms);
  el.addEventListener('click', () => { clearTimeout(t); done(); });
}

// ---------- lembar (sheet) ----------
let sheetStack = [];
export function openSheet({ title, body, footer, narrow = false, onClose } = {}) {
  const prevFocus = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const closeBtn = h('button', { class: 'btn icon sm ghost', 'aria-label': 'Tutup', html: icon('x') });
  const bodyEl = h('div', { class: 'sheet-b' }, body);
  const sheet = h('div', { class: 'sheet glass strong' + (narrow ? ' narrow' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h('div', { class: 'sheet-h' }, h('h2', null, title || ''), closeBtn), bodyEl, footer && footer.length ? h('div', { class: 'sheet-f' }, footer) : null);
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('on'); sheet.classList.add('on'); }));
  let closed = false;
  const api = {
    el: sheet, body: bodyEl,
    close() {
      if (closed) return; closed = true;
      sheetStack = sheetStack.filter((s) => s !== api);
      scrim.classList.remove('on'); sheet.classList.remove('on');
      setTimeout(() => { scrim.remove(); sheet.remove(); }, 380);
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* abaikan */ }
      if (onClose) onClose();
    }
  };
  const onKey = (e) => {
    if (sheetStack[sheetStack.length - 1] !== api) return;
    if (e.key === 'Escape') { e.preventDefault(); api.close(); }
    else if (e.key === 'Tab') {
      const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', sheet).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', () => api.close());
  closeBtn.addEventListener('click', () => api.close());
  sheetStack.push(api);
  setTimeout(() => { const f = $('input, textarea, .btn.primary', bodyEl) || closeBtn; try { f.focus({ preventScroll: true }); } catch (e) { /* abaikan */ } }, 60);
  return api;
}
export function confirmSheet(title, text, okLabel = 'Lanjutkan', danger = false) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; res(v); } };
    const sh = openSheet({ title, narrow: true, body: h('p', { class: 'mut' }, text), onClose: () => fin(false),
      footer: [h('button', { class: 'btn', onclick: () => sh.close() }, 'Batal'), h('button', { class: 'btn ' + (danger ? 'warn' : 'primary'), onclick: () => { fin(true); sh.close(); } }, okLabel)] });
  });
}

// ---------- kontrol segmen ----------
export function segmented({ options, value, onChange, fill = false, tint = false, label = '' }) {
  const root = h('div', { class: 'seg init' + (fill ? ' fill' : '') + (tint ? ' tint' : ''), role: 'group', 'aria-label': label });
  const thumb = h('i', { class: 'seg-thumb' });
  root.append(thumb);
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value), 'data-v': String(o.value), title: o.title || null }, o.icon ? h('span', { html: icon(o.icon), style: 'display:inline-flex;vertical-align:-4px;margin-right:6px;width:16px;height:16px' }) : null, o.label);
    b.addEventListener('click', () => { if (api.value !== o.value) { api.set(o.value); onChange && onChange(o.value); } });
    root.append(b); return b;
  });
  const place = () => {
    const i = options.findIndex((o) => o.value === api.value);
    const b = btns[i];
    if (!b || !b.offsetWidth) return;
    root.style.setProperty('--x', b.offsetLeft - 3 + 'px');
    root.style.setProperty('--w', b.offsetWidth + 'px');
  };
  const api = {
    el: root, value,
    set(v, silent) {
      api.value = v;
      btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
      place(); if (!silent) root.classList.remove('init');
    },
    refresh: place
  };
  const ro = new ResizeObserver(() => { place(); });
  ro.observe(root);
  requestAnimationFrame(() => { place(); requestAnimationFrame(() => root.classList.remove('init')); });
  return api;
}

export function switchEl(checked, onChange, label = '') {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange && onChange(input.checked, input));
  const el = h('span', { class: 'switch' }, input, h('i'));
  el.input = input;
  return el;
}

export function rangeEl({ min = 0, max = 100, step = 1, value = 0, onInput, onChange, label = '' }) {
  const input = h('input', { type: 'range', class: 'range', min, max, step, 'aria-label': label });
  input.value = value;
  const paint = () => input.style.setProperty('--p', ((input.value - min) / (max - min)) * 100 + '%');
  paint();
  input.addEventListener('input', () => { paint(); onInput && onInput(+input.value); });
  input.addEventListener('change', () => onChange && onChange(+input.value));
  input.paint = paint;
  return input;
}

// ---------- tooltip grafik ----------
let tipEl = null;
export function showTip(node, x, y) {
  tipEl = tipEl || $('#tip'); if (!tipEl) return;
  clear(tipEl).append(node);
  tipEl.classList.add('on');
  const w = tipEl.offsetWidth, hgt = tipEl.offsetHeight;
  let tx = x + 14, ty = y - hgt - 12;
  if (tx + w > innerWidth - 8) tx = x - w - 14;
  if (tx < 8) tx = 8;
  if (ty < 8) ty = y + 18;
  tipEl.style.left = tx + 'px'; tipEl.style.top = ty + 'px';
}
export function hideTip() { if (tipEl) tipEl.classList.remove('on'); }

// ---------- sorot kursor pada kaca ----------
export function initSpotlight() {
  if (matchMedia('(pointer: coarse)').matches) return;
  let cur = null, raf = 0, ev = null;
  addEventListener('pointermove', (e) => {
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const g = ev.target.closest && ev.target.closest('.glass');
      if (g !== cur) { if (cur) cur.classList.remove('lit'); cur = g; if (cur) cur.classList.add('lit'); }
      if (cur) { const r = cur.getBoundingClientRect(); cur.style.setProperty('--mx', ev.clientX - r.left + 'px'); cur.style.setProperty('--my', ev.clientY - r.top + 'px'); }
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (cur) cur.classList.remove('lit'); cur = null; });
}

// ---------- potongan umum ----------
export function card(title, { sub, actions, cls = '' } = {}, ...kids) {
  return h('section', { class: `card glass ${cls}` },
    title ? h('div', { class: 'card-h' }, h('h2', null, title), sub ? h('span', { class: 'sub' }, sub) : null, actions || null) : null, ...kids);
}
export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('b', null, title), text ? h('p', { class: 'cap' }, text) : null, action || null);
}
export function skeleton(w = '100%', hgt = 16) { return h('div', { class: 'skel', style: { width: w, height: hgt + 'px' } }); }
export function copyText(t) {
  try { navigator.clipboard.writeText(t); toast('Disalin.', 'ok', 1600); } catch (e) { toast('Tidak bisa menyalin.', 'err'); }
}
export function setBool(el, name, on) { if (on) el.setAttribute(name, ''); else el.removeAttribute(name); }
