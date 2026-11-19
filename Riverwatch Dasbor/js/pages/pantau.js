// Halaman Pantau: kamera langsung dengan pelacakan halus, tutupan sampah, kecepatan rekam (FPS adaptif), objek, kejadian terbaru.
import { h, tween, fmtNum, fmtPct, fmtDur, fmtAgo, fmtBytes, fmtClock, fmtDay, clamp, LEVELS, MODES, MODE_LABELS, ico, toast, setBool } from '../ui.js';
import { icon, catIcon } from '../icons.js';
import { store } from '../store.js';
import { core, pageHeader, banner, control, ackEvent, nowTs, nodeOff, isAlertEvent } from '../core.js';
import { CameraView } from '../camview.js';
import { sparkline } from '../charts.js';
import { openEventSheet, sevIcon, actionable } from './evsheet.js';

const CATS = [['trash', 'Sampah'], ['person', 'Manusia'], ['animal', 'Hewan'], ['vessel', 'Perahu'], ['vehicle', 'Kendaraan'], ['unknown', 'Tak dikenal']];

export default {
  id: 'pantau',
  async mount(root) {
    const offs = [], timers = [];
    const on = (k, fn, now = true) => offs.push(store.on(k, fn, now));
    const node = store.get('node') || {};
    const head = pageHeader('Pantau', [node.name, node.river].filter(Boolean).join(' · ') || 'Kondisi sungai saat ini');

    // ---------- kamera ----------
    const cam = new CameraView({ aspect: 16 / 9 });
    const view = { boxes: true, trails: true, zone: true };
    const tg = (key, label, iconName) => {
      const b = h('button', { class: 'btn sm', 'aria-pressed': 'true', onclick: () => { view[key] = !view[key]; b.setAttribute('aria-pressed', String(view[key])); cam['show' + key[0].toUpperCase() + key.slice(1)] = view[key]; } }, h('span', { html: icon(iconName) }), label);
      return b;
    };
    const boostBtn = h('button', { class: 'btn sm primary' }, h('span', { html: icon('bolt') }), 'Pantau langsung');
    const camBar = h('div', { class: 'cam-bar' },
      h('div', { class: 'cam-tg' }, tg('boxes', 'Kotak', 'target'), tg('trails', 'Jejak', 'wave'), tg('zone', 'Zona', 'layers')),
      h('div', { class: 'cam-acts' },
        h('button', { class: 'btn sm', onclick: () => control({ snapshot: true }, { okMsg: 'Foto disimpan di riwayat.' }) }, h('span', { html: icon('camera') }), 'Foto'),
        boostBtn,
        h('button', { class: 'btn sm icon', 'aria-label': 'Layar penuh', onclick: () => { const el = camWrap; (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen && Promise.resolve(el.requestFullscreen()).catch(() => {})); }, html: icon('expand') })));
    const camWrap = h('section', { class: 'glass cam-card', 'aria-label': 'Kamera langsung' }, cam.el);
    cam.start();
    const camCard = h('div', { class: 'cam-col' }, camWrap, camBar);
    boostBtn.addEventListener('click', () => {
      const c = store.get('control') || {};
      const active = c.live_boost_until && c.live_boost_until > nowTs();
      control({ live_boost: !active }, { okMsg: active ? 'Pantau langsung dihentikan.' : 'FPS tinggi dinyalakan selama beberapa menit.' });
    });

    // ---------- kartu tingkat ----------
    const covEl = h('span', null, '–');
    const lvPill = h('span', { class: 'pill lv' }, h('span', { class: 'dot', style: { '--c': 'var(--lvc)' } }), h('span', null, '–'));
    const trendTxt = h('p', { class: 'cap' }, 'Memuat tren…');
    const sparkBox = h('div', { class: 'spark-box' });
    const knob = h('i', { class: 'tb-knob' });
    const th = (node.levels && node.levels.thresholds) || { waspada: 0.15, peringatan: 0.25, kritis: 0.35 };
    const SC = 0.5; // skala batang 0–50%
    const tbar = h('div', { class: 'tbar', role: 'img', 'aria-label': 'Posisi tutupan terhadap ambang' },
      h('div', { class: 'tb-seg' }, [0, th.waspada, th.peringatan, th.kritis, SC].slice(0, 4).map((v, i, a) => h('i', { style: { flexGrow: String(((a[i + 1] ?? SC) - v) * 100), background: `var(--lv${i})` } }))), knob,
      [th.waspada, th.peringatan, th.kritis].map((v, i) => h('span', { class: 'tb-t', style: { left: (v / SC) * 100 + '%' } }, `${fmtNum(v * 100)}%`)));
    const levelCard = h('section', { class: 'card glass lvl-card' },
      h('div', { class: 'card-h' }, h('h2', null, 'Tutupan sampah di zona air'), lvPill),
      h('div', { class: 'hero' }, h('div', { class: 'num hero-n' }, covEl, h('small', null, '%'))),
      tbar, sparkBox, trendTxt);

    // ---------- kartu FPS ----------
    const modeEls = MODES.map((m, i) => h('div', { class: 'fm', 'data-m': m }, h('span', { class: 'fm-b', html: Array.from({ length: 4 }, (_, k) => `<i${k <= i ? ' class="on"' : ''}></i>`).join('') }), h('b', null, MODE_LABELS[m])));
    const reasonEl = h('p', { class: 'fps-why' }, '–');
    const srcBadge = h('span', { class: 'badge' }, 'otomatis');
    const rate = (label) => { const v = h('b', { class: 'tnum' }, '–'); return { el: h('div', { class: 'rt' }, h('span', null, label), v), v }; };
    const rg = { grab: rate('Ambil gambar'), infer: rate('Deteksi'), record: rate('Simpan'), stream: rate('Siaran') };
    const fpsCard = h('section', { class: 'card glass' },
      h('div', { class: 'card-h' }, h('h2', null, 'Kecepatan rekam'), srcBadge),
      h('div', { class: 'fpsrow', role: 'img', 'aria-label': 'Mode FPS aktif' }, modeEls), reasonEl,
      h('div', { class: 'rates' }, Object.values(rg).map((r) => r.el)));

    // ---------- kartu objek ----------
    const cnt = {};
    const cntEls = CATS.map(([k, label]) => { const v = h('b', { class: 'tnum' }, '0'); cnt[k] = v; return h('div', { class: 'ct', 'data-k': k }, h('span', { class: 'ct-i', html: catIcon(k) }), v, h('span', null, label)); });
    const objCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Objek terlacak'), h('span', { class: 'sub' }, 'saat ini')), h('div', { class: 'cts' }, cntEls));

    // ---------- kartu hemat data ----------
    const saveN = h('span', null, '–'), saveT = h('p', { class: 'cap' }, 'Menghitung…'), saveBar = h('i', null);
    const saveCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Hemat data'), h('span', { class: 'sub' }, 'dibanding rekam terus-menerus')),
      h('div', { class: 'save' }, h('div', { class: 'num save-n' }, saveN, h('small', null, '%')), h('div', { class: 'save-bar' }, saveBar)), saveT);

    // ---------- anomali aktif ----------
    const anomBox = h('section', { class: 'card glass anom', hidden: true });
    // ---------- kejadian terbaru ----------
    const evList = h('div', { class: 'rows' });
    const evCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Kejadian terbaru'), h('a', { href: '#riwayat', class: 'sub' }, 'Lihat semua')), evList);

    const banners = h('div', { class: 'stack' });
    const grid = h('div', { class: 'g-pantau' }, h('div', { class: 'col' }, camCard, anomBox, evCard), h('div', { class: 'col' }, levelCard, fpsCard, objCard, saveCard));
    root.append(head.el, banners, grid);

    // ---------- data langsung ----------
    const series = []; // [ts, tutupan]
    let lastPush = 0;
    async function loadSeries() {
      try {
        const r = await core.api.get('/api/history/metrics', { range: '1h', bucket: 30 });
        series.length = 0;
        (r.ts || []).forEach((t, i) => { if (r.coverage[i] != null) series.push([t, r.coverage[i]]); });
        drawSeries();
      } catch (e) { trendTxt.textContent = 'Tren belum tersedia.'; }
    }
    function drawSeries() {
      const w = Math.max(160, sparkBox.clientWidth || 280);
      sparkBox.replaceChildren(sparkline(series.map((s) => s[1] * 100), { w, h: 46, color: 'var(--lvc)', min: 0 }));
      if (series.length > 4) {
        const cur = series[series.length - 1][1], past = series.filter((s) => s[0] <= series[series.length - 1][0] - 600).pop() || series[0];
        const d = (cur - past[1]) * 100;
        trendTxt.textContent = Math.abs(d) < 0.3 ? 'Stabil dalam 10 menit terakhir.' : `${d > 0 ? 'Naik' : 'Turun'} ${fmtNum(Math.abs(d), 1)} poin dalam 10 menit terakhir.`;
      }
    }
    const frameUpdate = (f) => {
      const lv = f.level | 0, cov = f.coverage_smooth ?? f.coverage ?? 0;
      tween(covEl, cov * 100, { fmt: (v) => fmtNum(v, 1), dur: 700 });
      lvPill.lastChild.textContent = f.level_name || LEVELS[lv];
      knob.style.left = clamp((cov / SC) * 100, 0, 100) + '%';
      cam.setLevel(lv);
      modeEls.forEach((el) => el.classList.toggle('on', el.dataset.m === f.mode));
      reasonEl.textContent = f.mode_reason || '–';
      srcBadge.textContent = f.mode_source === 'manual' ? 'manual' : f.mode_source === 'boost' ? 'pantau langsung' : 'otomatis';
      srcBadge.className = 'badge' + (f.mode_source && f.mode_source !== 'auto' ? ' warn' : '');
      const fp = f.fps || {};
      rg.grab.v.textContent = `${fmtNum(fp.actual ?? fp.grab, 1)} / ${fmtNum(fp.grab, 0)} fps`;
      rg.infer.v.textContent = `${fmtNum(fp.infer, 1)} fps`; rg.record.v.textContent = `${fmtNum(fp.record, 1)} fps`; rg.stream.v.textContent = `${fmtNum(fp.stream, 1)} fps`;
      const bc = (f.counts && f.counts.by_category) || {};
      CATS.forEach(([k]) => { tween(cnt[k], bc[k] || 0, { dur: 350 }); cntEls.find((e) => e.dataset.k === k).classList.toggle('zero', !(bc[k] > 0)); });
      // seri tren: tambahkan titik baru tiap 10 dtk waktu mesin
      if (f.ts - lastPush >= 10) { lastPush = f.ts; series.push([f.ts, cov]); while (series.length > 130) series.shift(); drawSeries(); }
      renderAnoms(f);
    };
    function renderAnoms(f) {
      const list = f.anomalies || [];
      anomBox.hidden = list.length === 0;
      if (!list.length) return;
      const now = f.ts;
      anomBox.replaceChildren(
        h('div', { class: 'card-h' }, h('h2', null, `Anomali aktif (${list.length})`), h('button', { class: 'btn sm primary', onclick: () => control({ ack: true }, { okMsg: 'Peringatan dikonfirmasi.' }) }, h('span', { html: icon('check') }), 'Konfirmasi')),
        h('div', { class: 'rows' }, list.map((a) => h('div', { class: 'row' }, h('span', { class: 'sev ' + a.severity, html: icon(a.severity === 'info' ? 'info' : 'alert') }),
          h('div', { class: 'grow' }, h('div', { class: 't' }, a.label), h('div', { class: 'd' }, `pelacak #${a.track_id} · sudah ${fmtDur(now - a.since)}`)), h('span', { class: 'badge ' + (a.severity === 'critical' ? 'bad' : a.severity === 'warning' ? 'warn' : '') }, a.severity === 'critical' ? 'Kritis' : a.severity === 'warning' ? 'Peringatan' : 'Info')))));
    }
    on('frame', frameUpdate);
    on('shot', (s) => { cam.setFrame(s.frame, s.image); });
    const zoneUpd = () => { const c = store.get('control'), n = store.get('node'); cam.setZone((c && c.zone) || (n && n.zone)); };
    on('control', () => {
      zoneUpd();
      const c = store.get('control') || {};
      const active = c.live_boost_until && c.live_boost_until > nowTs();
      boostBtn.replaceChildren(h('span', { html: icon('bolt') }), active ? 'Hentikan pantau langsung' : 'Pantau langsung');
      boostBtn.classList.toggle('primary', !active);
    });
    on('node', zoneUpd);
    on('conn', (c) => cam.markStale(c === 'offline'));
    on('conn', () => {
      const c = store.get('conn'), n = store.get('node') || {};
      const items = [];
      if (core.demo) items.push(banner('warn', 'Mode demo: tidak ada server Riverwatch yang tersambung. Semua yang tampak adalah simulasi di peramban ini, bukan data kamera.'));
      else if (n.mode === 'simulation') items.push(banner('info', 'Mode simulasi: gambar dan deteksi tiruan. Untuk kamera nyata jalankan: python -m riverwatch run'));
      if (c === 'offline') items.push(banner('bad', 'Sambungan ke server terputus. Mencoba tersambung lagi otomatis…'));
      banners.replaceChildren(...items);
    });

    // kejadian terbaru
    const drawEvents = () => {
      const now = nowTs(), off = nodeOff();
      const list = (store.get('events') || []).filter((e) => e.kind !== 'fps_mode').slice(0, 6);
      evList.replaceChildren(...(list.length ? list.map((e) => h('div', { class: 'row click', role: 'button', tabindex: '0', onclick: () => openEventSheet(e), onkeydown: (k) => { if (k.key === 'Enter') openEventSheet(e); } },
        h('span', { class: 'sev ' + e.severity, html: icon(sevIcon(e.severity, e.kind)) }), h('div', { class: 'grow' }, h('div', { class: 't' }, e.title), h('div', { class: 'd' }, `${fmtAgo(e.ts, now)} · ${fmtClock(e.ts, off, false)}`)),
        actionable(e) ? h('button', { class: 'btn sm', onclick: (ev) => { ev.stopPropagation(); ackEvent(e.id); } }, 'Konfirmasi') : null))
        : [h('p', { class: 'cap', style: 'padding:8px 0' }, 'Belum ada kejadian. Saat ada anomali atau perubahan tingkat, daftarnya muncul di sini.')]));
    };
    on('events', drawEvents);
    timers.push(setInterval(drawEvents, 15000));

    // hemat data
    async function loadStorage() {
      try {
        const s = await core.api.get('/api/storage');
        tween(saveN, s.saved_pct || 0, { fmt: (v) => fmtNum(v, 1) });
        saveBar.style.width = clamp(s.saved_pct || 0, 0, 100) + '%';
        saveT.textContent = s.baseline_bytes_est ? `Tertulis ${fmtBytes(s.written_bytes && s.written_bytes.total)} dari ${fmtBytes(s.baseline_bytes_est)} bila merekam ${fmtNum(s.baseline_fps)} fps terus-menerus.` : 'Angka muncul setelah beberapa menit berjalan.';
      } catch (e) { saveT.textContent = 'Belum tersedia.'; }
    }
    loadSeries(); loadStorage(); timers.push(setInterval(loadStorage, 20000));
    const ro = new ResizeObserver(() => drawSeries()); ro.observe(sparkBox);

    return { destroy() { cam.destroy(); ro.disconnect(); offs.forEach((f) => f()); timers.forEach(clearInterval); head.destroy(); } };
  }
};
