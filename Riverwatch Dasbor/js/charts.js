// Grafik SVG/HTML ringan tanpa pustaka: area dengan ambang tingkat, batang bertumpuk, batang mendatar, strip jam, sparkline, cincin.
// Aturan: garis 2px, grid hairline redup, isi area ~14%, jarak 2px antarsegmen, teks memakai warna teks (bukan warna seri),
// legenda selalu ada untuk >= 2 seri, tooltip saat hover, dan tabel sebagai tampilan alternatif.
import { h, svgEl, clamp, fmtClock, fmtDay, fmtNum, fmtPct, showTip, hideTip, LEVELS, clear } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

export function niceStep(max, n = 4) {
  const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const STEPS = [300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
export function timeTicks(from, to, off, want = 6) {
  const span = to - from;
  let step = STEPS.find((s) => span / s <= want) || 86400;
  const out = [];
  const lf = from + off * 3600;
  let t = Math.ceil(lf / step) * step - off * 3600;
  for (; t <= to; t += step) out.push({ t, mid: ((t + off * 3600) % 86400) === 0 });
  return { ticks: out, step };
}
function tickLabel(tk, step, off, span) {
  if (tk.mid || span > 3 * 86400) return fmtDay(tk.t, off);
  return fmtClock(tk.t, off, false);
}
const levelOf = (v, th) => (v >= th[2] ? 3 : v >= th[1] ? 2 : v >= th[0] ? 1 : 0);

/** Grafik area tutupan sampah. Mengembalikan {el, update(opts)}. */
export function areaChart(opts) {
  const root = h('div', { class: 'chart' });
  let o = opts, w = 0;
  const H = o.height || 250;
  const m = { l: 40, r: 10, t: 10, b: 24 + (o.markers ? 22 : 0) };
  const svg = svgEl('svg', { class: 'cv', height: H, role: 'img', 'aria-label': o.label || 'Grafik tutupan sampah' });
  root.append(svg);

  function render() {
    w = root.clientWidth; if (w < 40) return;
    svg.setAttribute('width', w); svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
    clear(svg);
    const { ts, y, ymax: ym, thresholds: th, off = 7, from, to } = o;
    if (!ts || !ts.length) { svg.append(textEl(w / 2, H / 2, 'Belum ada data pada rentang ini.', 'mid')); return; }
    const t0 = from ?? ts[0], t1 = to ?? ts[ts.length - 1];
    const maxv = Math.max(...y.filter((v) => v != null), th ? th[2] * 1.15 : 0.1);
    const step = niceStep(Math.max(ym || 0, maxv * 1.05), 4);
    const ymax = Math.ceil(Math.max(ym || 0, maxv * 1.05) / step) * step;
    const X = (t) => m.l + ((t - t0) / Math.max(1, t1 - t0)) * (w - m.l - m.r);
    const Y = (v) => m.t + (1 - v / ymax) * (H - m.t - m.b);
    const bot = H - m.b;
    // pita tingkat (latar sangat tipis)
    if (th) {
      const edges = [0, th[0], th[1], th[2], ymax];
      for (let i = 0; i < 4; i++) {
        if (edges[i] >= ymax) break;
        const top = Math.min(edges[i + 1], ymax);
        svg.append(svgEl('rect', { x: m.l, y: Y(top), width: w - m.l - m.r, height: Math.max(0, Y(edges[i]) - Y(top)), style: `fill:var(--lv${i});opacity:.055` }));
      }
    }
    // grid dan label sumbu Y
    for (let v = 0; v <= ymax + 1e-9; v += step) {
      svg.append(svgEl('line', { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: 'grid' }));
      svg.append(textEl(m.l - 8, Y(v) + 4, `${fmtNum(v * 100, step < 0.01 ? 1 : 0)}%`, 'end'));
    }
    // garis ambang dengan label langsung
    if (th) {
      th.forEach((v, i) => {
        if (v > ymax) return;
        svg.append(svgEl('line', { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), style: `stroke:var(--lv${i + 1});stroke-opacity:.55;stroke-width:1;stroke-dasharray:2 4` }));
        const tx = textEl(w - m.r - 4, Y(v) - 4, `${LEVELS[i + 1]} ${fmtNum(v * 100)}%`, 'end'); tx.setAttribute('class', 'ax th'); svg.append(tx);
      });
    }
    // sumbu X
    const { ticks, step: ts_ } = timeTicks(t0, t1, off, w < 520 ? 4 : 6);
    ticks.forEach((tk) => {
      const x = X(tk.t); if (x < m.l - 1 || x > w - m.r + 1) return;
      svg.append(svgEl('line', { x1: x, x2: x, y1: bot, y2: bot + 4, class: 'grid' }));
      svg.append(textEl(clamp(x, m.l + 14, w - m.r - 14), H - 6, tickLabel(tk, ts_, off, t1 - t0), 'mid'));
    });
    // area + garis (putus pada celah data)
    const pts = ts.map((t, i) => (y[i] == null ? null : [X(t), Y(y[i])]));
    let d = '', started = false, seg = [];
    const segs = [];
    pts.forEach((p) => { if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    segs.forEach((s) => {
      const line = s.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
      svg.append(svgEl('path', { d: `${line}L${s[s.length - 1][0].toFixed(1)} ${bot}L${s[0][0].toFixed(1)} ${bot}Z`, class: 'area' }));
      svg.append(svgEl('path', { d: line, class: 'line' }));
    });
    // titik puncak dengan label langsung
    let pi = -1, pv = -1;
    y.forEach((v, i) => { if (v != null && v > pv) { pv = v; pi = i; } });
    if (pi >= 0 && pv > 0) {
      const px = X(ts[pi]), py = Y(pv);
      svg.append(svgEl('circle', { cx: px, cy: py, r: 5, class: 'pk' }));
      const lab = `Puncak ${fmtNum(pv * 100, 1)}%`;
      svg.append(textEl(clamp(px, m.l + 36, w - m.r - 36), py - 10, lab, 'mid'));
    }
    // jalur penanda kejadian
    const lane = H - m.b + 14;
    if (o.markers) {
      svg.append(svgEl('line', { x1: m.l, x2: w - m.r, y1: lane, y2: lane, class: 'grid' }));
      o.markers.forEach((ev) => {
        if (ev.ts < t0 || ev.ts > t1) return;
        const c = svgEl('circle', { cx: X(ev.ts), cy: lane, r: 5, class: 'mk ' + (ev.severity || 'info'), tabindex: 0, role: 'button', 'aria-label': ev.title });
        c.addEventListener('pointerenter', (e) => showTip(h('div', null, h('b', null, ev.title), h('div', { class: 'cap' }, `${fmtDay(ev.ts, off)}, ${fmtClock(ev.ts, off, false)}`)), e.clientX, e.clientY));
        c.addEventListener('pointermove', (e) => showTip(h('div', null, h('b', null, ev.title), h('div', { class: 'cap' }, `${fmtDay(ev.ts, off)}, ${fmtClock(ev.ts, off, false)}`)), e.clientX, e.clientY));
        c.addEventListener('pointerleave', hideTip);
        c.addEventListener('click', () => o.onMarker && o.onMarker(ev));
        c.addEventListener('keydown', (e) => { if (e.key === 'Enter') o.onMarker && o.onMarker(ev); });
        svg.append(c);
      });
      const tx = textEl(m.l - 8, lane + 4, 'Kejadian', 'end'); svg.append(tx);
    }
    // lapisan hover: garis bidik + titik + tooltip
    const cross = svgEl('line', { y1: m.t, y2: bot, class: 'cross', visibility: 'hidden' });
    const dot = svgEl('circle', { r: 5.5, class: 'pk', visibility: 'hidden' });
    svg.append(cross, dot);
    const hit = svgEl('rect', { x: m.l, y: m.t, width: w - m.l - m.r, height: bot - m.t, fill: 'transparent', style: 'cursor:crosshair' });
    svg.append(hit);
    const idxAt = (px) => {
      const t = t0 + ((px - m.l) / (w - m.l - m.r)) * (t1 - t0);
      let lo = 0, hi = ts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] < t) lo = mid; else hi = mid; }
      return Math.abs(ts[lo] - t) < Math.abs(ts[hi] - t) ? lo : hi;
    };
    const move = (e) => {
      const r = svg.getBoundingClientRect(); const i = idxAt(e.clientX - r.left);
      if (y[i] == null) { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); return; }
      const x = X(ts[i]); cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', Y(y[i])); dot.setAttribute('visibility', 'visible');
      const lv = th ? levelOf(y[i], th) : null;
      const rows = [['Tutupan rata-rata', fmtPct(y[i], 1)]];
      if (o.max && o.max[i] != null) rows.push(['Tutupan tertinggi', fmtPct(o.max[i], 1)]);
      if (o.extra) o.extra(i).forEach((r2) => rows.push(r2));
      showTip(h('div', null, h('b', null, `${fmtDay(ts[i], off)}, ${fmtClock(ts[i], off, false)}`),
        lv != null ? h('div', { class: 'tr' }, h('span', { class: 'k' }, h('span', { class: 'dot', style: { '--c': `var(--lv${lv})` } }), 'Tingkat'), h('b', null, LEVELS[lv])) : null,
        ...rows.map((r2) => h('div', { class: 'tr' }, h('span', { class: 'k' }, r2[0]), h('span', null, r2[1])))), e.clientX, e.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
  }
  const ro = new ResizeObserver(() => render());
  ro.observe(root);
  requestAnimationFrame(render);
  return { el: root, update(n) { o = Object.assign({}, o, n); render(); }, destroy() { ro.disconnect(); } };
}
function textEl(x, y, text, anchor) {
  const t = svgEl('text', { x, y, class: 'ax', 'text-anchor': anchor === 'end' ? 'end' : anchor === 'mid' ? 'middle' : 'start' });
  t.textContent = text; return t;
}

/** Batang tunggal terbagi (satu keseluruhan, banyak bagian). parts: [{label,value,color,text}] */
export function segBar({ parts, tall = true, fmt = (p, pct) => `${Math.round(pct)}%`, tipFmt, ariaLabel = '' }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const bar = h('div', { class: 'sbar' + (tall ? ' tall' : ''), role: 'img', 'aria-label': ariaLabel || parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ') });
  parts.forEach((p) => {
    if (p.value <= 0) return;
    const pct = (p.value / total) * 100;
    const seg = h('i', { style: Object.assign({ flexGrow: String(p.value), background: p.color }, p.ink ? { color: p.ink } : null) });
    if (tall && pct >= 11) seg.append(h('span', null, fmt(p, pct)));
    const tip = (e) => showTip(h('div', null, h('div', { class: 'tr' }, h('span', { class: 'k' }, h('span', { class: 'dot', style: { '--c': p.color } }), p.label), h('b', null, fmt(p, pct))), tipFmt ? h('div', { class: 'cap' }, tipFmt(p, pct)) : null), e.clientX, e.clientY);
    seg.addEventListener('pointerenter', tip); seg.addEventListener('pointermove', tip); seg.addEventListener('pointerleave', hideTip);
    bar.append(seg);
  });
  return bar;
}
export function legend(items) {
  return h('div', { class: 'legend' }, items.map((it) => h('span', { class: 'lg' }, h('i', { style: { background: it.color } }), h('span', null, it.label), it.value != null ? h('b', null, it.value) : null)));
}

/** Batang mendatar satu seri: nilai di ujung batang. items: [{label, value, color?, sub?}] */
export function hBars(items, { fmt = (v) => fmtNum(v), color = 'var(--s1)', onClick } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h('div', { class: 'hbars' }, items.map((it) => {
    const row = h('div', { class: 'hb' + (onClick ? ' click' : '') },
      h('span', { class: 'hb-l' }, it.label), h('span', { class: 'hb-t' }, h('i', { style: { width: Math.max(it.value > 0 ? 3 : 0, (it.value / max) * 100) + '%', background: it.color || color } })), h('b', { class: 'hb-v' }, fmt(it.value)));
    const tip = (e) => showTip(h('div', null, h('b', null, it.label), h('div', { class: 'cap' }, `${fmt(it.value)}${it.sub ? ' · ' + it.sub : ''}`)), e.clientX, e.clientY);
    row.addEventListener('pointerenter', tip); row.addEventListener('pointermove', tip); row.addEventListener('pointerleave', hideTip);
    if (onClick) row.addEventListener('click', () => onClick(it));
    return row;
  }));
}

/** Strip 24 jam: warna = rata-rata tutupan (satu rona, makin pekat makin tinggi), titik = jumlah anomali. */
export function hourStrip(hours, { th, off = 7, nowHour } = {}) {
  const maxc = Math.max(0.2, ...hours.map((x) => x.avg_cov || 0));
  const strip = h('div', { class: 'hstrip', role: 'img', 'aria-label': 'Tutupan rata-rata dan jumlah anomali per jam' });
  hours.forEach((x) => {
    const k = Math.sqrt(clamp((x.avg_cov || 0) / maxc, 0, 1));
    const cell = h('div', { class: 'hc', style: { '--k': (8 + k * 78).toFixed(0) + '%' } },
      h('i', { class: 'hc-f' }), h('span', { class: 'hc-d' }, x.anomalies ? Array.from({ length: Math.min(3, x.anomalies) }, () => h('b')) : null),
      h('span', { class: 'hc-l' }, x.hour % 3 === 0 ? String(x.hour).padStart(2, '0') : ''));
    if (nowHour === x.hour) cell.classList.add('now');
    const tip = (e) => showTip(h('div', null, h('b', null, `${String(x.hour).padStart(2, '0')}:00–${String((x.hour + 1) % 24).padStart(2, '0')}:00`),
      h('div', { class: 'tr' }, h('span', { class: 'k' }, 'Tutupan rata-rata'), h('span', null, fmtPct(x.avg_cov, 1))),
      h('div', { class: 'tr' }, h('span', { class: 'k' }, 'Anomali'), h('span', null, String(x.anomalies || 0)))), e.clientX, e.clientY);
    cell.addEventListener('pointerenter', tip); cell.addEventListener('pointermove', tip); cell.addEventListener('pointerleave', hideTip);
    strip.append(cell);
  });
  return strip;
}

/** Sparkline kecil. values: angka (null dilewati). */
export function sparkline(values, { w = 120, h: hh = 34, color = 'var(--accent)', min, max, area = true, dot = true, step = false } = {}) {
  const svg = svgEl('svg', { class: 'spark', width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, 'aria-hidden': 'true' });
  const v = values.filter((x) => x != null && isFinite(x));
  if (v.length < 2) return svg;
  const lo = min ?? Math.min(...v), hi = max ?? Math.max(...v), rng = hi - lo || 1;
  const pad = 4;
  const pts = []; const n = values.length;
  values.forEach((val, i) => { if (val != null && isFinite(val)) pts.push([pad + (i / (n - 1)) * (w - pad * 2), hh - pad - ((val - lo) / rng) * (hh - pad * 2)]); });
  let d = '';
  pts.forEach((p, i) => { d += i ? (step ? `H${p[0].toFixed(1)}V${p[1].toFixed(1)}` : `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`) : `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`; });
  if (area) svg.append(svgEl('path', { d: `${d}L${pts[pts.length - 1][0]} ${hh}L${pts[0][0]} ${hh}Z`, style: `fill:${color};opacity:.14` }));
  svg.append(svgEl('path', { d, fill: 'none', style: `stroke:${color};stroke-width:2;stroke-linecap:round;stroke-linejoin:round` }));
  if (dot) { const l = pts[pts.length - 1]; svg.append(svgEl('circle', { cx: l[0], cy: l[1], r: 3.6, style: `fill:${color};stroke:var(--ring,transparent);stroke-width:2` })); }
  return svg;
}

/** Cincin skor 0–100. */
export function ring({ value, size = 132, stroke = 11, color = 'var(--lv0)', label, sub }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `${label || 'Skor'} ${Math.round(value)} dari 100` });
  svg.append(svgEl('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', style: `stroke:var(--fill-2);stroke-width:${stroke}` }));
  const arc = svgEl('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', transform: `rotate(-90 ${size / 2} ${size / 2})`, style: `stroke:${color};stroke-width:${stroke};stroke-linecap:round;stroke-dasharray:${c};stroke-dashoffset:${c};transition:stroke-dashoffset 1.1s var(--ease),stroke .6s ease` });
  svg.append(arc);
  requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = String(c * (1 - clamp(value, 0, 100) / 100)); }));
  const wrap = h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } }, svg, h('div', { class: 'ring-c' }, h('b', { class: 'num' }, String(Math.round(value))), sub ? h('span', null, sub) : null));
  wrap.arc = arc; wrap.c = c;
  wrap.set = (v, col) => { arc.style.strokeDashoffset = String(c * (1 - clamp(v, 0, 100) / 100)); if (col) arc.style.stroke = col; wrap.querySelector('b').textContent = String(Math.round(v)); };
  return wrap;
}

/** Tabel alternatif untuk pembaca layar dan yang ingin angka. */
export function dataTable(cols, rows) {
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', null, c))))))));
}
