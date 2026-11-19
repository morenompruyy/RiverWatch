// Halaman Kesehatan: skor kesehatan CCTV, sensor (suhu, daya, jaringan), pemeriksaan per kelompok, penyimpanan, lokasi dan perangkat keras.
import { h, svgEl, fill, tween, fmtNum, fmtPct, fmtDur, fmtBytes, fmtAgo, segmented, emptyState, debounce } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { core, pageHeader, nowTs, banner } from '../core.js';
import { ring, sparkline, hBars } from '../charts.js';

const RANGES = [{ value: '1h', label: '1 jam', bucket: 60 }, { value: '6h', label: '6 jam', bucket: 300 }, { value: '24h', label: '24 jam', bucket: 900 }];
const TILES = [
  { key: 'cpu_temp_c', label: 'Suhu prosesor', unit: '°C', d: 1, ic: 'therm', chk: 'cpu_temp' },
  { key: 'enclosure_temp_c', label: 'Suhu dalam boks', unit: '°C', d: 1, ic: 'therm', chk: 'enclosure_temp' },
  { key: 'enclosure_humidity_pct', label: 'Kelembapan boks', unit: '%', d: 0, ic: 'drop', chk: 'humidity' },
  { key: 'cpu_load_pct', label: 'Beban prosesor', unit: '%', d: 0, ic: 'cpu', chk: 'cpu_load' },
  { key: 'ram_pct', label: 'Memori terpakai', unit: '%', d: 0, ic: 'cpu', chk: 'ram' },
  { key: 'net_rssi_dbm', label: 'Kekuatan sinyal', unit: 'dBm', d: 0, ic: 'wifi', chk: 'rssi' },
  { key: 'net_latency_ms', label: 'Latensi jaringan', unit: 'ms', d: 0, ic: 'wifi', chk: 'latency' },
  { key: 'power_w', label: 'Daya terpakai', unit: 'W', d: 1, ic: 'bolt', chk: 'supply', sub: (t) => (t.supply_v != null ? `${fmtNum(t.supply_v, 1)} V${t.supply_a != null ? ` · ${fmtNum(t.supply_a, 2)} A` : ''}` : '') },
  { key: 'water_temp_c', label: 'Suhu air', unit: '°C', d: 1, ic: 'drop' },
  { key: 'water_level_cm', label: 'Tinggi muka air', unit: 'cm', d: 0, ic: 'wave' },
  { key: 'disk_free_gb', label: 'Ruang disk bebas', unit: 'GB', d: 0, ic: 'db', chk: 'disk', sub: (t) => (t.disk_total_gb ? `dari ${fmtNum(t.disk_total_gb, 0)} GB` : '') },
  { key: 'uptime_s', label: 'Menyala selama', unit: '', ic: 'power', raw: (t) => fmtDur(t.uptime_s), nospark: true }
];
const STORE_NAMES = { timelapse: 'Rekaman hemat (time-lapse)', events: 'Klip kejadian', snapshots: 'Foto', review: 'Bahan tinjau dan latih' };
const STATUS = { ok: { c: 'var(--lv0)', t: 'Baik', i: 'checkc' }, warn: { c: 'var(--lv1)', t: 'Perlu dicek', i: 'alert' }, crit: { c: 'var(--lv3)', t: 'Bermasalah', i: 'alert' }, na: { c: 'var(--ink-3)', t: 'Tidak aktif', i: 'info' } };
const HEADLINE = { ok: 'Sehat', warn: 'Perlu perhatian', crit: 'Bermasalah', na: 'Belum ada data' };

function mapSvg(loc) {
  const W = 320, H = 190, cx = 170, cy = 112, hd = ((loc.heading_deg || 0) * Math.PI) / 180;
  const svg = svgEl('svg', { class: 'locmap', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Skema lokasi kamera di tepi sungai' });
  svg.append(svgEl('path', { d: 'M-10 60 C 60 40, 110 120, 170 105 S 270 70, 330 96 L 330 150 C 270 128, 220 168, 160 160 S 50 98, -10 118 Z', class: 'lm-river' }));
  svg.append(svgEl('path', { d: 'M-10 78 C 60 58, 110 138, 170 123 S 270 88, 330 114', class: 'lm-flow', fill: 'none' }));
  svg.append(svgEl('rect', { x: cx - 8, y: 22, width: 16, height: 150, rx: 6, class: 'lm-bridge', transform: `rotate(8 ${cx} ${cy})` }));
  // kerucut pandang searah arah kamera (0° = utara = atas)
  const fov = (66 * Math.PI) / 180, len = 70;
  const a1 = hd - fov / 2 - Math.PI / 2, a2 = hd + fov / 2 - Math.PI / 2;
  svg.append(svgEl('path', { d: `M${cx} ${cy} L${cx + Math.cos(a1) * len} ${cy + Math.sin(a1) * len} A${len} ${len} 0 0 1 ${cx + Math.cos(a2) * len} ${cy + Math.sin(a2) * len} Z`, class: 'lm-fov' }));
  svg.append(svgEl('circle', { cx, cy, r: 13, class: 'lm-pulse' }));
  svg.append(svgEl('circle', { cx, cy, r: 6.5, class: 'lm-pin' }));
  const n = svgEl('g', { transform: 'translate(292 28)' });
  n.append(svgEl('circle', { r: 15, class: 'lm-n' }), svgEl('path', { d: 'M0 -9 L5 6 L0 3 L-5 6 Z', class: 'lm-na' }));
  const t = svgEl('text', { y: -19, 'text-anchor': 'middle', class: 'lm-t' }); t.textContent = 'U'; n.append(t);
  svg.append(n);
  return svg;
}

export default {
  id: 'kesehatan',
  async mount(root) {
    const offs = [], timers = [];
    let trange = '1h', series = null, detail = null, storage = null, seq = 0;
    const head = pageHeader('Kesehatan', 'Kondisi perangkat CCTV: kamera, model AI, sistem, jaringan, dan penyimpanan.');
    const banners = h('div', { class: 'stack' });

    // ---------- skor ----------
    const scoreRing = ring({ value: 0, size: 148, stroke: 12, color: 'var(--ink-3)', label: 'Skor kesehatan', sub: 'dari 100' });
    const headline = h('h2', { class: 'hl' }, 'Memeriksa…'), summary = h('p', { class: 'mut' }, ''), issues = h('ul', { class: 'issues' });
    const scoreCard = h('section', { class: 'card glass score' }, h('div', { class: 'score-in' }, scoreRing, h('div', { class: 'score-t' }, headline, summary, issues)));

    // ---------- sensor ----------
    const tilesBox = h('div', { class: 'tiles' });
    const rangeSeg = segmented({ options: RANGES, value: trange, label: 'Rentang grafik sensor', onChange: (v) => { trange = v; loadSeries(); } });
    const sensCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Sensor dan jaringan'), rangeSeg.el), tilesBox);
    const tileEls = {};
    TILES.forEach((t) => {
      const val = h('b', { class: 'num tnum' }, '–'), unit = h('span', { class: 'u' }, t.unit), sub = h('span', { class: 'cap' }, ''), spark = h('div', { class: 'tile-sp' });
      const dot = h('span', { class: 'dot', style: { '--c': 'var(--ink-3)' } });
      const el = h('div', { class: 'tile', hidden: true }, h('div', { class: 'tile-h' }, h('span', { html: icon(t.ic) }), h('span', null, t.label), dot), h('div', { class: 'tile-v' }, val, unit), sub, t.nospark ? null : spark);
      tileEls[t.key] = { t, val, unit, sub, spark, dot, el }; tilesBox.append(el);
    });

    // ---------- pemeriksaan ----------
    const checksBox = h('div', { class: 'checks' });
    const chkCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Pemeriksaan perangkat'), h('span', { class: 'sub', id: 'chk-sub' }, '')), checksBox);

    // ---------- penyimpanan ----------
    const stoBox = h('div', { class: 'stack' });
    const stoCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Penyimpanan')), stoBox);

    // ---------- lokasi ----------
    const locBox = h('div', { class: 'stack' });
    const locCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Lokasi dan perangkat')), locBox);

    root.append(head.el, banners, h('div', { class: 'g-kes' }, scoreCard, sensCard), h('div', { class: 'g2 top' }, chkCard, h('div', { class: 'col' }, stoCard, locCard)));

    // ---------- pengisi ----------
    function paintScore() {
      const hl = store.get('health') || (detail ? { score: detail.score, status: detail.status, summary: detail.summary, issues: detail.issues } : null);
      const d = detail || hl; if (!d) return;
      const st = STATUS[d.status] || STATUS.na;
      scoreRing.set(d.score ?? 0, st.c);
      headline.textContent = HEADLINE[d.status] || '–'; headline.style.color = st.c;
      const shown = HEADLINE[d.status];
      summary.textContent = d.summary && d.summary !== shown ? d.summary : '';
      summary.hidden = !summary.textContent;
      const bad = detail ? detail.checks.filter((c) => c.status === 'warn' || c.status === 'crit') : [];
      fill(issues, bad.map((c) => h('li', null, h('span', { class: 'dot', style: { '--c': (STATUS[c.status] || STATUS.na).c } }), h('span', null, h('b', null, c.label), c.detail ? ` · ${c.detail}` : ''))));
    }
    function checkStatus(key) { const c = detail && detail.checks.find((x) => x.key === key); return c ? c.status : null; }
    function paintTiles() {
      const tel = store.get('telemetry'); if (!tel) return;
      const av = tel.available || {};
      Object.values(tileEls).forEach(({ t, val, unit, sub, dot, el }) => {
        const on = t.raw ? tel.uptime_s != null : av[t.key] !== false && tel[t.key] != null;
        el.hidden = !on; if (!on) return;
        if (t.raw) { val.textContent = t.raw(tel); unit.textContent = ''; val.classList.add('sm'); }
        else tween(val, tel[t.key], { fmt: (v) => fmtNum(v, t.d), dur: 500 });
        sub.textContent = t.sub ? t.sub(tel) : '';
        const st = t.chk ? checkStatus(t.chk) : null;
        dot.style.setProperty('--c', st ? (STATUS[st] || STATUS.na).c : 'var(--lv0)');
        dot.title = st ? (STATUS[st] || STATUS.na).t : '';
      });
      paintSparks();
    }
    function paintSparks() {
      if (!series) return;
      Object.values(tileEls).forEach(({ t, spark, el }) => {
        if (t.nospark || el.hidden) return;
        const v = series[t.key]; if (!v) return;
        const w = Math.max(80, spark.clientWidth || 160);
        fill(spark, sparkline(v, { w, h: 38, color: 'var(--s1)', dot: true }));
      });
    }
    function paintChecks() {
      if (!detail) return;
      const groups = []; const idx = {};
      detail.checks.forEach((c) => { if (!(c.group in idx)) { idx[c.group] = groups.length; groups.push({ label: c.group_label, items: [] }); } groups[idx[c.group]].items.push(c); });
      const bad = detail.checks.filter((c) => c.status === 'warn' || c.status === 'crit').length;
      const sub = document.getElementById('chk-sub'); if (sub) sub.textContent = bad ? `${bad} perlu dicek` : 'semuanya baik';
      fill(checksBox, groups.map((g) => h('div', { class: 'chk-g' }, h('h3', null, g.label),
        h('div', { class: 'rows' }, g.items.map((c) => {
          const st = STATUS[c.status] || STATUS.na;
          const v = c.value != null && c.unit ? `${fmtNum(c.value, Math.abs(c.value) < 10 && c.unit !== '' ? 1 : 0)} ${c.unit}` : '';
          return h('div', { class: 'row chk' }, h('span', { class: 'sev-i', style: { color: st.c }, html: icon(st.i), title: st.t }),
            h('div', { class: 'grow' }, h('div', { class: 't' }, c.label), h('div', { class: 'd' }, c.detail || '')), v ? h('b', { class: 'tnum' }, v) : null);
        })))));
    }
    function paintStorage() {
      if (!storage) return;
      const s = storage, d = s.disk || {}, wb = s.written_bytes || {}, ub = s.usage_bytes || {};
      const quota = (s.quota_gb || 0) * 1073741824, used = ub.total || 0;
      const items = ['timelapse', 'events', 'snapshots', 'review'].map((k) => ({ label: STORE_NAMES[k], value: ub[k] || 0, sub: `${fmtNum((s.files || {})[k] || 0)} berkas` })).filter((i) => i.value > 0 || i.label === STORE_NAMES.timelapse);
      const bar = (pct, c) => h('div', { class: 'meter' }, h('i', { style: { width: Math.min(100, pct) + '%', background: c } }));
      const dayInfo = s.days_left != null ? `Cukup untuk sekitar ${fmtNum(s.days_left, 0)} hari lagi` : 'Perkiraan sisa hari tampil setelah data terkumpul';
      fill(stoBox,
        h('div', { class: 'sto-top' }, h('div', null, h('b', { class: 'num sto-n' }, fmtNum(s.saved_pct ?? 0, 0), h('small', null, '%')), h('div', { class: 'cap' }, 'lebih hemat dari merekam terus-menerus')),
          h('div', { class: 'cap sto-c' }, `${fmtBytes(wb.total || 0)} tertulis, sedangkan rekaman ${fmtNum(s.baseline_fps || 15, 0)} fps terus-menerus akan ±${fmtBytes(s.baseline_bytes_est || 0)}.`)),
        h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'Disk'), h('span', { class: 'cap tnum' }, `${fmtNum(d.free_gb, 1)} GB bebas dari ${fmtNum(d.total_gb, 0)} GB`)), bar(d.used_pct || 0, (d.used_pct || 0) > 90 ? 'var(--lv3)' : (d.used_pct || 0) > 80 ? 'var(--lv1)' : 'var(--s1)')),
        h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'Jatah rekaman Riverwatch'), h('span', { class: 'cap tnum' }, `${fmtBytes(used)} dari ${fmtNum(s.quota_gb, 0)} GB`)), bar(quota ? (used / quota) * 100 : 0, s.over_quota ? 'var(--lv3)' : 'var(--s1)')),
        hBars(items, { fmt: (v) => fmtBytes(v) }),
        h('p', { class: 'cap' }, `${dayInfo}. Rekaman hemat disimpan ${fmtNum((s.retention || {}).timelapse_days, 0)} hari, klip kejadian ${fmtNum((s.retention || {}).event_days, 0)} hari${(s.retention || {}).protect_unacked ? ', dan klip yang belum dikonfirmasi tidak dihapus otomatis' : ''}.`));
    }
    function paintLocation() {
      const n = store.get('node'); if (!n) return;
      const loc = n.location || {}, hw = n.hardware || {};
      const mapUrl = loc.map_url || `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=18/${loc.lat}/${loc.lon}`;
      const dirs = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
      const hd = loc.heading_deg || 0, dir = dirs[Math.round(hd / 45) % 8];
      const kv = (k, v) => h('div', { class: 'row' }, h('span', { class: 'mut' }, k), h('span', { class: 'grow' }), h('b', { class: 'val' }, v));
      fill(locBox, mapSvg(loc),
        h('div', { class: 'loc-h' }, h('div', null, h('b', null, n.name || n.id), h('div', { class: 'cap' }, n.river || '')), h('a', { class: 'btn sm', href: mapUrl, target: '_blank', rel: 'noopener noreferrer' }, h('span', { html: icon('pin') }), 'Buka peta')),
        h('p', { class: 'cap' }, 'Gambar di atas hanya skema arah pandang kamera, bukan peta sebenarnya.'),
        h('div', { class: 'rows' },
          kv('Koordinat', loc.lat == null ? '–' : `${Number(loc.lat).toFixed(5)}, ${Number(loc.lon).toFixed(5)}`), kv('Ketinggian', `${fmtNum(loc.altitude_m, 0)} m dpl`), kv('Arah kamera', `${fmtNum(hd, 0)}° (${dir})`),
          kv('Kamera', hw.camera || '–'), kv('Komputer', hw.computer || '–'), kv('Sudut pandang lensa', hw.lens_fov_deg ? `${fmtNum(hw.lens_fov_deg, 0)}°` : '–'), kv('Lampu inframerah', hw.ir_lamp ? 'Terpasang' : 'Tidak ada'),
          kv('Detektor', `${(n.detector && n.detector.backend) || '–'}${n.detector && n.detector.imgsz ? ` · ${n.detector.imgsz}px` : ''}`), kv('Versi', n.version || '–'), kv('Mode', n.mode === 'simulation' ? 'Simulasi (data tiruan)' : 'Langsung')));
    }

    async function loadDetail() {
      try { detail = await core.api.get('/api/health/detail'); paintScore(); paintChecks(); paintTiles(); fill(banners); }
      catch (e) { fill(banners, banner('bad', `Data kesehatan tidak bisa dimuat: ${e.message || e}`, h('button', { class: 'btn sm', onclick: () => loadDetail() }, 'Coba lagi'))); }
    }
    async function loadSeries() {
      const my = ++seq; const b = (RANGES.find((r) => r.value === trange) || RANGES[0]).bucket;
      try { const s = await core.api.get('/api/telemetry', { range: trange, bucket: b }); if (my === seq) { series = s; paintSparks(); } } catch (e) { /* tampilkan angka saja */ }
    }
    async function loadStorage() { try { storage = await core.api.get('/api/storage'); paintStorage(); } catch (e) { fill(stoBox, emptyState('Penyimpanan belum bisa dibaca', e.message || '')); } }
    async function loadTel() { try { const r = await core.api.get('/api/telemetry/latest'); if (r.telemetry) store.set('telemetry', r.telemetry); if (r.health) store.set('health', r.health); } catch (e) { /* SSE akan mengisi */ } }

    loadTel(); loadDetail(); loadSeries(); loadStorage(); paintLocation();
    offs.push(store.on('telemetry', () => paintTiles()), store.on('health', () => paintScore()), store.on('node', () => paintLocation()));
    timers.push(setInterval(() => { if (!document.hidden) { loadDetail(); loadStorage(); } }, 15000), setInterval(() => { if (!document.hidden) loadSeries(); }, 45000));
    const onRs = debounce(() => paintSparks(), 150); addEventListener('resize', onRs); offs.push(() => removeEventListener('resize', onRs));
    return { destroy() { seq++; offs.forEach((f) => f()); timers.forEach(clearInterval); head.destroy(); } };
  }
};
