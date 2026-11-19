// Tampilan kamera di kanvas: gambar bingkai terakhir (dengan pudar silang antarbingkai) + kotak pelacak yang bergeser halus,
// jejak gerak, zona pantau, dan sorotan anomali. Dipakai di halaman Pantau, Kembar 3D (inset), dan editor zona.
import { h, fill, clamp, fmtClock, fmtNum, MODE_LABELS, LEVELS } from './ui.js';
import { icon } from './icons.js';
import { store } from './store.js';

const SEV = { critical: '#FF4D5E', warning: '#FFC53D', info: '#4CC3FF' };

function taxMap() {
  const node = store.get('node'); const m = {};
  ((node && node.taxonomy) || []).forEach((t) => { m[t.key] = t; });
  return m;
}
const hex2rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function rr(g, x, y, w, hh, r) {
  r = Math.min(r, w / 2, hh / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export class CameraView {
  /** opts: { mini: bool, chips: bool, aspect: number } */
  constructor(opts = {}) {
    this.opts = Object.assign({ mini: false, chips: true, aspect: 16 / 9 }, opts);
    this.canvas = h('canvas', { class: 'cam-c', role: 'img', 'aria-label': 'Gambar kamera pemantau sungai dengan kotak pelacak' });
    this.g = this.canvas.getContext('2d');
    this.chips = {
      tl: h('div', { class: 'cam-chip' }), tr: h('div', { class: 'cam-chip mono' }), bl: h('div', { class: 'cam-chip' }), br: h('div', { class: 'cam-chip' })
    };
    this.wait = h('div', { class: 'cam-wait' }, h('i', { class: 'spinner' }), h('span', null, 'Menunggu gambar dari kamera…'));
    this.el = h('div', { class: 'cam' + (this.opts.mini ? ' mini' : ''), style: { aspectRatio: String(this.opts.aspect) } }, this.canvas,
      this.opts.chips ? [h('div', { class: 'cam-top' }, this.chips.tl, this.chips.tr), h('div', { class: 'cam-bot' }, this.chips.bl, this.chips.br)] : null, this.wait);
    this.frame = null; this.cur = null; this.prev = null; this.tCur = 0; this.interval = 0.5;
    this.tracks = new Map(); this.zone = null; this.level = 0; this.running = false; this.size = [0, 0]; this.dpr = 1;
    this.showBoxes = true; this.showTrails = true; this.showZone = true;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.el);
    this.raf = 0; this.last = 0; this.stale = false;
    this._loop = (t) => this.draw(t);
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.mini ? 1.5 : 2);
    const w = Math.max(2, Math.round(r.width * this.dpr)), hh = Math.max(2, Math.round(r.height * this.dpr));
    if (w !== this.canvas.width || hh !== this.canvas.height) { this.canvas.width = w; this.canvas.height = hh; }
    this.size = [w, hh];
  }
  start() { if (this.running) return; this.running = true; this.resize(); this.last = performance.now(); this.raf = requestAnimationFrame(this._loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  destroy() { this.stop(); this.ro.disconnect(); }
  setZone(z) { this.zone = z && z.length >= 3 ? z : null; }
  setLevel(l) { this.level = l | 0; }

  /** Dipanggil saat bingkai baru dan gambarnya siap. */
  setFrame(frame, image) {
    const now = performance.now() / 1000;
    if (this.frame && frame.ts > this.frame.ts) this.interval = clamp(now - this.tCur, 0.05, 2);
    this.prev = this.cur; this.cur = image || this.cur; this.tCur = now; this.frame = frame;
    this.wait.hidden = true; this.stale = false;
    this.fAge = 0;
    const seen = new Set();
    for (const t of frame.tracks || []) {
      seen.add(t.id);
      let s = this.tracks.get(t.id);
      if (!s) { s = { box: t.box.slice(), trail: [], born: now }; this.tracks.set(t.id, s); }
      s.t = t; s.upd = now; s.gone = false;
      const cx = (t.box[0] + t.box[2]) / 2, cy = (t.box[1] + t.box[3]) / 2;
      const lt = s.trail[s.trail.length - 1];
      if (!lt || Math.hypot(lt[0] - cx, lt[1] - cy) > 0.004) { s.trail.push([cx, cy]); if (s.trail.length > 14) s.trail.shift(); }
    }
    for (const [id, s] of this.tracks) if (!seen.has(id)) s.gone = true;
    if (this.opts.chips) this.updateChips(frame);
  }
  clearFrame() { this.frame = null; this.cur = null; this.prev = null; this.tracks.clear(); this.wait.hidden = false; }
  markStale(on) { this.stale = on; this.el.classList.toggle('stale', on); }

  updateChips(f) {
    const node = store.get('node') || {}; const off = node.utc_offset_hours ?? 7;
    const n = f.night || {};
    fill(this.chips.tl, h('span', { class: 'dot live', style: { '--c': 'var(--lv3)' } }), h('b', null, (node.id || 'rw-01').toUpperCase()),
      n.is_night ? h('span', { class: 'cam-tag' }, h('span', { html: icon('moon'), style: 'display:inline-flex;width:13px;height:13px' }), n.ir ? 'Malam · IR' : 'Malam') : null);
    this.chips.tr.textContent = `${fmtClock(f.ts, off)} · ${fmtNum(f.fps && f.fps.actual, f.fps && f.fps.actual < 10 ? 1 : 0)} fps`;
    fill(this.chips.bl, h('span', { class: 'dot', style: { '--c': f.mode === 'low' ? 'var(--lv0)' : f.mode === 'normal' ? 'var(--accent)' : 'var(--lv2)' } }), `FPS ${MODE_LABELS[f.mode] || f.mode}`);
    const anomalies = (f.anomalies || []).length;
    fill(this.chips.br, h('span', { class: 'dot', style: { '--c': `var(--lv${f.level | 0})` } }), LEVELS[f.level | 0] || '–', anomalies ? h('span', { class: 'cam-tag warn' }, `${anomalies} anomali`) : null);
  }

  draw(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
    const g = this.g, [W, H] = this.size;
    if (!W) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const now = t / 1000;
    if (this.cur) {
      // pudar silang antara dua bingkai gambar supaya laju rendah tidak terasa patah-patah
      const k = this.prev ? clamp((now - this.tCur) / clamp(this.interval * 0.75, 0.12, 0.5), 0, 1) : 1;
      if (this.prev && k < 1) this.blit(g, this.prev, W, H, 1);
      this.blit(g, this.cur, W, H, this.prev ? k : 1);
    } else {
      g.fillStyle = 'rgba(6,22,32,0.6)'; g.fillRect(0, 0, W, H);
    }
    if (!this.frame) return;
    const S = this.dpr;
    if (this.showZone && this.zone) this.drawZone(g, W, H);
    const tax = taxMap();
    const age = now - this.tCur;
    const ease = 1 - Math.exp(-dt * 13);
    const font = getComputedStyle(document.body).fontFamily;
    const draw = [];
    for (const [id, s] of this.tracks) {
      if (s.gone && now - s.upd > 0.9) { this.tracks.delete(id); continue; }
      const tr = s.t; if (!tr) continue;
      // posisi sasaran = kotak terakhir + kecepatan x umur bingkai (batas 0,7 dtk), lalu mendekat dengan halus
      const a = clamp(age, 0, 0.7), vx = (tr.v && tr.v[0]) || 0, vy = (tr.v && tr.v[1]) || 0;
      const tg = [tr.box[0] + vx * a, tr.box[1] + vy * a, tr.box[2] + vx * a, tr.box[3] + vy * a];
      for (let i = 0; i < 4; i++) s.box[i] += (tg[i] - s.box[i]) * ease;
      s.alpha = s.gone ? clamp(1 - (now - s.upd) / 0.9, 0, 1) : clamp((now - s.born) / 0.25, 0, 1);
      draw.push(s);
    }
    draw.sort((p, q) => (p.t.anomaly ? 1 : 0) - (q.t.anomaly ? 1 : 0) || (p.t.cat === 'trash' ? 0 : 1) - (q.t.cat === 'trash' ? 0 : 1));
    if (this.showTrails) for (const s of draw) this.drawTrail(g, s, tax, W, H);
    // saat sampah padat (>12 kotak) label sampah disembunyikan agar gambar tetap terbaca
    this.crowd = draw.reduce((n, s) => n + (s.t.cat === 'trash' ? 1 : 0), 0) > 12;
    if (this.showBoxes) for (const s of draw) this.drawBox(g, s, tax, W, H, S, font, now);
  }

  blit(g, img, W, H, alpha) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    if (!iw) return;
    const sc = Math.max(W / iw, H / ih), w = iw * sc, hh = ih * sc;
    g.globalAlpha = alpha; g.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh); g.globalAlpha = 1;
  }
  drawZone(g, W, H) {
    const lc = getComputedStyle(document.documentElement).getPropertyValue('--lvc').trim() || '#34C9A0';
    g.save(); g.beginPath();
    this.zone.forEach((p, i) => (i ? g.lineTo(p[0] * W, p[1] * H) : g.moveTo(p[0] * W, p[1] * H)));
    g.closePath();
    g.fillStyle = hex2rgba(lc.startsWith('#') ? lc : '#34C9A0', 0.07); g.fill();
    g.lineWidth = 1.6 * this.dpr; g.setLineDash([7 * this.dpr, 6 * this.dpr]); g.strokeStyle = hex2rgba(lc.startsWith('#') ? lc : '#34C9A0', 0.75); g.stroke();
    g.restore();
  }
  drawTrail(g, s, tax, W, H) {
    const tr = s.t; const pts = s.trail;
    if (pts.length < 3) return;
    const moving = tr.cat !== 'trash' || (tr.speed || 0) > 0.02;
    if (!moving) return;
    const col = (tax[tr.cls] && tax[tr.cls].color) || '#4CC3FF';
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      g.strokeStyle = hex2rgba(col, 0.55 * k * (s.alpha ?? 1)); g.lineWidth = (1 + 2.2 * k) * this.dpr;
      g.beginPath(); g.moveTo(pts[i - 1][0] * W, pts[i - 1][1] * H); g.lineTo(pts[i][0] * W, pts[i][1] * H); g.stroke();
    }
    g.restore();
  }
  drawBox(g, s, tax, W, H, S, font, now) {
    const tr = s.t, b = s.box, info = tax[tr.cls] || {};
    const col = info.color || '#4CC3FF';
    const x = b[0] * W, y = b[1] * H, w = Math.max(4, (b[2] - b[0]) * W), hh = Math.max(4, (b[3] - b[1]) * H);
    const an = tr.anomaly, trash = tr.cat === 'trash';
    const al = (s.alpha ?? 1) * (tr.predicted ? 0.6 : 1);
    g.save(); g.globalAlpha = al;
    if (an) {
      const sev = SEV[an.severity] || SEV.warning;
      const pulse = 0.5 + 0.5 * Math.sin(now * 5.2);
      g.shadowColor = hex2rgba(sev, 0.85); g.shadowBlur = (10 + 12 * pulse) * S;
      g.lineWidth = 3 * S; g.strokeStyle = sev; rr(g, x - 3 * S, y - 3 * S, w + 6 * S, hh + 6 * S, 9 * S); g.stroke();
      g.shadowBlur = 0; g.fillStyle = hex2rgba(sev, 0.1); rr(g, x, y, w, hh, 7 * S); g.fill();
    }
    g.lineWidth = (trash ? 1.6 : 2.4) * S; g.strokeStyle = hex2rgba(col, trash ? (this.crowd ? 0.7 : 0.9) : 1);
    if (tr.predicted) g.setLineDash([5 * S, 4 * S]);
    rr(g, x, y, w, hh, 6 * S); g.stroke(); g.setLineDash([]);
    // label: sampah hanya bila cukup besar; non-sampah dan anomali selalu berlabel
    const big = !this.crowd && w > 34 * S && hh > 22 * S;
    if (!trash || an || big) {
      const name = an ? an.label : (info.name || tr.cls);
      const txt = `${name}${trash ? '' : ' ' + fmtNum(tr.score, 2)}`;
      g.font = `600 ${11.5 * S}px ${font}`;
      const tw = g.measureText(txt).width + 14 * S, th = 20 * S;
      let lx = x, ly = y - th - 4 * S; if (ly < 2 * S) ly = y + 4 * S; if (lx + tw > W - 2 * S) lx = W - tw - 2 * S;
      g.fillStyle = 'rgba(6,20,30,0.74)'; rr(g, lx, ly, tw, th, th / 2); g.fill();
      g.fillStyle = an ? SEV[an.severity] || SEV.warning : col; g.beginPath(); g.arc(lx + 9 * S, ly + th / 2, 3.5 * S, 0, 6.283); g.fill();
      g.fillStyle = '#F2F8FA'; g.textBaseline = 'middle'; g.fillText(txt, lx + 17 * S, ly + th / 2 + 0.5 * S);
    }
    g.restore();
  }
}
