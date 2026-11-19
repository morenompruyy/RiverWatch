// Halaman Kembar 3D: model tiga dimensi lokasi pantau yang bergerak mengikuti data CCTV (tutupan, tingkat siaga, benda yang lewat).
// Model dimuat di iframe (twin/index.html) dan dikendalikan lewat postMessage dengan protokol di twin_src/js/85_embed.js.
import { h, fill, tween, fmtNum, fmtPct, clamp, LEVELS, segmented, switchEl, rangeEl, ico } from '../ui.js';
import { icon } from '../icons.js';
import { store, prefs } from '../store.js';
import { core, pageHeader, banner, nowTs, nodeOff, control } from '../core.js';
import { CameraView } from '../camview.js';

const DEFAULT_ZONE = [[0.05, 0.45], [0.95, 0.45], [0.98, 0.95], [0.02, 0.95]];
const LAYERS = [
  ['zone', 'Zona air', 'Garis zona pantau di permukaan air'],
  ['boxes', 'Kotak deteksi', 'Bingkai di sekeliling objek'],
  ['labels', 'Label objek', 'Nama dan nomor pelacak'],
  ['rings', 'Cincin peringatan', 'Denyut pada objek anomali'],
  ['flow', 'Arah arus', 'Garis aliran air'],
  ['cable', 'Tembus kabel', 'Perlihatkan jalur kabel pod'],
  ['rotate', 'Putar otomatis', 'Kamera berputar pelan']
];
const VIEWS = [{ value: 'home', label: 'Ikhtisar' }, { value: 'cctv', label: 'Sudut CCTV' }, { value: 'top', label: 'Dari atas' }];
const LEVEL_COV = [0.04, 0.2, 0.3, 0.42];
const SIM_OBJ = [['person', 'Manusia jatuh', 'person'], ['vessel', 'Perahu lewat', 'boat'], ['animal', 'Hewan', 'paw']];

const hourOf = () => { const t = nowTs() + nodeOff() * 3600; return ((t % 86400) + 86400) % 86400 / 3600; };
const levelFromCov = (cov, th) => (cov >= th.kritis ? 3 : cov >= th.peringatan ? 2 : cov >= th.waspada ? 1 : 0);

function loadLayers() {
  const base = { zone: true, labels: true, rings: true, flow: true, cable: false, rotate: false, boxes: true };
  try { return Object.assign(base, JSON.parse(prefs.get('twin.layers', '{}'))); } catch (e) { return base; }
}

export default {
  id: 'kembar',
  async mount(root) {
    const offs = [], timers = [];
    const on = (k, fn, now = true) => offs.push(store.on(k, fn, now));
    const node = store.get('node') || {};
    const th = (node.levels && node.levels.thresholds) || { waspada: 0.15, peringatan: 0.25, kritis: 0.35 };
    const head = pageHeader('Kembar 3D', 'Replika tiga dimensi lokasi pantau. Ia bergerak mengikuti apa yang dilihat CCTV.');

    // ---------- panggung 3D ----------
    const frame = h('iframe', { class: 'twin-frame', src: 'twin/index.html', title: 'Model 3D lokasi pantau', loading: 'eager', allow: 'fullscreen' });
    const loader = h('div', { class: 'twin-load' }, h('i', { class: 'spinner' }), h('span', null, 'Memuat model 3D…'));
    const lvBadge = h('div', { class: 'twin-badge glass' }, h('span', { class: 'dot live', style: { '--c': 'var(--lvc)' } }), h('b', null, '–'), h('span', { class: 'mut' }, ''));
    const view = segmented({ options: VIEWS, value: prefs.get('twin.view', 'home'), label: 'Sudut pandang', onChange: (v) => { prefs.set('twin.view', v); send({ type: 'view', view: v }); } });
    const fsBtn = h('button', { class: 'btn sm icon', 'aria-label': 'Layar penuh', onclick: () => { document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen && Promise.resolve(stage.requestFullscreen()).catch(() => {}); }, html: icon('expand') });
    const stage = h('section', { class: 'twin-stage glass', 'aria-label': 'Kembar digital 3D' },
      frame, loader, lvBadge,
      h('div', { class: 'twin-bar' }, view.el, fsBtn));
    const statLine = h('p', { class: 'cap twin-stat' }, 'Menunggu model…');

    // ---------- jembatan pesan ----------
    let ready = false, lastSend = 0, pendingTimer = 0, lastHour = -9;
    const send = (m) => {
      if (!frame.contentWindow) return;
      m.rw = 1;
      try { frame.contentWindow.postMessage(m, location.origin); } catch (e) { /* bingkai belum siap */ }
    };
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
      const m = e.data;
      if (!m || m.rw !== 1) return;
      if (m.type === 'ready') {
        ready = true; loader.classList.add('gone');
        send({ type: 'layers', layers });
        send({ type: 'view', view: view.value });
        send({ type: 'quality', lite: !!(store.get('prefs') || {}).lite });
        push(true);
      } else if (m.type === 'stats') {
        statLine.textContent = `Model 3D berjalan ${fmtNum(m.fps)} fps · ${fmtNum(m.count)} sampah · ${fmtNum(m.proxies)} objek ditampilkan`;
      }
    };
    addEventListener('message', onMsg);
    offs.push(() => removeEventListener('message', onMsg));
    const slowT = setTimeout(() => { if (!ready) { const sp = loader.querySelector('span'); if (sp) sp.textContent = 'Masih memuat model 3D. Bila tidak muncul, peramban ini mungkin tidak mendukung WebGL atau memblokir bingkai.'; } }, 20000);
    offs.push(() => clearTimeout(slowT));

    // ---------- keadaan yang dikirim ----------
    const layers = loadLayers();
    const sim = { on: false, level: 0, coverage: 0.04, hour: Math.round(hourOf()), objs: { person: false, vessel: false, animal: false }, t0: performance.now() };
    const taxName = () => { const m = {}; ((store.get('node') || {}).taxonomy || []).forEach((t) => { m[t.key] = t.name; }); return m; };

    function liveState() {
      const f = store.get('frame'); if (!f) return null;
      const names = taxName();
      const c = store.get('control') || {}, n = store.get('node') || {};
      const tracks = (f.tracks || []).map((t) => ({ id: t.id, cat: t.cat, cls: t.cls, name: names[t.cls], box: t.box, v: t.v, in_zone: t.in_zone, state: t.state, predicted: t.predicted, anomaly: t.anomaly }));
      const s = { type: 'state', level: f.level | 0, coverage: f.coverage_smooth ?? f.coverage ?? 0, tracks, zone: c.zone || n.zone || DEFAULT_ZONE };
      const hr = hourOf(); if (Math.abs(hr - lastHour) > 0.02) { s.hour = hr; lastHour = hr; }
      return s;
    }
    function simState() {
      const t = (performance.now() - sim.t0) / 1000;
      const tracks = [];
      const wob = (a, p) => Math.sin(t * a + p);
      if (sim.objs.person) {
        const cx = 0.5 + 0.12 * wob(0.5, 0), cy = 0.72 + 0.03 * wob(0.9, 1);
        tracks.push({ id: 9001, cat: 'person', cls: 'person', name: 'Manusia', box: [cx - 0.03, cy - 0.11, cx + 0.03, cy], v: [0.06 * wob(0.5, 1.57), 0], in_zone: true, state: 'confirmed', anomaly: { kind: 'person_in_water', severity: 'critical', label: 'Manusia di perairan' } });
      }
      if (sim.objs.vessel) {
        const k = (t * 0.05) % 1, cx = 1.1 - k * 1.3, cy = 0.6;
        tracks.push({ id: 9002, cat: 'vessel', cls: 'boat', name: 'Perahu', box: [cx - 0.09, cy - 0.07, cx + 0.09, cy], v: [-0.05, 0], in_zone: true, state: 'confirmed', anomaly: null });
      }
      if (sim.objs.animal) {
        const cx = 0.3 + 0.08 * wob(0.4, 2), cy = 0.8;
        tracks.push({ id: 9003, cat: 'animal', cls: 'animal', name: 'Hewan', box: [cx - 0.03, cy - 0.05, cx + 0.03, cy], v: [0.03, 0], in_zone: true, state: 'confirmed', anomaly: null });
      }
      const lv = Math.max(sim.level, sim.objs.person ? 3 : 0);
      return { type: 'state', level: lv, coverage: sim.coverage, hour: sim.hour, tracks, zone: DEFAULT_ZONE };
    }
    function push(force) {
      if (!ready) return;
      const now = performance.now();
      if (!force && now - lastSend < 80) {
        if (!pendingTimer) pendingTimer = setTimeout(() => { pendingTimer = 0; push(true); }, 80 - (now - lastSend));
        return;
      }
      lastSend = now;
      const s = sim.on ? simState() : liveState();
      if (s) { send(s); paintBadge(s); }
    }
    function paintBadge(s) {
      const lv = s.level | 0;
      lvBadge.style.setProperty('--lvc', `var(--lv${lv})`);
      lvBadge.children[0].style.setProperty('--c', `var(--lv${lv})`);
      lvBadge.children[1].textContent = LEVELS[lv];
      lvBadge.children[2].textContent = ` · tutupan ${fmtPct(s.coverage, 1)}${s.tracks && s.tracks.length ? ` · ${s.tracks.length} objek` : ''}`;
    }

    // ---------- kartu mode ----------
    const modeSeg = segmented({ options: [{ value: 'live', label: 'Ikuti CCTV' }, { value: 'sim', label: 'Simulasikan' }], value: 'live', fill: true, label: 'Sumber data model', onChange: (v) => setMode(v === 'sim') });
    const modeNote = h('p', { class: 'cap' }, 'Model menampilkan kondisi nyata dari kamera. Pilih "Simulasikan" untuk mencoba tingkat siaga dan kejadian tanpa mengubah apa pun pada CCTV.');
    const levelSeg = segmented({ options: LEVELS.map((n, i) => ({ value: i, label: n })), value: 0, fill: true, tint: true, label: 'Tingkat siaga simulasi', onChange: (v) => { sim.level = v; sim.coverage = LEVEL_COV[v]; covRange.value = Math.round(sim.coverage * 100); covRange.paint(); covVal.textContent = `${fmtNum(sim.coverage * 100)}%`; push(true); } });
    const covVal = h('b', { class: 'tnum' }, `${fmtNum(sim.coverage * 100)}%`);
    const covRange = rangeEl({ min: 0, max: 60, step: 1, value: sim.coverage * 100, label: 'Tutupan sampah simulasi', onInput: (v) => { sim.coverage = v / 100; covVal.textContent = `${fmtNum(v)}%`; sim.level = levelFromCov(sim.coverage, th); levelSeg.set(sim.level, true); push(); } });
    const hrVal = h('b', { class: 'tnum' }, '');
    const hrText = (v) => `${String(Math.floor(v)).padStart(2, '0')}.00${v >= 21 || v < 5 ? ' · malam' : v < 6 ? ' · subuh' : ''}`;
    const hrRange = rangeEl({ min: 0, max: 23, step: 1, value: sim.hour, label: 'Jam simulasi', onInput: (v) => { sim.hour = v; hrVal.textContent = hrText(v); push(); } });
    hrVal.textContent = hrText(sim.hour);
    const objBtns = SIM_OBJ.map(([k, label, ic]) => {
      const b = h('button', { class: 'btn sm', 'aria-pressed': 'false', onclick: () => { sim.objs[k] = !sim.objs[k]; b.setAttribute('aria-pressed', String(sim.objs[k])); push(true); } }, h('span', { html: icon(ic) }), label);
      return b;
    });
    const simBox = h('div', { class: 'twin-sim', hidden: true },
      h('div', { class: 'fld' }, h('span', { class: 'lab' }, 'Tingkat siaga'), levelSeg.el),
      h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'Tutupan sampah'), covVal), covRange),
      h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'Jam'), hrVal), hrRange),
      h('div', { class: 'fld' }, h('span', { class: 'lab' }, 'Benda di sungai'), h('div', { class: 'chips' }, objBtns)));
    const modeCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Sumber data')), modeSeg.el, modeNote, simBox);
    function setMode(simOn) {
      sim.on = simOn; simBox.hidden = !simOn;
      if (simOn) {
        const f = store.get('frame');
        if (f) { sim.level = f.level | 0; sim.coverage = f.coverage_smooth ?? f.coverage ?? 0.04; }
        levelSeg.set(sim.level, true); covRange.value = Math.round(sim.coverage * 100); covRange.paint(); covVal.textContent = `${fmtNum(sim.coverage * 100)}%`;
        sim.hour = Math.round(hourOf()) % 24; hrRange.value = sim.hour; hrRange.paint(); hrVal.textContent = hrText(sim.hour);
        modeNote.textContent = 'Ini hanya percobaan di layar. Kondisi CCTV dan peringatan sebenarnya tidak berubah.';
        lastHour = -9;
      } else {
        modeNote.textContent = 'Model menampilkan kondisi nyata dari kamera. Pilih "Simulasikan" untuk mencoba tingkat siaga dan kejadian tanpa mengubah apa pun pada CCTV.';
        sim.objs.person = sim.objs.vessel = sim.objs.animal = false; objBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
        send({ type: 'state', tracks: [] });
        lastHour = -9;
      }
      push(true);
    }

    // ---------- kartu lapisan ----------
    const layerRows = LAYERS.map(([k, label, d]) => {
      const sw = switchEl(layers[k], (v) => { layers[k] = v; prefs.set('twin.layers', JSON.stringify(layers)); send({ type: 'layers', layers: { [k]: v } }); }, label);
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, label), h('div', { class: 'd' }, d)), sw);
    });
    const layerCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Tampilan')), h('div', { class: 'rows' }, layerRows));

    // ---------- inset kamera ----------
    const cam = new CameraView({ mini: true, chips: true, aspect: 16 / 9 });
    cam.start();
    const camCard = h('section', { class: 'card glass cam-mini' }, h('div', { class: 'card-h' }, h('h2', null, 'Yang dilihat CCTV'), h('a', { class: 'sub', href: '#pantau' }, 'Buka Pantau')), cam.el,
      h('p', { class: 'cap' }, 'Posisi objek di gambar ini dipetakan ke permukaan air model memakai zona pantau.'));

    // ---------- kartu kondisi ----------
    const kv = (label) => { const v = h('b', { class: 'tnum' }, '–'); return { v, el: h('div', { class: 'tk' }, h('span', null, label), v) }; };
    const k = { lv: kv('Tingkat'), cov: kv('Tutupan'), obj: kv('Objek'), an: kv('Anomali') };
    const condCard = h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, 'Kondisi di model')), h('div', { class: 'tks' }, Object.values(k).map((x) => x.el)), statLine);

    const banners = h('div', { class: 'stack' });
    root.append(head.el, banners, h('div', { class: 'g-kembar' }, h('div', { class: 'col' }, stage, h('p', { class: 'cap twin-note' }, 'Tarik untuk memutar, cubit atau gulir untuk mendekat. Model ini gambaran bergaya dari lokasi, bukan hasil pemindaian 3D asli.')), h('div', { class: 'col' }, modeCard, camCard, condCard, layerCard)));

    // ---------- langganan ----------
    on('frame', (f) => {
      if (!sim.on) push();
      const lv = f.level | 0;
      k.lv.v.textContent = LEVELS[lv]; k.lv.v.style.color = `var(--lv${lv})`;
      tween(k.cov.v, (f.coverage_smooth ?? f.coverage ?? 0) * 100, { fmt: (v) => fmtNum(v, 1) + '%', dur: 500 });
      k.obj.v.textContent = fmtNum((f.counts && f.counts.total) || 0); k.an.v.textContent = fmtNum((f.anomalies || []).length);
      cam.setLevel(lv);
    });
    on('shot', (s) => cam.setFrame(s.frame, s.image));
    on('control', () => { const c = store.get('control') || {}, n = store.get('node') || {}; cam.setZone(c.zone || n.zone); lastHour = -9; });
    on('node', () => { const n = store.get('node') || {}; cam.setZone(n.zone); });
    on('prefs', (p) => send({ type: 'quality', lite: !!(p && p.lite) }));
    on('conn', () => {
      const items = [];
      if (core.demo) items.push(banner('warn', 'Mode demo: model bergerak mengikuti simulasi di peramban ini, bukan CCTV sungguhan.'));
      else if (store.get('conn') === 'offline') items.push(banner('bad', 'Sambungan ke server terputus. Model berhenti di kondisi terakhir.'));
      fill(banners, ...items);
    });
    const onVis = () => send({ type: 'pause', value: document.hidden });
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));
    // simulasi butuh detak sendiri agar gerak benda halus; mode langsung dikirim saat bingkai tiba
    timers.push(setInterval(() => { if (sim.on) push(true); else if (ready) push(); }, 100));
    // jam di model ikut waktu titik pantau walau bingkai jarang datang (mode hemat)
    timers.push(setInterval(() => { if (!sim.on) lastHour = -9; }, 30000));

    return {
      destroy() {
        clearTimeout(pendingTimer); cam.destroy(); offs.forEach((f) => f()); timers.forEach(clearInterval); head.destroy();
        if (document.fullscreenElement) document.exitFullscreen();
        frame.src = 'about:blank';
      }
    };
  }
};
