// Mode demo: server Riverwatch tiruan yang berjalan sepenuhnya di peramban (tanpa Python). Antarmukanya sama dengan LiveApi,
// jadi seluruh dasbor bekerja seperti terhubung ke CCTV sungguhan. Semua data di sini TIRUAN: bukan hasil model YOLO dan bukan kamera.
import { ApiError } from './api.js';
import { SceneRenderer, KIND_STYLE } from './demo_scene.js';

const OFF = 7, TH = [0.15, 0.25, 0.35];
const LEVEL_NAMES = ['Aman', 'Waspada', 'Peringatan', 'Kritis'], MODES = ['low', 'normal', 'high', 'max'], MODE_LABEL = { low: 'Hemat', normal: 'Normal', high: 'Tinggi', max: 'Maksimum' };
const POLICY = { low: { grab: 5, infer: 1.0, record: 0.2, stream: 1.0, label: 'Hemat' }, normal: { grab: 8, infer: 3.0, record: 1.0, stream: 3.0, label: 'Normal' }, high: { grab: 15, infer: 10.0, record: 10.0, stream: 10.0, label: 'Tinggi' }, max: { grab: 25, infer: 15.0, record: 20.0, stream: 15.0, label: 'Maksimum' } };
const ZONE0 = [[0.05, 0.45], [0.95, 0.45], [0.98, 0.95], [0.02, 0.95]];
const LEVEL_COV = [0.04, 0.2, 0.3, 0.42];
const KINDS = { person_in_water: 'Manusia di perairan', person_near_water: 'Manusia di dekat air', vehicle_in_water: 'Kendaraan di perairan', animal_in_water: 'Hewan di perairan', vessel: 'Perahu / rakit melintas', unknown_object: 'Benda tak dikenal', fast_object: 'Benda bergerak cepat', against_flow: 'Benda melawan arus', large_object: 'Benda besar hanyut', fall_suspect: 'Dugaan jatuh ke air' };
const KIND_SEV = { person_in_water: 'critical', fall_suspect: 'critical', vehicle_in_water: 'critical', person_near_water: 'warning', animal_in_water: 'warning', unknown_object: 'warning', fast_object: 'warning', against_flow: 'warning', large_object: 'info', vessel: 'info' };
const KIND_CLS = { person_in_water: 'manusia', person_near_water: 'manusia', fall_suspect: 'manusia', vehicle_in_water: 'kendaraan', animal_in_water: 'hewan', vessel: 'perahu', unknown_object: 'objek_lain', fast_object: 'objek_lain', against_flow: 'objek_lain', large_object: 'sampah_besar' };
const CLS_CAT = { plastik_kantong: 'trash', botol_kemasan: 'trash', sampah_besar: 'trash', tumbuhan_air: 'trash', kayu_batang: 'trash', manusia: 'person', hewan: 'animal', perahu: 'vessel', kendaraan: 'vehicle', objek_lain: 'unknown' };
const TRASH_MIX = ['plastik_kantong', 'plastik_kantong', 'botol_kemasan', 'botol_kemasan', 'tumbuhan_air', 'tumbuhan_air', 'sampah_besar', 'kayu_batang'];
const GROUPS = { camera: 'Kamera', model: 'Model AI', system: 'Sistem', network: 'Jaringan', storage: 'Penyimpanan', notify: 'Notifikasi' };
const SIM_ACTIONS = ['animal', 'boat', 'clear_trash', 'hour', 'odd', 'person_fall', 'person_swim', 'person_walk', 'trash_level', 'vehicle'];
const FAULTS = { overheat: 'Suhu boks dan prosesor naik tajam', low_voltage: 'Tegangan catu daya turun', weak_signal: 'Sinyal jaringan melemah', high_load: 'Beban prosesor hampir penuh', disk_full: 'Ruang disk hampir habis', flood: 'Muka air naik cepat', sensor_lost: 'Sensor boks tidak terbaca' };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const levelOf = (c) => (c >= TH[2] ? 3 : c >= TH[1] ? 2 : c >= TH[0] ? 1 : 0);
const clone = (o) => JSON.parse(JSON.stringify(o));
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(n) { n = (n | 0) ^ 61 ^ ((n | 0) >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
const localHour = (ts) => (((ts + OFF * 3600) % 86400) + 86400) % 86400 / 3600;
const dayFactor = (hr) => clamp((Math.cos(((hr - 12) * Math.PI) / 12) + 0.1) / 0.5, 0, 1);
const spanOf = (rg) => { const m = /^(\d+)([mhd])$/.exec(String(rg || '24h')); if (!m) throw new ApiError(400, `rentang tidak valid: ${rg}`, 'bad_param'); return +m[1] * { m: 60, h: 3600, d: 86400 }[m[2]]; };
function polyContains(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
function polyDist(poly, x, y) { let best = 9; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1); best = Math.min(best, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))); } return best; }
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; };

// ---------- model riwayat berbasis rumus (deterministik) ----------
function dayPlan(day) { const r = rnd(day * 977 + 13), n = 2 + Math.floor(r() * 2), s = []; for (let i = 0; i < n; i++) s.push({ c: 5 + r() * 16, w: 0.5 + r() * 1.0, a: 0.1 + r() * 0.32 }); return s; }
function covAt(ts) {
  const loc = ts + OFF * 3600, day = Math.floor(loc / 86400), hr = (loc % 86400) / 3600;
  let c = 0.03 + 0.008 * Math.sin(((hr - 6) / 24) * 2 * Math.PI);
  for (const s of dayPlan(day)) c += s.a * Math.exp(-0.5 * ((hr - s.c) / s.w) ** 2);
  return Math.max(0.006, c + (hash(Math.floor(ts / 60)) - 0.5) * 0.004);
}
function teleAt(ts, t0) {
  const hr = localHour(ts), n = (k, a = 1) => (hash(Math.floor(ts / 20) * 7 + k) - 0.5) * a;
  const load = clamp(20 + 12 * (0.5 + 0.5 * Math.sin(ts / 700)) + n(1, 8), 4, 99);
  const cpu = 43 + load * 0.2 + 4 * Math.sin(((hr - 14) / 24) * 2 * Math.PI) + n(2, 1.5), enc = cpu - 12 + n(3, 1);
  const v = 12.6 + n(4, 0.12), a = 0.45 + load / 400 + n(5, 0.04);
  return { cpu_temp_c: cpu, cpu_load_pct: load, ram_pct: 38 + 3 * Math.sin(ts / 3000) + n(6, 1), disk_free_gb: 53 - ((ts - t0) / 86400) * 1.6, disk_total_gb: 64, uptime_s: ts - t0,
    proc_cpu_pct: load * 0.7, proc_rss_mb: 390 + n(7, 4), net_rssi_dbm: -62 + 4 * Math.sin(ts / 500) + n(8, 3), net_latency_ms: 38 + 8 * Math.abs(Math.sin(ts / 300)) + (hash(Math.floor(ts / 90)) > 0.93 ? 40 : 0),
    net_rx_kbps: 20 + n(9, 6), net_tx_kbps: 88 + n(10, 12), supply_v: v, supply_a: a, power_w: v * a, enclosure_temp_c: enc, enclosure_humidity_pct: 70 - (enc - 30) * 0.6 + n(11, 2),
    water_temp_c: 28 + 1.5 * Math.sin(((hr - 15) / 24) * 2 * Math.PI) + n(12, 0.2), water_level_cm: 120 + 12 * Math.sin(ts / 6000) + covAt(ts) * 60, gpu_temp_c: null };
}

export class DemoApi {
  constructor() {
    this.mode = 'demo'; this.token = 'demo'; this.readNeedsToken = false;
    this.real0 = Date.now() / 1000; this.shift = 0; this.boot = this.real0 - 3 * 86400 - 5 * 3600;
    this.ctl = { fps_mode: 'auto', fps_manual: null, live_boost_until: null, night_mode: 'auto', enhance: 'auto', lamp: 'auto', lamp_on: false, recording: 'auto', detector_conf: 0.25, zone: clone(ZONE0), levels: { waspada: 0.15, peringatan: 0.25, kritis: 0.35, hold_s: 600, clear_s: 600 }, muted_until: null, paused: false, alert_ack: false };
    this.log = []; this.events = []; this.evSeq = 1; this.frames = 0; this.objs = []; this.oid = 1; this.faults = {}; this.rainUntil = 0; this.liveHist = [];
    this.cov = { target: 0.04, smooth: 0.04, scale: 1 }; this.lv = { level: 0, since: this.now(), pend: null, acked: false }; this.active = new Map(); this.mode = 'demo';
    this.fpsSt = { mode: 'low', until: 0, reason: 'Hanya sampah lambat atau sepi', source: 'auto' }; this.modeTime = { low: 0, normal: 0, high: 0, max: 0 };
    this.heal = { status: 'ok', score: 100 }; this.night = false; this.cb = null; this.timer = 0; this.last = 0; this.lastEmit = 0; this.lastTele = 0; this.lastPing = 0; this.lastHist = 0; this.scnT = 0; this.scnI = 0;
    this.render = new SceneRenderer(); this.evRender = new SceneRenderer(); this.imgs = new Map(); this.evFrames = new Map(); this.ctlKind = 'demo';
    this.seedEvents(); this.ensureTrash(true);
    this.node = this.buildNode();
  }
  now() { return Date.now() / 1000 + this.shift; }
  hour() { return localHour(this.now()); }
  setToken(t) { this.token = t; } hasToken() { return true; }
  url(p) { return p; }
  async ping() { return true; }

  buildNode() {
    return { id: 'rw-01', name: 'Titik 1 - Jembatan Contoh (demo)', river: 'Sungai Contoh', location: { lat: -6.2, lon: 106.8, altitude_m: 10, heading_deg: 20, map_url: '' },
      hardware: { camera: 'Pi Camera Module 3 NoIR', computer: 'Raspberry Pi 5 4GB', lens_fov_deg: 66, ir_lamp: true }, utc_offset_hours: OFF, mode: 'simulation', version: '1.0.0-demo',
      taxonomy: [['plastik_kantong', 'Plastik / kantong', 'trash', '#ff7a1a', 1], ['botol_kemasan', 'Botol / kemasan', 'trash', '#00c2ff', 1], ['sampah_besar', 'Sampah besar', 'trash', '#b36bff', 1], ['tumbuhan_air', 'Tumbuhan air', 'trash', '#38d66b', 1], ['kayu_batang', 'Kayu / batang pohon', 'trash', '#c8a165', 1],
        ['manusia', 'Manusia', 'person', '#ff375f', 0], ['hewan', 'Hewan', 'animal', '#ffd60a', 0], ['perahu', 'Perahu / rakit', 'vessel', '#5ac8fa', 0], ['kendaraan', 'Kendaraan', 'vehicle', '#ff9f0a', 0], ['objek_lain', 'Objek lain / tak dikenal', 'unknown', '#8e8e93', 0]].map((t, i) => ({ id: i, key: t[0], name: t[1], category: t[2], color: t[3], coverage: !!t[4] })),
      levels: { names: LEVEL_NAMES, thresholds: { waspada: 0.15, peringatan: 0.25, kritis: 0.35, hold_s: 600, clear_s: 600 } }, zone: clone(ZONE0), calibration: { calibrated: false, unit: 'norm' },
      modes: { names: MODES, labels: MODE_LABEL }, fps_policy: clone(POLICY), detector: { backend: 'demo', weights: '(demo di peramban)', imgsz: 640, device: 'peramban', nc: 10, mapped: 10, map_mode: 'tiruan', warning: '', ignored: [] },
      auth: { read_requires_token: false, write_requires_token: false }, sim: { actions: SIM_ACTIONS, faults: FAULTS } };
  }

  // ====================================================================== riwayat awal
  ev(ts, type, kind, severity, title, detail, extra = {}) {
    const e = Object.assign({ id: `D${Math.round(ts)}-${(this.evSeq++).toString(36)}`, ts: +ts.toFixed(3), node: 'rw-01', type, kind, severity, title, detail: detail || '', cls: null, track_id: null, level: null, coverage: null, media: {}, ack: false, meta: { demo: true } }, extra);
    return e;
  }
  seedEvents() {
    const now = this.now(), from = now - 7 * 86400, list = [];
    const startDay = Math.floor((from + OFF * 3600) / 86400), endDay = Math.floor((now + OFF * 3600) / 86400);
    for (let d = startDay; d <= endDay; d++) {
      const base = d * 86400 - OFF * 3600, r = rnd(d * 31 + 5);
      const push = (ts, ...a) => { if (ts > from && ts < now - 90) list.push(this.ev(ts, ...a)); };
      push(base + 5.5 * 3600, 'system', 'night_off', 'info', 'Mode siang aktif', 'Kecerahan naik');
      push(base + 18.2 * 3600, 'system', 'night_on', 'info', 'Mode malam aktif', 'Kecerahan turun; inframerah');
      // lonjakan sampah -> kenaikan tingkat
      let lv = 0;
      for (let m = 0; m < 1440; m += 2) {
        const ts = base + m * 60, c = covAt(ts), l = levelOf(c);
        if (l > lv) { push(ts, 'level', 'level_up', l === 3 ? 'critical' : l === 2 ? 'warning' : 'info', `Tingkat naik ke ${LEVEL_NAMES[l]}`, `Tutupan ${(c * 100).toFixed(1)}%`, { level: l, coverage: +c.toFixed(3), media: { frames: 6 } }); lv = l; }
        else if (l < lv && l < levelOf(covAt(ts + 600))) { /* naik lagi: tahan */ }
        else if (l < lv) { push(ts, 'level', 'level_down', 'info', `Tingkat turun ke ${LEVEL_NAMES[l]}`, `Tutupan ${(c * 100).toFixed(1)}%`, { level: l, coverage: +c.toFixed(3) }); lv = l; }
      }
      // anomali
      const n = 4 + Math.floor(r() * 4), bag = ['vessel', 'vessel', 'vessel', 'person_near_water', 'person_near_water', 'large_object', 'unknown_object', 'fast_object', 'person_in_water', 'animal_in_water', 'against_flow', 'fall_suspect'];
      for (let i = 0; i < n; i++) {
        const kind = bag[Math.floor(r() * bag.length)], ts = base + (1 + r() * 22) * 3600, dur = 40 + Math.floor(r() * 140), sev = KIND_SEV[kind], cls = KIND_CLS[kind], tid = 100 + Math.floor(r() * 900), cov = covAt(ts);
        const meta = { anomaly_kind: kind, demo: true, score: +(0.7 + r() * 0.25).toFixed(2), in_zone: kind !== 'person_near_water', speed: +(r() * 0.1).toFixed(3) };
        push(ts, 'anomaly', 'anomaly_start', sev, KINDS[kind], 'Terdeteksi dan dilacak', { cls, track_id: tid, coverage: +cov.toFixed(3), level: levelOf(cov), media: { frames: 6 }, meta });
        push(ts + dur, 'anomaly', 'anomaly_end', 'info', `${KINDS[kind]} selesai`, `Berlangsung ${dur} detik`, { cls, track_id: tid, coverage: +cov.toFixed(3), media: { frames: 6 }, meta: Object.assign({ duration_s: dur }, meta) });
        const hi = sev === 'critical' ? 'max' : sev === 'warning' ? 'high' : 'normal';
        push(ts + 2, 'system', 'fps_mode', 'info', `FPS ${MODE_LABEL[hi]}`, 'Mode FPS naik karena anomali'); push(ts + dur + 14, 'system', 'fps_mode', 'info', 'FPS Hemat', 'Kembali ke mode hemat');
      }
    }
    list.sort((a, b) => b.ts - a.ts);
    const cut = now - 6 * 3600; list.forEach((e, i) => { e.ack = e.ts < cut || (e.severity !== 'warning' && e.severity !== 'critical') || hash(i) < 0.7; });
    this.events = list;
    this.events.unshift(this.ev(now - 5, 'system', 'started', 'info', 'Pemantauan dimulai', 'Mode demo di peramban; semua data tiruan'));
  }

  // ====================================================================== kurva dan ringkasan
  series(from, to, bucket) {
    const b = Math.max(10, Math.round(bucket || 600)); const ts = [], o = { from, to, bucket: b, ts, coverage: [], coverage_max: [], level: [], trash: [], person: [], other: [], fps: [], infer_ms: [], luma: [], night: [], mode: [], anomalies: [], n: [] };
    const starts = this.events.filter((e) => e.kind === 'anomaly_start');
    for (let t = Math.ceil(from / b) * b; t <= to; t += b) {
      let sum = 0, mx = 0; for (let k = 0; k < 4; k++) { const c = covAt(t + (k * b) / 4); sum += c; mx = Math.max(mx, c); }
      let cov = sum / 4;
      const live = this.liveHist.filter((s) => s.ts >= t && s.ts < t + b);
      if (live.length) { cov = live.reduce((a, s) => a + s.cov, 0) / live.length; mx = Math.max(...live.map((s) => s.cov)); }
      const an = starts.filter((e) => e.ts >= t && e.ts < t + b), crit = an.some((e) => e.severity === 'critical');
      const mode = live.length ? Math.max(...live.map((s) => s.mode)) : crit ? 3 : an.some((e) => e.severity === 'warning') ? 2 : an.length || levelOf(mx) ? 1 : 0;
      const day = dayFactor(localHour(t + b / 2));
      ts.push(t); o.coverage.push(+cov.toFixed(4)); o.coverage_max.push(+mx.toFixed(4)); o.level.push(levelOf(mx)); o.trash.push(+(cov * 70).toFixed(1));
      o.person.push(an.filter((e) => e.cls === 'manusia').length); o.other.push(an.filter((e) => e.cls !== 'manusia').length);
      o.fps.push(+(POLICY[MODES[mode]].grab * (0.97 + hash(t) * 0.05)).toFixed(2)); o.infer_ms.push(+(20 + hash(t + 3) * 3).toFixed(1)); o.luma.push(+(30 + 105 * day).toFixed(1));
      o.night.push(day < 0.35 ? 1 : 0); o.mode.push(mode); o.anomalies.push(an.length); o.n.push(Math.round(b / 5));
    }
    return o;
  }
  summary(range) {
    const span = spanOf(range), to = this.now(), from = to - span, s = this.series(from, to, Math.max(60, span / 240)), b = s.bucket;
    const tl = [0, 0, 0, 0], mt = { low: 0, normal: 0, high: 0, max: 0 }; let sum = 0, peak = 0, frames = 0;
    s.ts.forEach((_, i) => { tl[s.level[i]] += b; mt[MODES[s.mode[i]]] += b; sum += s.coverage[i]; peak = Math.max(peak, s.coverage_max[i]); frames += POLICY[MODES[s.mode[i]]].infer * b; });
    const ev = this.events.filter((e) => e.ts >= from), cnt = (f) => ev.reduce((m, e) => { const k = f(e); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
    const starts = ev.filter((e) => e.kind === 'anomaly_start'), byCat = (c) => starts.filter((e) => CLS_CAT[e.cls] === c).length;
    const avg = s.ts.length ? sum / s.ts.length : 0, hours = Array.from({ length: 24 }, (_, hh) => ({ hour: hh, avg_cov: 0, anomalies: 0, n: 0 }));
    s.ts.forEach((t, i) => { const hh = Math.floor(localHour(t)); hours[hh].avg_cov += s.coverage[i]; hours[hh].n++; });
    starts.forEach((e) => { hours[Math.floor(localHour(e.ts))].anomalies++; });
    return { range, from, to, frames: Math.round(frames), avg_coverage: +avg.toFixed(4), peak_coverage: +peak.toFixed(4), time_in_level_s: tl.map((v) => +v.toFixed(1)), mode_time_s: mt,
      events_by_type: cnt((e) => e.type), events_by_kind: cnt((e) => e.kind), events_by_severity: cnt((e) => e.severity), anomalies_by_kind: starts.reduce((m, e) => { const k = e.meta.anomaly_kind; m[k] = (m[k] || 0) + 1; return m; }, {}),
      objects_by_class: { trash: Math.round((s.trash.reduce((a, v) => a + v, 0) / Math.max(1, s.trash.length)) * (span / 600)), person: byCat('person'), other: starts.length - byCat('person') },
      hourly: hours.map((x) => ({ hour: x.hour, avg_cov: +(x.n ? x.avg_cov / x.n : 0).toFixed(4), anomalies: x.anomalies })), storage: this.storage() };
  }
  storage() {
    const s = this.series(this.now() - 48 * 3600, this.now(), 1800), b = s.bucket, avgB = 23000;
    let w = 0; s.ts.forEach((_, i) => { w += POLICY[MODES[s.mode[i]]].record * b * avgB; });
    const base = 48 * 3600 * 15 * avgB, ev = Math.round(w * 0.45), tl = Math.round(w * 0.5), sn = Math.round(w * 0.04), rv = Math.round(w * 0.01), tot = tl + ev + sn + rv;
    return { disk: { free_gb: 52.9, total_gb: 64, used_pct: 17.3 }, usage_bytes: { timelapse: tl, events: ev, snapshots: sn, review: rv, total: tot }, files: { timelapse: Math.round(tl / avgB), events: Math.round(ev / 400000), snapshots: Math.round(sn / 90000), review: Math.round(rv / 90000) },
      quota_gb: 20, min_free_gb: 2, over_quota: false, retention: { timelapse_days: 7, event_days: 90, max_gb: 20, min_free_gb: 2, protect_unacked: true }, written_bytes: { timelapse: tl, events: ev, snapshots: sn, review: rv, total: tot },
      saved_pct: +(100 * (1 - w / base)).toFixed(1), baseline_bytes_est: base, baseline_fps: 15, avg_frame_bytes: avgB, bytes_per_day_est: Math.round(w / 2), days_left: Math.round((20e9 - tot) / (w / 2)), dropped_writes: 0, review_items: 0, elapsed_s: 48 * 3600 };
  }

  // ====================================================================== telemetri dan kesehatan
  tele(ts = this.now()) {
    const t = teleAt(ts, this.boot), f = this.faults, up = (k) => f[k] && f[k] > this.real0 + (Date.now() / 1000 - this.real0), live = Date.now() / 1000;
    const on = (k) => f[k] && f[k] > live, avail = {};
    if (on('overheat')) { t.cpu_temp_c += 30; t.enclosure_temp_c += 22; }
    if (on('low_voltage')) { t.supply_v = 10.4; t.power_w = t.supply_v * t.supply_a; }
    if (on('weak_signal')) { t.net_rssi_dbm = -88; t.net_latency_ms = 480; }
    if (on('high_load')) { t.cpu_load_pct = 97; t.ram_pct = 91; }
    if (on('disk_full')) t.disk_free_gb = 1.4;
    if (on('flood') || this.rainUntil > live) t.water_level_cm += on('flood') ? 90 : 30;
    if (this.rainUntil > live) { t.enclosure_humidity_pct = Math.min(99, t.enclosure_humidity_pct + 14); t.net_rssi_dbm -= 6; }
    Object.keys(t).forEach((k) => { avail[k] = t[k] != null; });
    if (on('sensor_lost')) { t.enclosure_temp_c = null; t.enclosure_humidity_pct = null; avail.enclosure_temp_c = avail.enclosure_humidity_pct = false; }
    Object.keys(t).forEach((k) => { if (typeof t[k] === 'number') t[k] = +t[k].toFixed(2); });
    return Object.assign({ ts: +ts.toFixed(3), available: avail, faults: Object.fromEntries(Object.keys(f).filter(on).map((k) => [k, FAULTS[k]])) }, t);
  }
  healthDetail() {
    const t = this.tele(), checks = [];
    const add = (key, label, group, status, value, unit, detail) => checks.push({ key, label, group, group_label: GROUPS[group], status, value, unit, detail });
    const th = (v, w, c, hi = true) => (v == null ? 'na' : (hi ? v >= c : v <= c) ? 'crit' : (hi ? v >= w : v <= w) ? 'warn' : 'ok');
    const d = (st, ok, bad) => (st === 'na' ? 'Sensor tidak tersedia' : st === 'ok' ? ok : bad);
    add('frame_age', 'Umur bingkai terakhir', 'camera', this.ctl.paused ? 'warn' : 'ok', 0.1, 'dtk', this.ctl.paused ? 'Pemantauan dijeda oleh operator' : 'Kamera tiruan mengirim gambar');
    add('camera_link', 'Sambungan kamera', 'camera', 'ok', null, '', 'Sumber: kamera tiruan di peramban');
    add('lens', 'Kualitas gambar / lensa', 'camera', 'ok', 0, '', 'Gambar jernih');
    add('infer', 'Kecepatan model (kapasitas)', 'model', 'ok', 8.6, 'ms', 'Kapasitas 116 fps untuk target 1 fps');
    add('detector', 'Galat model', 'model', 'ok', 0, '', 'Tidak ada galat');
    add('model_kind', 'Jenis model', 'model', 'ok', null, '', 'Detektor TIRUAN (mode demo), bukan YOLO');
    const s1 = th(t.cpu_temp_c, 70, 80); add('cpu_temp', 'Suhu prosesor', 'system', s1, t.cpu_temp_c, '°C', d(s1, 'Normal', 'Terlalu panas: cek ventilasi dan kipas'));
    const s2 = th(t.cpu_load_pct, 85, 95); add('cpu_load', 'Beban prosesor', 'system', s2, t.cpu_load_pct, '%', d(s2, 'Normal', 'Beban terlalu tinggi'));
    const s3 = th(t.ram_pct, 85, 95); add('ram', 'Memori', 'system', s3, t.ram_pct, '%', d(s3, 'Normal', 'Memori hampir penuh'));
    const free = (t.disk_free_gb / t.disk_total_gb) * 100, s4 = th(free, 15, 7, false); add('disk', 'Ruang disk bebas', 'system', s4, +free.toFixed(2), '%', `${t.disk_free_gb.toFixed(1)} GB bebas`);
    const s5 = th(t.supply_v, 11.5, 10.8, false); add('supply', 'Tegangan catu daya', 'system', s5, t.supply_v, 'V', d(s5, 'Normal', 'Tegangan turun: cek adaptor atau kabel'));
    const s6 = th(t.enclosure_temp_c, 50, 60); add('enclosure_temp', 'Suhu dalam boks', 'system', s6, t.enclosure_temp_c, '°C', d(s6, 'Normal', 'Boks terlalu panas'));
    const s7 = th(t.enclosure_humidity_pct, 85, 95); add('humidity', 'Kelembapan dalam boks', 'system', s7, t.enclosure_humidity_pct, '%', d(s7, 'Normal', 'Kelembapan tinggi: cek penutup boks'));
    const s8 = th(t.net_rssi_dbm, -75, -85, false); add('rssi', 'Kekuatan sinyal', 'network', s8, t.net_rssi_dbm, 'dBm', d(s8, 'Baik', 'Sinyal lemah'));
    const s9 = th(t.net_latency_ms, 150, 400); add('latency', 'Latensi jaringan', 'network', s9, t.net_latency_ms, 'ms', d(s9, 'Normal', 'Jaringan lambat'));
    add('database', 'Basis data riwayat', 'storage', 'ok', 0, '', 'Normal');
    add('notifier', 'Notifikasi Telegram', 'notify', 'na', null, '', 'Belum diaktifkan');
    let score = 100; checks.forEach((c) => { score -= c.status === 'crit' ? 18 : c.status === 'warn' ? 6 : 0; });
    score = Math.max(0, Math.round(score));
    const crit = checks.some((c) => c.status === 'crit'), warn = checks.some((c) => c.status === 'warn');
    const status = crit || score < 55 ? 'crit' : warn || score < 85 ? 'warn' : 'ok';
    return { score, status, summary: status === 'ok' ? 'Semua sistem normal' : status === 'warn' ? 'Perlu perhatian' : 'Ada masalah serius', checks, issues: checks.filter((c) => c.status === 'warn' || c.status === 'crit').map((c) => c.key), ts: +this.now().toFixed(3) };
  }

  // ====================================================================== kontrol
  controlState() { const c = clone(this.ctl); c.muted_until = this.ctl.muted_until && this.ctl.muted_until > this.now() ? this.ctl.muted_until : null; c.live_boost_until = this.ctl.live_boost_until && this.ctl.live_boost_until > this.now() ? this.ctl.live_boost_until : null; return c; }
  applyControl(patch) {
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) throw new ApiError(400, 'patch kontrol harus berupa objek JSON yang tidak kosong', 'bad_control');
    const keys = ['fps_mode', 'fps_manual', 'live_boost', 'night_mode', 'enhance', 'lamp', 'recording', 'detector_conf', 'zone', 'levels', 'muted_minutes', 'paused', 'snapshot', 'ack', 'restart', 'mark_event'];
    const bad = Object.keys(patch).filter((k) => !keys.includes(k)); if (bad.length) throw new ApiError(400, `kunci kontrol tidak dikenal: ${bad.join(', ')}`, 'bad_control');
    const pick = (k, list) => { if (!list.includes(patch[k])) throw new ApiError(400, `${k} harus salah satu dari: ${list.join(', ')}`, 'bad_control'); return patch[k]; };
    const num = (k, v, lo, hi) => { const x = Number(v); if (!isFinite(x) || x < lo || x > hi) throw new ApiError(400, `${k} harus angka antara ${lo} dan ${hi}`, 'bad_control'); return x; };
    const ok = {};
    if ('fps_mode' in patch) ok.fps_mode = pick('fps_mode', ['auto', ...MODES]);
    if ('fps_manual' in patch) ok.fps_manual = [null, 0, false].includes(patch.fps_manual) ? null : num('fps_manual', patch.fps_manual, 1, 30);
    if ('live_boost' in patch) { const v = patch.live_boost; ok.live_boost = v === false || v === 0 ? 0 : v === true ? 120 : num('live_boost', v, 5, 900); }
    if ('night_mode' in patch) ok.night_mode = pick('night_mode', ['auto', 'day', 'night']);
    ['enhance', 'lamp', 'recording'].forEach((k) => { if (k in patch) ok[k] = pick(k, ['auto', 'on', 'off']); });
    if ('detector_conf' in patch) ok.detector_conf = num('detector_conf', patch.detector_conf, 0.05, 0.95);
    if ('zone' in patch) {
      const z = patch.zone; if (!Array.isArray(z) || z.length < 3 || z.length > 24) throw new ApiError(400, 'zona harus berupa daftar 3 sampai 24 titik [x, y]', 'bad_control');
      ok.zone = z.map((p) => { if (!Array.isArray(p) || p.length !== 2) throw new ApiError(400, 'setiap titik zona harus [x, y]', 'bad_control'); return [num('koordinat zona', p[0], 0, 1), num('koordinat zona', p[1], 0, 1)]; });
      if (polyArea(ok.zone) < 0.01) throw new ApiError(400, 'zona terlalu kecil atau garis lurus (luas minimal 1% dari gambar)', 'bad_control');
    }
    if ('levels' in patch) {
      const l = Object.assign({}, this.ctl.levels, patch.levels), w = num('waspada', l.waspada, 0.001, 1), p = num('peringatan', l.peringatan, 0.001, 1), k = num('kritis', l.kritis, 0.001, 1);
      if (!(w < p && p < k)) throw new ApiError(400, 'ambang harus naik: waspada < peringatan < kritis (maksimal 100%)', 'bad_control');
      ok.levels = { waspada: w, peringatan: p, kritis: k, hold_s: num('hold_s', l.hold_s, 0, 7200), clear_s: num('clear_s', l.clear_s, 0, 7200) };
    }
    if ('muted_minutes' in patch) ok.muted_minutes = num('muted_minutes', patch.muted_minutes, 0, 1440);
    if ('paused' in patch) { if (typeof patch.paused !== 'boolean') throw new ApiError(400, 'paused harus true atau false', 'bad_control'); ok.paused = patch.paused; }
    ['snapshot', 'ack', 'restart'].forEach((k) => { if (k in patch) { if (patch[k] !== true) throw new ApiError(400, `${k} hanya boleh true`, 'bad_control'); ok[k] = true; } });
    if ('mark_event' in patch) { const t = String(patch.mark_event || '').trim(); if (!t) throw new ApiError(400, 'catatan penanda tidak boleh kosong', 'bad_control'); ok.mark_event = t.slice(0, 80); }
    const now = this.now(), c = this.ctl;
    ['fps_mode', 'fps_manual', 'night_mode', 'enhance', 'lamp', 'recording', 'detector_conf', 'zone', 'levels', 'paused'].forEach((k) => { if (k in ok) c[k] = ok[k]; });
    if ('live_boost' in ok) c.live_boost_until = ok.live_boost ? now + ok.live_boost : null;
    if ('muted_minutes' in ok) c.muted_until = ok.muted_minutes > 0 ? now + ok.muted_minutes * 60 : null;
    if (ok.restart) { c.fps_mode = 'auto'; c.fps_manual = null; c.live_boost_until = null; this.lv = { level: 0, since: now, pend: null, acked: false }; this.active.clear(); }
    if (ok.ack) { this.lv.acked = true; c.alert_ack = true; this.events.forEach((e) => { if (!e.ack && e.ts > now - 12 * 3600) { e.ack = true; this.cb && this.cb('event', clone(e)); } }); }
    if (ok.snapshot) this.push(this.ev(now, 'system', 'snapshot', 'info', 'Foto diambil', 'Dari tombol kontrol', { media: { snapshot: 'demo' } }));
    if (ok.mark_event) this.push(this.ev(now, 'system', 'manual', 'info', ok.mark_event, 'Ditandai manual', { meta: { demo: true, actor: 'demo' } }));
    this.log.unshift({ id: this.log.length + 1, ts: +now.toFixed(3), actor: 'demo', patch: clone(ok), ok: true, result: '' }); this.log = this.log.slice(0, 100);
    this.push(this.ev(now, 'system', 'control', 'info', 'Perintah kontrol', Object.keys(ok).join(', '), { meta: { demo: true, actor: 'demo' } }), true);
    this.cb && this.cb('control', this.controlState());
    return { control: this.controlState(), applied: ok };
  }
  push(e, quiet) { this.events.unshift(e); this.events.sort((a, b) => b.ts - a.ts); if (this.events.length > 800) this.events.length = 800; if (!quiet && this.cb) this.cb('event', clone(e)); return e; }

  // ====================================================================== permintaan
  async get(path, params) {
    const u = new URL(path, 'http://demo'); const q = Object.assign(Object.fromEntries(u.searchParams), params || {}); const p = u.pathname;
    const n = this.now();
    if (p === '/api/node') return clone(this.node);
    if (p === '/api/health') return { ok: true, version: '1.0.0-demo', uptime_s: n - this.real0, node: 'rw-01', running: true, mode: 'demo' };
    if (p === '/api/control') return { control: this.controlState() };
    if (p === '/api/control/log') return { log: clone(this.log.slice(0, +q.limit || 50)) };
    if (p === '/api/history/summary') return this.summary(q.range || '24h');
    if (p === '/api/history/metrics') { const span = spanOf(q.range || '24h'); return this.series(n - span, n, +q.bucket || span / 120); }
    if (p === '/api/telemetry/latest') { const d = this.healthDetail(); return { telemetry: this.tele(), health: { score: d.score, status: d.status, summary: d.summary, issues: d.issues, ts: d.ts } }; }
    if (p === '/api/telemetry') {
      const span = spanOf(q.range || '1h'), b = Math.max(30, +q.bucket || span / 90), ts = [], o = { from: n - span, to: n, bucket: b, ts };
      for (let t = Math.ceil((n - span) / b) * b; t <= n; t += b) { ts.push(t); const v = teleAt(t, this.boot); Object.keys(v).forEach((k) => { (o[k] = o[k] || []).push(v[k] == null ? null : +v[k].toFixed(2)); }); }
      return o;
    }
    if (p === '/api/health/detail') return this.healthDetail();
    if (p === '/api/storage') return this.storage();
    if (p === '/api/events') {
      let l = this.events; if (q.kind) l = l.filter((e) => e.type === q.kind || e.kind === q.kind); if (q.before) l = l.filter((e) => e.ts < +q.before);
      const lim = clamp(+q.limit || 50, 1, 500), out = l.slice(0, lim); return { events: clone(out), next_before: out.length === lim ? out[out.length - 1].ts : null, count: out.length };
    }
    let m = /^\/api\/events\/([^/]+)$/.exec(p);
    if (m) { const e = this.events.find((x) => x.id === decodeURIComponent(m[1])); if (!e) throw new ApiError(404, 'Kejadian tidak ditemukan.', 'not_found'); return Object.assign(clone(e), { frames: await this.evidence(e) }); }
    throw new ApiError(404, 'Endpoint tidak ada di mode demo.', 'not_found');
  }
  async post(path, body = {}) {
    const p = new URL(path, 'http://demo').pathname;
    if (p === '/api/control') return this.applyControl(body);
    let m = /^\/api\/events\/([^/]+)\/ack$/.exec(p);
    if (m) { const e = this.events.find((x) => x.id === decodeURIComponent(m[1])); if (!e) throw new ApiError(404, 'Kejadian tidak ditemukan.', 'not_found'); e.ack = true; this.lv.acked = true; this.cb && this.cb('event', clone(e)); return { event: clone(e), alert_confirmed: true, control: this.controlState() }; }
    if (/^\/api\/events\/[^/]+\/mp4$/.test(p)) throw new ApiError(503, 'Membuat MP4 butuh server Riverwatch dengan ffmpeg. Tidak tersedia di mode demo.', 'no_ffmpeg');
    if (p === '/api/notify/test') throw new ApiError(503, 'Notifikasi tidak tersedia di mode demo.', 'no_notifier');
    if (p === '/api/sim') return this.sim(body);
    throw new ApiError(404, 'Endpoint tidak ada di mode demo.', 'not_found');
  }

  // ====================================================================== simulasi
  sim(b) {
    const a = String(b.action || ''), now = this.now(), live = Date.now() / 1000;
    if (a === 'fault') { if (!FAULTS[b.kind]) throw new ApiError(400, `gangguan tidak dikenal: ${b.kind}`, 'bad_sim'); this.faults[b.kind] = live + (+b.duration_s || 120); return { ok: true, faults: {} }; }
    if (a === 'clear_faults') { this.faults = {}; this.rainUntil = 0; return { ok: true, faults: {} }; }
    if (a === 'rain') { this.rainUntil = live + (+b.duration_s || 600); return { ok: true, faults: {} }; }
    if (!SIM_ACTIONS.includes(a)) throw new ApiError(400, `aksi simulasi tidak dikenal: ${a}`, 'bad_sim');
    if (a === 'trash_level') this.cov.target = b.coverage != null ? clamp(+b.coverage, 0, 0.6) : LEVEL_COV[clamp(b.level | 0, 0, 3)];
    else if (a === 'clear_trash') this.cov.target = 0.03;
    else if (a === 'hour') { const hr = clamp(+b.hour || 0, 0, 23.99), cur = localHour(live); this.shift = Math.round((hr - cur) * 3600); this.liveHist = []; }
    else this.spawn(a, b);
    return { ok: true, action: a, args: {} };
  }
  spawn(kind, b = {}) {
    const r = rnd((Date.now() & 0xffff) + this.oid), id = this.oid++, t = this.now();
    const base = (cls, o) => Object.assign({ id, cls, x: 0.5, y: 0.7, w: KIND_STYLE[cls].w, h: KIND_STYLE[cls].h, vx: 0, vy: 0, seed: id, phase: r() * 6.28, born: t, until: t + 30, pose: '' }, o);
    if (kind === 'person_fall') this.objs.push(base('manusia', { x: 0.3 + r() * 0.35, y: 0.33, vx: -0.012, fall: { t0: t, y1: 0.62 + r() * 0.06 }, until: t + 45, pose: 'walk' }));
    else if (kind === 'person_swim') { const left = b.side !== 'right'; this.objs.push(base('manusia', { x: left ? 0.12 : 0.85, y: 0.6 + r() * 0.18, vx: left ? 0.06 : -0.06, until: t + 25, pose: 'swim' })); }
    else if (kind === 'person_walk') this.objs.push(base('manusia', { x: 0.08, y: 0.335, vx: 0.04, until: t + 26, pose: 'walk' }));
    else if (kind === 'boat') { const left = b.side !== 'right'; this.objs.push(base('perahu', { x: left ? -0.12 : 1.12, y: 0.62, vx: left ? 0.08 : -0.08, until: t + 22 })); }
    else if (kind === 'animal') this.objs.push(base('hewan', { x: 0.86, y: 0.62 + r() * 0.16, vx: -0.05, until: t + 20, pose: 'swim' }));
    else if (kind === 'vehicle') this.objs.push(base('kendaraan', { x: 0.45, y: 0.72, until: t + 40 }));
    else if (kind === 'odd') this.objs.push(base('objek_lain', { x: 0.92, y: 0.66, vx: -0.13, until: t + 14 }));
  }
  scenario(dt) {
    this.scnT += dt;
    const S = [[8, () => this.spawn('boat')], [30, () => this.spawn('person_walk')], [58, () => this.spawn('person_fall')], [105, () => { this.cov.target = LEVEL_COV[2]; }], [135, () => { this.cov.target = LEVEL_COV[3]; }], [175, () => this.spawn('animal')],
      [205, () => { this.cov.target = 0.03; }], [236, () => this.spawn('odd')], [262, () => this.spawn('boat', { side: 'right' })]];
    while (this.scnI < S.length && this.scnT >= S[this.scnI][0]) S[this.scnI++][1]();
    if (this.scnT > 300) { this.scnT = 0; this.scnI = 0; }
  }

  // ====================================================================== kejadian bukti
  async evidence(e) {
    if (!(e.media && (e.media.frames || e.media.snapshot))) return [];
    if (this.evFrames.has(e.id)) return this.evFrames.get(e.id);
    const kind = (e.meta && e.meta.anomaly_kind) || null, r = rnd(Math.floor(e.ts) + 11), t0 = e.ts, hr = localHour(e.ts), day = dayFactor(hr), cov = e.coverage != null ? e.coverage : covAt(e.ts);
    const out = [], ms = [-1500, -800, 0, 700, 1500, 2300], sc = this.evRender;
    const trash = this.trashObjs(cov, Math.floor(e.ts), 0.1);
    const x0 = 0.3 + r() * 0.35;
    for (let i = 0; i < ms.length; i++) {
      const k = i / (ms.length - 1), objs = trash.map((o) => Object.assign({}, o, { x: o.x - k * 0.01 }));
      const add = (cls, o) => objs.push(Object.assign({ id: 9000 + i, cls, x: 0.5, y: 0.7, w: KIND_STYLE[cls].w, h: KIND_STYLE[cls].h, seed: Math.floor(e.ts), phase: 0 }, o));
      if (kind === 'fall_suspect') add('manusia', { x: x0, y: lerp(0.34, 0.63, clamp(k * 1.5, 0, 1)), pose: k > 0.7 ? 'swim' : 'walk' });
      else if (kind === 'person_in_water') add('manusia', { x: x0 + k * 0.08, y: 0.66, pose: 'swim' });
      else if (kind === 'person_near_water') add('manusia', { x: 0.2 + k * 0.4, y: 0.335, pose: 'walk', phase: k * 12 });
      else if (kind === 'vessel') add('perahu', { x: 0.1 + k * 0.8, y: 0.62 });
      else if (kind === 'animal_in_water') add('hewan', { x: 0.8 - k * 0.3, y: 0.7, pose: 'swim' });
      else if (kind === 'vehicle_in_water') add('kendaraan', { x: 0.45, y: 0.72 });
      else if (kind === 'large_object') add('kayu_batang', { x: 0.75 - k * 0.2, y: 0.68 });
      else if (kind) add('objek_lain', { x: 0.85 - k * 0.5, y: 0.66 });
      sc.render(objs, { day, ir: day < 0.25, t: t0 + ms[i] / 1000, lamp: day < 0.5, noise: 0.6 });
      const blob = await (sc.canvas.convertToBlob ? sc.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 }) : new Promise((res) => sc.canvas.toBlob(res, 'image/jpeg', 0.72)));
      out.push({ n: i, ms: ms[i] + 1500, ts: +(t0 + ms[i] / 1000).toFixed(3), url: URL.createObjectURL(blob) });
    }
    this.evFrames.set(e.id, out);
    return out;
  }
  trashObjs(cov, seed, fade) {
    const r = rnd(seed), n = Math.round(5 + cov * 70), zoneA = 0.225, area = (cov * zoneA) / 0.9 / n, out = [];
    for (let i = 0; i < n; i++) { const cls = TRASH_MIX[Math.floor(r() * TRASH_MIX.length)], st = KIND_STYLE[cls], sc = clamp(Math.sqrt(area / (st.w * st.h)), 0.5, 2); out.push({ id: 500 + i, cls, x: 0.06 + r() * 0.88, y: 0.5 + r() * 0.43, w: st.w * sc, h: st.h * sc, seed: seed + i, phase: r() * 6.28 }); }
    return out;
  }

  // ====================================================================== simulasi waktu nyata
  ensureTrash(init) {
    const trash = this.objs.filter((o) => CLS_CAT[o.cls] === 'trash' && !o.leaving), want = Math.round(5 + this.cov.target * 70), t = this.now();
    const zoneA = Math.max(0.05, polyArea(this.ctl.zone));
    if (trash.length < want) {
      for (let i = trash.length; i < want; i++) {
        const cls = TRASH_MIX[Math.floor(Math.random() * TRASH_MIX.length)], st = KIND_STYLE[cls], sc = clamp(Math.sqrt(((this.cov.target * zoneA) / 0.9 / want) / (st.w * st.h)), 0.5, 2.1);
        const o = { id: this.oid++, cls, x: init ? 0.05 + Math.random() * 0.9 : 1.05 + Math.random() * 0.1, y: 0.5 + Math.random() * 0.43, w: st.w * sc, h: st.h * sc, vx: -(0.012 + Math.random() * 0.01), vy: (Math.random() - 0.5) * 0.002, seed: this.oid, phase: Math.random() * 6.28, born: t, until: Infinity, fade: init ? 1 : 0 };
        if (!init) o.x = 0.1 + Math.random() * 0.85;
        this.objs.push(o);
      }
    } else if (trash.length > want + 2) { trash.sort((a, b) => a.x - b.x).slice(0, trash.length - want).forEach((o) => { o.leaving = true; }); }
  }
  start(cb) {
    this.cb = cb; this.last = performance.now(); this.lastEmit = 0; this.lastTele = 0;
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 100);
    this.tick(true);
  }
  stop() { clearInterval(this.timer); this.cb = null; }

  tick(first) {
    const nowP = performance.now(), dt = Math.min(1, (nowP - this.last) / 1000); this.last = nowP;
    if (this.ctl.paused) { if (first) this.emitFrame(); return; }
    const t = this.now(), live = Date.now() / 1000;
    this.scenario(dt);
    this.cov.smooth = lerp(this.cov.smooth, this.cov.target, 1 - Math.exp(-dt / 12));
    // fisika objek
    const flow = -0.016;
    for (const o of this.objs) {
      if (o.fall) { const k = clamp((t - o.fall.t0) / 2.2, 0, 1); o.y = lerp(0.33, o.fall.y1, k * k); o.vy = k < 1 ? (o.fall.y1 - 0.33) / 2.2 : 0; if (k >= 1) { o.pose = 'swim'; o.vx = flow * 0.9; o.vy = 0; } }
      o.x += o.vx * dt; o.y = clamp(o.y + (o.fall ? 0 : o.vy * dt), 0.3, 0.97);
      if (CLS_CAT[o.cls] === 'trash') { o.vy += (Math.random() - 0.5) * 0.0006; o.vy = clamp(o.vy, -0.004, 0.004); if (o.fade != null && o.fade < 1 && !o.leaving) o.fade = Math.min(1, o.fade + dt / 3); if (o.leaving) { o.fade = Math.max(0, (o.fade == null ? 1 : o.fade) - dt / 3); } }
    }
    this.objs = this.objs.filter((o) => !(o.until < t) && !(o.leaving && o.fade <= 0) && o.x > -0.2 && o.x < 1.2 && !(o.cls !== 'objek_lain' && CLS_CAT[o.cls] === 'trash' && o.x < -0.1));
    if (Math.floor(t / 2) !== Math.floor((t - dt) / 2)) this.ensureTrash();
    // trash yang keluar di kiri diganti oleh yang baru dari kanan lewat ensureTrash
    const hr = localHour(t), day = dayFactor(hr), nm = this.ctl.night_mode, isNight = nm === 'night' ? true : nm === 'day' ? false : day < 0.35;
    if (isNight !== this.night) { this.night = isNight; this.push(this.ev(t, 'system', isNight ? 'night_on' : 'night_off', 'info', isNight ? 'Mode malam aktif' : 'Mode siang aktif', isNight ? 'Kecerahan turun; inframerah' : 'Kecerahan naik')); }
    this.updateBehavior(t);
    this.updateFps(t, dt);
    this.updateLevel(t);
    if (live - this.lastHist >= 5) { this.lastHist = live; this.liveHist.push({ ts: t, cov: this.cov.now || this.cov.smooth, mode: MODES.indexOf(this.fpsSt.mode) }); if (this.liveHist.length > 4000) this.liveHist.shift(); }
    // keluaran
    const pol = this.policy(t), interval = 1 / Math.max(0.5, pol.stream);
    if (first || t - this.lastEmit >= interval) { this.lastEmit = t; this.emitFrame(); }
    if (live - this.lastTele >= 3) { this.lastTele = live; this.emitTele(); }
    if (live - this.lastPing >= 10) { this.lastPing = live; this.cb && this.cb('ping', { now: +t.toFixed(3), viewers: 1 }); }
  }

  tracks(t) {
    const zone = this.ctl.zone, tr = [];
    for (const o of this.objs) {
      if (o.fade != null && o.fade < 0.15) continue;
      const cat = CLS_CAT[o.cls], inZ = polyContains(zone, o.x, o.y), near = !inZ && polyDist(zone, o.x, o.y) < 0.16, sp = Math.hypot(o.vx, o.vy), nightK = this.night ? 0.12 : 0;
      tr.push({ id: o.id, cls: o.cls, cat, score: +clamp(0.62 + hashf(o.id) * 0.3 - nightK, 0.3, 0.97).toFixed(3), box: [+(o.x - o.w / 2).toFixed(4), +(o.y - o.h).toFixed(4), +(o.x + o.w / 2).toFixed(4), +o.y.toFixed(4)], v: [+o.vx.toFixed(4), +o.vy.toFixed(4)], speed: +sp.toFixed(4), speed_unit: 'norm',
        rel_speed: +(sp / 0.016).toFixed(3), along_flow: o.vx < 0 ? 0.95 : -0.95, heading: +((Math.atan2(o.vy, o.vx) * 180) / Math.PI).toFixed(1), age: +(t - o.born).toFixed(2), hits: Math.max(1, Math.round((t - o.born) * 2)), state: 'confirmed', src: 'yolo', in_zone: inZ, near_zone: near,
        size_frac: +(o.w * o.h).toFixed(4), predicted: false, anomaly: null, _o: o });
    }
    return tr;
  }
  updateBehavior(t) {
    const tr = this.tracks(t), seen = new Set(); let area = 0; const zoneA = Math.max(0.05, polyArea(this.ctl.zone));
    for (const k of tr) {
      const o = k._o; let kind = null;
      if (k.cat === 'trash' && k.in_zone) area += (o.w * o.h) * (o.fade == null ? 1 : o.fade);
      if (o.fall && !k.in_zone && o.y < 0.6) kind = 'fall_suspect';
      else if (k.cat === 'person') kind = k.in_zone ? 'person_in_water' : k.near_zone ? 'person_near_water' : null;
      else if (k.cat === 'vehicle') kind = k.in_zone ? 'vehicle_in_water' : null;
      else if (k.cat === 'animal') kind = k.in_zone ? 'animal_in_water' : null;
      else if (k.cat === 'vessel') kind = k.in_zone ? 'vessel' : null;
      else if (k.cat === 'unknown') kind = k.speed > 0.1 ? 'fast_object' : 'unknown_object';
      if (kind) {
        const key = `${o.id}:${kind}`; seen.add(key); k.anomaly = { kind, severity: KIND_SEV[kind], label: KINDS[kind], score: k.score, since: 0 };
        if (!this.active.has(key)) { const e = this.push(this.ev(t, 'anomaly', 'anomaly_start', KIND_SEV[kind], KINDS[kind], 'Terdeteksi dan dilacak', { cls: o.cls, track_id: o.id, level: this.lv.level, coverage: +this.cov.smooth.toFixed(3), media: { frames: 6 }, meta: { anomaly_kind: kind, demo: true, score: k.score, in_zone: k.in_zone, speed: k.speed, box: k.box } })); this.active.set(key, { since: t, kind, id: o.id, cls: o.cls, ev: e }); if (KIND_SEV[kind] !== 'info') this.lv.acked = false; }
        k.anomaly.since = this.active.get(key).since;
      }
    }
    for (const [key, a] of this.active) if (!seen.has(key) && t - a.since > 0.5) { this.active.delete(key); const dur = Math.round(t - a.since); this.push(this.ev(t, 'anomaly', 'anomaly_end', 'info', `${KINDS[a.kind]} selesai`, `Berlangsung ${dur} detik`, { cls: a.cls, track_id: a.id, meta: { anomaly_kind: a.kind, duration_s: dur, demo: true } })); }
    this.cov.now = clamp((area / zoneA / 0.9) * (0.96 + 0.08 * Math.random()), 0, 0.7); this.cur = tr;
  }
  policy(t) {
    const c = this.ctl, st = this.fpsSt;
    if (c.live_boost_until && c.live_boost_until > t) return Object.assign({}, POLICY.max, { _m: 'max', _src: 'boost', _why: 'Pantau langsung diminta operator' });
    if (c.fps_manual) { const f = c.fps_manual; return { grab: f, infer: f, record: f / 2, stream: Math.min(f, 15), label: 'Manual', _m: 'normal', _src: 'manual', _why: 'FPS manual dari operator' }; }
    if (c.fps_mode !== 'auto') return Object.assign({}, POLICY[c.fps_mode], { _m: c.fps_mode, _src: 'manual', _why: 'Dipilih operator' });
    return Object.assign({}, POLICY[st.mode], { _m: st.mode, _src: 'auto', _why: st.reason });
  }
  updateFps(t, dt) {
    const an = [...this.active.values()], sev = (a) => KIND_SEV[a.kind];
    let want = 'low', why = 'Hanya sampah lambat atau sepi';
    if (an.some((a) => sev(a) === 'critical')) { want = 'max'; why = `Anomali kritis: ${KINDS[an.find((a) => sev(a) === 'critical').kind].toLowerCase()}`; }
    else if (an.some((a) => sev(a) === 'warning')) { want = 'high'; why = `Anomali: ${KINDS[an.find((a) => sev(a) === 'warning').kind].toLowerCase()}`; }
    else if (an.length || this.objs.some((o) => CLS_CAT[o.cls] !== 'trash')) { want = 'normal'; why = 'Ada benda non-sampah melintas'; }
    else if (this.lv.level >= 2) { want = 'normal'; why = 'Tingkat siaga tinggi: pantau lebih sering'; }
    const st = this.fpsSt, rank = (m) => MODES.indexOf(m);
    if (rank(want) >= rank(st.mode)) { if (want !== st.mode) { st.mode = want; this.modeEv(t, want, why); } st.until = t + (want === 'low' ? 0 : 14); st.reason = why; }
    else if (t > st.until) { const nm = MODES[rank(st.mode) - 1]; st.mode = nm; st.until = t + 8; st.reason = rank(want) < rank(nm) ? 'Menurunkan FPS bertahap setelah kejadian selesai' : why; this.modeEv(t, nm, st.reason); }
    this.modeTime[st.mode] += dt;
  }
  modeEv(t, m, why) { if (this.ctl.fps_mode === 'auto' && !this.ctl.fps_manual) this.push(this.ev(t, 'system', 'fps_mode', 'info', `FPS ${MODE_LABEL[m]}`, why)); }
  updateLevel(t) {
    const c = this.cov.smooth, L = this.lv, cl = Object.assign({}, this.ctl.levels);
    const covLv = c >= cl.kritis ? 3 : c >= cl.peringatan ? 2 : c >= cl.waspada ? 1 : 0;
    let an = 0; for (const a of this.active.values()) an = Math.max(an, KIND_SEV[a.kind] === 'critical' ? 3 : KIND_SEV[a.kind] === 'warning' ? 1 : 0);
    const target = Math.max(covLv, an), hold = Math.min(25, cl.clear_s || 0);
    if (target > L.level) { L.level = target; L.since = t; L.pend = null; L.acked = false; const cv = +c.toFixed(3); this.push(this.ev(t, 'level', 'level_up', target === 3 ? 'critical' : target === 2 ? 'warning' : 'info', `Tingkat naik ke ${LEVEL_NAMES[target]}`, `Tutupan ${(c * 100).toFixed(1)}%${an ? '; ada anomali' : ''}`, { level: target, coverage: cv, media: { frames: 6 }, meta: { demo: true } })); }
    else if (target < L.level) { if (L.pend == null) L.pend = t; if (t - L.pend >= hold) { L.level = target; L.since = t; L.pend = null; this.push(this.ev(t, 'level', 'level_down', 'info', `Tingkat turun ke ${LEVEL_NAMES[target]}`, `Tutupan ${(c * 100).toFixed(1)}%`, { level: target, coverage: +c.toFixed(3) })); } }
    else L.pend = null;
  }

  frameData(t) {
    const pol = this.policy(t), tr = this.cur || [], c = this.cov.now ?? this.cov.smooth, hr = localHour(t), day = dayFactor(hr);
    const nm = this.ctl.night_mode, isNight = nm === 'night' ? true : nm === 'day' ? false : day < 0.35, lampOn = this.ctl.lamp === 'on' || (this.ctl.lamp !== 'off' && isNight); this.ctl.lamp_on = lampOn;
    const byClass = {}, byCat = {}; tr.forEach((k) => { byClass[k.cls] = (byClass[k.cls] || 0) + 1; byCat[k.cat] = (byCat[k.cat] || 0) + 1; });
    const anomalies = tr.filter((k) => k.anomaly).map((k) => ({ track_id: k.id, kind: k.anomaly.kind, severity: k.anomaly.severity, since: +k.anomaly.since.toFixed(2), label: k.anomaly.label, score: k.score }));
    this.frames++;
    const luma = clamp(30 + 105 * day + (lampOn ? 14 : 0), 0, 255);
    return { type: 'frame', v: 1, node: 'rw-01', frame_id: this.frames, ts: +t.toFixed(3), size: [640, 360], mode: pol._m, mode_source: pol._src, mode_reason: pol._why, fps: { target: pol.grab, actual: +(pol.grab * (0.97 + Math.random() * 0.05)).toFixed(2), grab: pol.grab, infer: pol.infer, record: pol.record, stream: pol.stream },
      infer_ms: +(18 + Math.random() * 4).toFixed(1), night: { is_night: isNight, ir: isNight && this.ctl.lamp !== 'on' && day < 0.25, luma: +luma.toFixed(1), chroma: +(day * 18).toFixed(1), confidence: 1, solar_elevation: +(Math.cos(((hr - 12) * Math.PI) / 12) * 50 - 8).toFixed(1), forced: nm, enhanced: this.ctl.enhance !== 'off' && isNight, gain: isNight ? 2.2 : 1, lamp_on: lampOn },
      coverage: +c.toFixed(4), coverage_smooth: +this.cov.smooth.toFixed(4), level: this.lv.level, level_name: LEVEL_NAMES[this.lv.level], level_since: +this.lv.since.toFixed(2), counts: { by_class: byClass, by_category: byCat, total: tr.length },
      tracks: tr.map((k) => { const { _o, ...rest } = k; return rest; }), anomalies, alert: { level: this.lv.level, acked: this.lv.acked, muted: !!(this.ctl.muted_until && this.ctl.muted_until > t) },
      quality: { sharpness: 0.5, contrast: 16, luma: +luma.toFixed(1), noise: isNight ? 4.2 : 1.6, issues: [], ok: true, labels: [] }, motion: { score: 0.2, trigger: false, global_change: false, flow: [-1, 0], flow_speed: 0.016, flow_conf: 0.6, blobs: tr.length },
      detector: { backend: 'demo', conf: this.ctl.detector_conf, fresh: true, count: tr.length, errors: 0, latency_ms: 18 }, recording: { active: pol._m !== 'low', event_id: null, mode: this.ctl.recording } };
  }
  emitFrame() {
    if (!this.cb) return;
    const t = this.now(), f = this.frameData(t);
    if (!document.hidden) {
      const day = dayFactor(localHour(t)), objs = this.objs.filter((o) => o.fade == null || o.fade > 0.02).map((o) => Object.assign({}, o, { fade: o.fade == null ? 1 : o.fade }));
      this.render.render(objs, { day: f.night.is_night ? Math.min(day, 0.3) : Math.max(day, 0.6), ir: f.night.ir, t, rain: this.rainUntil > Date.now() / 1000, lamp: f.night.lamp_on, noise: f.night.is_night ? 0.7 : 0.2 });
      const c = this.render.canvas; this.imgs.set(f.frame_id, createImageBitmap(c));
      if (this.imgs.size > 6) this.imgs.delete(this.imgs.keys().next().value);
    }
    this.lastFrame = f.frame_id;
    this.cb('frame', f);
  }
  emitTele() {
    const d = this.healthDetail(), prev = this.heal.status;
    if (d.status !== prev) { this.heal.status = d.status; const bad = d.checks.filter((c) => c.status === 'warn' || c.status === 'crit').map((c) => c.label).join(', '); this.push(this.ev(this.now(), 'health', d.status === 'ok' ? 'health_ok' : d.status === 'crit' ? 'health_crit' : 'health_warn', d.status === 'ok' ? 'info' : d.status === 'crit' ? 'critical' : 'warning', d.status === 'ok' ? 'Kesehatan perangkat pulih' : 'Kesehatan perangkat menurun', bad || 'Semua normal')); }
    this.cb && this.cb('telemetry', { ts: +this.now().toFixed(3), telemetry: this.tele(), health: { score: d.score, status: d.status, summary: d.summary, issues: d.issues, ts: d.ts } });
  }
  async frameImage(frame) {
    const p = this.imgs.get(frame && frame.frame_id) || this.imgs.get(this.lastFrame);
    if (!p) throw new Error('belum ada gambar');
    return p;
  }

  stream(cb) {
    cb('open', null);
    const d = this.healthDetail();
    this.start(cb);
    const f = this.frameData(this.now());
    cb('hello', { node: clone(this.node), state: { frame: f, control: this.controlState(), stats: { mode: f.mode, uptime_s: this.now() - this.real0, simulation: true }, telemetry: this.tele(), health: { score: d.score, status: d.status, summary: d.summary, issues: d.issues, ts: d.ts } }, server_time: this.now(), now: this.now() });
    return { close: () => this.stop() };
  }
}
function hashf(n) { return hash(n * 2654435761 | 0); }
