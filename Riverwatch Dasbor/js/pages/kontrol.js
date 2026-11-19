// Halaman Kontrol: kecepatan rekam, mode malam, deteksi, ambang tingkat siaga, editor zona, peringatan, aksi, simulasi, tampilan.
import { h, fill, fmtNum, fmtClock, fmtDay, fmtAgo, clamp, LEVELS, MODES, MODE_LABELS, segmented, switchEl, rangeEl, confirmSheet, toast, debounce, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { store, prefs } from '../store.js';
import { core, pageHeader, banner, nowTs, nodeOff, control, call, askToken, simAction } from '../core.js';
import { CameraView } from '../camview.js';
import { applyPrefs } from '../app.js';

const AUTO = (on, off) => [{ value: 'auto', label: 'Otomatis' }, { value: 'on', label: on }, { value: 'off', label: off }];
const KEYLAB = { fps_mode: 'Mode FPS', fps_manual: 'FPS manual', live_boost: 'Pantau langsung', night_mode: 'Mode malam', enhance: 'Peningkat gambar', lamp: 'Lampu IR', recording: 'Rekaman', detector_conf: 'Ambang yakin model', zone: 'Zona pantau', levels: 'Ambang tingkat', muted_minutes: 'Bisukan', paused: 'Jeda', snapshot: 'Ambil foto', ack: 'Konfirmasi', restart: 'Setel ulang', mark_event: 'Tandai kejadian' };
const VALLAB = { auto: 'otomatis', on: 'hidup', off: 'mati', day: 'siang', night: 'malam', low: 'Hemat', normal: 'Normal', high: 'Tinggi', max: 'Maksimum' };
const SIM_BTNS = [['person_fall', 'Orang jatuh ke air', 'person'], ['person_swim', 'Orang berenang', 'person'], ['person_walk', 'Orang di tepi', 'person'], ['boat', 'Perahu lewat', 'boat'], ['animal', 'Hewan', 'paw'], ['vehicle', 'Kendaraan', 'car'], ['odd', 'Benda aneh', 'unknown'], ['clear_trash', 'Bersihkan sampah', 'trash']];
const FAULT_LAB = { overheat: 'Suhu naik', low_voltage: 'Tegangan turun', weak_signal: 'Sinyal lemah', high_load: 'Beban tinggi', disk_full: 'Disk penuh', flood: 'Banjir', sensor_lost: 'Sensor hilang' };
const DEFAULT_ZONE = [[0.05, 0.45], [0.95, 0.45], [0.98, 0.95], [0.02, 0.95]];

function describe(patch) {
  return Object.entries(patch || {}).map(([k, v]) => {
    let t;
    if (k === 'zone') t = `${v.length} titik`;
    else if (k === 'levels') t = Object.entries(v).map(([a, b]) => (a.endsWith('_s') ? `${a === 'hold_s' ? 'tahan' : 'pulih'} ${fmtNum(b / 60, 0)} mnt` : `${a} ${fmtNum(b * 100, 0)}%`)).join(', ');
    else if (typeof v === 'boolean') t = v ? 'ya' : 'tidak';
    else if (k === 'detector_conf') t = fmtNum(v, 2);
    else t = VALLAB[v] || String(v);
    return `${KEYLAB[k] || k}: ${t}`;
  }).join(' · ');
}

export default {
  id: 'kontrol',
  async mount(root) {
    const offs = [], timers = [];
    const on = (k, fn, now = true) => offs.push(store.on(k, fn, now));
    const node = store.get('node') || {};
    const head = pageHeader('Kontrol', 'Atur cara CCTV merekam, mengenali benda, dan memberi peringatan. Perubahan langsung berlaku.');
    const banners = h('div', { class: 'stack' });
    const isSim = () => core.demo || (store.get('node') || {}).mode === 'simulation';
    const C = () => store.get('control') || {};

    const syncers = [];
    const row = (label, desc, ctl) => h('div', { class: 'row set' }, h('div', { class: 'grow' }, h('div', { class: 't' }, label), desc ? h('div', { class: 'd' }, desc) : null), ctl);
    const card = (title, sub, ...kids) => h('section', { class: 'card glass' }, h('div', { class: 'card-h' }, h('h2', null, title), sub ? h('span', { class: 'sub' }, sub) : null), ...kids);
    const segCtl = (key, options, label) => {
      const s = segmented({ options, value: C()[key] ?? options[0].value, label, onChange: async (v) => { const r = await control({ [key]: v }); if (!r) s.set(C()[key] ?? options[0].value, true); } });
      syncers.push(() => { const v = C()[key]; if (v != null && s.value !== v) s.set(v, true); });
      return s;
    };

    // ---------- 1. kecepatan rekam ----------
    const fpsSeg = segCtl('fps_mode', [{ value: 'auto', label: 'Otomatis' }, ...MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))], 'Mode FPS');
    const pol = (store.get('node') || {}).fps_policy || {};
    const polRows = MODES.map((m) => { const p = pol[m] || {}; return h('div', { class: 'pol' }, h('b', null, MODE_LABELS[m]), h('span', null, `${fmtNum(p.grab)} / ${fmtNum(p.infer)} / ${fmtNum(p.record, 1)} / ${fmtNum(p.stream)}`)); });
    const manVal = h('b', { class: 'tnum' }, 'Mati');
    const manRange = rangeEl({ min: 0, max: 30, step: 1, value: C().fps_manual || 0, label: 'FPS manual', onInput: (v) => { manVal.textContent = v ? `${v} fps` : 'Mati'; }, onChange: async (v) => { const r = await control({ fps_manual: v || null }); if (!r) syncers.forEach((f) => f()); } });
    syncers.push(() => { const v = C().fps_manual || 0; manRange.value = v; manRange.paint(); manVal.textContent = v ? `${fmtNum(v)} fps` : 'Mati'; });
    const boostSt = h('span', { class: 'cap' }, '');
    const boostBtn = h('button', { class: 'btn', onclick: async () => { const on = !!C().live_boost_until && C().live_boost_until > nowTs(); await control({ live_boost: on ? false : 120 }, { okMsg: on ? 'Pantau langsung dihentikan.' : 'FPS dinaikkan selama 2 menit.' }); } }, h('span', { html: icon('bolt') }), 'Pantau langsung 2 menit');
    const paintBoost = () => { const u = C().live_boost_until, left = u ? u - nowTs() : 0; boostSt.textContent = left > 0 ? `Aktif, sisa ${fmtNum(left, 0)} detik` : 'Naikkan FPS sementara untuk melihat kejadian dengan jelas.'; boostBtn.classList.toggle('primary', left > 0); };
    syncers.push(paintBoost); timers.push(setInterval(paintBoost, 1000));
    const fpsCard = card('Kecepatan rekam', 'FPS adaptif',
      h('p', { class: 'cap' }, 'Otomatis: kamera menurunkan FPS saat hanya sampah lambat yang lewat, dan menaikkannya saat ada manusia atau benda tak terduga.'), fpsSeg.el,
      h('div', { class: 'pols' }, h('div', { class: 'pol hd' }, h('span', null, 'Mode'), h('span', null, 'ambil / analisis / simpan / siar (fps)')), polRows),
      h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'FPS manual (menimpa mode)'), manVal), manRange),
      h('div', { class: 'boost' }, boostBtn, boostSt));

    // ---------- 2. malam dan gambar ----------
    const nightSeg = segCtl('night_mode', [{ value: 'auto', label: 'Otomatis' }, { value: 'day', label: 'Siang' }, { value: 'night', label: 'Malam' }], 'Mode malam');
    const enhSeg = segCtl('enhance', AUTO('Aktif', 'Mati'), 'Peningkat gambar malam');
    const lampSeg = segCtl('lamp', AUTO('Hidup', 'Mati'), 'Lampu inframerah');
    const recSeg = segCtl('recording', AUTO('Hidup', 'Mati'), 'Rekaman');
    const lampSt = h('span', { class: 'cap' }, '');
    syncers.push(() => { lampSt.textContent = C().lamp_on ? 'Lampu IR sedang menyala' : 'Lampu IR sedang mati'; });
    const nightCard = card('Malam dan gambar', 'tanpa lampu jalan pun tetap terlacak',
      row('Mode malam', 'Otomatis membaca kecerahan dan warna gambar kamera.', nightSeg.el), row('Peningkat gambar', 'Menerangkan gambar gelap dan menekan bintik agar pelacakan tetap halus.', enhSeg.el),
      row('Lampu inframerah', null, lampSeg.el), h('div', { class: 'row-n' }, lampSt), row('Rekaman', 'Otomatis mengikuti mode FPS. Matikan untuk menghentikan penulisan ke disk.', recSeg.el));

    // ---------- 3. deteksi ----------
    const confVal = h('b', { class: 'tnum' }, fmtNum(C().detector_conf ?? 0.25, 2));
    const confRange = rangeEl({ min: 5, max: 95, step: 1, value: Math.round((C().detector_conf ?? 0.25) * 100), label: 'Ambang yakin model', onInput: (v) => { confVal.textContent = fmtNum(v / 100, 2); }, onChange: async (v) => { const r = await control({ detector_conf: v / 100 }); if (!r) syncers.forEach((f) => f()); } });
    syncers.push(() => { const v = C().detector_conf; if (v != null) { confRange.value = Math.round(v * 100); confRange.paint(); confVal.textContent = fmtNum(v, 2); } });
    const detCard = card('Deteksi benda', null,
      h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'Seberapa yakin model sebelum menandai benda'), confVal), confRange),
      h('p', { class: 'cap' }, 'Rendah menangkap lebih banyak benda kecil tapi lebih banyak salah tandai. Tinggi lebih bersih tapi bisa melewatkan sampah yang samar. Mulai dari 0,25 dan sesuaikan dengan hasil di lokasi.'));

    // ---------- 4. ambang tingkat ----------
    const thv = { w: 15, p: 25, k: 35, hold: 10, clear: 10 };
    const lvBar = h('div', { class: 'lvbar' }, [0, 1, 2, 3].map((i) => h('i', { style: { background: `var(--lv${i})` } })));
    const lvVals = {}; const mk = (key, label, color, min, max, step, fmt) => {
      const v = h('b', { class: 'tnum' }, ''); lvVals[key] = v;
      const r = rangeEl({ min, max, step, value: thv[key], label, onInput: (x) => { thv[key] = x; if (key === 'w') { thv.p = Math.max(thv.p, x + 1); thv.k = Math.max(thv.k, thv.p + 1); } if (key === 'p') { thv.w = Math.min(thv.w, x - 1); thv.k = Math.max(thv.k, x + 1); } if (key === 'k') { thv.p = Math.min(thv.p, x - 1); thv.w = Math.min(thv.w, thv.p - 1); } paintTh(); dirty(true); } });
      lvVals[key + 'R'] = r; lvVals[key + 'F'] = fmt;
      return h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, color ? h('span', { class: 'dot', style: { '--c': color } }) : null, ' ', label), v), r);
    };
    const pc = (x) => `${fmtNum(x, 0)}%`, mn = (x) => (x === 0 ? 'langsung' : `${fmtNum(x, 0)} menit`);
    const fW = mk('w', 'Waspada mulai dari tutupan', 'var(--lv1)', 1, 90, 1, pc), fP = mk('p', 'Peringatan mulai dari', 'var(--lv2)', 2, 95, 1, pc), fK = mk('k', 'Kritis mulai dari', 'var(--lv3)', 3, 99, 1, pc);
    const fH = mk('hold', 'Tahan naik tingkat selama', null, 0, 60, 1, mn), fC = mk('clear', 'Turunkan setelah aman selama', null, 0, 60, 1, mn);
    const applyBtn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
      applyBtn.classList.add('busy');
      const r = await control({ levels: { waspada: thv.w / 100, peringatan: thv.p / 100, kritis: thv.k / 100, hold_s: thv.hold * 60, clear_s: thv.clear * 60 } }, { okMsg: 'Ambang disimpan.' });
      applyBtn.classList.remove('busy'); if (r) dirty(false);
    } }, 'Simpan ambang');
    const resetBtn = h('button', { class: 'btn ghost', disabled: true, onclick: () => { loadTh(); dirty(false); } }, 'Batalkan');
    function dirty(v) { applyBtn.disabled = !v; resetBtn.disabled = !v; }
    function paintTh() {
      ['w', 'p', 'k', 'hold', 'clear'].forEach((k) => { lvVals[k + 'R'].value = thv[k]; lvVals[k + 'R'].paint(); lvVals[k].textContent = lvVals[k + 'F'](thv[k]); });
      const mx = 60, e = [0, thv.w, thv.p, thv.k, Math.max(mx, thv.k + 5)];
      [...lvBar.children].forEach((el, i) => { el.style.flexGrow = String((e[i + 1] - e[i]) * 10); });
    }
    function loadTh() { const l = C().levels; if (!l) return; thv.w = Math.round(l.waspada * 100); thv.p = Math.round(l.peringatan * 100); thv.k = Math.round(l.kritis * 100); thv.hold = Math.round((l.hold_s || 0) / 60); thv.clear = Math.round((l.clear_s || 0) / 60); paintTh(); }
    let thTouched = false;
    syncers.push(() => { if (applyBtn.disabled) loadTh(); });
    const lvCard = card('Ambang tingkat siaga', 'persentase permukaan air tertutup sampah',
      lvBar, fW, fP, fK, h('div', { class: 'sep' }), fH, fC,
      h('p', { class: 'cap' }, 'Tingkat juga naik langsung bila ada anomali berat, misalnya manusia jatuh ke air, walau tutupan sampah masih rendah.'),
      h('div', { class: 'btns' }, resetBtn, applyBtn));

    // ---------- 5. editor zona ----------
    const cam = new CameraView({ chips: false, aspect: 16 / 9 }); cam.showZone = false; cam.showBoxes = false; cam.showTrails = false; cam.start();
    let pts = DEFAULT_ZONE.map((p) => p.slice()), zdirty = false;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); poly.setAttribute('class', 'zone-poly');
    const zsvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); zsvg.setAttribute('viewBox', '0 0 100 100'); zsvg.setAttribute('preserveAspectRatio', 'none'); zsvg.setAttribute('class', 'zone-svg'); zsvg.append(poly);
    const hbox = h('div', { class: 'zone-h' });
    const ov = h('div', { class: 'zone-ov' }, zsvg, hbox);
    const zsave = h('button', { class: 'btn primary sm', disabled: true, onclick: async () => { zsave.classList.add('busy'); const r = await control({ zone: pts.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]) }, { okMsg: 'Zona disimpan.' }); zsave.classList.remove('busy'); if (r) setZ(false); } }, 'Simpan zona');
    const zreset = h('button', { class: 'btn sm', disabled: true, onclick: () => { loadZone(); } }, 'Batalkan');
    const zdef = h('button', { class: 'btn sm ghost', onclick: () => { pts = DEFAULT_ZONE.map((p) => p.slice()); setZ(true); drawZone(); } }, 'Zona bawaan');
    const zadd = h('button', { class: 'btn sm ghost', onclick: () => { let bi = 0, bl = -1; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(a[0] - b[0], a[1] - b[1]); if (l > bl) { bl = l; bi = i; } } const a = pts[bi], b = pts[(bi + 1) % pts.length]; pts.splice(bi + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); setZ(true); drawZone(); } }, 'Tambah titik');
    function setZ(v) { zdirty = v; zsave.disabled = !v; zreset.disabled = !v; }
    function drawZone() {
      poly.setAttribute('points', pts.map((p) => `${p[0] * 100},${p[1] * 100}`).join(' '));
      while (hbox.children.length > pts.length) hbox.lastChild.remove();
      pts.forEach((p, i) => {
        let el = hbox.children[i];
        if (!el) {
          el = h('button', { class: 'zh', type: 'button', 'aria-label': `Titik zona ${i + 1}` });
          el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); el._i = [...hbox.children].indexOf(el); });
          el.addEventListener('pointermove', (e) => { if (!el.hasPointerCapture(e.pointerId)) return; const r = ov.getBoundingClientRect(); const i2 = [...hbox.children].indexOf(el); pts[i2] = [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; setZ(true); drawZone(); });
          el.addEventListener('pointerup', () => el.classList.remove('drag'));
          el.addEventListener('dblclick', () => { if (pts.length > 3) { pts.splice([...hbox.children].indexOf(el), 1); setZ(true); drawZone(); } else toast('Zona minimal punya 3 titik.', 'info'); });
          el.addEventListener('keydown', (e) => { const d = e.shiftKey ? 0.05 : 0.01, i2 = [...hbox.children].indexOf(el); const m = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key]; if (m) { e.preventDefault(); pts[i2] = [clamp(pts[i2][0] + m[0], 0, 1), clamp(pts[i2][1] + m[1], 0, 1)]; setZ(true); drawZone(); } });
          hbox.append(el);
        }
        el.style.left = p[0] * 100 + '%'; el.style.top = p[1] * 100 + '%';
        el.textContent = String(i + 1);
      });
    }
    function loadZone() { const z = C().zone || (store.get('node') || {}).zone || DEFAULT_ZONE; pts = z.map((p) => [p[0], p[1]]); setZ(false); drawZone(); }
    syncers.push(() => { if (!zdirty) loadZone(); });
    const zoneCard = card('Zona pantau', 'area air yang dihitung',
      h('p', { class: 'cap' }, 'Seret titik bernomor agar bingkai hanya menutup permukaan air, bukan tebing atau jembatan. Klik dua kali titik untuk menghapusnya. Bisa juga dengan tombol panah saat titik terpilih.'),
      h('div', { class: 'zone-ed' }, cam.el, ov),
      h('div', { class: 'btns' }, zadd, zdef, h('span', { class: 'grow' }), zreset, zsave));

    // ---------- 6. peringatan dan aksi ----------
    const muteSt = h('span', { class: 'cap' }, '');
    const paintMute = () => { const u = C().muted_until, left = u ? u - nowTs() : 0; muteSt.textContent = left > 0 ? `Notifikasi dibisukan sampai ${fmtClock(u, nodeOff(), false)}` : 'Notifikasi aktif'; };
    syncers.push(paintMute); timers.push(setInterval(paintMute, 5000));
    const muteBtns = [[30, '30 menit'], [120, '2 jam'], [480, '8 jam']].map(([m, l]) => h('button', { class: 'btn sm', onclick: () => control({ muted_minutes: m }, { okMsg: `Dibisukan ${l}.` }) }, l));
    const unmute = h('button', { class: 'btn sm ghost', onclick: () => control({ muted_minutes: 0 }, { okMsg: 'Notifikasi aktif lagi.' }) }, 'Aktifkan lagi');
    const testBtn = h('button', { class: 'btn sm', onclick: async (e) => {
      const b = e.currentTarget; b.classList.add('busy');
      const r = await call(() => core.api.post('/api/notify/test'), { quiet: true }).catch(() => null);
      b.classList.remove('busy');
      if (!r) { toast('Notifikasi belum diatur di server ini.', 'info', 4200); return; }
      const res = r.result || {};
      if (res.enabled && res.ok !== false) toast('Pesan uji terkirim.', 'ok'); else toast(res.hint || 'Notifikasi belum aktif.', 'info', 6000);
    } }, h('span', { html: icon('bell') }), 'Kirim pesan uji');
    const pauseSw = switchEl(!!C().paused, async (v, input) => { const r = await control({ paused: v }, { okMsg: v ? 'Pemantauan dijeda.' : 'Pemantauan dilanjutkan.' }); if (!r) input.checked = !v; }, 'Jeda pemantauan');
    syncers.push(() => { pauseSw.input.checked = !!C().paused; });
    const markIn = h('input', { class: 'field', type: 'text', maxlength: 80, placeholder: 'Catatan singkat, mis. “Perahu nelayan lewat”', 'aria-label': 'Catatan penanda kejadian' });
    const markBtn = h('button', { class: 'btn sm', onclick: async () => { const t = markIn.value.trim(); if (!t) { markIn.focus(); return; } const r = await control({ mark_event: t }, { okMsg: 'Kejadian ditandai.' }); if (r) markIn.value = ''; } }, 'Tandai');
    markIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') markBtn.click(); });
    const actCard = card('Peringatan dan aksi', null,
      row('Bisukan notifikasi', null, h('div', { class: 'chips' }, muteBtns, unmute)), h('div', { class: 'row-n' }, muteSt),
      row('Uji pengiriman', 'Kirim pesan percobaan ke Telegram bila sudah diatur.', testBtn),
      row('Konfirmasi peringatan aktif', 'Menandai bahwa petugas sudah melihat kejadian yang sedang berlangsung.', h('button', { class: 'btn sm', onclick: () => control({ ack: true }, { okMsg: 'Peringatan dikonfirmasi.' }) }, h('span', { html: icon('check') }), 'Konfirmasi')),
      row('Ambil foto sekarang', 'Disimpan sebagai bukti, tanpa menunggu kejadian.', h('button', { class: 'btn sm', onclick: () => control({ snapshot: true }, { okMsg: 'Foto disimpan.' }) }, h('span', { html: icon('camera') }), 'Ambil foto')),
      h('div', { class: 'row set stk' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Tandai kejadian'), h('div', { class: 'd' }, 'Catat sesuatu yang kamu lihat langsung agar muncul di Riwayat.')), h('div', { class: 'mark' }, markIn, markBtn)),
      row('Jeda pemantauan', 'Berhenti menganalisis dan merekam sementara.', pauseSw),
      row('Setel ulang pemantauan', 'Mengembalikan FPS ke otomatis dan mengosongkan status siaga. Pengaturan lain tetap.', h('button', { class: 'btn sm warn', onclick: async () => { if (await confirmSheet('Setel ulang pemantauan?', 'Mode FPS kembali ke otomatis dan status siaga dihapus. Riwayat tidak berubah.', 'Setel ulang', true)) control({ restart: true }, { okMsg: 'Pemantauan disetel ulang.' }); } }, 'Setel ulang')));

    // ---------- 7. simulasi ----------
    const simCard = h('section', { class: 'card glass', hidden: true });
    function buildSim() {
      const sim = (store.get('node') || {}).sim || {};
      const hr = h('b', { class: 'tnum' }, '12.00');
      let hv = 12; const hrR = rangeEl({ min: 0, max: 23, step: 1, value: 12, label: 'Jam simulasi', onInput: (v) => { hv = v; hr.textContent = `${String(v).padStart(2, '0')}.00`; } });
      const sb = (a, label, ic, extra = {}) => h('button', { class: 'btn sm', onclick: () => simAction(Object.assign({ action: a }, extra), null) }, ic ? h('span', { html: icon(ic) }) : null, label);
      const faults = Object.keys(sim.faults || FAULT_LAB).map((k) => h('button', { class: 'btn sm', title: (sim.faults || {})[k] || '', onclick: () => simAction({ action: 'fault', kind: k, duration_s: 120 }, 'Gangguan disuntikkan 2 menit.') }, FAULT_LAB[k] || k));
      fill(simCard, h('div', { class: 'card-h' }, h('h2', null, 'Simulasi'), h('span', { class: 'badge warn' }, 'data tiruan')),
        h('p', { class: 'cap' }, 'Mode ini memakai kamera tiruan. Gunakan tombol di bawah untuk melihat bagaimana FPS, peringatan, dan Kembar 3D bereaksi.'),
        h('div', { class: 'fld' }, h('span', { class: 'lab' }, 'Sampah di sungai'), h('div', { class: 'chips' }, LEVELS.map((n, i) => sb('trash_level', n, 'trash', { level: i })))),
        h('div', { class: 'fld' }, h('span', { class: 'lab' }, 'Benda dan orang'), h('div', { class: 'chips' }, SIM_BTNS.map(([a, l, ic]) => sb(a, l, ic)))),
        h('div', { class: 'fld' }, h('div', { class: 'lab-r' }, h('span', { class: 'lab' }, 'Jam di lokasi (uji mode malam)'), hr), hrR, h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: () => simAction({ action: 'hour', hour: hv }, `Jam diatur ${String(hv).padStart(2, '0')}.00`) }, 'Atur jam'))),
        h('div', { class: 'fld' }, h('span', { class: 'lab' }, 'Gangguan perangkat'), h('div', { class: 'chips' }, faults, h('button', { class: 'btn sm', onclick: () => simAction({ action: 'rain', duration_s: 600 }, 'Hujan 10 menit.') }, 'Hujan'), h('button', { class: 'btn sm ghost', onclick: () => simAction({ action: 'clear_faults' }, 'Gangguan dihapus.') }, 'Hapus gangguan'))));
      simCard.hidden = false;
    }

    // ---------- 8. tampilan dan akses ----------
    const themeSeg = segmented({ options: [{ value: 'auto', label: 'Otomatis' }, { value: 'dark', label: 'Gelap' }, { value: 'light', label: 'Terang' }], value: prefs.get('theme', 'auto'), label: 'Tema', onChange: (v) => { prefs.set('theme', v); applyPrefs(); } });
    const liteSw = switchEl(prefs.get('lite', '0') === '1', (v) => { prefs.set('lite', v ? '1' : '0'); applyPrefs(); }, 'Mode ringan');
    const tokSt = h('span', { class: 'cap' }, '');
    const paintTok = () => { tokSt.textContent = core.demo ? 'Mode demo tidak memakai token.' : core.api.hasToken && core.api.hasToken() ? 'Token tersimpan di peramban ini.' : 'Belum ada token. Dibutuhkan untuk mengubah pengaturan.'; };
    paintTok();
    const viewCard = card('Tampilan dan akses', null,
      row('Tema', null, themeSeg.el), row('Mode ringan', 'Mematikan efek kaca dan animasi agar nyaman di komputer atau ponsel lama.', liteSw),
      row('Token kontrol', null, h('div', { class: 'chips' }, h('button', { class: 'btn sm', onclick: async () => { await askToken(); paintTok(); } }, 'Isi token'), h('button', { class: 'btn sm ghost', onclick: () => { prefs.del('token'); if (core.api.setToken) core.api.setToken(''); paintTok(); toast('Token dihapus dari peramban ini.', 'ok'); } }, 'Hapus'))), h('div', { class: 'row-n' }, tokSt));

    // ---------- 9. log ----------
    const logBox = h('div', { class: 'rows' });
    const logCard = card('Riwayat perubahan', 'perintah terakhir', logBox);
    async function loadLog() {
      try {
        const r = await core.api.get('/api/control/log', { limit: 8 });
        const items = r.log || [];
        fill(logBox, items.length ? items.map((l) => h('div', { class: 'row log' }, h('span', { class: 'sev-i ' + (l.ok ? 'ok' : 'bad'), html: icon(l.ok ? 'checkc' : 'alert') }), h('div', { class: 'grow' }, h('div', { class: 't' }, describe(l.patch) || '–'), h('div', { class: 'd' }, `${fmtDay(l.ts, nodeOff())}, ${fmtClock(l.ts, nodeOff(), false)} · ${l.actor || 'dasbor'}${l.ok ? '' : ' · ditolak'}`)))) : emptyState('Belum ada perubahan', 'Perubahan pengaturan akan tercatat di sini.'));
      } catch (e) { fill(logBox, h('p', { class: 'cap' }, 'Riwayat perubahan tidak bisa dimuat.')); }
    }

    root.append(head.el, banners, h('div', { class: 'g-kontrol' }, h('div', { class: 'col' }, fpsCard, nightCard, detCard, lvCard), h('div', { class: 'col' }, zoneCard, actCard, simCard, viewCard, logCard)));

    // ---------- sinkron ----------
    const syncAll = () => syncers.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    on('control', () => { syncAll(); });
    on('shot', (s) => cam.setFrame(s.frame, s.image));
    const reLog = debounce(loadLog, 400); on('control', reLog, false);
    on('node', () => { if (isSim()) buildSim(); }, true);
    on('conn', () => { fill(banners, core.demo ? banner('warn', 'Mode demo: perubahan hanya berlaku di simulasi dalam peramban ini.') : store.get('conn') === 'offline' ? banner('bad', 'Sambungan ke server terputus. Perubahan tidak akan terkirim.') : null); });
    loadTh(); loadZone(); paintTh(); syncAll(); loadLog();
    if (!C().levels) loadTh();
    return { destroy() { cam.destroy(); offs.forEach((f) => f()); timers.forEach(clearInterval); head.destroy(); } };
  }
};
