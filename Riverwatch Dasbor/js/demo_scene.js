// Pembuat gambar kamera tiruan untuk mode demo: sungai dengan jembatan, sampah hanyut, orang, perahu, dsb. digambar di kanvas 2D.
// Koordinat objek ternormalisasi (0..1): x,y = titik tengah-bawah kotak; w,h = lebar-tinggi kotak.

export const KIND_STYLE = {
  plastik_kantong: { w: 0.034, h: 0.04 }, botol_kemasan: { w: 0.022, h: 0.03 }, sampah_besar: { w: 0.07, h: 0.07 }, tumbuhan_air: { w: 0.08, h: 0.06 },
  kayu_batang: { w: 0.13, h: 0.035 }, manusia: { w: 0.05, h: 0.12 }, hewan: { w: 0.06, h: 0.05 }, perahu: { w: 0.19, h: 0.1 }, kendaraan: { w: 0.15, h: 0.1 }, objek_lain: { w: 0.07, h: 0.06 }
};
const PEOPLE = ['#e3513f', '#2f7fd8', '#e8b53a'];
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class SceneRenderer {
  constructor(w = 640, h = 360) {
    this.w = w; this.h = h;
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    this.g = this.canvas.getContext('2d');
    this.bg = null; this.bgKey = '';
  }
  // ---- latar (langit, tebing, jembatan, air): digambar ulang hanya bila jam/hujan berubah banyak ----
  background(day, rain) {
    const key = `${(day * 20) | 0}:${rain ? 1 : 0}`;
    if (this.bg && this.bgKey === key) return this.bg;
    const W = this.w, H = this.h;
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d');
    const mix = (a, b) => a.map((v, i) => Math.round(v * day + b[i] * (1 - day)));
    const sky = g.createLinearGradient(0, 0, 0, H * 0.3);
    sky.addColorStop(0, `rgb(${mix([150, 190, 215], [16, 24, 40])})`); sky.addColorStop(1, `rgb(${mix([205, 218, 220], [34, 42, 58])})`);
    g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.34);
    // tebing jauh dan bangunan
    const r = rnd(7);
    g.fillStyle = `rgb(${mix([86, 120, 78], [20, 30, 26])})`; g.fillRect(0, H * 0.2, W, H * 0.12);
    for (let x = 0; x < W; x += 28 + r() * 40) {
      const bw = 24 + r() * 46, bh = 18 + r() * 40, col = r() < 0.5 ? [196, 170, 140] : [170, 176, 182];
      g.fillStyle = `rgb(${mix(col, col.map((v) => v * 0.22))})`; g.fillRect(x, H * 0.27 - bh, bw, bh + 4);
      g.fillStyle = `rgb(${mix([120, 60, 50], [26, 16, 18])})`; g.fillRect(x - 2, H * 0.27 - bh - 4, bw + 4, 5);
      if (day < 0.5 && r() < 0.5) { g.fillStyle = 'rgba(255,214,120,0.8)'; g.fillRect(x + 6, H * 0.27 - bh + 8, 6, 5); }
    }
    // jembatan (dek dan pagar) memotong atas gambar
    g.fillStyle = `rgb(${mix([112, 116, 120], [34, 38, 44])})`; g.fillRect(0, H * 0.3, W, H * 0.1);
    g.fillStyle = `rgb(${mix([84, 88, 94], [22, 26, 32])})`; g.fillRect(0, H * 0.385, W, H * 0.03);
    g.strokeStyle = `rgb(${mix([205, 208, 210], [70, 78, 90])})`; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H * 0.31); g.lineTo(W, H * 0.31); g.stroke();
    for (let x = 6; x < W; x += 22) { g.beginPath(); g.moveTo(x, H * 0.31); g.lineTo(x, H * 0.385); g.stroke(); }
    // dinding tepi
    g.fillStyle = `rgb(${mix([138, 132, 122], [40, 40, 42])})`; g.fillRect(0, H * 0.415, W, H * 0.04);
    // air
    const wat = g.createLinearGradient(0, H * 0.45, 0, H);
    wat.addColorStop(0, `rgb(${mix([84, 122, 118], [14, 34, 40])})`); wat.addColorStop(1, `rgb(${mix([58, 98, 96], [8, 24, 30])})`);
    g.fillStyle = wat; g.fillRect(0, H * 0.45, W, H * 0.55);
    this.bg = c; this.bgKey = key; this.waterSeed = rnd(21);
    return c;
  }

  /** objs: [{id, cls, x, y, w, h, seed, phase, pose}] ; opts: {day 0..1, ir, t (detik), rain, lamp, noise} */
  render(objs, opts = {}) {
    const { day = 1, ir = false, t = 0, rain = false, lamp = false, noise = 0.5 } = opts;
    const g = this.g, W = this.w, H = this.h;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.drawImage(this.background(day, rain), 0, 0);
    // riak air bergerak
    g.save(); g.beginPath(); g.rect(0, H * 0.45, W, H * 0.55); g.clip();
    for (let i = 0; i < 26; i++) {
      const yy = H * (0.47 + (i / 26) * 0.52), amp = 1 + (yy / H) * 3, off = (t * (8 + i * 0.7) + i * 53) % (W + 80);
      g.strokeStyle = `rgba(${day > 0.5 ? '255,255,255' : '120,160,180'},${0.05 + (i % 3) * 0.025})`; g.lineWidth = 1;
      g.beginPath();
      for (let x = -40; x <= W + 40; x += 16) { const y2 = yy + Math.sin((x + off) / (20 + (i % 5) * 6)) * amp; if (x === -40) g.moveTo(x, y2); else g.lineTo(x, y2); }
      g.stroke();
    }
    g.restore();
    // objek terurut dari jauh ke dekat
    const list = objs.slice().sort((a, b) => a.y - b.y);
    for (const o of list) this.drawObj(g, o, day, t);
    // hujan
    if (rain) { g.strokeStyle = 'rgba(210,225,235,0.35)'; g.lineWidth = 1; const r = rnd((t * 12) | 0); g.beginPath(); for (let i = 0; i < 90; i++) { const x = r() * W, y = r() * H; g.moveTo(x, y); g.lineTo(x - 5, y + 14); } g.stroke(); }
    // malam: gelap, lampu jembatan, dan tampilan inframerah
    if (day < 0.98) {
      g.fillStyle = `rgba(4,10,22,${(1 - day) * 0.55})`; g.fillRect(0, 0, W, H);
      if (lamp) { const gr = g.createRadialGradient(W * 0.5, H * 0.4, 8, W * 0.5, H * 0.62, W * 0.55); gr.addColorStop(0, 'rgba(255,230,170,0.55)'); gr.addColorStop(1, 'rgba(255,230,170,0)'); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.globalAlpha = 1 - day; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
    }
    if (ir && day < 0.5) {
      g.globalCompositeOperation = 'saturation'; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(70,150,100,0.18)'; g.fillRect(0, 0, W, H);
    }
    if (day < 0.8) { // bintik gambar malam
      const r = rnd((t * 30) | 0), n = Math.round(260 * noise * (1 - day));
      for (let i = 0; i < n; i++) { g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.22})`; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
    }
    return this.canvas;
  }

  drawObj(g, o, day, t) {
    const W = this.w, H = this.h, bw = o.w * W, bh = o.h * H, cx = o.x * W, by = o.y * H, r = rnd(o.seed || o.id || 1);
    g.save(); g.translate(cx, by);
    const bob = Math.sin(t * 1.6 + (o.phase || 0)) * 1.2;
    g.globalAlpha = o.fade == null ? 1 : o.fade;
    switch (o.cls) {
      case 'plastik_kantong': { g.fillStyle = r() < 0.5 ? '#eef2f4' : '#e98d3a'; g.beginPath(); g.ellipse(0, -bh / 2 + bob, bw / 2, bh / 2.2, r() * 2, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,0.16)'; g.beginPath(); g.ellipse(0, -1, bw / 2.2, 2, 0, 0, 7); g.fill(); break; }
      case 'botol_kemasan': { g.rotate((r() - 0.5) * 1.4); g.fillStyle = r() < 0.5 ? '#6cc3e8' : '#d8e6ea'; g.fillRect(-bw / 2, -bh / 2 + bob, bw, bh * 0.55); g.fillStyle = '#2c6fb5'; g.fillRect(bw * 0.25, -bh / 2 + bob + 1, bw * 0.2, bh * 0.4); break; }
      case 'sampah_besar': { g.fillStyle = '#4b4f52'; g.fillRect(-bw / 2, -bh + bob, bw, bh * 0.85); g.fillStyle = '#7b6a55'; g.fillRect(-bw / 2 + 4, -bh + bob + 5, bw * 0.45, bh * 0.4); g.fillStyle = '#2d3033'; g.fillRect(bw * 0.05, -bh * 0.45 + bob, bw * 0.4, bh * 0.35); break; }
      case 'tumbuhan_air': { for (let i = 0; i < 7; i++) { g.fillStyle = `rgb(${50 + r() * 30},${130 + r() * 50},${60 + r() * 30})`; g.beginPath(); g.ellipse((r() - 0.5) * bw * 0.8, -bh * (0.2 + r() * 0.5) + bob, bw * 0.22, bh * 0.28, r(), 0, 7); g.fill(); } break; }
      case 'kayu_batang': { g.fillStyle = '#7a5a36'; g.beginPath(); g.roundRect ? g.roundRect(-bw / 2, -bh + bob, bw, bh * 0.9, bh * 0.4) : g.rect(-bw / 2, -bh + bob, bw, bh * 0.9); g.fill(); g.fillStyle = '#9a7a52'; g.fillRect(-bw / 2 + 4, -bh * 0.8 + bob, bw * 0.6, 2); break; }
      case 'manusia': {
        const col = PEOPLE[(o.seed || 0) % 3], sw = o.pose === 'swim', phase = o.phase || 0;
        if (sw) { g.fillStyle = '#e0b08a'; g.beginPath(); g.arc(-bw * 0.2, -bh * 0.3 + bob, bh * 0.18, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.ellipse(bw * 0.12, -bh * 0.22 + bob, bw * 0.32, bh * 0.14, 0, 0, 7); g.fill(); g.strokeStyle = '#e0b08a'; g.lineWidth = 3; g.beginPath(); g.moveTo(-bw * 0.1, -bh * 0.3 + bob); g.lineTo(bw * 0.05 + Math.sin(t * 4 + phase) * 6, -bh * 0.55 + bob); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(0, -2, bw * 0.55, 3, 0, 0, 7); g.fill(); }
        else { const step = Math.sin(t * 6 + phase) * 4; g.fillStyle = '#2a3348'; g.fillRect(-bw * 0.18 + step * 0.3, -bh * 0.38, bw * 0.16, bh * 0.38); g.fillRect(bw * 0.02 - step * 0.3, -bh * 0.38, bw * 0.16, bh * 0.38); g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(-bw * 0.28, -bh * 0.78, bw * 0.56, bh * 0.44, 5) : g.rect(-bw * 0.28, -bh * 0.78, bw * 0.56, bh * 0.44); g.fill(); g.fillStyle = '#e0b08a'; g.beginPath(); g.arc(0, -bh * 0.9, bh * 0.11, 0, 7); g.fill(); }
        break;
      }
      case 'hewan': { g.fillStyle = '#6b4a2e'; g.beginPath(); g.ellipse(0, -bh * 0.4 + bob, bw * 0.45, bh * 0.28, 0, 0, 7); g.fill(); g.beginPath(); g.arc(bw * 0.4, -bh * 0.55 + bob, bh * 0.16, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(0, -1, bw * 0.5, 3, 0, 0, 7); g.fill(); break; }
      case 'perahu': { g.fillStyle = '#3d6fa3'; g.beginPath(); g.moveTo(-bw / 2, -bh * 0.45 + bob); g.lineTo(bw / 2, -bh * 0.45 + bob); g.lineTo(bw * 0.38, 0); g.lineTo(-bw * 0.38, 0); g.closePath(); g.fill(); g.fillStyle = '#e8e2d0'; g.fillRect(-bw * 0.15, -bh * 0.9 + bob, bw * 0.34, bh * 0.45); g.fillStyle = '#b2402f'; g.fillRect(-bw * 0.15, -bh * 0.9 + bob, bw * 0.34, 4); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-bw * 0.6, -1, bw * 1.2, 2); break; }
      case 'kendaraan': { g.fillStyle = '#c64a3a'; g.fillRect(-bw / 2, -bh * 0.6, bw, bh * 0.4); g.fillStyle = '#d96a58'; g.fillRect(-bw * 0.25, -bh * 0.95, bw * 0.5, bh * 0.38); g.fillStyle = '#1b1d20'; g.beginPath(); g.arc(-bw * 0.28, -bh * 0.18, bh * 0.16, 0, 7); g.arc(bw * 0.28, -bh * 0.18, bh * 0.16, 0, 7); g.fill(); break; }
      default: { g.fillStyle = '#c04ee0'; g.beginPath(); g.moveTo(0, -bh + bob); g.lineTo(bw / 2, 0); g.lineTo(-bw / 2, 0); g.closePath(); g.fill(); }
    }
    g.restore();
  }
}
