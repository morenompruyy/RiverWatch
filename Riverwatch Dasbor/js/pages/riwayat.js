// Halaman Riwayat: tutupan sampah dari waktu ke waktu, waktu di tiap tingkat, mode FPS, jenis anomali, pola per jam, dan daftar kejadian.
import { h, fill, tween, fmtNum, fmtPct, fmtDur, fmtClock, fmtDay, fmtAgo, dayLabel, dayKey, fmtBytes, LEVELS, MODES, MODE_LABELS, segmented, switchEl, emptyState, debounce } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { core, pageHeader, nowTs, nodeOff, banner, ackEvent } from '../core.js';
import { areaChart, segBar, legend, hBars, hourStrip, dataTable } from '../charts.js';
import { openEventSheet, sevIcon, actionable, SEV_LABEL } from './evsheet.js';

const RANGES = [{ value: '1h', label: '1 jam', bucket: 60 }, { value: '6h', label: '6 jam', bucket: 300 }, { value: '24h', label: '24 jam', bucket: 900 }, { value: '48h', label: '2 hari', bucket: 1800 }, { value: '7d', label: '7 hari', bucket: 3600 }];
const KINDS = {
  person_in_water: 'Manusia di perairan', person_near_water: 'Manusia di dekat air', vehicle_in_water: 'Kendaraan di perairan', animal_in_water: 'Hewan di perairan', vessel: 'Perahu / rakit melintas',
  unknown_object: 'Benda tak dikenal', fast_object: 'Benda bergerak cepat', against_flow: 'Benda melawan arus', large_object: 'Benda besar hanyut', stationary_object: 'Benda non-sampah diam lama',
  fall_suspect: 'Dugaan jatuh ke air', motion_unknown: 'Gerakan tak dikenal'
};
const CATS = { trash: 'Sampah', person: 'Manusia', animal: 'Hewan', vessel: 'Perahu', vehicle: 'Kendaraan', other: 'Benda lain', unknown: 'Tak dikenal' };
const GROUPS = [{ value: 'all', label: 'Semua' }, { value: 'anomaly', label: 'Anomali' }, { value: 'level', label: 'Tingkat' }, { value: 'system', label: 'Sistem' }];
const PAGE = 40;

export default {
  id: 'riwayat',
  async mount(root) {
    const offs = [], timers = [];
    const off = nodeOff;
    let range = '24h', seq = 0, group = 'all', query = '', shown = PAGE, showTable = false;
    let sum = null, met = null;
    const node = store.get('node') || {};
    const thObj = (node.levels && node.levels.thresholds) || { waspada: 0.15, peringatan: 0.25, kritis: 0.35 };
    const th = [thObj.waspada, thObj.peringatan, thObj.kritis];

    const rangeSeg = segmented({ options: RANGES, value: range, label: 'Rentang waktu', onChange: (v) => { range = v; shown = PAGE; load(); } });
    const exportA = h('a', { class: 'btn sm', href: '#', download: '', hidden: core.demo, onclick: (e) => { e.currentTarget.href = core.api.url(`/api/export/metrics.csv?range=${range}&bucket=${bucketOf()}`); } }, h('span', { html: icon('download') }), 'Ekspor CSV');
    const head = pageHeader('Riwayat', 'Apa yang terjadi di sungai: tutupan sampah, kejadian, dan bagaimana kamera mengatur kecepatan rekamnya.', rangeSeg.el);
    const bucketOf = () => (RANGES.find((r) => r.value === range) || RANGES[2]).bucket;
    const banners = h('div', { class: 'stack' });

    // ---------- ringkasan angka ----------
    const kpi = (label, hint) => { const n = h('b', { class: 'num' }, '–'), s = h('span', { class: 'cap' }, hint || ''); return { n, s, el: h('div', { class: 'kpi glass' }, h('span', { class: 'kpi-l' }, label), n, s) }; };
    const K = { avg: kpi('Tutupan rata-rata'), peak: kpi('Tutupan tertinggi'), anom: kpi('Anomali tercatat'), unsafe: kpi('Waktu di atas Aman') };
    const kpis = h('div', { class: 'kpis' }, Object.values(K).map((k) => k.el));

    // ---------- grafik tutupan ----------
    const chart = areaChart({ height: 260, thresholds: th, off: off(), markers: [], onMarker: (ev) => openEventSheet(ev), label: 'Grafik tutupan sampah di zona air' });
    const tblBox = h('div', { hidden: true });
    const tblSw = switchEl(false, (v) => { showTable = v; chartBox.hidden = v; tblBox.hidden = !v; if (v) paintTable(); }, 'Tampilkan sebagai tabel');
    const chartBox = h('div', null, chart.el);
    const covCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Tutupan sampah'), h('label', { class: 'tgl' }, h('span', { class: 'cap' }, 'Tabel'), tblSw), exportA), chartBox, tblBox,
      h('p', { class: 'cap' }, 'Persentase permukaan zona air yang tertutup sampah. Garis putus-putus menandai batas Waspada, Peringatan, dan Kritis. Titik di bawah grafik adalah kejadian; ketuk untuk melihat buktinya.'));

    // ---------- kartu-kartu analisis ----------
    const lvBox = h('div', { class: 'stack' }), fpsBox = h('div', { class: 'stack' }), anBox = h('div', { class: 'stack' }), objBox = h('div', { class: 'stack' }), hrBox = h('div');
    const lvCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Waktu di tiap tingkat')), lvBox);
    const fpsCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Mode FPS')), fpsBox);
    const anCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Jenis anomali')), anBox);
    const objCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Objek yang terlihat')), objBox);
    const hrCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Pola per jam'), h('span', { class: 'sub' }, 'jam setempat')), hrBox,
      h('p', { class: 'cap' }, 'Makin pekat berarti tutupan rata-rata makin tinggi. Titik oranye menandai jam yang ada anomalinya.'));

    // ---------- daftar kejadian ----------
    const search = h('input', { class: 'field', type: 'search', placeholder: 'Cari kejadian…', 'aria-label': 'Cari kejadian', autocomplete: 'off' });
    search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); shown = PAGE; paintEvents(); }, 150));
    const groupSeg = segmented({ options: GROUPS, value: group, label: 'Jenis kejadian', onChange: (v) => { group = v; shown = PAGE; paintEvents(); } });
    const list = h('div', { class: 'evlist' });
    const evCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Kejadian'), h('a', { class: 'btn sm', href: '#', hidden: core.demo, onclick: (e) => { e.currentTarget.href = core.api.url('/api/export/events.csv'); }, download: '' }, h('span', { html: icon('download') }), 'CSV')),
      h('div', { class: 'ev-tools' }, h('div', { class: 'search' }, h('span', { html: icon('search') }), search), groupSeg.el), list);

    root.append(head.el, banners, kpis, covCard,
      h('div', { class: 'g2' }, lvCard, fpsCard), h('div', { class: 'g2' }, anCard, objCard), hrCard, evCard);

    // ---------- pengisi ----------
    const inRange = (e) => !sum || e.ts >= sum.from - 1;
    const evsInRange = () => (store.get('events') || []).filter(inRange);

    function paintKpi() {
      if (!sum) return;
      tween(K.avg.n, sum.avg_coverage * 100, { fmt: (v) => fmtNum(v, 1) + '%', dur: 600 });
      tween(K.peak.n, sum.peak_coverage * 100, { fmt: (v) => fmtNum(v, 1) + '%', dur: 600 });
      let peakTs = null;
      if (met && met.coverage_max) { let b = -1; met.coverage_max.forEach((v, i) => { if (v != null && v > b) { b = v; peakTs = met.ts[i]; } }); }
      K.avg.s.textContent = `${fmtNum(sum.frames)} bingkai dianalisis`;
      K.peak.s.textContent = peakTs ? `pada ${fmtDay(peakTs, off())}, ${fmtClock(peakTs, off(), false)}` : '';
      const nAn = Object.values(sum.anomalies_by_kind || {}).reduce((a, b) => a + b, 0), crit = (sum.events_by_severity || {}).critical || 0;
      tween(K.anom.n, nAn, { fmt: (v) => fmtNum(v), dur: 500 });
      K.anom.s.textContent = crit ? `${fmtNum(crit)} kejadian kritis` : 'tidak ada yang kritis';
      const t = sum.time_in_level_s || [0, 0, 0, 0], all = t.reduce((a, b) => a + b, 0) || 1, un = t[1] + t[2] + t[3];
      tween(K.unsafe.n, (un / all) * 100, { fmt: (v) => fmtNum(v, v < 10 ? 1 : 0) + '%', dur: 600 });
      K.unsafe.s.textContent = un ? `${fmtDur(un)} dari ${fmtDur(all)}` : 'selalu Aman';
    }
    function paintChart() {
      if (!met) return;
      const ev = evsInRange().filter((e) => e.type === 'anomaly' && e.kind === 'anomaly_start' || e.kind === 'level_up').filter(inRange);
      chart.update({ ts: met.ts, y: met.coverage, max: met.coverage_max, from: sum ? sum.from : met.from, to: sum ? sum.to : met.to, markers: ev, off: off(),
        extra: (i) => { const r = []; if (met.fps[i] != null) r.push(['Kecepatan rekam', `${fmtNum(met.fps[i], 1)} fps`]); if (met.anomalies && met.anomalies[i]) r.push(['Anomali', String(met.anomalies[i])]); if (met.night && met.night[i] > 0.5) r.push(['Kondisi', 'malam']); return r; } });
      if (showTable) paintTable();
    }
    function paintTable() {
      if (!met) return;
      const rows = met.ts.map((t, i) => { const c = met.coverage[i]; const lv = c == null ? '–' : LEVELS[c >= th[2] ? 3 : c >= th[1] ? 2 : c >= th[0] ? 1 : 0]; return [`${fmtDay(t, off())} ${fmtClock(t, off(), false)}`, fmtPct(c, 1), fmtPct(met.coverage_max[i], 1), lv, met.fps[i] != null ? fmtNum(met.fps[i], 1) : '–']; }).reverse();
      fill(tblBox, dataTable(['Waktu', 'Rata-rata', 'Tertinggi', 'Tingkat', 'FPS'], rows));
    }
    function paintLevels() {
      if (!sum) return;
      const t = sum.time_in_level_s || [0, 0, 0, 0], all = t.reduce((a, b) => a + b, 0);
      const parts = t.map((v, i) => ({ label: LEVELS[i], value: v, color: `var(--lv${i})` }));
      fill(lvBox, segBar({ parts, fmt: (p, pct) => `${fmtNum(pct, pct < 10 ? 1 : 0)}%`, tipFmt: (p) => fmtDur(p.value) }),
        legend(parts.map((p) => ({ label: p.label, color: p.color, value: fmtDur(p.value) }))),
        h('p', { class: 'cap' }, all ? 'Berapa lama sungai berada di tiap tingkat siaga selama rentang ini.' : 'Belum ada data.'));
    }
    function paintFps() {
      if (!sum) return;
      const t = sum.mode_time_s || {}, all = MODES.reduce((a, m) => a + (t[m] || 0), 0) || 1;
      const parts = MODES.map((m, i) => ({ label: MODE_LABELS[m], value: t[m] || 0, color: `var(--ord-${i + 1})`, ink: `var(--ord-ink-${i + 1})` }));
      const st = sum.storage || {}; const saved = st.saved_pct;
      fill(fpsBox, segBar({ parts, fmt: (p, pct) => `${fmtNum(pct, pct < 10 ? 1 : 0)}%`, tipFmt: (p) => fmtDur(p.value) }),
        legend(parts.map((p) => ({ label: p.label, color: p.color, value: fmtDur(p.value) }))),
        h('p', { class: 'cap' }, `Mode Hemat dipakai ${fmtNum(((t.low || 0) / all) * 100)}% waktu, sehingga rekaman kecil. FPS naik otomatis hanya saat ada anomali.${saved != null ? ` Penghematan data dibanding merekam terus-menerus: sekitar ${fmtNum(saved, 0)}%.` : ''}`));
    }
    function paintAnom() {
      if (!sum) return;
      const items = Object.entries(sum.anomalies_by_kind || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: KINDS[k] || k.replace(/_/g, ' '), value: v, color: /person|fall|vehicle/.test(k) ? 'var(--lv3)' : 'var(--s1)' }));
      fill(anBox, items.length ? hBars(items) : emptyState('Tidak ada anomali', 'Tidak ada manusia atau benda tak terduga di rentang ini.'));
    }
    function paintObjs() {
      if (!sum) return;
      const items = Object.entries(sum.objects_by_class || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: CATS[k] || k, value: v, sub: 'jumlah pelacakan unik' }));
      fill(objBox, items.length ? hBars(items) : emptyState('Belum ada objek', 'Belum ada benda yang dilacak di rentang ini.'),
        h('p', { class: 'cap' }, 'Jumlah benda berbeda yang pernah dilacak, bukan jumlah bingkai.'));
    }
    function paintHours() {
      const long = range === '24h' || range === '48h' || range === '7d';
      hrCard.hidden = false;
      if (!sum || !sum.hourly) return;
      if (!long) { fill(hrBox, emptyState('Pilih rentang 24 jam atau lebih', 'Pola per jam butuh data yang cukup panjang.')); return; }
      const nowH = Math.floor((((nowTs() + off() * 3600) % 86400) + 86400) % 86400 / 3600);
      fill(hrBox, hourStrip(sum.hourly, { th, off: off(), nowHour: nowH }));
    }
    function groupOf(e) { return e.type === 'anomaly' ? 'anomaly' : e.type === 'level' ? 'level' : 'system'; }
    function paintEvents() {
      const all = evsInRange().filter((e) => (group === 'all' || groupOf(e) === group)).filter((e) => !query || `${e.title} ${e.detail || ''} ${e.cls || ''}`.toLowerCase().includes(query));
      if (!all.length) { fill(list, emptyState(query ? 'Tidak ada yang cocok' : 'Belum ada kejadian', query ? 'Coba kata lain atau ganti jenis kejadian.' : 'Kejadian muncul di sini saat ada anomali, perubahan tingkat, atau perubahan sistem.')); return; }
      const now = nowTs(), vis = all.slice(0, shown); let last = null; const out = [];
      const tax = {}; ((store.get('node') || {}).taxonomy || []).forEach((t) => { tax[t.key] = t.name; });
      vis.forEach((e) => {
        const dk = dayKey(e.ts, off());
        if (dk !== last) { last = dk; out.push(h('h3', { class: 'day' }, dayLabel(e.ts, now, off()))); }
        const act = actionable(e);
        const sub = [fmtClock(e.ts, off(), false), e.cls ? (tax[e.cls] || e.cls) : null, e.coverage != null ? `tutupan ${fmtPct(e.coverage, 1)}` : null, e.ack ? 'dikonfirmasi' : null].filter(Boolean).join(' · ');
        out.push(h('div', { class: 'row click ev', role: 'button', tabindex: 0, onclick: () => openEventSheet(e), onkeydown: (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); openEventSheet(e); } } },
          h('span', { class: 'sev ' + e.severity, html: icon(sevIcon(e.severity, e.kind)) }),
          h('div', { class: 'grow' }, h('div', { class: 't' }, e.title), h('div', { class: 'd' }, sub)),
          e.media && (e.media.frames || e.media.snapshot) ? h('span', { class: 'badge' }, 'ada bukti') : null,
          act ? h('button', { class: 'btn sm', onclick: (k) => { k.stopPropagation(); ackEvent(e.id); } }, 'Konfirmasi') : h('span', { class: 'badge ' + (e.severity === 'critical' ? 'bad' : e.severity === 'warning' ? 'warn' : '') }, SEV_LABEL[e.severity] || e.severity)));
      });
      if (all.length > shown) out.push(h('button', { class: 'btn more', onclick: () => { shown += PAGE; paintEvents(); } }, `Tampilkan ${Math.min(PAGE, all.length - shown)} lagi`));
      fill(list, out);
    }

    function skel() { [lvBox, fpsBox, anBox, objBox].forEach((b) => fill(b, h('div', { class: 'skel', style: 'height:30px' }), h('div', { class: 'skel', style: 'height:16px;width:70%' }))); fill(hrBox, h('div', { class: 'skel', style: 'height:56px' })); }
    async function load(quiet) {
      const my = ++seq;
      if (!quiet) skel();
      try {
        const [s, m] = await Promise.all([core.api.get('/api/history/summary', { range }), core.api.get('/api/history/metrics', { range, bucket: bucketOf() })]);
        if (my !== seq) return;
        sum = s; met = m; fill(banners);
        paintKpi(); paintChart(); paintLevels(); paintFps(); paintAnom(); paintObjs(); paintHours(); paintEvents();
      } catch (e) {
        if (my !== seq) return;
        fill(banners, banner('bad', `Riwayat tidak bisa dimuat: ${e.message || e}`, h('button', { class: 'btn sm', onclick: () => load() }, 'Coba lagi')));
      }
    }
    load();
    timers.push(setInterval(() => { if (!document.hidden) load(true); }, 30000));
    offs.push(store.on('events', debounce(() => { paintEvents(); paintChart(); }, 200)));
    offs.push(store.on('node', () => { const n = store.get('node') || {}; const t = (n.levels && n.levels.thresholds) || thObj; th[0] = t.waspada; th[1] = t.peringatan; th[2] = t.kritis; chart.update({ thresholds: th, off: off() }); }));
    return { destroy() { seq++; chart.destroy(); offs.forEach((f) => f()); timers.forEach(clearInterval); head.destroy(); } };
  }
};
