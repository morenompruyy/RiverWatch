(function () {
'use strict';

/* =====================================================================
   RIVERWATCH 3D: diorama titik pantau sungai.
   Satuan dunia = 1 meter. Sumbu: +x ke timur (arah aliran sungai), +z ke selatan, +y ke atas.
   ===================================================================== */

var reduce = false;
try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
var coarse = false;
try { coarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700; } catch (e) {}

var $ = function (id) { return document.getElementById(id); };
var stage = $('stage');
var pinsEl = $('pins');
function fail(msg) {
  var p = document.createElement('p');
  p.className = 'fallback';
  p.textContent = msg;
  stage.appendChild(p);
  var l = $('loader'); if (l) l.hidden = true;
}
if (!window.THREE || !THREE.OrbitControls || !THREE.BufferGeometryUtils) { fail('Model 3D tidak bisa dimuat. Periksa koneksi lalu muat ulang halaman.'); return; }
var renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { fail('Perangkat ini tidak mendukung WebGL, jadi model 3D tidak bisa ditampilkan.'); return; }

var V3 = THREE.Vector3, V2 = THREE.Vector2, MU = THREE.MathUtils;
var BGU = THREE.BufferGeometryUtils;
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- noise ---------- */
function hash2(x, y) {
  var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hash3(x, y, z) {
  var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  var a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o) {
  var s = 0, a = 0.5, f = 1, n = 0;
  for (var i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); n += a; f *= 2.03; a *= 0.5; }
  return s / n;
}
function vnoise3(x, y, z) {
  var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  var xf = x - xi, yf = y - yi, zf = z - zi;
  var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  var c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi), c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  var c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1), c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  var x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u, x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  var y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}
/* noise yang bisa disambung (tileable): u, v dalam 0..1, cells = jumlah sel per sisi */
function tnoise(u, v, cells) {
  var x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  var uu = xf * xf * (3 - 2 * xf), vv = yf * yf * (3 - 2 * yf);
  var x0 = ((xi % cells) + cells) % cells, x1 = (x0 + 1) % cells, y0 = ((yi % cells) + cells) % cells, y1 = (y0 + 1) % cells;
  var a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
  return a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv;
}
function tfbm(u, v, cells, o) {
  var s = 0, a = 0.5, n = 0, c = cells;
  for (var i = 0; i < o; i++) { s += a * tnoise(u, v, c); n += a; c *= 2; a *= 0.5; }
  return s / n;
}

/* ---------- color ---------- */
function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
function hexToRgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function cssRgb(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }

/* ---------- loader (tahap demi tahap supaya halaman tetap responsif) ---------- */
var loaderEl = $('loader'), loaderBar = $('loaderBar'), loaderMsg = $('loaderMsg');
var tasks = [];
function task(msg, fn) { tasks.push({ msg: msg, fn: fn }); }
var onReady = [];
function runTasks() {
  var i = 0, n = tasks.length;
  (function next() {
    if (i >= n) { loaderEl.hidden = true; onReady.forEach(function (f) { f(); }); return; }
    var t = tasks[i];
    loaderMsg.textContent = t.msg;
    loaderBar.style.width = Math.round(i / n * 100) + '%';
    setTimeout(function () {
      try { t.fn(); } catch (e) { if (window.console) console.error(e); }
      i++; next();
    }, 16);
  })();
}

/* ---------- renderer, scene, camera ---------- */
var DPR = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
renderer.setPixelRatio(DPR);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x000000, 0);
renderer.domElement.className = 'gl';
stage.insertBefore(renderer.domElement, stage.firstChild);
var MAXANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(34, 1, 0.05, 400);
var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 0.25;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.8;

/* kelompok dunia: titik pantau (view 0), detail pod (view 1), detail hub (view 2) */
var world = new THREE.Group();
var podDetail = new THREE.Group();
var hubDetail = new THREE.Group();
scene.add(world); scene.add(podDetail); scene.add(hubDetail);

/* ---------- texture dan material ---------- */
function makeCanvas(w, h) {
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function canvasTex(c, o) {
  o = o || {};
  var t = new THREE.CanvasTexture(c);
  t.encoding = o.linear ? THREE.LinearEncoding : THREE.sRGBEncoding;
  t.anisotropy = MAXANISO;
  if (o.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(o.repeat[0], o.repeat[1]);
  }
  if (o.noFlip) t.flipY = false;
  if (o.clamp) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
/* lukis piksel demi piksel: fn(u, v, out) mengisi out = [r, g, b, a] (0 sampai 255) */
function pixelTex(w, h, fn, o) {
  var c = makeCanvas(w, h), ctx = c.getContext('2d'), im = ctx.createImageData(w, h), d = im.data, out = [0, 0, 0, 255], k = 0;
  for (var j = 0; j < h; j++) {
    for (var i = 0; i < w; i++) {
      out[3] = 255;
      fn((i + 0.5) / w, (j + 0.5) / h, out, i, j);
      d[k++] = out[0]; d[k++] = out[1]; d[k++] = out[2]; d[k++] = out[3];
    }
  }
  ctx.putImageData(im, 0, 0);
  return { canvas: c, tex: canvasTex(c, o) };
}

var matCache = {};
function mat(c, o) {
  var key = c + JSON.stringify(o || {}, function (k, v) { return v && v.isTexture ? v.uuid : v; });
  if (matCache[key]) return matCache[key];
  var p = { color: lin(c), roughness: 0.85, metalness: 0 };
  if (o) { for (var k in o) { p[k] = o[k]; } }
  var m = (p.physical ? new THREE.MeshPhysicalMaterial(strip(p)) : new THREE.MeshStandardMaterial(strip(p)));
  matCache[key] = m;
  return m;
}
function strip(p) { var q = {}; for (var k in p) { if (k !== 'physical') q[k] = p[k]; } return q; }

function add(parent, g, m, x, y, z, opt) {
  var me = new THREE.Mesh(g, m);
  me.position.set(x || 0, y || 0, z || 0);
  me.castShadow = !(opt && opt.noCast);
  me.receiveShadow = !(opt && opt.noRecv);
  (parent || world).add(me);
  return me;
}
function B(w, h, d, sx, sy, sz) { return new THREE.BoxGeometry(w, h, d, sx || 1, sy || 1, sz || 1); }
function Cy(rt, rb, h, s, hs, open) { return new THREE.CylinderGeometry(rt, rb, h, s || 12, hs || 1, !!open); }
/* silinder antara dua titik */
function link(parent, a, b, r, m, seg, opt) {
  var d = b.clone().sub(a), len = d.length();
  var me = add(parent, Cy(r, r, len, seg || 8), m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, opt || { noRecv: true });
  me.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  return me;
}
/* atur warna per verteks dari fungsi f(x, y, z, nx, ny, nz) -> [r, g, b] (sRGB 0..1) */
function paintVerts(g, f) {
  var pos = g.attributes.position, nor = g.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (var i = 0; i < pos.count; i++) {
    var r = f(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    c.setRGB(r[0], r[1], r[2]).convertSRGBToLinear();
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function disp(g, f) {
  var pos = g.attributes.position, v = new V3();
  for (var i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    f(v, i);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/* ---------- registri pembaruan per frame ---------- */
var updaters = [];
var afterRender = [];
function onFrame(fn) { updaters.push(fn); }
var state = {
  view: 0, level: 1, hour: 12, tm: 0, dt: 0, night: 0,
  showZone: true, showBoxes: true, showFlow: true, showCable: false, showPip: true, showNames: false,
  explode: 1, cut: false, dims: true
};

/* =====================================================================
   LANGIT, CAHAYA, WAKTU
   ===================================================================== */
var SKY_FN = [
  'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
  'float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }',
  'uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunCol;',
  'uniform float uNight; uniform float uTime; uniform float uCloud; uniform float uDisc;',
  'vec3 skyCol(vec3 d, float withClouds){',
  '  float y = d.y;',
  '  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));',
  '  col = mix(col, uGround, 1.0 - smoothstep(-0.3, 0.0, y));',
  '  float sd = max(dot(d, uSunDir), 0.0);',
  '  col += uSunCol * (0.16 * pow(sd, 6.0) + 0.55 * pow(sd, 48.0));',
  '  col += uSunCol * 14.0 * smoothstep(0.99935, 0.9998, sd) * uDisc;',
  '  if (uNight > 0.02 && y > 0.0) {',
  '    vec2 sp = d.xz / (d.y + 0.35) * 70.0; vec2 cell = floor(sp);',
  '    float s = h21(cell); float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);',
  '    col += vec3(step(0.9935, s)) * uNight * tw * smoothstep(0.0, 0.25, y) * 1.4;',
  '  }',
  '  if (withClouds > 0.5 && y > 0.01) {',
  '    vec2 cp = d.xz / (y + 0.18) * 1.5 + vec2(uTime * 0.006, uTime * 0.002);',
  '    float c = fbm2(cp); c = smoothstep(0.50, 0.82, c) * smoothstep(0.01, 0.2, y) * uCloud;',
  '    vec3 cc = mix(uHorizon * 1.25 + 0.15, vec3(1.0), 0.5) * (1.0 - 0.75 * uNight) + uSunCol * 0.12 * pow(sd, 4.0);',
  '    col = mix(col, cc, c * 0.85);',
  '  }',
  '  return col;',
  '}'
].join('\n');

var skyU = {
  uSunDir: { value: new V3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
  uNight: { value: 0 }, uTime: { value: 0 }, uCloud: { value: 0.6 }, uDisc: { value: 1 }
};
var skyUEnv = {};
for (var sk in skyU) { skyUEnv[sk] = skyU[sk]; }
skyUEnv.uDisc = { value: 0 };

function skyMaterial(u, clouds) {
  return new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vDir;\n' + SKY_FN + '\nvoid main(){ gl_FragColor = vec4(skyCol(normalize(vDir), ' + (clouds ? '1.0' : '0.0') + '), 1.0);\n#include <encodings_fragment>\n}'
  });
}
/* kubah langit hanya terlihat oleh kamera pod (layer 1) */
var skyDome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMaterial(skyU, true));
skyDome.layers.set(1);
skyDome.frustumCulled = false;
skyDome.renderOrder = -10;
scene.add(skyDome);

/* peta lingkungan (refleksi) dibuat dari kubah langit tanpa awan */
var envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12), skyMaterial(skyUEnv, false)));
var pmrem = new THREE.PMREMGenerator(renderer);
var envOutdoor = null, envStudio = null;
function genOutdoorEnv() {
  var rt = pmrem.fromScene(envScene, 0, 0.1, 100);
  if (envOutdoor) envOutdoor.dispose();
  envOutdoor = rt;
  if (state.view === 0) scene.environment = envOutdoor.texture;
}
function genStudioEnv() {
  var s = new THREE.Scene();
  var dome = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vDir; void main(){ float y = vDir.y; vec3 c = mix(vec3(0.20, 0.22, 0.25), vec3(0.62, 0.68, 0.74), smoothstep(-0.4, 0.9, y)); gl_FragColor = vec4(c, 1.0);\n#include <encodings_fragment>\n}'
  }));
  s.add(dome);
  function panel(w, h, col, pos) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col[0], col[1], col[2]), side: THREE.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(0, 0, 0);
    s.add(m);
  }
  panel(16, 10, [5, 5, 5.2], [-14, 18, 12]);
  panel(6, 20, [3.2, 3.4, 3.8], [22, 6, -4]);
  panel(18, 5, [1.6, 1.7, 1.8], [0, 4, 24]);
  panel(30, 30, [0.9, 0.95, 1.0], [0, 36, 0]);
  var rt = pmrem.fromScene(s, 0, 0.1, 100);
  envStudio = rt;
}

/* ---------- cahaya ---------- */
var sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
var SH = coarse ? 2048 : 4096;
sun.shadow.mapSize.set(SH, SH);
sun.shadow.camera.left = -19; sun.shadow.camera.right = 19;
sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
sun.shadow.camera.near = 2; sun.shadow.camera.far = 120;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 2.2;
scene.add(sun); scene.add(sun.target);
var hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 0.6);
scene.add(hemi);
var lamps = [];            /* {light, base} cahaya titik lampu jalan */
var nightMats = [];        /* {mat, base} bahan yang menyala saat malam */
function addLamp(x, y, z, color, base, dist) {
  var l = new THREE.PointLight(color, 0, dist || 16, 2);
  l.position.set(x, y, z);
  world.add(l);
  lamps.push({ light: l, base: base });
  return l;
}
function nightMat(m, base) { m.emissive = m.emissive || new THREE.Color(0); nightMats.push({ mat: m, base: base }); return m; }

/* bayangan lembut di bawah blok tanah, dan lantai penangkap bayangan */
var floorY = -3.4;
(function () {
  var c = makeCanvas(256, 256), g = c.getContext('2d');
  var gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  var t = new THREE.CanvasTexture(c);
  var blob = new THREE.Mesh(new THREE.PlaneGeometry(52, 40), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = floorY + 0.02; blob.renderOrder = -2; blob.userData.noPip = true;
  world.add(blob);
  var fl = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.26 }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = floorY; fl.receiveShadow = true; fl.userData.noPip = true;
  world.add(fl);
})();

/* ---------- kunci waktu ---------- */
var KEYS = [
  { h: 5.5,  el: 40, az: 2.3, zen: 0x16233f, hor: 0x6f6488, gnd: 0x24293a, sun: 0x9db4ff, si: 0.32, hi: 0.5,  ex: 1.15, night: 0.75, cloud: 0.4, lamp: 1,   top: 0x1b2a46, bot: 0x4a5878 },
  { h: 6.3,  el: 4,  az: 0.05, zen: 0x3f5f98, hor: 0xffb48c, gnd: 0x4a3f48, sun: 0xffa868, si: 1.5,  hi: 0.55, ex: 1.05, night: 0.1,  cloud: 0.6, lamp: 0.4, top: 0x7f9bc4, bot: 0xf6d2b4 },
  { h: 7.5,  el: 24, az: 0.4, zen: 0x4a84c4, hor: 0xbcd8ee, gnd: 0x6a6f6a, sun: 0xffe4c0, si: 2.6,  hi: 0.62, ex: 1.0,  night: 0,    cloud: 0.6, lamp: 0,   top: 0xb4d3ea, bot: 0xeef2f1 },
  { h: 10,   el: 55, az: 1.0, zen: 0x3279c6, hor: 0xc4e0f4, gnd: 0x707a70, sun: 0xfff4e6, si: 3.2,  hi: 0.66, ex: 1.0,  night: 0,    cloud: 0.55, lamp: 0,  top: 0xa9cde8, bot: 0xeef3f6 },
  { h: 12,   el: 76, az: 1.57, zen: 0x2b74c6, hor: 0xc8e3f6, gnd: 0x747c72, sun: 0xffffff, si: 3.4,  hi: 0.68, ex: 1.0,  night: 0,    cloud: 0.55, lamp: 0,  top: 0xa2c8e6, bot: 0xedf3f6 },
  { h: 14.5, el: 55, az: 2.1, zen: 0x3279c6, hor: 0xc8e2f4, gnd: 0x707a70, sun: 0xfff6e8, si: 3.2,  hi: 0.66, ex: 1.0,  night: 0,    cloud: 0.55, lamp: 0,  top: 0xa9cde8, bot: 0xeef3f6 },
  { h: 16.5, el: 30, az: 2.6, zen: 0x4a82c6, hor: 0xecdcc8, gnd: 0x6e6c62, sun: 0xffe2bc, si: 2.7,  hi: 0.6,  ex: 1.0,  night: 0,    cloud: 0.6, lamp: 0,   top: 0xb4cbe2, bot: 0xf6eadb },
  { h: 17.7, el: 7,  az: 3.0, zen: 0x4d5f9c, hor: 0xff9d63, gnd: 0x4d4448, sun: 0xff9250, si: 1.6,  hi: 0.5,  ex: 1.08, night: 0.1,  cloud: 0.7, lamp: 0.5, top: 0x7480b4, bot: 0xf8c79a },
  { h: 18.4, el: 3,  az: 3.1, zen: 0x2c3a6d, hor: 0xc0607a, gnd: 0x2c2c3c, sun: 0xff7a5a, si: 0.75, hi: 0.42, ex: 1.2,  night: 0.45, cloud: 0.7, lamp: 1,   top: 0x34406e, bot: 0xb98aa0 },
  { h: 19.3, el: 38, az: 2.3, zen: 0x0c1630, hor: 0x2a3358, gnd: 0x1a2030, sun: 0x8fa8ff, si: 0.42, hi: 0.4,  ex: 1.3,  night: 0.9,  cloud: 0.5, lamp: 1,   top: 0x101b33, bot: 0x2d3b5c },
  { h: 20.6, el: 48, az: 2.2, zen: 0x070e24, hor: 0x131d3a, gnd: 0x141a28, sun: 0x8fa8ff, si: 0.5,  hi: 0.42, ex: 1.35, night: 1,    cloud: 0.4, lamp: 1,   top: 0x0b1424, bot: 0x1d2b44 },
  { h: 21,   el: 48, az: 2.2, zen: 0x070e24, hor: 0x131d3a, gnd: 0x141a28, sun: 0x8fa8ff, si: 0.5,  hi: 0.42, ex: 1.35, night: 1,    cloud: 0.4, lamp: 1,   top: 0x0b1424, bot: 0x1d2b44 }
];
KEYS.forEach(function (k) {
  ['zen', 'hor', 'gnd', 'sun', 'top', 'bot'].forEach(function (n) { k[n + 'C'] = hexToRgb(k[n]); });
});
var NUMF = ['el', 'az', 'si', 'hi', 'ex', 'night', 'cloud', 'lamp'], COLF = ['zen', 'hor', 'gnd', 'sun', 'top', 'bot'];
function sampleKeys(h) {
  h = clamp(h, KEYS[0].h, KEYS[KEYS.length - 1].h);
  var i = 0;
  while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
  var a = KEYS[i], b = KEYS[i + 1], t = (h - a.h) / (b.h - a.h || 1), o = {};
  NUMF.forEach(function (n) { o[n] = lerp(a[n], b[n], t); });
  COLF.forEach(function (n) { o[n] = mixRgb(a[n + 'C'], b[n + 'C'], t); });
  return o;
}
function rgbToLin(c) { return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).convertSRGBToLinear(); }

var todCur = null;
var rig = 'outdoor';
function applyTime(h, force) {
  var k = sampleKeys(h);
  todCur = k;
  state.night = k.night;
  var el = k.el * Math.PI / 180;
  var dir = new V3(Math.cos(el) * Math.cos(k.az), Math.sin(el), Math.cos(el) * Math.sin(k.az));
  skyU.uSunDir.value.copy(dir);
  skyU.uZenith.value.copy(rgbToLin(k.zen));
  skyU.uHorizon.value.copy(rgbToLin(k.hor));
  skyU.uGround.value.copy(rgbToLin(k.gnd));
  skyU.uSunCol.value.copy(rgbToLin(k.sun));
  skyU.uNight.value = k.night;
  skyU.uCloud.value = k.cloud;
  if (rig === 'outdoor') {
    sun.color.copy(rgbToLin(k.sun));
    sun.intensity = k.si * 0.62;
    sun.position.copy(dir).multiplyScalar(52);
    sun.target.position.set(0, 0, 0);
    hemi.color.copy(rgbToLin(mixRgb(k.zen, k.hor, 0.45)));
    hemi.groundColor.copy(rgbToLin(k.gnd));
    hemi.intensity = k.hi * 0.38;
    renderer.toneMappingExposure = k.ex;
    lamps.forEach(function (l) { l.light.intensity = l.base * k.lamp; });
    nightMats.forEach(function (m) { m.mat.emissiveIntensity = m.base * k.lamp; });
    stage.style.background = 'linear-gradient(180deg, ' + cssRgb(k.top) + ' 0%, ' + cssRgb(k.bot) + ' 100%)';
  }
  return k;
}
function setRig(name) {
  rig = name;
  if (name === 'studio') {
    sun.color.set(0xfff6ea);
    sun.intensity = 2.6;
    sun.position.set(-4, 7, 5).multiplyScalar(1.4);
    sun.target.position.set(0, 0, 0);
    hemi.color.set(0xdfe9f2); hemi.groundColor.set(0x3a3f45); hemi.intensity = 0.55;
    renderer.toneMappingExposure = 1.0;
    lamps.forEach(function (l) { l.light.intensity = 0; });
    nightMats.forEach(function (m) { m.mat.emissiveIntensity = 0; });
    stage.style.background = 'linear-gradient(180deg, #c9d5de 0%, #eef2f5 100%)';
    scene.environment = envStudio ? envStudio.texture : null;
  } else {
    scene.environment = envOutdoor ? envOutdoor.texture : null;
    applyTime(state.hour);
  }
}

/* =====================================================================
   TANAH, SUNGAI, AIR
   ===================================================================== */
var XMIN = -16, XMAX = 16, ZMIN = -11, ZMAX = 11, GY = 1.5, BEDY = -0.95, SOILBOT = -3.1;
var WX = XMAX - XMIN, WZ = ZMAX - ZMIN;
function riverC(x) { return 1.5 * smooth(4.5, 12, Math.abs(x)) * Math.sin(x * 0.19 + 0.35); }
function riverHW(x) { return 2.55 + 0.55 * smooth(4, 13, Math.abs(x)); }
function bankRun(x) { return lerp(0.38, 2.2, smooth(3.6, 8.5, Math.abs(x))); }
function natural(x) { return smooth(3.6, 8.5, Math.abs(x)); }
function heightAt(x, z) {
  var c = riverC(x), hw = riverHW(x), dz = Math.abs(z - c), s = dz - hw;
  if (s <= 0) {
    var t = dz / hw;
    return BEDY + 0.62 * t * t * t + 0.05 * (vnoise(x * 2.1, z * 2.1) - 0.5);
  }
  var D = bankRun(x), q = Math.min(s / D, 1), nat = natural(x);
  var e = lerp(q, q * q * (3 - 2 * q), nat * 0.85);
  var h0 = BEDY + 0.62;
  if (q >= 1) return GY + 0.07 * (fbm(x * 0.35 + 3, z * 0.35, 3) - 0.5) * smooth(0, 2, s - D);
  return h0 + (GY - h0) * e;
}
/* jalan kecil di sisi selatan sungai (jalur setapak) */
function pathZ(x) { return riverC(x) + riverHW(x) + bankRun(x) + 1.25 + 0.25 * Math.sin(x * 0.45); }

var groundTex, wallTex, strataTex, rippleTex, depthTex, foamC, foamTex, shadeC, shadeTex, concreteTexA, asphaltTex, detailTex;

/* ---------- beton: ubin 2 m x 2 m dengan panel 1 m, lubang tie rod, noda ---------- */
function makeConcrete(size, o) {
  o = o || {};
  var px = size / 2;                       /* piksel per meter */
  var r = pixelTex(size, size, function (u, v, out) {
    var n1 = tfbm(u, v, 6, 4), n2 = tnoise(u, v, 64), st = tnoise(u * 18 % 1, v * 2 % 1, 18);
    var base = 156 + 26 * (n1 - 0.5) + 14 * (n2 - 0.5);
    var streak = Math.max(0, tnoise(u, v, 24) - 0.55) * 1.6 * (0.5 + 0.5 * tnoise(u * 3 % 1, v * 0.5, 3));
    var stain = 1 - 0.30 * streak - 0.12 * st * (o.stain ? 1 : 0);
    var low = o.wet ? 1 - 0.28 * smooth(0.5, 1.0, v) : 1;
    base *= stain * low;
    out[0] = base + 2; out[1] = base; out[2] = base - 6;
    if (o.moss) {
      var m = smooth(0.62, 0.95, v + 0.22 * (n1 - 0.5)) * smooth(0.45, 0.7, tnoise(u, v, 40));
      out[0] = lerp(out[0], 70, m * 0.7); out[1] = lerp(out[1], 92, m * 0.7); out[2] = lerp(out[2], 48, m * 0.7);
    }
  }, {});
  var ctx = r.canvas.getContext('2d');
  if (o.panels !== false) {
    ctx.strokeStyle = 'rgba(40,40,40,0.55)'; ctx.lineWidth = Math.max(1.5, px * 0.012 * 2);
    for (var k = 0; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(k * px, 0); ctx.lineTo(k * px, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k * px); ctx.lineTo(size, k * px); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    for (var k2 = 0; k2 <= 2; k2++) {
      ctx.beginPath(); ctx.moveTo(k2 * px + 2, 0); ctx.lineTo(k2 * px + 2, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k2 * px + 2); ctx.lineTo(size, k2 * px + 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,40,40,0.55)';
    [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].forEach(function (p) {
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (q) {
        ctx.beginPath(); ctx.arc((q[0] + p[0] * 1) * px % size + (q[0] ? 0 : 0), (q[1] + p[1]) * px % size, px * 0.022, 0, 6.283); ctx.fill();
      });
    });
  }
  r.tex.needsUpdate = true;
  return r.tex;
}

/* ---------- aspal ---------- */
function makeAsphalt(size) {
  var r = pixelTex(size, size, function (u, v, out) {
    var n = tnoise(u, v, 96), m = tfbm(u, v, 8, 3), sp = tnoise(u, v, 256);
    var b = 58 + 16 * (m - 0.5) + 26 * (n - 0.5) + (sp > 0.86 ? 38 : 0);
    out[0] = b; out[1] = b; out[2] = b + 2;
  }, {});
  return r.tex;
}

/* ---------- strata tanah (sisi potongan) ---------- */
function makeStrata(w, h) {
  var yTop = 1.8, yBot = SOILBOT;
  var r = pixelTex(w, h, function (u, v, out) {
    var y = yTop - v * (yTop - yBot);
    var nb = tfbm(u, v * 0.6, 6, 3) - 0.5, wob = nb * 0.35;
    var n1 = tfbm(u, v, 16, 4), n2 = tnoise(u, v, 90);
    var yy = y + wob, R, G, Bc;
    if (yy > 1.36) { R = 70; G = 52; Bc = 36; }                              /* tanah humus */
    else if (yy > 0.45) { R = 176; G = 120; Bc = 72; }                        /* lempung */
    else if (yy > -0.55) { R = 198; G = 168; Bc = 118; }                      /* pasir lanau */
    else if (yy > -1.85) { R = 138; G = 126; Bc = 110; }                      /* kerikil */
    else { R = 88; G = 92; Bc = 100; }                                        /* batuan dasar */
    var edge = Math.min(Math.abs(yy - 1.36), Math.abs(yy - 0.45), Math.abs(yy + 0.55), Math.abs(yy + 1.85));
    var dk = edge < 0.025 ? 0.78 : 1;
    var k = (0.78 + 0.5 * (n1 - 0.5) + 0.22 * (n2 - 0.5)) * dk;
    out[0] = R * k; out[1] = G * k; out[2] = Bc * k;
  }, {});
  var ctx = r.canvas.getContext('2d'), rnd = rng(9);
  for (var i = 0; i < 260; i++) {                                              /* kerikil dan batu */
    var yv = 0.52 + rnd() * 0.43, xv = rnd();
    var rr = 2 + rnd() * 6, gv = 90 + rnd() * 70;
    ctx.fillStyle = 'rgb(' + (gv + 14) + ',' + gv + ',' + (gv - 12) + ')';
    ctx.beginPath(); ctx.ellipse(xv * w, yv * h, rr * 1.3, rr, rnd() * 3, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  }
  r.tex.needsUpdate = true;
  return r.tex;
}

/* ---------- tekstur permukaan tanah (tampak atas) ---------- */
function paintGround(x, z, out) {
  var h = heightAt(x, z);
  var c = riverC(x), hw = riverHW(x), dz = z - c, s = Math.abs(dz) - hw;
  var n1 = fbm(x * 0.55, z * 0.55, 3), n2 = vnoise(x * 5.5, z * 5.5), n3 = vnoise(x * 23, z * 23);
  var r, g, b, ax = Math.abs(x);
  if (s < 0) {
    var t = Math.abs(dz) / hw;
    r = 96 + 40 * n1; g = 84 + 34 * n1; b = 64 + 26 * n1;
    var sand = smooth(0.5, 0.8, n2); r += sand * 32; g += sand * 28; b += sand * 20;
    var dd = smooth(-0.95, -0.3, h);
    var kk = 0.5 + 0.5 * dd; r *= kk; g *= kk; b *= kk;
  } else {
    var D = bankRun(x), nat = natural(x), q = s / D;
    if (q < 1) {
      if (nat < 0.4) {
        var cv = 150 + 22 * n1 + 8 * n3;
        r = cv; g = cv - 2; b = cv - 8;
        var mo = smooth(0.4, 0.0, q) * 0.5 * smooth(0.35, 0.65, n2);
        r = lerp(r, 62, mo); g = lerp(g, 84, mo); b = lerp(b, 44, mo);
      } else {
        var rip = smooth(0.66, 0.28, q + (n1 - 0.5) * 0.35);
        var gr = 0.5 + 0.5 * n1;
        var gR = lerp(62, 90, gr), gG = lerp(100, 126, gr), gB = lerp(38, 52, gr);
        var st = 96 + 40 * n2;
        r = lerp(gR, st, rip); g = lerp(gG, st - 2, rip); b = lerp(gB, st - 8, rip);
        var mud = smooth(0.28, 0.0, q);
        r = lerp(r, 96, mud * 0.6); g = lerp(g, 82, mud * 0.6); b = lerp(b, 62, mud * 0.6);
      }
    } else {
      var far = s - D;
      var gm = 0.5 + 0.5 * n1;
      r = lerp(56, 84, gm); g = lerp(94, 124, gm); b = lerp(34, 48, gm);
      var dry = smooth(0.55, 0.75, fbm(x * 0.9 + 9, z * 0.9, 3));
      r = lerp(r, 128, dry * 0.34); g = lerp(g, 118, dry * 0.28); b = lerp(b, 64, dry * 0.28);
      var soil = smooth(0.62, 0.8, vnoise(x * 1.7 - 4, z * 1.7)) * smooth(0, 1.2, far);
      r = lerp(r, 104, soil * 0.45); g = lerp(g, 82, soil * 0.45); b = lerp(b, 56, soil * 0.45);
      var edgeStrip = smooth(0.0, 0.5, far);
      r = lerp(r * 0.82, r, edgeStrip); g = lerp(g * 0.82, g, edgeStrip); b = lerp(b * 0.82, b, edgeStrip);
      if (ax >= 1.5 && ax < 2.4) {                                            /* bahu jalan berkerikil */
        var gv2 = 136 + 40 * n3 + 12 * n2, gk = smooth(2.4, 1.9, ax);
        r = lerp(r, gv2, gk); g = lerp(g, gv2 - 2, gk); b = lerp(b, gv2 - 8, gk);
      } else if (ax < 1.5) { r = 104; g = 100; b = 94; }
      var pz = pathZ(x), pd = Math.abs(z - pz);
      if (ax > 2.6 && ax < 15 && pd < 0.55) {                                 /* jalur setapak */
        var pk = smooth(0.55, 0.15, pd) * smooth(2.6, 3.4, ax);
        var pv = 150 + 26 * n3 + 12 * n2;
        r = lerp(r, pv + 14, pk * 0.9); g = lerp(g, pv - 6, pk * 0.9); b = lerp(b, pv - 34, pk * 0.9);
      }
    }
  }
  var wet = 0.58 + 0.42 * smooth(0.0, 0.3, h);
  if (s > -0.2) { r *= wet; g *= wet; b *= wet; }
  var dt = 0.88 + 0.24 * n3;
  out[0] = r * dt; out[1] = g * dt; out[2] = b * dt;
}

task('Membuat tanah dan tebing sungai', function () {
  var W = coarse ? 768 : 1024, H = Math.round(W * WZ / WX);
  var gp = pixelTex(W, H, function (u, v, out) { paintGround(XMIN + u * WX, ZMIN + v * WZ, out); }, { noFlip: true, clamp: true });
  var ctx = gp.canvas.getContext('2d'), rnd = rng(77), ppm = W / WX;
  function P(x, z) { return [(x - XMIN) * ppm, (z - ZMIN) * ppm]; }
  /* batu tanggul di lereng alami */
  for (var i = 0; i < (coarse ? 900 : 1700); i++) {
    var x = XMIN + rnd() * WX, side = rnd() < 0.5 ? -1 : 1;
    if (Math.abs(x) < 4.6) continue;
    var hw = riverHW(x), D = bankRun(x), q = 0.05 + rnd() * 0.55;
    var z = riverC(x) + side * (hw + q * D);
    var p = P(x, z), rr = (0.022 + rnd() * 0.06) * ppm, gv = 84 + rnd() * 56;
    var g = ctx.createRadialGradient(p[0] - rr * 0.3, p[1] - rr * 0.3, rr * 0.1, p[0], p[1], rr);
    g.addColorStop(0, 'rgb(' + (gv + 22) + ',' + (gv + 19) + ',' + (gv + 10) + ')');
    g.addColorStop(1, 'rgb(' + (gv - 20) + ',' + (gv - 22) + ',' + (gv - 26) + ')');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(p[0], p[1], rr * 1.25, rr, rnd() * 3.14, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
  }
  /* batu di dasar sungai */
  for (var j = 0; j < 260; j++) {
    var xb = XMIN + rnd() * WX, cb = riverC(xb), hb = riverHW(xb) * 0.9;
    var zb = cb + (rnd() * 2 - 1) * hb, pb = P(xb, zb), rb = (0.04 + rnd() * 0.12) * ppm, gb = 80 + rnd() * 50;
    ctx.fillStyle = 'rgb(' + gb + ',' + (gb - 4) + ',' + (gb - 12) + ')';
    ctx.beginPath(); ctx.ellipse(pb[0], pb[1], rb * 1.3, rb, rnd() * 3, 0, 6.283); ctx.fill();
  }
  /* beberapa serpihan sampah di tepi tebing */
  var cols = ['#e8e8e4', '#e2552b', '#2d77c8', '#f0c53a', '#2b2b2e', '#cfd7c8'];
  for (var k = 0; k < 90; k++) {
    var xs = XMIN + rnd() * WX, sd = rnd() < 0.5 ? -1 : 1;
    var zs = riverC(xs) + sd * (riverHW(xs) + rnd() * bankRun(xs) * 0.9 + 0.1), ps = P(xs, zs);
    ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
    ctx.save(); ctx.translate(ps[0], ps[1]); ctx.rotate(rnd() * 3.14);
    ctx.fillRect(-1.2 - rnd() * 2, -0.8 - rnd(), 2.4 + rnd() * 3.5, 1.6 + rnd() * 1.5);
    ctx.restore();
  }
  groundTex = gp.tex;
  groundTex.needsUpdate = true;
});

task('Membuat tekstur beton, aspal, dan lapisan tanah', function () {
  concreteTexA = makeConcrete(coarse ? 512 : 1024, { wet: false, stain: true });
  concreteTexA.wrapS = concreteTexA.wrapT = THREE.RepeatWrapping;
  wallTex = makeConcrete(coarse ? 512 : 1024, { wet: true, moss: true, stain: true });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  asphaltTex = makeAsphalt(512);
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  strataTex = makeStrata(coarse ? 1024 : 2048, 512);
  strataTex.wrapS = THREE.RepeatWrapping; strataTex.wrapT = THREE.ClampToEdgeWrapping; strataTex.flipY = false;
  strataTex.needsUpdate = true;
});

/* ---------- bangun jaring tanah ---------- */
var terrain, terrainMat;
detailTex = pixelTex(256, 256, function (u, v, out) { var n = tfbm(u, v, 8, 4) * 0.7 + tnoise(u, v, 64) * 0.3; var c = 255 * n; out[0] = c; out[1] = c; out[2] = c; }, { linear: true, repeat: [1, 1] }).tex;
detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
task('Membentuk medan', function () {
  var NX = coarse ? 160 : 200, NZ = Math.round(NX * WZ / WX);
  var pos = new Float32Array((NX + 1) * (NZ + 1) * 3), nor = new Float32Array(pos.length), uv = new Float32Array((NX + 1) * (NZ + 1) * 2);
  var col = new Float32Array(pos.length), wall = new Float32Array((NX + 1) * (NZ + 1));
  var e = 0.08, k = 0, ku = 0, kc = new THREE.Color();
  for (var j = 0; j <= NZ; j++) {
    for (var i = 0; i <= NX; i++) {
      var x = XMIN + i / NX * WX, z = ZMIN + j / NZ * WZ, h = heightAt(x, z);
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      var dhx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dhz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      var il = 1 / Math.sqrt(dhx * dhx + 1 + dhz * dhz);
      nor[k] = -dhx * il; nor[k + 1] = il; nor[k + 2] = -dhz * il;
      uv[ku] = i / NX; uv[ku + 1] = j / NZ;
      var ao = lerp(0.5, 1, smooth(-0.95, 1.2, h));
      if (Math.abs(x) < 1.8 && h < 1.4) ao *= lerp(1, 0.5, smooth(1.8, 1.3, Math.abs(x)));
      kc.setRGB(ao, ao, ao);
      col[k] = kc.r; col[k + 1] = kc.g; col[k + 2] = kc.b;
      wall[j * (NX + 1) + i] = 1 - smooth(3.8, 5.4, Math.abs(x));
      k += 3; ku += 2;
    }
  }
  var idx = [];
  for (var jj = 0; jj < NZ; jj++) {
    for (var ii = 0; ii < NX; ii++) {
      var a = jj * (NX + 1) + ii, b = (jj + 1) * (NX + 1) + ii, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aWall', new THREE.BufferAttribute(wall, 1));
  g.setIndex(idx);
  terrainMat = new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 0.96, metalness: 0 });
  terrainMat.onBeforeCompile = function (sh) {
    sh.uniforms.wallMap = { value: wallTex }; sh.uniforms.detailMap = { value: detailTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWall; varying float vWall; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D wallMap; uniform sampler2D detailMap; varying float vWall; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n' +
        '{ vec3 wn = normalize(vWN); float st = smoothstep(0.66, 0.34, wn.y) * vWall;\n' +
        '  vec2 wuv = abs(wn.z) > abs(wn.x) ? vec2(vWP.x, vWP.y) : vec2(vWP.z, vWP.y);\n' +
        '  vec4 wc = mapTexelToLinear(texture2D(wallMap, wuv * 0.5));\n' +
        '  float dn = texture2D(detailMap, vWP.xz * 0.83).r * 0.55 + texture2D(detailMap, vWP.xz * 3.3 + 0.37).r * 0.45;\n' +
        '  diffuseColor.rgb *= mix(0.74, 1.26, dn);\n' +
        '  diffuseColor.rgb = mix(diffuseColor.rgb, wc.rgb * 0.92, st); }');
  };
  terrain = new THREE.Mesh(g, terrainMat);
  terrain.receiveShadow = true; terrain.castShadow = true;
  world.add(terrain);

  /* sisi potongan blok tanah */
  function sideStrip(pts, nx, nz, uScale) {
    var n = pts.length, pp = [], nn = [], uu = [], ii2 = [], u = 0;
    for (var m = 0; m < n; m++) {
      if (m > 0) u += Math.hypot(pts[m].x - pts[m - 1].x, pts[m].z - pts[m - 1].z);
      var p = pts[m], yt = p.top;
      pp.push(p.x, SOILBOT, p.z, p.x, yt, p.z);
      nn.push(nx, 0, nz, nx, 0, nz);
      uu.push(u * uScale, 1, u * uScale, (1.8 - yt) / (1.8 - SOILBOT));
    }
    for (var q2 = 0; q2 < n - 1; q2++) {
      var b0 = q2 * 2, b1 = q2 * 2 + 1, c0 = q2 * 2 + 2, c1 = q2 * 2 + 3;
      ii2.push(b0, c0, b1, b1, c0, c1);
    }
    var gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    gg.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(uu, 2));
    gg.setIndex(ii2);
    /* arah muka: sesuaikan dengan normal yang diharapkan */
    var A = new V3(pp[0], pp[1], pp[2]), Bv = new V3(pp[6], pp[7], pp[8]), Cv = new V3(pp[3], pp[4], pp[5]);
    var tn = new V3().crossVectors(Bv.clone().sub(A), Cv.clone().sub(A));
    if (tn.x * nx + tn.z * nz < 0) {
      var ix = gg.index.array; for (var w = 0; w < ix.length; w += 3) { var t2 = ix[w + 1]; ix[w + 1] = ix[w + 2]; ix[w + 2] = t2; }
    }
    return gg;
  }
  var sm = new THREE.MeshStandardMaterial({ map: strataTex, roughness: 0.98, metalness: 0 });
  var step = 0.1, ptsE = [], ptsW = [], ptsN = [], ptsS = [];
  for (var zz = ZMIN; zz <= ZMAX + 1e-6; zz += step) { ptsE.push({ x: XMAX, z: zz, top: heightAt(XMAX, zz) }); ptsW.push({ x: XMIN, z: zz, top: heightAt(XMIN, zz) }); }
  for (var xx = XMIN; xx <= XMAX + 1e-6; xx += 0.2) { ptsN.push({ x: xx, z: ZMIN, top: heightAt(xx, ZMIN) }); ptsS.push({ x: xx, z: ZMAX, top: heightAt(xx, ZMAX) }); }
  [[ptsE, 1, 0, 1 / 8], [ptsW, -1, 0, 1 / 8], [ptsN, 0, -1, 1 / 8], [ptsS, 0, 1, 1 / 8]].forEach(function (s2) {
    var m = new THREE.Mesh(sideStrip(s2[0], s2[1], s2[2], s2[3]), sm);
    m.receiveShadow = true; m.castShadow = true; m.userData.noPip = true;
    world.add(m);
  });
  /* penampang air di ujung sungai */
  var wmat = new THREE.MeshStandardMaterial({ color: lin(0x2f7f93), transparent: true, opacity: 0.58, roughness: 0.12, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  [[XMAX, 1], [XMIN, -1]].forEach(function (e2) {
    var pp2 = [], ii3 = [], nn2 = [];
    var cnt = 0;
    for (var z3 = ZMIN; z3 <= ZMAX + 1e-6; z3 += 0.1) {
      var bd = Math.min(heightAt(e2[0], z3), 0);
      pp2.push(e2[0], bd, z3, e2[0], 0, z3); nn2.push(e2[1], 0, 0, e2[1], 0, 0); cnt++;
    }
    for (var q3 = 0; q3 < cnt - 1; q3++) ii3.push(q3 * 2, q3 * 2 + 2, q3 * 2 + 1, q3 * 2 + 1, q3 * 2 + 2, q3 * 2 + 3);
    var gw = new THREE.BufferGeometry();
    gw.setAttribute('position', new THREE.Float32BufferAttribute(pp2, 3));
    gw.setAttribute('normal', new THREE.Float32BufferAttribute(nn2, 3));
    gw.setIndex(ii3);
    var mm = new THREE.Mesh(gw, wmat); mm.renderOrder = 1; mm.userData.noPip = true; world.add(mm);
  });
});

/* ---------- air ---------- */
var waterMesh, waterU;
var rackX = -3.3;                         /* letak saringan sampah */
task('Membuat air sungai', function () {
  /* peta kedalaman */
  var dw = 512, dh = Math.round(dw * WZ / WX);
  var dp = pixelTex(dw, dh, function (u, v, out) {
    var h = heightAt(XMIN + u * WX, ZMIN + v * WZ);
    var d = clamp(-h / 0.95, 0, 1) * 255;
    out[0] = d; out[1] = d; out[2] = d;
  }, { linear: true, noFlip: true, clamp: true });
  depthTex = dp.tex; depthTex.minFilter = THREE.LinearFilter; depthTex.generateMipmaps = false;
  /* peta busa dan bayangan, digambar ulang saat perlu */
  foamC = makeCanvas(256, 176); foamTex = canvasTex(foamC, { linear: true, noFlip: true, clamp: true });
  shadeC = makeCanvas(256, 176); shadeTex = canvasTex(shadeC, { linear: true, noFlip: true, clamp: true });
  foamTex.minFilter = shadeTex.minFilter = THREE.LinearFilter; foamTex.generateMipmaps = shadeTex.generateMipmaps = false;
  /* peta normal riak */
  var rp = pixelTex(256, 256, function (u, v, out) {
    var e = 1 / 256, amp = 5.0;
    function H(a, b) { var n = tfbm(a, b, 6, 4), r = 1 - Math.abs(2 * tfbm(a + 0.37, b + 0.11, 10, 3) - 1); return n * 0.6 + r * 0.4; }
    var nx = (H(u - e, v) - H(u + e, v)) * amp, ny = (H(u, v - e) - H(u, v + e)) * amp;
    var il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    out[0] = (nx * il * 0.5 + 0.5) * 255; out[1] = (ny * il * 0.5 + 0.5) * 255; out[2] = (il * 0.5 + 0.5) * 255;
  }, { linear: true, repeat: [1, 1] });
  rippleTex = rp.tex; rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;

  waterU = {
    uTime: skyU.uTime, uSunDir: skyU.uSunDir, uZenith: skyU.uZenith, uHorizon: skyU.uHorizon, uGround: skyU.uGround, uSunCol: skyU.uSunCol,
    uNight: skyU.uNight, uCloud: { value: 0 }, uDisc: skyU.uDisc,
    uDepth: { value: depthTex }, uFoam: { value: foamTex }, uShade: { value: shadeTex }, uRipple: { value: rippleTex },
    uMin: { value: new V2(XMIN, ZMIN) }, uSize: { value: new V2(WX, WZ) }, uFlow: { value: new V2(1, 0.0) },
    uTurb: { value: 0.35 },
    uLamp0: { value: new V3(0, 5, 0) }, uLamp1: { value: new V3(0, 5, 0) }, uLampI: { value: 0 }
  };
  var wm = new THREE.ShaderMaterial({
    uniforms: waterU, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'varying vec3 vW;',
      'uniform sampler2D uDepth; uniform sampler2D uFoam; uniform sampler2D uShade; uniform sampler2D uRipple;',
      'uniform vec2 uMin; uniform vec2 uSize; uniform vec2 uFlow; uniform float uTurb;',
      'uniform vec3 uLamp0; uniform vec3 uLamp1; uniform float uLampI;',
      SKY_FN,
      'void main(){',
      '  vec2 muv = (vW.xz - uMin) / uSize;',
      '  float depth = texture2D(uDepth, muv).r;',
      '  float foamMap = texture2D(uFoam, muv).r;',
      '  float shade = texture2D(uShade, muv).r;',
      '  vec2 p = vW.xz;',
      '  vec3 r1 = texture2D(uRipple, p * 0.33 - uFlow * uTime * 0.07).xyz * 2.0 - 1.0;',
      '  vec3 r2 = texture2D(uRipple, p * 0.9 + vec2(0.31, 0.17) - uFlow * uTime * 0.16).xyz * 2.0 - 1.0;',
      '  vec3 r3 = texture2D(uRipple, p * 2.4 - uFlow * uTime * 0.3 + vec2(0.7, 0.2)).xyz * 2.0 - 1.0;',
      '  float calm = 1.0 - foamMap * 0.5;',
      '  vec2 sl = (r1.xy * 0.55 + r2.xy * 0.35 + r3.xy * 0.2) * 0.34 * calm;',
      '  sl += vec2(0.035 * sin(p.x * 0.8 + uTime * 0.9), 0.03 * sin(p.y * 1.1 - uTime * 0.7));',
      '  vec3 N = normalize(vec3(sl.x, 1.0, sl.y));',
      '  vec3 V = normalize(cameraPosition - vW);',
      '  float nv = max(dot(N, V), 0.0);',
      '  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);',
      '  vec3 R = reflect(-V, N); R.y = abs(R.y);',
      '  vec3 refl = skyCol(R, 0.0);',
      '  float day = clamp(uSunDir.y, 0.0, 1.0);',
      '  vec3 light = uSunCol * (0.25 + 0.75 * day) * (1.0 - 0.8 * shade) * (1.0 - uNight * 0.85) + uHorizon * 0.55 + uZenith * 0.25 + vec3(0.30, 0.40, 0.58) * uNight * (1.0 - 0.6 * shade);',
      '  vec3 shallow = vec3(0.115, 0.20, 0.145), deep = vec3(0.012, 0.062, 0.075), turb = vec3(0.17, 0.125, 0.06);',
      '  vec3 body = mix(shallow, deep, smoothstep(0.0, 0.85, depth));',
      '  body = mix(body, turb, uTurb * (1.0 - 0.5 * smoothstep(0.0, 0.8, depth)));',
      '  body *= light * 0.9;',
      '  vec3 col = mix(body, refl * (1.0 - 0.55 * shade), clamp(fres * 0.95 + 0.04, 0.0, 1.0));',
      '  float gl = pow(max(dot(R, uSunDir), 0.0), 500.0) * 9.0 * (1.0 - shade);',
      '  col += uSunCol * gl * (1.0 - uNight);',
      '  col += vec3(0.42, 0.56, 0.85) * (pow(max(dot(R, uSunDir), 0.0), 90.0) * 0.55 + pow(max(dot(R, uSunDir), 0.0), 700.0) * 3.0) * uNight * (1.0 - shade);',
      '  vec3 l0 = uLamp0 - vW; vec3 l1 = uLamp1 - vW;',
      '  col += vec3(1.0, 0.72, 0.4) * uLampI * (pow(max(dot(R, normalize(l0)), 0.0), 120.0) / (1.0 + 0.05 * dot(l0, l0)) + pow(max(dot(R, normalize(l1)), 0.0), 120.0) / (1.0 + 0.05 * dot(l1, l1))) * 2.5;',
      '  float shore = 1.0 - smoothstep(0.0, 0.1, depth);',
      '  float fn = n2(p * 5.0 + uFlow * uTime * 0.15) * 0.55 + n2(p * 13.0 - uFlow * uTime * 0.25) * 0.45;',
      '  float fm = clamp(foamMap * 1.15 + shore * 0.9, 0.0, 1.0);',
      '  float foam = smoothstep(0.48, 0.74, fn + fm * 0.7 - 0.28) * fm;',
      '  vec3 foamCol = vec3(0.86, 0.88, 0.84) * (light * 0.65 + 0.14);',
      '  col = mix(col, foamCol, foam * 0.62);',
      '  float alpha = mix(0.42, 0.95, smoothstep(0.02, 0.55, depth));',
      '  alpha = max(alpha, max(fres, foam));',
      '  gl_FragColor = vec4(col, alpha);',
      '  #include <tonemapping_fragment>',
      '  #include <encodings_fragment>',
      '}'
    ].join('\n')
  });
  waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(WX, WZ, 1, 1), wm);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.renderOrder = 1;
  world.add(waterMesh);
});

/* ---------- peta bayangan jembatan dan busa ---------- */
function redrawShade() {
  var g = shadeC.getContext('2d'), W = shadeC.width, H = shadeC.height, ppm = W / WX;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  function P(x, z) { return [(x - XMIN) * ppm, (z - ZMIN) * ppm]; }
  var d = skyU.uSunDir.value, dy = Math.max(d.y, 0.1);
  var ox = -d.x / dy * 1.45, oz = -d.z / dy * 1.45;
  function rect(x0, z0, x1, z1, a) {
    var p0 = P(x0, z0), p1 = P(x1, z1);
    g.fillStyle = 'rgba(255,255,255,' + a + ')';
    g.fillRect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]);
  }
  var up = clamp(skyU.uSunDir.value.y * 6, 0, 1) * (1 - skyU.uNight.value);
  for (var k = 0; k < 5; k++) {
    var gr = 0.06 * k;
    rect(-1.5 + ox - gr, -3.9 + oz - gr, 1.5 + ox + gr, 3.9 + oz + gr, 0.22 * up);
  }
  for (var k2 = 0; k2 < 5; k2++) { var g2 = 0.07 * k2; rect(-1.5 - g2, -3.9 - g2, 1.5 + g2, 3.9 + g2, 0.12); }
  shadeTex.needsUpdate = true;
}
var foamItems = [];
function redrawFoam() {
  var g = foamC.getContext('2d'), W = foamC.width, ppm = W / WX;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000'; g.fillRect(0, 0, W, foamC.height);
  g.globalCompositeOperation = 'lighter';
  function P(x, z) { return [(x - XMIN) * ppm, (z - ZMIN) * ppm]; }
  var pr = P(rackX - 0.12, riverC(rackX)), hwr = riverHW(rackX) * ppm;
  var gr = g.createLinearGradient(pr[0] - 5, 0, pr[0] + 8, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(pr[0] - 5, pr[1] - hwr, 13, hwr * 2);
  for (var i = 0; i < foamItems.length; i++) {
    var it = foamItems[i];
    if (!it.on) continue;
    var p = P(it.x, it.z), rr = Math.max(1.4, it.r * ppm * 1.15);
    var rg = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr);
    rg.addColorStop(0, 'rgba(255,255,255,0.16)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(p[0], p[1], rr, 0, 6.283); g.fill();
  }
  foamTex.needsUpdate = true;
}

/* =====================================================================
   JEMBATAN, SARINGAN, TIANG, RUMAH, PERLENGKAPAN
   ===================================================================== */
var DECK_TOP = 1.6, SLAB_BOT = 1.28;
var POD = { x: -1.515, y: 1.245, z: 0.6 };        /* pusat pod, depan menghadap barat (-x) */
var HUB = { x: -1.14, y: 1.245, z: 0.6 };         /* pusat box hub, sisi panjang sepanjang x */
var HUBW = 0.115, HUBH = 0.055, HUBD = 0.09;      /* ukuran box hub (m) */
var POLE = { x: -2.8, z: -5.4 };
var ADP = { x: -2.8 + 0.16, y: GY + 1.6, z: POLE.z };

/* UV berdasarkan koordinat dunia (m) supaya tekstur tidak melar */
function worldUV(g, tile) {
  var p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (var i = 0; i < p.count; i++) {
    var ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function gbox(w, h, d, x, y, z, ry, rx, rz) {
  var g = new THREE.BoxGeometry(w, h, d);
  var m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
  m.setPosition(x || 0, y || 0, z || 0);
  g.applyMatrix4(m);
  return g;
}
function gcyl(rt, rb, h, seg, x, y, z, rx, ry, rz) {
  var g = new THREE.CylinderGeometry(rt, rb, h, seg || 10);
  var m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
  m.setPosition(x || 0, y || 0, z || 0);
  g.applyMatrix4(m);
  return g;
}
function mergeMesh(parent, geos, m, opt) {
  var g = BGU.mergeBufferGeometries(geos, false);
  var me = new THREE.Mesh(g, m);
  me.castShadow = !(opt && opt.noCast); me.receiveShadow = !(opt && opt.noRecv);
  parent.add(me);
  return me;
}
/* kurva kabel berpenampang bulat */
function tube(parent, pts, r, m, seg, closed, opt) {
  var c = new THREE.CatmullRomCurve3(pts, !!closed, 'catmullrom', 0.3);
  var me = new THREE.Mesh(new THREE.TubeGeometry(c, seg || 60, r, 6, !!closed), m);
  me.castShadow = !(opt && opt.noCast); me.receiveShadow = true;
  parent.add(me);
  return { mesh: me, curve: c };
}
function textPanelTex(w, h, draw) {
  var c = makeCanvas(w, h), g = c.getContext('2d');
  draw(g, w, h);
  return canvasTex(c, {});
}

var concMat, steelMat, paintWhite, darkMat, galvMat, rubberMat, asphaltMat, houseMats = {};
task('Membangun jembatan dan saringan sampah', function () {
  concMat = new THREE.MeshStandardMaterial({ map: concreteTexA, color: lin(0xe6e3dc), roughness: 0.92, metalness: 0 });
  steelMat = mat(0x8e979f, { metalness: 0.78, roughness: 0.42 });
  galvMat = mat(0xaab2b9, { metalness: 0.7, roughness: 0.38 });
  paintWhite = mat(0xdadee0, { roughness: 0.5, metalness: 0.25 });
  darkMat = mat(0x1e2226, { roughness: 0.65 });
  rubberMat = mat(0x15171a, { roughness: 0.8 });
  asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: lin(0xffffff), roughness: 0.93, metalness: 0 });
  asphaltTex.repeat.set(1.5, 11);

  /* ---- jalan dan dek ---- */
  var deck = [];
  deck.push(worldUV(gbox(3.0, 0.24, 7.9, 0, 1.4, 0), 2));
  deck.push(worldUV(gbox(0.3, 0.1, 7.9, -1.35, 1.0, 0), 2));
  mergeMesh(world, deck, concMat);
  /* gelagar */
  var gird = [];
  [-0.75, 0.75].forEach(function (x) { gird.push(worldUV(gbox(0.3, 0.28, 7.7, x, 1.14, 0), 2)); });
  [-3.8, 3.8].forEach(function (z) { gird.push(worldUV(gbox(3.0, 0.3, 0.26, 0, 1.13, z), 2)); });
  [-1.9, 1.9].forEach(function (z) { gird.push(worldUV(gbox(1.5, 0.16, 0.18, 0, 1.2, z), 2)); });
  mergeMesh(world, gird, concMat);
  /* aspal */
  var road = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 22), asphaltMat);
  road.position.set(0, 1.55, 0); road.receiveShadow = true; road.castShadow = true;
  /* UV dunia untuk aspal */
  worldUV(road.geometry, 2);
  world.add(road);
  /* marka jalan */
  var mk = textPanelTex(128, 1024, function (g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(236,234,226,0.92)';
    g.fillRect(w * 0.06, 0, 4, h); g.fillRect(w * 0.94 - 4, 0, 4, h);
    for (var y = 0; y < h; y += 1024 / 11) { g.fillStyle = 'rgba(240,206,70,0.92)'; g.fillRect(w * 0.5 - 2.5, y + 12, 5, 1024 / 11 * 0.5); }
  });
  var mkMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 22), new THREE.MeshStandardMaterial({ map: mk, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mkMesh.rotation.x = -Math.PI / 2; mkMesh.position.y = 1.6015; mkMesh.receiveShadow = true;
  world.add(mkMesh);
  /* trotoar kecil / lis tepi dek */
  var curbs = [];
  [-1, 1].forEach(function (s) {
    curbs.push(worldUV(gbox(0.22, 0.12, 8.8, s * 1.39, 1.66, 0), 2));
  });
  mergeMesh(world, curbs, concMat);
  /* sambungan muai */
  [-3.95, 3.95].forEach(function (z) {
    var j = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.06), new THREE.MeshBasicMaterial({ color: 0x15171a }));
    j.rotation.x = -Math.PI / 2; j.position.set(0, 1.602, z); world.add(j);
  });

  /* ---- railing ---- */
  var posts = [], rails = [];
  [-1, 1].forEach(function (s) {
    for (var z = -4.4; z <= 4.41; z += 1.1) {
      posts.push(gcyl(0.035, 0.035, 0.95, 8, s * 1.39, 2.19, z));
      posts.push(gcyl(0.07, 0.07, 0.015, 10, s * 1.39, 1.72, z));
    }
    rails.push(gcyl(0.03, 0.03, 8.8, 8, s * 1.39, 2.62, 0, Math.PI / 2, 0, 0));
    rails.push(gcyl(0.022, 0.022, 8.8, 8, s * 1.39, 2.3, 0, Math.PI / 2, 0, 0));
    rails.push(gcyl(0.022, 0.022, 8.8, 8, s * 1.39, 1.98, 0, Math.PI / 2, 0, 0));
  });
  mergeMesh(world, posts.concat(rails), paintWhite);

  /* ---- pagar pengaman di tepi tebing dekat jembatan ---- */
  var gp = [];
  [-1, 1].forEach(function (sx) {
    [-1, 1].forEach(function (sz) {
      for (var x = 1.9; x <= 4.9; x += 1.0) {
        var xx = sx * x, c = riverC(xx), zz = c + sz * (riverHW(xx) + bankRun(xx) + 0.22);
        gp.push(gcyl(0.025, 0.025, 0.95, 6, xx, GY + 0.45, zz));
      }
      var xa = sx * 1.9, xb = sx * 4.9, za = riverC(xa) + sz * (riverHW(xa) + bankRun(xa) + 0.22), zb = riverC(xb) + sz * (riverHW(xb) + bankRun(xb) + 0.22);
      [0.95, 0.5].forEach(function (hh) {
        var a = new V3(xa, GY - 0.02 + hh, za), b = new V3(xb, GY - 0.02 + hh, zb), d = b.clone().sub(a), len = d.length();
        var g = new THREE.CylinderGeometry(0.02, 0.02, len, 6);
        g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize())));
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        gp.push(g);
      });
    });
  });
  mergeMesh(world, gp, galvMat, { noRecv: true });

  /* ---- saringan sampah (miring ke hulu) ---- */
  var cR = riverC(rackX), hwR = riverHW(rackX), rackTilt = 0.26;
  var barCount = 30, barH = 1.6;
  var barGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  var bars = new THREE.InstancedMesh(barGeo, galvMat, barCount);
  var dm = new THREE.Object3D();
  for (var b = 0; b < barCount; b++) {
    var zz = cR - hwR + 0.06 + (b / (barCount - 1)) * (hwR * 2 - 0.12);
    var bedH = heightAt(rackX, zz);
    var top = 0.42, bot = bedH - 0.04, len = (top - bot) / Math.cos(rackTilt);
    dm.position.set(rackX - Math.sin(rackTilt) * (top + bot) / 2, (top + bot) / 2, zz);
    dm.rotation.set(0, 0, rackTilt);
    dm.scale.set(1, len, 1);
    dm.updateMatrix();
    bars.setMatrixAt(b, dm.matrix);
  }
  bars.castShadow = true; bars.receiveShadow = true;
  world.add(bars);
  var rk = [];
  [0.4, -0.25].forEach(function (yy) {
    var xo = rackX - Math.sin(rackTilt) * yy;
    rk.push(gbox(0.07, 0.05, hwR * 2 + 0.2, xo, yy + 0.02, cR, 0, 0, rackTilt));
  });
  [-1, 1].forEach(function (s) {
    rk.push(gbox(0.12, 1.9, 0.12, rackX - 0.1, -0.2, cR + s * (hwR + 0.02), 0, 0, rackTilt));
  });
  mergeMesh(world, rk, mat(0x6f7882, { metalness: 0.7, roughness: 0.5 }));
  /* angkur beton di tepi */
  var anc = [];
  [-1, 1].forEach(function (s) { anc.push(worldUV(gbox(0.5, 0.35, 0.4, rackX - 0.05, 0.12, cR + s * (hwR + 0.12)), 2)); });
  mergeMesh(world, anc, concMat);

  /* ---- papan duga di dinding utara (menghadap selatan, terlihat dari sisi jalan) ---- */
  var gt = textPanelTex(64, 512, function (g, w, h) {
    g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 20; i++) { g.fillStyle = (i % 2 ? '#1c5fa8' : '#f2f2ee'); g.fillRect(0, h - (i + 1) * (h / 20), w * 0.42, h / 20); }
    g.fillStyle = '#c8321f';
    for (var m = 0; m <= 4; m++) g.fillRect(w * 0.42, h - m * 5 * (h / 20) - 3, w * 0.58, 3);
    g.fillStyle = '#111'; g.font = '600 17px sans-serif';
    for (var n = 1; n <= 3; n++) { g.fillText(String(n * 0.5).replace('.', ',') + (n % 2 ? '' : ''), w * 0.46, h - n * 5 * (h / 20) - 6); }
  });
  var gaugeX = rackX + 1.0, gH = 2.0, gwz = riverC(gaugeX) - riverHW(gaugeX), gD = bankRun(gaugeX), gh0 = BEDY + 0.62;
  var gyc = 0.55, gtt = (gyc - gh0) / (GY - gh0), gtilt = Math.atan2(gD, GY - gh0);
  var gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.16, gH), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.5 }));
  gauge.position.set(gaugeX, gyc, gwz - gD * gtt + 0.02);
  gauge.rotation.x = -gtilt;
  gauge.castShadow = false; gauge.receiveShadow = true;
  world.add(gauge);

  /* ---- tanda informasi (menjelaskan tujuan kamera) ---- */
  var st = textPanelTex(512, 340, function (g, w, h) {
    g.fillStyle = '#0d4f7c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#0d4f7c'; g.fillRect(14, 14, w - 28, 62);
    g.fillStyle = '#ffffff'; g.font = '700 30px sans-serif'; g.fillText('AREA PEMANTAUAN SUNGAI', 30, 56);
    g.fillStyle = '#1b2a36'; g.font = '500 24px sans-serif';
    g.fillText('Kamera hanya memantau permukaan air', 30, 122);
    g.fillText('untuk mendeteksi penumpukan sampah.', 30, 154);
    g.fillText('Video tidak direkam. Hanya foto zona', 30, 196);
    g.fillText('air yang dikirim saat ada peringatan.', 30, 228);
    g.font = '600 22px sans-serif'; g.fillStyle = '#0d4f7c'; g.fillText('Riverwatch  ·  Titik 1', 30, 288);
  });
  var signX = -4.1, signZ = riverC(signX) - riverHW(signX) - bankRun(signX) - 0.8;
  var sg = new THREE.Group(); sg.position.set(signX, GY, signZ); sg.rotation.y = 0; world.add(sg);
  add(sg, new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ map: st, roughness: 0.4, metalness: 0.1 }), 0, 1.45, 0.021, { noCast: true });
  add(sg, B(0.92, 0.62, 0.04), galvMat, 0, 1.45, 0);
  [-0.38, 0.38].forEach(function (x) { add(sg, Cy(0.025, 0.025, 1.8, 8), galvMat, x, 0.9, -0.04); });

  /* ---- tiang listrik, kotak adaptor, kawat ---- */
  var woodTex = pixelTex(128, 256, function (u, v, out) {
    var n = tnoise(u * 8 % 1, v, 8) * 0.5 + tfbm(u, v, 24, 3) * 0.5, g = 96 + 40 * n - 14 * Math.abs(Math.sin(v * 40 + n * 5));
    out[0] = g + 18; out[1] = g; out[2] = g - 26;
  }, { repeat: [1, 3] }).tex;
  var woodMat = new THREE.MeshStandardMaterial({ map: woodTex, color: lin(0xb89870), roughness: 0.92 });
  function pole(x, z) {
    var p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.145, 7.4, 12), woodMat);
    p.position.set(x, GY + 3.7, z); p.castShadow = true; p.receiveShadow = true; world.add(p);
    var arm = [gbox(1.9, 0.09, 0.09, x, GY + 7.05, z)];
    [-0.7, 0, 0.7].forEach(function (o) { arm.push(gcyl(0.026, 0.035, 0.16, 8, x + o, GY + 7.17, z)); });
    mergeMesh(world, arm, woodMat);
    var ins = [];
    [-0.7, 0, 0.7].forEach(function (o) { ins.push(gcyl(0.04, 0.05, 0.1, 10, x + o, GY + 7.22, z)); });
    mergeMesh(world, ins, mat(0xb8c0c6, { roughness: 0.25, metalness: 0.1 }), { noRecv: true });
  }
  pole(POLE.x, POLE.z); pole(POLE.x, -10.2);
  var wireM = mat(0x0f1114, { roughness: 0.6 });
  [-0.7, 0, 0.7].forEach(function (o) {
    var pts = [], zA = POLE.z, zB = -10.2;
    for (var i = 0; i <= 14; i++) {
      var z2 = lerp(zA, -11, i / 14), u = (z2 - zA) / (zB - zA), sag = (u >= 0 && u <= 1) ? 0.45 * 4 * u * (1 - u) : 0;
      pts.push(new V3(POLE.x + o, GY + 7.26 - sag, z2));
    }
    tube(world, pts, 0.011, wireM, 60, false, { noCast: false });
  });
  /* kotak adaptor di tiang */
  var ab = [];
  var box = new THREE.Group(); box.position.set(ADP.x + 0.07, ADP.y, ADP.z); world.add(box);
  add(box, B(0.14, 0.3, 0.24), mat(0xe4e8ea, { roughness: 0.45 }), 0, 0, 0);
  add(box, B(0.15, 0.04, 0.25), mat(0xc9ced1, { roughness: 0.5 }), 0, 0.17, 0);
  add(box, B(0.012, 0.22, 0.2), mat(0xcfd5d8, { roughness: 0.5 }), 0.077, 0, 0, { noCast: true });
  add(box, Cy(0.012, 0.012, 0.03, 8), darkMat, 0.0, -0.165, 0.0, { noCast: true });
  [[-0.05, 0.1], [0.05, 0.1], [-0.05, -0.1], [0.05, -0.1]].forEach(function (s2) { add(box, Cy(0.008, 0.008, 0.012, 6), steelMat, 0.081, s2[0] * 2.2, s2[1], { noCast: true }).rotation.z = Math.PI / 2; });
  /* kabel layanan dari kawat ke kotak, dan pipa PVC di tiang */
  tube(world, [new V3(POLE.x, GY + 7.15, POLE.z), new V3(POLE.x + 0.13, GY + 6.9, POLE.z), new V3(POLE.x + 0.15, GY + 4, POLE.z), new V3(ADP.x + 0.1, ADP.y + 0.2, ADP.z)], 0.008, wireM, 30);
  var pvc = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, ADP.y - GY - 0.15, 8), mat(0xc8ccd0, { roughness: 0.4 }));
  pvc.position.set(POLE.x + 0.145, GY + (ADP.y - GY - 0.15) / 2 - 0.0, POLE.z); pvc.castShadow = true; world.add(pvc);
});

/* ---------- lampu jalan ---------- */
task('Memasang lampu jalan dan rumah', function () {
  function lamp(x, z, ry) {
    var g = new THREE.Group(); g.position.set(x, GY, z); g.rotation.y = ry; world.add(g);
    add(g, new THREE.CylinderGeometry(0.06, 0.09, 5.4, 10), mat(0x5b646c, { metalness: 0.7, roughness: 0.45 }), 0, 2.7, 0);
    var arm = tube(g, [new V3(0, 5.35, 0), new V3(0, 5.65, 0), new V3(-0.4, 5.85, 0), new V3(-1.2, 5.9, 0)], 0.04, mat(0x5b646c, { metalness: 0.7, roughness: 0.45 }), 24);
    add(g, B(0.42, 0.07, 0.16), mat(0x2b3138, { roughness: 0.5, metalness: 0.5 }), -1.3, 5.9, 0);
    var glass = new THREE.MeshStandardMaterial({ color: lin(0xfff1cf), emissive: lin(0xffc880), emissiveIntensity: 0.0, roughness: 0.3 });
    nightMat(glass, 2.2);
    add(g, B(0.36, 0.03, 0.12), glass, -1.3, 5.86, 0, { noCast: true });
    g.updateMatrixWorld(true);
    var wp = new V3(-1.3, 5.7, 0); g.localToWorld(wp);
    addLamp(wp.x, wp.y, wp.z, 0xffc47a, 6.5, 18);
    return wp;
  }
  var l0 = lamp(1.95, 4.4, 0), l1 = lamp(-1.95, -4.4, Math.PI);
  if (waterU) { waterU.uLamp0.value.copy(l0); waterU.uLamp1.value.copy(l1); }
});

/* =====================================================================
   RUMAH, POHON, RUMPUT, ALANG-ALANG
   ===================================================================== */
var leafTex, frondTex, bananaTex, grassTex, reedTex, wallPlaster, roofTileTex, winTex, winEmTex, doorTex;
var treeSpots = [], houseSpots = [];            /* titik pohon (dipakai untuk menghindari tabrakan) */
function bankTopZ(x, side) { return riverC(x) + side * (riverHW(x) + bankRun(x)); }

task('Menggambar daun, rumput, dan dinding', function () {
  /* daun lebat untuk tajuk pohon */
  var lc = makeCanvas(256, 256), g = lc.getContext('2d'), rnd = rng(5);
  g.fillStyle = '#2d5a24'; g.fillRect(0, 0, 256, 256);
  for (var i = 0; i < 1500; i++) {
    var x = rnd() * 256, y = rnd() * 256, s = 2 + rnd() * 4.5, t = rnd();
    g.fillStyle = t < 0.3 ? 'rgb(34,72,28)' : t < 0.7 ? 'rgb(58,104,38)' : 'rgb(96,140,52)';
    g.save(); g.translate(x, y); g.rotate(rnd() * 6.28);
    g.beginPath(); g.ellipse(0, 0, s, s * 0.42, 0, 0, 6.283); g.fill(); g.restore();
  }
  leafTex = canvasTex(lc, { repeat: [2.4, 2.4] }); leafTex.wrapS = leafTex.wrapT = THREE.RepeatWrapping;

  /* daun kelapa: tulang daun dan helai */
  var fc = makeCanvas(128, 512), f = fc.getContext('2d');
  f.clearRect(0, 0, 128, 512);
  for (var j = 0; j < 70; j++) {
    var yy = 20 + j * 6.8, len = 58 * Math.sin(Math.min(1, (j + 4) / 22) * 1.57) * (1 - 0.35 * (j / 70));
    var shade = 70 + 40 * rnd();
    f.strokeStyle = 'rgb(' + (shade - 28) + ',' + (shade + 50) + ',' + (shade - 40) + ')'; f.lineWidth = 3.1;
    [-1, 1].forEach(function (sd) {
      f.beginPath(); f.moveTo(64, yy); f.quadraticCurveTo(64 + sd * len * 0.6, yy + 10, 64 + sd * len, yy + 34 + len * 0.15); f.stroke();
    });
  }
  f.strokeStyle = '#4c7a2c'; f.lineWidth = 4; f.beginPath(); f.moveTo(64, 0); f.lineTo(64, 512); f.stroke();
  frondTex = canvasTex(fc, { clamp: true });

  /* daun pisang */
  var bc = makeCanvas(128, 256), b = bc.getContext('2d');
  b.clearRect(0, 0, 128, 256);
  var bg = b.createLinearGradient(0, 0, 128, 0); bg.addColorStop(0, '#3f7a2c'); bg.addColorStop(0.5, '#5aa03a'); bg.addColorStop(1, '#3f7a2c');
  b.fillStyle = bg; b.beginPath(); b.ellipse(64, 128, 58, 124, 0, 0, 6.283); b.fill();
  b.strokeStyle = '#8fc060'; b.lineWidth = 3; b.beginPath(); b.moveTo(64, 6); b.lineTo(64, 250); b.stroke();
  b.strokeStyle = 'rgba(30,70,20,0.45)'; b.lineWidth = 1;
  for (var k = 0; k < 26; k++) { var ky = 14 + k * 9; [-1, 1].forEach(function (sd) { b.beginPath(); b.moveTo(64, ky); b.lineTo(64 + sd * 56, ky + 14); b.stroke(); }); }
  b.globalCompositeOperation = 'destination-out';
  for (var m = 0; m < 5; m++) { b.fillStyle = 'rgba(0,0,0,1)'; [-1, 1].forEach(function (sd) { b.fillRect(64 + sd * (24 + m * 2) - 1, 30 + m * 44, 1.6, 30); }); }
  bananaTex = canvasTex(bc, { clamp: true });

  /* rumput */
  var gc = makeCanvas(128, 128), q = gc.getContext('2d');
  q.clearRect(0, 0, 128, 128);
  for (var n = 0; n < 15; n++) {
    var bx = 12 + rnd() * 104, hh = 60 + rnd() * 62, lean = (rnd() - 0.5) * 34, wdt = 3 + rnd() * 3.5;
    var gr = q.createLinearGradient(0, 128, 0, 128 - hh); gr.addColorStop(0, '#2a5a20'); gr.addColorStop(0.6, '#5d9a34'); gr.addColorStop(1, '#a8c860');
    q.fillStyle = gr; q.beginPath(); q.moveTo(bx - wdt, 128); q.quadraticCurveTo(bx - wdt * 0.3 + lean * 0.4, 128 - hh * 0.55, bx + lean, 128 - hh); q.quadraticCurveTo(bx + wdt * 0.3 + lean * 0.4, 128 - hh * 0.55, bx + wdt, 128); q.fill();
  }
  grassTex = canvasTex(gc, { clamp: true });

  /* alang-alang / tebu rawa dengan bulir */
  var rc = makeCanvas(64, 256), r = rc.getContext('2d');
  r.clearRect(0, 0, 64, 256);
  for (var u = 0; u < 6; u++) {
    var rx = 8 + u * 9 + rnd() * 5, rh = 150 + rnd() * 96, rl = (rnd() - 0.5) * 16;
    r.strokeStyle = u % 2 ? '#6f8f3c' : '#8aa44a'; r.lineWidth = 2.6;
    r.beginPath(); r.moveTo(rx, 256); r.quadraticCurveTo(rx + rl * 0.3, 256 - rh * 0.6, rx + rl, 256 - rh); r.stroke();
    if (u % 3 === 0) { r.strokeStyle = '#7a5a34'; r.lineWidth = 6; r.beginPath(); r.moveTo(rx + rl, 256 - rh); r.lineTo(rx + rl * 1.1, 256 - rh - 22); r.stroke(); }
  }
  reedTex = canvasTex(rc, { clamp: true });

  /* dinding plesteran */
  wallPlaster = pixelTex(256, 256, function (u, v, out) {
    var n = tfbm(u, v, 5, 4), s = tnoise(u, v, 90), st = Math.max(0, tfbm(u * 2 % 1, v * 0.3, 6, 3) - 0.55) * 0.5;
    var c = 218 + 22 * (n - 0.5) + 10 * (s - 0.5) - st * 70 - 40 * smooth(0.82, 1, v);
    out[0] = c; out[1] = c - 2; out[2] = c - 6;
  }, { repeat: [1, 1] }).tex;
  wallPlaster.wrapS = wallPlaster.wrapT = THREE.RepeatWrapping;

  /* genteng tanah liat */
  roofTileTex = pixelTex(256, 256, function (u, v, out) {
    var row = (v * 12) % 1, col = ((u * 16) + (Math.floor(v * 12) % 2) * 0.5) % 1;
    var n = tnoise(u, v, 32), m = tfbm(u, v, 6, 3);
    var rib = 0.74 + 0.26 * Math.abs(Math.sin(col * 3.14159));
    var edge = 1 - 0.38 * smooth(0.75, 1, row);
    var base = (130 + 55 * (m - 0.5) + 28 * (n - 0.5)) * rib * edge;
    var moss = smooth(0.62, 0.9, tnoise(u, v, 14)) * 0.5;
    out[0] = lerp(base * 1.06, 66, moss); out[1] = lerp(base * 0.66, 84, moss); out[2] = lerp(base * 0.44, 48, moss);
  }, { repeat: [1, 1] }).tex;
  roofTileTex.wrapS = roofTileTex.wrapT = THREE.RepeatWrapping;

  /* jendela dan pintu: bingkai kayu, kaca, kisi-kisi */
  function drawWin(glassCol, glow) {
    var c = makeCanvas(128, 160), w = c.getContext('2d');
    w.fillStyle = glow ? '#000' : '#5a3e28'; w.fillRect(0, 0, 128, 160);
    var gg = w.createLinearGradient(0, 14, 0, 146);
    if (glow) { gg.addColorStop(0, '#fff'); gg.addColorStop(1, '#fff'); } else { gg.addColorStop(0, glassCol[0]); gg.addColorStop(1, glassCol[1]); }
    w.fillStyle = gg; w.fillRect(14, 14, 100, 132);
    if (!glow) {
      w.fillStyle = 'rgba(255,255,255,0.18)'; w.beginPath(); w.moveTo(14, 14); w.lineTo(64, 14); w.lineTo(14, 80); w.fill();
      w.fillStyle = '#5a3e28'; w.fillRect(60, 14, 8, 132);
    } else { w.fillStyle = '#000'; w.fillRect(60, 14, 8, 132); }
    w.fillStyle = glow ? '#000' : '#5a3e28'; w.fillRect(14, 74, 100, 7);
    return c;
  }
  winTex = canvasTex(drawWin(['#6f8fa6', '#2f4a5c'], false), { clamp: true });
  winEmTex = canvasTex(drawWin(null, true), { clamp: true });
  var dc = makeCanvas(128, 256), d = dc.getContext('2d');
  d.fillStyle = '#6a4a30'; d.fillRect(0, 0, 128, 256);
  for (var p = 0; p < 9; p++) { d.fillStyle = p % 2 ? '#5e4129' : '#70502f'; d.fillRect(8 + p * 12, 8, 11, 240); }
  d.strokeStyle = '#3d2a1a'; d.lineWidth = 4; d.strokeRect(5, 5, 118, 246);
  d.fillStyle = '#c8b070'; d.beginPath(); d.arc(104, 134, 5, 0, 6.28); d.fill();
  doorTex = canvasTex(dc, { clamp: true });
});

/* ---------- rumah ---------- */
function hipRoof(W, D, H, over) {
  var w = W / 2 + over, d = D / 2 + over, R = Math.max(0, (W - D) / 2), rg = R;
  var A = [-w, 0, d], Bq = [w, 0, d], C = [w, 0, -d], Dq = [-w, 0, -d], rA = [-rg, H, 0], rB = [rg, H, 0];
  var pos = [], uv = [], k = 3.2;
  function tri(a, b, c, ua, ub, uc) { pos.push.apply(pos, a.concat(b, c)); uv.push.apply(uv, ua.concat(ub, uc)); }
  var sl = Math.hypot(H, d), sl2 = Math.hypot(H, w - rg);
  /* sisi depan (z+) dan belakang (z-): trapesium */
  var fw = w, rw = rg;
  tri(A, Bq, rB, [0, 0], [2 * w / k, 0], [(w + rg) / k, sl / k]);
  tri(A, rB, rA, [0, 0], [(w + rg) / k, sl / k], [(w - rg) / k, sl / k]);
  tri(C, Dq, rA, [0, 0], [2 * w / k, 0], [(w - rg) / k, sl / k]);
  tri(C, rA, rB, [0, 0], [(w - rg) / k, sl / k], [(w + rg) / k, sl / k]);
  /* sisi kiri dan kanan: segitiga */
  tri(Dq, A, rA, [0, 0], [2 * d / k, 0], [d / k, sl2 / k]);
  tri(Bq, C, rB, [0, 0], [2 * d / k, 0], [d / k, sl2 / k]);
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
var winLit, winDark, doorMat, trimMat;
function house(x, z, ry, W, D, wallCol, roofCol, o) {
  o = o || {};
  houseSpots.push({ x: x, z: z, r: Math.max(W, D) / 2 + 1.0 });
  var g = new THREE.Group(); g.position.set(x, GY, z); g.rotation.y = ry; world.add(g);
  var wallH = o.h || 2.35;
  var wm = new THREE.MeshStandardMaterial({ map: wallPlaster, color: lin(wallCol), roughness: 0.9 });
  worldUVBox(add(g, B(W, wallH, D), wm, 0, wallH / 2 + 0.14, 0), 1.2);
  add(g, B(W + 0.16, 0.16, D + 0.16), concMat, 0, 0.08, 0);                       /* sloof / plinth */
  var roofM = new THREE.MeshStandardMaterial({ map: roofTileTex, color: lin(roofCol), roughness: 0.78, side: THREE.DoubleSide });
  var roof = new THREE.Mesh(hipRoof(W, D, o.rh || 1.05, 0.42), roofM);
  roof.position.y = wallH + 0.14; roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
  /* bubungan */
  add(g, B(Math.max(0.2, W - D) + 0.35, 0.1, 0.14), mat(0x6a2f1c, { roughness: 0.8 }), 0, wallH + 0.14 + (o.rh || 1.05) + 0.02, 0);
  /* jendela dan pintu di muka depan (+z) */
  var fz = D / 2 + 0.012;
  var doorX = o.doorX !== undefined ? o.doorX : -W * 0.22;
  add(g, new THREE.PlaneGeometry(0.82, 1.8), doorMat, doorX, 1.04, fz, { noCast: true });
  add(g, B(0.94, 0.06, 0.1), trimMat, doorX, 1.96, fz + 0.03, { noCast: true });
  var wx = [W * 0.27, W * 0.27 + (W > 3.4 ? 0 : 0)];
  var winM = (hash2(Math.floor(x * 10), Math.floor(z * 10)) > 0.5) ? winLit : winDark;
  add(g, new THREE.PlaneGeometry(0.7, 0.88), winM, wx[0], 1.4, fz, { noCast: true });
  add(g, B(0.82, 0.05, 0.08), trimMat, wx[0], 0.94, fz + 0.03, { noCast: true });
  /* jendela samping */
  [-1, 1].forEach(function (s) {
    var m2 = hash2(Math.floor(x * 7) + s, Math.floor(z * 7)) > 0.5 ? winLit : winDark;
    var wp = add(g, new THREE.PlaneGeometry(0.7, 0.88), m2, s * (W / 2 + 0.012), 1.4, 0, { noCast: true });
    wp.rotation.y = s * Math.PI / 2;
  });
  /* teras kecil bertiang */
  if (o.porch !== false) {
    add(g, B(W * 0.7, 0.1, 0.9), concMat, -W * 0.1, 0.05, D / 2 + 0.45);
    [-0.3, 0.3].forEach(function (s) { add(g, B(0.1, 2.1, 0.1), mat(0xd8d2c4, { roughness: 0.8 }), W * 0.35 * s * 2 - W * 0.1, 1.15, D / 2 + 0.86); });
    add(g, B(W * 0.7 + 0.1, 0.07, 0.1), mat(0xd8d2c4, { roughness: 0.8 }), -W * 0.1, 2.22, D / 2 + 0.86);
  }
  if (o.sign) {
    var tx = textPanelTex(256, 64, function (c, w, h) { c.fillStyle = '#c8321f'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '700 40px sans-serif'; c.textAlign = 'center'; c.fillText(o.sign, w / 2, 46); });
    add(g, new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 }), -W * 0.1, 2.0, D / 2 + 0.92, { noCast: true });
  }
  return g;
}
function worldUVBox(m, tile) { worldUV(m.geometry, tile); return m; }

task('Membangun rumah warga', function () {
  winLit = new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: winEmTex, emissive: lin(0xffc070), emissiveIntensity: 0, roughness: 0.25, metalness: 0.1 });
  nightMat(winLit, 2.4);
  winDark = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.25, metalness: 0.1 });
  doorMat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7 });
  trimMat = mat(0x5a3e28, { roughness: 0.8 });
  /* utara */
  function nz(x, off, d) { return bankTopZ(x, -1) - off - d / 2; }
  house(-8.2, nz(-8.2, 1.3, 2.8), 0, 3.6, 2.8, 0xe8e0cc, 0xb8532f);
  house(5.6, nz(5.6, 1.6, 3.0), 0, 3.8, 3.0, 0xd9e4d0, 0x5d646b, { rh: 0.95 });
  house(10.4, nz(10.4, 1.2, 2.8), 0, 3.2, 2.6, 0xeed9b8, 0xb8532f, { doorX: 0.5 });
  /* selatan (warung dan rumah) */
  var sx = 9.2; house(sx, bankTopZ(sx, 1) + 1.5 + 1.3, Math.PI, 3.6, 2.6, 0xf0e8d8, 0xb8532f, { sign: 'WARUNG', doorX: 0.4 });
});

/* ---------- pohon ---------- */
var barkMat, canopyMat;
function blob(r, seed, tint, sq) {
  var g = new THREE.IcosahedronGeometry(r, 3);
  var rn = rng(seed);
  var off = rn() * 50;
  disp(g, function (v) {
    var n = vnoise3(v.x * 1.7 + off, v.y * 1.7, v.z * 1.7 + off);
    var s = 1 + 0.34 * (n - 0.5) + 0.1 * (vnoise3(v.x * 5 + off, v.y * 5, v.z * 5) - 0.5);
    v.multiplyScalar(s); v.y *= (sq || 0.82);
  });
  paintVerts(g, function (x, y, z) {
    var l = clamp(0.5 + 0.5 * (y / r), 0, 1), k = 0.5 + 0.7 * l * l + 0.1 * (vnoise3(x * 4, y * 4, z * 4) - 0.5);
    return [tint[0] * k, tint[1] * k, tint[2] * k];
  });
  g.deleteAttribute('uv');
  var uv = new Float32Array(g.attributes.position.count * 2), p = g.attributes.position;
  for (var i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 0.9 + p.getZ(i) * 0.3; uv[i * 2 + 1] = p.getY(i) * 0.9 + p.getZ(i) * 0.6; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function bendPlane(w, l, segs, droop, curl) {
  var g = new THREE.PlaneGeometry(w, l, 1, segs);
  g.translate(0, l / 2, 0);                                  /* pangkal di y = 0 */
  var p = g.attributes.position;
  for (var i = 0; i < p.count; i++) {
    var t = p.getY(i) / l, x = p.getX(i);
    p.setXYZ(i, x * (1 - 0.25 * t), t * l * Math.cos(t * droop), t * t * l * Math.sin(droop) * curl);
  }
  g.computeVertexNormals();
  return g;
}
task('Menanam pohon, rumput, dan alang-alang', function () {
  barkMat = new THREE.MeshStandardMaterial({ color: lin(0x6c5238), roughness: 0.95 });
  canopyMat = new THREE.MeshStandardMaterial({ map: leafTex, vertexColors: true, roughness: 0.88, color: lin(0xffffff) });
  var frondMat = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7, color: lin(0xcfe8b0) });
  var bananaMat = new THREE.MeshStandardMaterial({ map: bananaTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.65 });
  var rn = rng(31);

  /* kebun pohon bulat (mangga, rambutan) lewat InstancedMesh */
  var variants = [];
  [[0, [0.58, 0.82, 0.38]], [1, [0.5, 0.74, 0.32]], [2, [0.66, 0.86, 0.42]]].forEach(function (vv) {
    var gs = [], s = vv[0] * 7 + 3, tint = vv[1];
    gs.push(blob(1.15, s, tint).translate(0, 3.1, 0));
    gs.push(blob(0.9, s + 1, tint).translate(0.75, 2.7, 0.3));
    gs.push(blob(0.85, s + 2, tint).translate(-0.7, 2.75, -0.2));
    gs.push(blob(0.8, s + 3, tint).translate(0.1, 3.7, -0.3));
    gs.push(blob(0.7, s + 4, tint).translate(-0.2, 2.5, 0.8));
    var trunk = Cy(0.1, 0.17, 2.7, 7); trunk.translate(0, 1.35, 0);
    variants.push({ canopy: BGU.mergeBufferGeometries(gs, false), trunk: trunk });
  });
  var spots = [
    [-14, -8.6, 0], [-12.2, -9.5, 1], [-10.4, -9.9, 2], [-6, -9.8, 0], [-3.6, -9.6, 1], [0.8, -8.7, 2], [3.2, -9.7, 0], [8, -9.6, 1], [12.4, -9.4, 2], [14.6, -8, 0],
    [14.6, 7.5, 1], [13.8, 9.4, 2], [-14.8, 5.6, 0]
  ];
  var groups = [[], [], []];
  spots.forEach(function (s) {
    var x = s[0], z = s[1], sc = 0.85 + rn() * 0.55;
    groups[s[2]].push({ x: x, z: z, sc: sc, ry: rn() * 6.28 });
    treeSpots.push({ x: x, z: z, r: 1.5 * sc });
  });
  var dm = new THREE.Object3D();
  groups.forEach(function (arr, vi) {
    if (!arr.length) return;
    var v = variants[vi];
    var cm = new THREE.InstancedMesh(v.canopy, canopyMat, arr.length), tm = new THREE.InstancedMesh(v.trunk, barkMat, arr.length);
    arr.forEach(function (a, i) {
      dm.position.set(a.x, GY - 0.05, a.z); dm.rotation.set(0, a.ry, 0); dm.scale.setScalar(a.sc); dm.updateMatrix();
      cm.setMatrixAt(i, dm.matrix); tm.setMatrixAt(i, dm.matrix);
    });
    cm.castShadow = tm.castShadow = true; cm.receiveShadow = tm.receiveShadow = true;
    world.add(cm); world.add(tm);
  });

  /* kelapa */
  function palm(x, z, h, lean, seed) {
    var rr = rng(seed), g = new THREE.Group(); g.position.set(x, GY - 0.05, z); world.add(g);
    var top = new V3(Math.cos(lean) * h * 0.12, h, Math.sin(lean) * h * 0.12);
    var cu = new THREE.CatmullRomCurve3([new V3(0, 0, 0), new V3(top.x * 0.2, h * 0.35, top.z * 0.2), new V3(top.x * 0.65, h * 0.72, top.z * 0.65), top]);
    var tg = new THREE.TubeGeometry(cu, 16, 0.11, 8, false);
    var p = tg.attributes.position;
    var col = new Float32Array(p.count * 3), cc = new THREE.Color();
    for (var i = 0; i < p.count; i++) {
      var ring = 0.7 + 0.3 * Math.abs(Math.sin(p.getY(i) * 14));
      cc.setRGB(0.5 * ring, 0.4 * ring, 0.3 * ring).convertSRGBToLinear();
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var trunk = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    trunk.castShadow = true; trunk.receiveShadow = true; g.add(trunk);
    var fg = [];
    for (var f = 0; f < 11; f++) {
      var a = f / 11 * 6.283 + rr() * 0.3, pitch = 0.2 + rr() * 0.5;
      var fr = bendPlane(0.95, 2.7 + rr() * 0.6, 8, 0.7 + rr() * 0.3, 0.9 + rr() * 0.7);
      fr.rotateX(Math.PI / 2 - 0.2); fr.rotateY(0);
      var m4 = new THREE.Matrix4().makeRotationY(a); fr.applyMatrix4(m4);
      fr.translate(top.x, top.y - 0.05, top.z);
      fg.push(fr);
    }
    var fm = new THREE.Mesh(BGU.mergeBufferGeometries(fg, false), frondMat);
    fm.castShadow = true; fm.receiveShadow = false; g.add(fm);
    for (var nn = 0; nn < 4; nn++) add(g, new THREE.SphereGeometry(0.12, 8, 6), mat(0x6a8f2e, { roughness: 0.6 }), top.x + Math.cos(nn * 1.6) * 0.18, top.y - 0.28, top.z + Math.sin(nn * 1.6) * 0.18);
    treeSpots.push({ x: x, z: z, r: 1.4 });
  }
  palm(-12.6, -7.2, 6.6, 0.8, 1); palm(-4.6, -9, 7.6, 2.2, 2); palm(7.8, -8.4, 7, 1.0, 3); palm(13.4, 6.6, 6.2, 3.6, 4);

  /* pisang */
  function banana(x, z, s, seed) {
    var rr = rng(seed), gs = [];
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * 6.283 + rr() * 0.5, lf = bendPlane(0.55 * s, 1.9 * s, 5, 0.55 + rr() * 0.5, 0.8);
      lf.rotateX(Math.PI / 2 - 0.55 - rr() * 0.4); lf.applyMatrix4(new THREE.Matrix4().makeRotationY(a)); lf.translate(0, 0.9 * s, 0);
      gs.push(lf);
    }
    var m = new THREE.Mesh(BGU.mergeBufferGeometries(gs, false), bananaMat); m.position.set(x, GY - 0.05, z); m.castShadow = true; world.add(m);
    var st = add(world, Cy(0.05 * s, 0.07 * s, 0.95 * s, 6), mat(0x7a9a50, { roughness: 0.8 }), x, GY + 0.42 * s, z);
  }
  banana(-9.9, -6.6, 1.1, 1); banana(-6.4, -6.5, 0.95, 2); banana(8.3, -6.2, 1.15, 3); banana(11.9, 3.7, 1.0, 4); banana(7.2, 5.6, 0.9, 5);

  /* rumpun bambu */
  function bamboo(x, z, seed) {
    var rr = rng(seed), gs = [], lg = [];
    for (var i = 0; i < 12; i++) {
      var h = 5.5 + rr() * 2.5, ox = (rr() - 0.5) * 0.9, oz = (rr() - 0.5) * 0.9, lean = (rr() - 0.5) * 0.28, lean2 = (rr() - 0.5) * 0.28;
      var c = new THREE.CylinderGeometry(0.028, 0.045, h, 6, 7);
      var p = c.attributes.position, col = new Float32Array(p.count * 3), cc = new THREE.Color();
      for (var q = 0; q < p.count; q++) {
        var y = p.getY(q), node = Math.abs(((y + h / 2) / 0.55) % 1 - 0.5) > 0.46 ? 0.7 : 1;
        cc.setRGB(0.62 * node, 0.7 * node, 0.32 * node).convertSRGBToLinear();
        col[q * 3] = cc.r; col[q * 3 + 1] = cc.g; col[q * 3 + 2] = cc.b;
        p.setX(q, p.getX(q) + lean * (y + h / 2) * 0.25); p.setZ(q, p.getZ(q) + lean2 * (y + h / 2) * 0.25);
      }
      c.setAttribute('color', new THREE.BufferAttribute(col, 3));
      c.translate(ox, h / 2, oz); gs.push(c);
      for (var l = 0; l < 6; l++) {
        var lf = new THREE.PlaneGeometry(0.28, 0.9, 1, 1); lf.translate(0, 0.45, 0);
        lf.rotateX(1.05 + rr() * 0.7); lf.rotateY(rr() * 6.28); lf.translate(ox + lean * h * 0.25, h - rr() * 1.8, oz + lean2 * h * 0.25); lg.push(lf);
      }
    }
    var tm = new THREE.Mesh(BGU.mergeBufferGeometries(gs, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    tm.position.set(x, GY - 0.05, z); tm.castShadow = true; world.add(tm);
    var lm = new THREE.Mesh(BGU.mergeBufferGeometries(lg, false), new THREE.MeshStandardMaterial({ map: bananaTex, alphaTest: 0.4, side: THREE.DoubleSide, color: lin(0x9ccf6a), roughness: 0.7 }));
    lm.position.copy(tm.position); lm.castShadow = true; world.add(lm);
  }
  bamboo(14.2, -3.6, 8); bamboo(-14.6, -4.2, 9);

  /* rumput dan alang-alang: bidang silang dengan tekstur bilah */
  function tuftGeo(w, h, cross) {
    var gs = [];
    for (var i = 0; i < cross; i++) {
      var q = new THREE.PlaneGeometry(w, h); q.translate(0, h / 2, 0); q.rotateY(i * Math.PI / cross); gs.push(q);
    }
    var g = BGU.mergeBufferGeometries(gs, false);
    paintVerts(g, function (x, y) { var k = 0.72 + 0.28 * (y / h); return [k, k, k]; });
    return g;
  }
  function swayMat(tex, tint, amp) {
    var m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true, color: lin(tint) });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTimeG = skyU.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTimeG;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n transformed.x += sin(uTimeG * 1.6 + instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7) * ' + amp.toFixed(3) + ' * position.y; transformed.z += cos(uTimeG * 1.3 + instanceMatrix[3].z * 0.8) * ' + (amp * 0.6).toFixed(3) + ' * position.y;\n#endif');
    };
    return m;
  }
  var grassG = tuftGeo(0.22, 0.24, 3), reedG = tuftGeo(0.26, 1.3, 2);
  var gm = swayMat(grassTex, 0xffffff, 0.09), rm = swayMat(reedTex, 0xffffff, 0.05);
  var gPts = [], rPts = [], tries = 0, rg = rng(77);
  while (gPts.length < (coarse ? 3800 : 7200) && tries++ < 60000) {
    var x = XMIN + 0.3 + rg() * (WX - 0.6), z = ZMIN + 0.3 + rg() * (WZ - 0.6);
    var c = riverC(x), s = Math.abs(z - c) - riverHW(x), D = bankRun(x);
    if (s < 0.2 || Math.abs(x) < 2.5 && Math.abs(z) < 5) continue;
    if (s < D && natural(x) < 0.5) continue;                                   /* lereng beton */
    if (s < D * 0.5 && s > 0.15 && natural(x) >= 0.5) { if (rg() < 0.55) continue; }
    if (Math.abs(z - pathZ(x)) < 0.4 && Math.abs(x) > 2.6) continue;           /* jalur setapak */
    var blocked = false, hh2;
    for (hh2 = 0; hh2 < houseSpots.length; hh2++) { if (Math.hypot(x - houseSpots[hh2].x, z - houseSpots[hh2].z) < houseSpots[hh2].r) { blocked = true; break; } }
    for (hh2 = 0; hh2 < treeSpots.length && !blocked; hh2++) { if (Math.hypot(x - treeSpots[hh2].x, z - treeSpots[hh2].z) < 0.35) blocked = true; }
    if (blocked) continue;
    gPts.push([x, heightAt(x, z), z, rg()]);
  }
  /* buang rumput di dalam tapak rumah */
  var gI = new THREE.InstancedMesh(grassG, gm, gPts.length);
  gPts.forEach(function (p, i) {
    var sc = 0.6 + p[3] * 0.9;
    dm.position.set(p[0], p[1] - 0.02, p[2]); dm.rotation.set(0, p[3] * 40, 0); dm.scale.set(sc, sc * (0.75 + 0.5 * hash2(i, 3)), sc); dm.updateMatrix();
    gI.setMatrixAt(i, dm.matrix);
    var cc = new THREE.Color().setHSL(0.23 + 0.05 * hash2(i, 7), 0.5 + 0.2 * hash2(i, 9), 0.58 + 0.2 * hash2(i, 11));
    gI.setColorAt(i, cc);
  });
  gI.receiveShadow = true; gI.instanceMatrix.needsUpdate = true; gI.instanceColor.needsUpdate = true;
  world.add(gI);
  /* alang-alang di tepi sungai alami */
  var rp = [];
  for (var side = -1; side <= 1; side += 2) {
    for (var xr = XMIN + 0.5; xr < XMAX - 0.3; xr += 0.35) {
      if (Math.abs(xr) < 5.5 || rg() < 0.35) continue;
      var zr = riverC(xr) + side * (riverHW(xr) + rg() * bankRun(xr) * 0.35 + 0.1);
      rp.push([xr + (rg() - 0.5) * 0.3, heightAt(xr, zr), zr, rg()]);
    }
  }
  var rI = new THREE.InstancedMesh(reedG, rm, rp.length);
  rp.forEach(function (p, i) {
    var sc = 0.7 + p[3] * 0.8;
    dm.position.set(p[0], p[1] - 0.03, p[2]); dm.rotation.set(0, p[3] * 30, 0); dm.scale.set(sc, sc, sc); dm.updateMatrix();
    rI.setMatrixAt(i, dm.matrix);
    rI.setColorAt(i, new THREE.Color().setHSL(0.2 + 0.06 * hash2(i, 5), 0.4, 0.5 + 0.15 * hash2(i, 6)));
  });
  rI.instanceMatrix.needsUpdate = true; rI.instanceColor.needsUpdate = true;
  world.add(rI);
});

/* =====================================================================
   SAMPAH: bentuk, penempatan per tingkat, gerak di air
   ===================================================================== */
var TCLS = [
  { name: 'Plastik dan kantong', hex: 0xff7a1a },
  { name: 'Botol dan kemasan', hex: 0x00c2ff },
  { name: 'Sampah besar', hex: 0xb36bff },
  { name: 'Tumbuhan air', hex: 0x38d66b }
];
var LEVEL_COUNT = [8, 29, 56];
var T = [];                                   /* semua sampah, urut dari yang paling awal muncul */
var trashRoot = new THREE.Group(); world.add(trashRoot);
var hyaTex, TS = 1.15;

function plastic(hex, op) { return mat(hex, { roughness: 0.22, metalness: 0, transparent: true, opacity: op || 0.6, depthWrite: false, side: THREE.DoubleSide }); }
function solid(hex, r, m) { return mat(hex, { roughness: r === undefined ? 0.7 : r, metalness: m || 0 }); }
function wrinkle(g, amp, f, seed) {
  var off = seed * 13.7;
  return disp(g, function (v) { var n = vnoise3(v.x * f + off, v.y * f, v.z * f + off) - 0.5, m = vnoise3(v.x * f * 2.7 + off, v.y * f * 2.7, v.z * f * 2.7) - 0.5; v.addScaledVector(v.clone().normalize(), amp * (n + 0.5 * m)); });
}

var KIND = {
  botol: function (rr) {
    var c = [0xa9d8f0, 0x7fc08a, 0xe6efe9, 0xc9e0f0][Math.floor(rr() * 4)], g = new THREE.Group();
    var pts = [[0, 0], [0.026, 0], [0.034, 0.012], [0.034, 0.1], [0.031, 0.122], [0.019, 0.148], [0.0125, 0.162], [0.0125, 0.178]].map(function (p) { return new V2(p[0], p[1]); });
    add(g, new THREE.LatheGeometry(pts, 14), plastic(c, 0.6), 0, -0.1, 0, { noRecv: true });
    var cap = add(g, Cy(0.0145, 0.0145, 0.016, 10), solid([0x2a6fc8, 0xffffff, 0x2f9a56, 0xd33a2a][Math.floor(rr() * 4)], 0.5), 0, 0.088, 0);
    add(g, Cy(0.0348, 0.0348, 0.05, 14, 1, true), mat([0xe8e8e0, 0xd33a2a, 0x2a6fc8][Math.floor(rr() * 3)], { roughness: 0.6, side: THREE.DoubleSide }), 0, -0.05, 0, { noRecv: true });
    g.rotation.z = Math.PI / 2 + (rr() - 0.5) * 0.25; g.rotation.y = rr() * 6.28; g.position.y = 0.0;
    return { g: g, cls: 1, name: 'botol', y: -0.002 };
  },
  gelas: function (rr) {
    var g = new THREE.Group(), up = rr() < 0.35;
    var m = add(g, Cy(0.04, 0.027, 0.095, 14, 1, true), mat(rr() < 0.5 ? 0xf4f4ee : 0xe2b04a, { roughness: 0.45, side: THREE.DoubleSide }), 0, 0, 0);
    add(g, Cy(0.027, 0.027, 0.004, 12), solid(0xe8e8e2, 0.5), 0, -0.047, 0);
    add(g, new THREE.TorusGeometry(0.04, 0.0034, 6, 14), solid(0xf4f4ee, 0.5), 0, 0.047, 0).rotation.x = Math.PI / 2;
    g.rotation.z = up ? 0.12 : Math.PI / 2 + (rr() - 0.5) * 0.6; g.rotation.y = rr() * 6.28;
    return { g: g, cls: 1, name: 'gelas', y: up ? 0.0 : 0.012 };
  },
  kantong: function (rr) {
    var cols = [0xf2f2ee, 0x1b1c1f, 0x3f86d6, 0xe9d34a, 0xd8574a], c = cols[Math.floor(rr() * cols.length)];
    var s = 0.7 + rr() * 0.9, g = new THREE.Group();
    var geo = wrinkle(new THREE.SphereGeometry(0.14, 14, 9), 0.05, 7, rr() * 10);
    geo.scale(1.5 * s, 0.2, 1.1 * s);
    add(g, geo, mat(c, { roughness: 0.3, metalness: 0, transparent: true, opacity: c === 0x1b1c1f ? 0.95 : 0.78, side: THREE.DoubleSide }), 0, 0.0, 0, { noRecv: true });
    var handle = add(g, new THREE.TorusGeometry(0.05 * s, 0.006, 5, 10, 3.6), mat(c, { roughness: 0.4 }), 0.18 * s, 0.02, 0, { noRecv: true });
    handle.rotation.x = Math.PI / 2; handle.rotation.z = rr() * 6;
    g.rotation.y = rr() * 6.28;
    return { g: g, cls: 0, name: 'kantong', y: 0.004 };
  },
  styrofoam: function (rr) {
    var g = new THREE.Group(), w = 0.24 + rr() * 0.14;
    var geo = wrinkle(new THREE.BoxGeometry(w, 0.075, w * 0.7, 6, 2, 4), 0.012, 9, rr() * 10);
    add(g, geo, mat(0xf2eee2, { roughness: 0.95 }), 0, 0.01, 0);
    if (rr() < 0.7) add(g, B(w * 0.86, 0.02, w * 0.56), mat(0xe6e1d2, { roughness: 1 }), 0, 0.05, 0, { noCast: true });
    g.rotation.y = rr() * 6.28; g.rotation.z = (rr() - 0.5) * 0.18;
    return { g: g, cls: 1, name: 'styrofoam', y: 0.012 };
  },
  kaleng: function (rr) {
    var g = new THREE.Group(), lab = [0xd2352b, 0x1f6ac9, 0x2d9a58, 0x888c92][Math.floor(rr() * 4)];
    add(g, Cy(0.033, 0.033, 0.12, 14), mat(0xc4c8cc, { metalness: 0.85, roughness: 0.3 }), 0, 0, 0);
    add(g, Cy(0.0335, 0.0335, 0.075, 14), mat(lab, { roughness: 0.4, metalness: 0.4 }), 0, -0.004, 0);
    add(g, Cy(0.027, 0.03, 0.006, 14), mat(0xaeb2b8, { metalness: 0.9, roughness: 0.25 }), 0, 0.062, 0);
    g.rotation.z = Math.PI / 2 + (rr() - 0.5) * 0.4; g.rotation.y = rr() * 6.28;
    return { g: g, cls: 1, name: 'kaleng', y: 0.0 };
  },
  ranting: function (rr) {
    var g = new THREE.Group(), L = 0.7 + rr() * 0.9;
    var br = mat(0x6b5238, { roughness: 0.95 });
    var trunk = add(g, Cy(0.022, 0.032, L, 7), br, 0, 0, 0); trunk.rotation.z = Math.PI / 2;
    for (var i = 0; i < 3; i++) {
      var tl = 0.15 + rr() * 0.25, tw = add(g, Cy(0.007, 0.014, tl, 5), br, (rr() - 0.5) * L * 0.7, 0.03, 0);
      tw.rotation.z = Math.PI / 2; tw.rotation.y = (rr() < 0.5 ? 1 : -1) * (0.5 + rr() * 0.7);
      tw.position.z = Math.sin(tw.rotation.y) * tl * 0.4; tw.position.x += Math.cos(tw.rotation.y) * tl * 0.4;
      if (rr() < 0.6) add(g, new THREE.SphereGeometry(0.05, 6, 5), mat(0x4e7a32, { roughness: 0.8 }), tw.position.x + 0.08, 0.04, tw.position.z, { noRecv: true }).scale.set(1.6, 0.35, 1);
    }
    g.rotation.y = rr() * 6.28;
    return { g: g, cls: 2, name: 'ranting', y: 0.0 };
  },
  bambu: function (rr) {
    var g = new THREE.Group(), L = 0.9 + rr() * 0.7;
    var m = mat(0xb5b46a, { roughness: 0.6 });
    var c = add(g, Cy(0.028, 0.03, L, 8), m, 0, 0, 0); c.rotation.z = Math.PI / 2;
    for (var i = -2; i <= 2; i++) { var r = add(g, Cy(0.032, 0.032, 0.012, 8), mat(0x8e8d4c, { roughness: 0.7 }), i * L * 0.2, 0, 0); r.rotation.z = Math.PI / 2; }
    g.rotation.y = rr() * 6.28;
    return { g: g, cls: 2, name: 'bambu', y: 0.0 };
  },
  papan: function (rr) {
    var g = new THREE.Group(), L = 0.6 + rr() * 0.7;
    add(g, B(L, 0.028, 0.13 + rr() * 0.06), mat(0x8d7a62, { roughness: 0.95 }), 0, 0, 0);
    add(g, B(0.04, 0.032, 0.012), mat(0x8c8f93, { metalness: 0.7, roughness: 0.4 }), L * 0.4, 0.002, 0.02, { noCast: true });
    g.rotation.y = rr() * 6.28; g.rotation.z = (rr() - 0.5) * 0.2; g.rotation.x = (rr() - 0.5) * 0.2;
    return { g: g, cls: 2, name: 'papan', y: 0.004 };
  },
  karung: function (rr) {
    var g = new THREE.Group(), s = 0.85 + rr() * 0.4;
    var geo = wrinkle(new THREE.BoxGeometry(0.52 * s, 0.13, 0.34 * s, 6, 3, 5), 0.04, 6, rr() * 10);
    geo.attributes.position.needsUpdate = true;
    add(g, geo, mat([0xd2c29a, 0xe3dcc4, 0xb7b2a2][Math.floor(rr() * 3)], { roughness: 1 }), 0, 0.02, 0);
    g.rotation.y = rr() * 6.28;
    return { g: g, cls: 2, name: 'karung', y: 0.01 };
  },
  sandal: function (rr) {
    var g = new THREE.Group(), col = [0x2f78d0, 0xe0679a, 0x2f2f33, 0x3a9a5c][Math.floor(rr() * 4)];
    var sg = new THREE.SphereGeometry(0.12, 12, 6); sg.scale(1, 0.12, 0.38);
    add(g, sg, mat(col, { roughness: 0.55 }), 0, 0, 0);
    var st = add(g, new THREE.TorusGeometry(0.03, 0.006, 5, 8, 3.14), mat(0xf0f0f0, { roughness: 0.6 }), 0.04, 0.012, 0, { noRecv: true });
    st.rotation.y = Math.PI / 2;
    g.rotation.y = rr() * 6.28; g.rotation.z = (rr() - 0.5) * 0.3;
    return { g: g, cls: 0, name: 'sandal', y: 0.0 };
  },
  jerigen: function (rr) {
    var g = new THREE.Group();
    var m = mat([0x2f6fc2, 0xe0ddd2, 0xd9a02a][Math.floor(rr() * 3)], { roughness: 0.4 });
    add(g, new THREE.BoxGeometry(0.16, 0.26, 0.28, 3, 3, 3), m, 0, 0.07, 0);
    add(g, Cy(0.024, 0.024, 0.04, 10), m, 0.0, 0.215, 0.07);
    add(g, new THREE.TorusGeometry(0.03, 0.008, 5, 10, 3.2), m, 0, 0.215, -0.05).rotation.y = Math.PI / 2;
    g.rotation.z = Math.PI / 2 - 0.1; g.rotation.y = rr() * 6.28;
    return { g: g, cls: 2, name: 'jerigen', y: -0.02 };
  },
  ban: function (rr) {
    var g = new THREE.Group();
    var tg = new THREE.TorusGeometry(0.27, 0.095, 10, 22); tg.scale(1, 1, 0.8);
    add(g, tg, mat(0x1c1d20, { roughness: 0.85 }), 0, 0, 0).rotation.x = Math.PI / 2;
    add(g, new THREE.TorusGeometry(0.2, 0.01, 4, 18), mat(0x2b2c30, { roughness: 0.9 }), 0, 0.02, 0).rotation.x = Math.PI / 2;
    g.rotation.y = rr() * 6.28; g.rotation.x = (rr() - 0.5) * 0.12;
    return { g: g, cls: 2, name: 'ban', y: -0.025 };
  },
  eceng: function (rr) {
    var g = new THREE.Group(), n = 3 + Math.floor(rr() * 4), geos = [];
    for (var k = 0; k < n; k++) {
      var cx = (rr() - 0.5) * 0.7, cz = (rr() - 0.5) * 0.5, rs = 0.7 + rr() * 0.6;
      for (var l = 0; l < 8; l++) {
        var lf = new THREE.PlaneGeometry(0.24 * rs, 0.26 * rs); lf.translate(0, 0.13 * rs, 0);
        lf.rotateX(-Math.PI / 2 + 0.55 + rr() * 0.5); lf.rotateY(l / 8 * 6.283 + rr() * 0.3); lf.translate(cx, 0.03, cz); geos.push(lf);
      }
    }
    add(g, BGU.mergeBufferGeometries(geos, false), mat(0xffffff, { map: hyaTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.35 }), 0, 0, 0, { noRecv: false });
    if (rr() < 0.6) { var fl = add(g, new THREE.ConeGeometry(0.03, 0.12, 6), mat(0xb18be4, { roughness: 0.6 }), (rr() - 0.5) * 0.3, 0.1, (rr() - 0.5) * 0.2, { noCast: true }); fl.rotation.z = (rr() - 0.5) * 0.3; }
    g.rotation.y = rr() * 6.28;
    return { g: g, cls: 3, name: 'eceng gondok', y: -0.006 };
  }
};
var KW = [['kantong', 0.2], ['botol', 0.2], ['gelas', 0.09], ['kaleng', 0.06], ['styrofoam', 0.07], ['ranting', 0.07], ['bambu', 0.03], ['papan', 0.04], ['karung', 0.04], ['sandal', 0.04], ['eceng', 0.1], ['jerigen', 0.03], ['ban', 0.01]];
function pickKind(rr, idx) {
  if (idx === 14 || idx === 33) return 'eceng';
  if (idx === 25) return 'ban';
  var t = 0, u = rr() * 1.0;
  for (var i = 0; i < KW.length; i++) { t += KW[i][1]; if (u <= t) { if (KW[i][0] === 'eceng' && idx < 7) return 'kantong'; return KW[i][0]; } }
  return 'botol';
}

task('Menyiapkan sampah', function () {
  var hc = makeCanvas(128, 128), h = hc.getContext('2d');
  h.clearRect(0, 0, 128, 128);
  var gr = h.createRadialGradient(54, 54, 8, 64, 64, 60); gr.addColorStop(0, '#7fc24a'); gr.addColorStop(1, '#2f7a2a');
  h.fillStyle = gr; h.beginPath(); h.ellipse(64, 64, 58, 54, 0, 0, 6.283); h.fill();
  h.strokeStyle = 'rgba(190,230,140,0.7)'; h.lineWidth = 2; h.beginPath(); h.moveTo(64, 120); h.lineTo(64, 12); h.stroke();
  for (var i = -3; i <= 3; i++) { if (!i) continue; h.beginPath(); h.moveTo(64, 100); h.quadraticCurveTo(64 + i * 14, 70, 64 + i * 15, 28 + Math.abs(i) * 4); h.stroke(); }
  hyaTex = canvasTex(hc, { clamp: true });

  var rr = rng(2024), placed = [];
  var N = LEVEL_COUNT[2];
  for (var idx = 0; idx < N; idx++) {
    var kind = pickKind(rr, idx), it = KIND[kind](rr);
    var inner = it.g;
    var g = new THREE.Group(); g.add(inner); trashRoot.add(g);
    g.updateMatrixWorld(true);
    var pts = [], box = new THREE.Box3();
    g.traverse(function (m) {
      if (!m.isMesh) return;
      var pa = m.geometry.attributes.position, st = Math.max(1, Math.floor(pa.count / 70));
      for (var q = 0; q < pa.count; q += st) pts.push(new V3(pa.getX(q), pa.getY(q), pa.getZ(q)).applyMatrix4(m.matrixWorld));
    });
    if (pts.length > 150) { var keep = []; for (var w = 0; w < pts.length; w += Math.ceil(pts.length / 150)) keep.push(pts[w]); pts = keep; }
    pts.forEach(function (v) { box.expandByPoint(v); });
    var size = box.getSize(new V3()), rad = Math.max(size.x, size.z) * 0.5 * TS;
    /* posisi: sebaran lebar untuk 7 awal, memusat ke saringan untuk berikutnya */
    var x, z, tries = 0, lift = 0, ok = false;
    do {
      var u = rr();
      if (idx < LEVEL_COUNT[0]) { x = -11.2 + u * 7.0; }
      else if (idx < LEVEL_COUNT[1]) { x = rackX - 0.5 - Math.pow(u, 1.25) * 6.2; }
      else { x = rackX - 0.4 - Math.pow(u, 1.5) * 5.8; }
      var cc = riverC(x), hw = riverHW(x);
      var gz = (rr() + rr() + rr() - 1.5) * 0.62;
      z = cc + clamp(gz * hw, -hw * 0.9, hw * 0.9) + 0.1;
      ok = true;
      for (var j = 0; j < placed.length; j++) {
        var d = Math.hypot(placed[j].x - x, placed[j].z - z);
        if (d < (placed[j].r + rad) * (idx < LEVEL_COUNT[1] ? 0.95 : 0.62)) { ok = false; break; }
      }
      tries++;
    } while (!ok && tries < 24);
    if (!ok && idx >= LEVEL_COUNT[1]) lift = 0.012 + rr() * 0.03;
    placed.push({ x: x, z: z, r: rad });
    g.position.set(x, it.y + lift, z);
    g.rotation.y = 0;
    var item = { g: g, inner: inner, pts: pts, idx: idx, kind: kind, name: it.name, cls: it.cls, x: x, z: z, y0: it.y + lift, r: rad,
      box: box, s: 0, target: 0, delay: 0, ph: rr() * 6.28, drift: (rr() < 0.3) ? 0.1 + rr() * 0.2 : 0.02, conf: 0.58 + rr() * 0.38,
      foam: null };
    g.scale.setScalar(0.001); g.visible = false;
    g.traverse(function (m) { if (m.isMesh) { m.userData.trash = true; } });
    T.push(item);
    item.foam = { x: x, z: z, r: Math.max(rad * 0.9, 0.08), on: false };
    foamItems.push(item.foam);
  }
});

var trashLevel = 1;
function setTrashLevel(l) {
  trashLevel = l;
  var n = LEVEL_COUNT[l], c = 0;
  T.forEach(function (it) {
    var on = it.idx < n;
    it.target = on ? 1 : 0;
    it.delay = on ? Math.max(0, it.idx - (l > 0 ? LEVEL_COUNT[l - 1] : 0)) * 0.012 : 0;
    it.foam.on = on;
  });
  if (typeof redrawFoam === 'function') redrawFoam();
}
onFrame(function (dt, tm) {
  for (var i = 0; i < T.length; i++) {
    var it = T[i];
    if (it.s !== it.target) {
      if (it.delay > 0) { it.delay -= dt; }
      else {
        var k = 1 - Math.exp(-dt * (it.target ? 5 : 8));
        it.s += (it.target - it.s) * k;
        if (Math.abs(it.s - it.target) < 0.01) it.s = it.target;
      }
    }
    var g = it.g;
    if (it.s <= 0.002) { g.visible = false; continue; }
    g.visible = true;
    var sc = it.s * it.s * (3 - 2 * it.s);
    g.scale.setScalar(Math.max(0.001, sc * TS));
    var dx = Math.sin(tm * 0.11 + it.ph) * it.drift, dz = Math.cos(tm * 0.09 + it.ph * 1.3) * it.drift * 0.4;
    g.position.set(it.x + dx, it.y0 + Math.sin(tm * 1.25 + it.ph) * 0.007 * (it.kind === 'ban' ? 0.2 : 1), it.z + dz);
    g.rotation.y = Math.sin(tm * 0.3 + it.ph) * 0.12;
    g.rotation.x = Math.sin(tm * 0.9 + it.ph * 2) * 0.03;
  }
});

/* =====================================================================
   POD KAMERA (satuan model = mm; sumbu pod = +x, depan di x = 0 menghadap -x dunia)
   ===================================================================== */
var PodMat = {}, POD_TILT_DEG = 19;
function latheX(pts, seg, colorFn) {
  var g = new THREE.LatheGeometry(pts.map(function (p) { return new V2(p[0], p[1]); }), seg || 48);
  g.rotateZ(-Math.PI / 2);
  if (colorFn) {
    var np = pts.length, n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
    for (var i = 0; i < n; i++) { var j = i % np, k = colorFn(j); c.setRGB(k[0], k[1], k[2]).convertSRGBToLinear(); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}
function ribbonGeo(pts, w, th, segs) {
  var cu = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4), fr = cu.computeFrenetFrames(segs, false), pos = [], idx = [];
  for (var i = 0; i <= segs; i++) {
    var P = cu.getPoint(i / segs), N = fr.normals[i], Bn = fr.binormals[i];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { var q = P.clone().addScaledVector(Bn, c[0] * w / 2).addScaledVector(N, c[1] * th / 2); pos.push(q.x, q.y, q.z); });
  }
  for (var s = 0; s < segs; s++) for (var f = 0; f < 4; f++) { var a = s * 4 + f, b = s * 4 + (f + 1) % 4, c2 = a + 4, d = b + 4; idx.push(a, c2, b, b, c2, d); }
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { geo: g, curve: cu };
}
function podMats() {
  if (PodMat.shell) return PodMat;
  PodMat.shell = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.05, side: THREE.DoubleSide });
  PodMat.paint = mat(0x8b8e8d, { roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  PodMat.black = mat(0x121416, { roughness: 0.55, metalness: 0.1 });
  PodMat.glass = mat(0xdceaf0, { physical: true, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.6, depthWrite: false, side: THREE.DoubleSide });
  PodMat.pcb = mat(0x1a6b3b, { roughness: 0.38, metalness: 0.15 });
  PodMat.steel = mat(0xb4bac0, { metalness: 0.92, roughness: 0.28, side: THREE.DoubleSide });
  PodMat.brass = mat(0xc89d45, { metalness: 1, roughness: 0.32 });
  PodMat.chip = mat(0x1b1d20, { roughness: 0.4, metalness: 0.2 });
  PodMat.gold = mat(0xd9b24c, { metalness: 1, roughness: 0.25 });
  PodMat.lens = mat(0x20124a, { metalness: 0.7, roughness: 0.08 });
  PodMat.white = mat(0xf0f0ea, { roughness: 0.7 });
  PodMat.clear = mat(0xe9efec, { roughness: 0.4, transparent: true, opacity: 0.75 });
  PodMat.alu = mat(0xc7cbcf, { metalness: 0.85, roughness: 0.38 });
  PodMat.ribbon = mat(0xe8a23c, { roughness: 0.5, side: THREE.DoubleSide });
  PodMat.conduit = mat(0x1a1c1f, { roughness: 0.7 });
  return PodMat;
}
function mmPart(list, root, name, dx, build) {
  var g = new THREE.Group(); root.add(g); build(g);
  var p = { name: name, g: g, dx: dx, anchor: new V3() };
  list.push(p); return p;
}
function roundBoxFlat(w, h, d, bevel) { return new THREE.BoxGeometry(w, h, d); }

/* membangun pod lengkap ke dalam root; mengembalikan daftar bagian (nama, grup, offset urai, jangkar) */
function buildPod(root) {
  var M = podMats(), list = [];
  var HOOD = mmPart(list, root, 'Tudung', [-30, 6, 0], function (g) {
    var ring = new THREE.Mesh(latheX([[23.8, -2], [23.8, 6], [22.6, 6], [22.6, -2], [23.8, -2]], 48), PodMat.paint); ring.castShadow = true; ring.receiveShadow = true; g.add(ring);
    var arcs = [23.8, 22.6].map(function (r) {
      var cy = new THREE.CylinderGeometry(r, r, 11, 28, 1, true, 1.5 * Math.PI - 1.15, 2.3); cy.rotateZ(-Math.PI / 2); cy.translate(-7.5, 0, 0);
      return add(g, cy, PodMat.paint, 0, 0, 0);
    });
    var cap = new THREE.CylinderGeometry(23.8, 22.6, 0.01, 2, 1, true);   /* sisi depan brim ditutup dengan strip tipis */
    var edge = new THREE.Mesh(new THREE.RingGeometry(22.6, 23.8, 2), PodMat.paint);
    add(g, B(1.2, 1.2, 17.7), PodMat.paint, -13, 23.2, 0);
    var inner = new THREE.Mesh(latheX([[22.55, 0], [22.55, 6]], 40), PodMat.black); g.add(inner);
  });
  HOOD.anchor.set(-8, 24, 0);
  var GLASS = mmPart(list, root, 'Jendela kaca', [-16, 0, 0], function (g) {
    add(g, Cy(18.5, 18.5, 2, 48), PodMat.glass, 4, 0, 0, { noCast: true }).rotation.z = Math.PI / 2;
    var bead = new THREE.Mesh(latheX([[20.3, 3], [20.3, 5], [18.2, 5], [18.2, 3], [20.3, 3]], 48), PodMat.clear); g.add(bead);
  });
  GLASS.anchor.set(4, 18.5, 0);
  var SHELL = mmPart(list, root, 'Cangkang depan', [0, 0, 0], function (g) {
    var geo = latheX([[22.5, 26], [22.5, 0.5], [22.0, 0], [16.5, 0], [16.5, 0.02], [16.5, 3], [20.3, 3], [20.3, 26], [22.5, 26]], 64, function (j) { return j <= 3 ? [0.56, 0.58, 0.57] : [0.07, 0.07, 0.08]; });
    var m = new THREE.Mesh(geo, PodMat.shell); m.castShadow = true; m.receiveShadow = true; g.add(m);
    [[-1.0, 6], [1.0, 6]].forEach(function (s) { add(g, Cy(0.9, 0.9, 1.2, 8), PodMat.steel, 17, s[0] * 0, 0); });
  });
  SHELL.anchor.set(14, 22.5, 0);
  var BOARD = mmPart(list, root, 'Papan kamera', [24, 0, 0], function (g) {
    var bx = 14.5;
    add(g, B(1.6, 25, 24), PodMat.pcb, bx, 0, 0);
    add(g, B(5, 8.6, 8.6), PodMat.black, bx - 3.3, 0, 0);
    add(g, Cy(3.4, 3.4, 1.7, 22), PodMat.black, bx - 6.5, 0, 0).rotation.z = Math.PI / 2;
    add(g, Cy(2.5, 2.5, 0.2, 22), PodMat.lens, bx - 7.4, 0, 0).rotation.z = Math.PI / 2;
    add(g, Cy(1.2, 1.2, 0.2, 14), mat(0x6f3fb0, { metalness: 0.8, roughness: 0.1 }), bx - 7.55, 0, 0).rotation.z = Math.PI / 2;
    add(g, B(2.6, 3.2, 21), PodMat.white, bx + 2.1, -11.2, 0);                            /* soket kabel pita */
    add(g, B(1.2, 2.4, 20), PodMat.black, bx + 2.0, -12.0, 0);
    [[-8, 9], [8, 9], [-8, -9], [8, -9]].forEach(function (p) { add(g, B(0.9, 1.8, 1.2), PodMat.chip, bx + 1.2, p[1] * 0.55, p[0] * 0.4); });
    [[-9.6, 10.6], [9.6, 10.6]].forEach(function (p) { add(g, Cy(1.1, 1.1, 1.8, 10), PodMat.black, bx, p[1], p[0]).rotation.z = Math.PI / 2; add(g, Cy(0.9, 0.9, 0.1, 10), PodMat.gold, bx + 0.85, p[1], p[0]).rotation.z = Math.PI / 2; });
    add(g, B(0.6, 3, 3.6), PodMat.chip, bx + 1.1, 5, -6);
    [[-4, 5], [3, 6], [-7, 3]].forEach(function (p) { add(g, B(0.5, 1.2, 0.8), PodMat.gold, bx + 1.0, p[0] + 2, p[1]); });
  });
  BOARD.anchor.set(14.5, 12.8, 0);
  var GEL = mmPart(list, root, 'Silica gel', [34, 12, 0], function (g) {
    var gg = wrinkle(new THREE.BoxGeometry(7, 11, 14, 5, 6, 8), 1.1, 0.5, 3);
    add(g, gg, mat(0xf4f4ef, { roughness: 0.95 }), 19.3, -6, 0);
    add(g, B(0.1, 7, 12), mat(0x1c68c4, { roughness: 0.8 }), 15.5, -6, 0, { noCast: true });
  });
  GEL.anchor.set(19.3, -1, 0);
  var CAP = mmPart(list, root, 'Tutup belakang dan standoff', [58, 0, 0], function (g) {
    var cp = latheX([[0, 23.3], [20.1, 23.3], [20.1, 26], [22.5, 26], [22.5, 29.3], [10, 29.3], [10, 36], [13, 36], [13, 29.3], [10, 29.3]].slice(0, 0).concat([[10, 23.3], [20.1, 23.3], [20.1, 26], [22.5, 26], [22.5, 29.3], [13, 29.3], [13, 36], [10, 36], [10, 23.3]]), 48);
    var cm = new THREE.Mesh(cp, PodMat.paint); cm.castShadow = true; cm.receiveShadow = true; g.add(cm);
    for (var i = 0; i < 4; i++) { var a = i * 1.5708 + 0.78; add(g, Cy(1.0, 1.0, 0.6, 6), PodMat.steel, 29.4, Math.sin(a) * 18, Math.cos(a) * 18).rotation.z = Math.PI / 2; }
    [-9.6, 9.6].forEach(function (zz) {
      add(g, Cy(2, 2, 8, 6), PodMat.brass, 19.3, 10.6, zz).rotation.z = Math.PI / 2;
      add(g, Cy(0.5, 0.5, 4, 8), PodMat.steel, 13.6, 10.6, zz).rotation.z = Math.PI / 2;
    });
    add(g, Cy(11.5, 11.5, 1.5, 6), PodMat.steel, 32.2, 0, 0).rotation.z = Math.PI / 2;   /* mur nipple */
    var seal = new THREE.Mesh(latheX([[10.1, 23.3], [10.1, 29.3]], 24), mat(0xb9bcc0, { roughness: 0.6 })); g.add(seal);
  });
  CAP.anchor.set(29, 22.5, 0);
  var CON = mmPart(list, root, 'Conduit dan kabel pita', [86, 0, 0], function (g) {
    var prof = [], L = 55, x0 = 36, n = 40;
    prof.push([10.5, x0 - 7]);
    for (var i = 0; i <= n; i++) prof.push([12.5 + 0.9 * Math.sign(Math.sin(i * 1.26)) * 0.9 + 0.5 * Math.sin(i * 1.26), x0 + L * i / n]);
    for (var j = n; j >= 0; j--) prof.push([11.2, x0 + L * j / n]);
    var cs = new THREE.Mesh(latheX(prof, 28), PodMat.conduit); cs.castShadow = true; cs.receiveShadow = true; cs.userData.stub = true; g.add(cs);
    var rb = ribbonGeo([new V3(16.4, -12.3, 0), new V3(17.2, -16.6, 0), new V3(21.5, -17.4, 0), new V3(26.5, -13, 0), new V3(30.5, -5, 0), new V3(36, -0.5, 0), new V3(60, 0, 0), new V3(92, 0, 0)], 16, 0.35, 70);
    var rm = new THREE.Mesh(rb.geo, PodMat.ribbon); rm.castShadow = true; rm.userData.stub = true; g.add(rm);
    g.userData.ribbon = rb.curve;
    add(g, Cy(11.9, 11.9, 6, 20), mat(0x2b2e32, { roughness: 0.7 }), 33, 0, 0).rotation.z = Math.PI / 2;
  });
  CON.anchor.set(60, 13, 0);
  var CLAMP = mmPart(list, root, 'Klem dan pelat spasi', [0, 34, 0], function (g) {
    var band = new THREE.CylinderGeometry(24.4, 24.4, 10, 48, 1, true, -Math.PI / 2 + 0.5, 2 * Math.PI - 1.0); band.rotateZ(-Math.PI / 2); band.translate(13, 0, 0);
    var bm = new THREE.Mesh(band, PodMat.steel); bm.castShadow = true; g.add(bm);
    [-1, 1].forEach(function (s) {
      add(g, B(10, 1.6, 9), PodMat.steel, 13, 25.2, s * 15.2);
      add(g, Cy(1.6, 1.6, 2.2, 10), PodMat.steel, 13, 26.9, s * 15.6);
      add(g, Cy(1.9, 1.9, 14, 10), PodMat.steel, 13, 34, s * 15.6);
    });
    add(g, B(22, 3, 39), PodMat.alu, 13, 27.8, 0);
    var th = POD_TILT_DEG * Math.PI / 180, yt = function (x) { return (35 - (x - 13) * Math.sin(th)) / Math.cos(th); };
    var sh = new THREE.Shape(); sh.moveTo(3, 29.3); sh.lineTo(23, 29.3); sh.lineTo(23, yt(23)); sh.lineTo(3, yt(3)); sh.closePath();
    var wg = new THREE.ExtrudeGeometry(sh, { depth: 39, bevelEnabled: false }); wg.translate(0, 0, -19.5);
    var wm = new THREE.Mesh(wg, mat(0xb8bdc2, { metalness: 0.8, roughness: 0.45 })); wm.castShadow = true; g.add(wm);
  });
  CLAMP.anchor.set(13, 30, 0);
  return list;
}

/* ---------- pod pada skala asli di bawah lantai jembatan ---------- */
var podScene = null, podSceneParts = null;
task('Membuat pod kamera asli', function () {
  podScene = new THREE.Group();
  podScene.scale.setScalar(0.001);
  podScene.position.set(POD.x - 0.013, POD.y, POD.z);                     /* x = 0 pod di -1,5277 m, tengah cangkang 13 mm di belakangnya */
  world.add(podScene);
  podSceneParts = buildPod(podScene);
  /* di dalam model skala asli: tutup conduit dan klem tidak digambar terpisah dari lantai */
  podSceneParts.forEach(function (p) {
    if (p.name === 'Klem dan pelat spasi') { p.g.traverse(function (m) { if (m.isMesh && m.geometry.type === 'CylinderGeometry' && m.geometry.parameters.height === 14) m.visible = false; }); }
  });
});

/* =====================================================================
   HUB (box IP65 + Raspberry Pi), JALUR KABEL, ALIRAN DATA
   Satuan model = mm. Pusat box di titik asal; panjang box di sumbu x, tinggi di y, lebar di z.
   Tutup di atas (+y). Di jembatan dipasang terbalik (tutup menghadap ke bawah).
   ===================================================================== */
function bx(g, w, h, d, x, y, z, m, o) { return add(g, B(w, h, d), m, x, y, z, o); }
function buildHub(root) {
  var M = podMats(), list = [];
  var abs = mat(0xc9cdd0, { roughness: 0.5, metalness: 0.02 });
  var absIn = mat(0xb6bbbe, { roughness: 0.55 });
  var piG = mat(0x1d6e3d, { roughness: 0.4, metalness: 0.1 });
  var silver = mat(0xc2c6ca, { metalness: 0.9, roughness: 0.3 });
  var black = mat(0x16181b, { roughness: 0.5 });
  var gray = mat(0x9ea3a6, { roughness: 0.8 });
  var FL = -24.5;                                    /* permukaan lantai dalam */
  var cx = 6, cz = -8, PY = FL + 6;                  /* pusat Pi dan tinggi bawah PCB */
  /* --- box dasar dan standoff --- */
  var base = mmPart(list, root, 'Box dasar dan braket', [0, 0, 0], function (g) {
    bx(g, 115, 3, 90, 0, -26, 0, abs);
    bx(g, 115, 50, 3, 0, -2, -43.5, abs); bx(g, 115, 50, 3, 0, -2, 43.5, abs);
    bx(g, 3, 50, 84, -56, -2, 0, abs); bx(g, 3, 50, 84, 56, -2, 0, abs);
    [[-52, -39.5], [52, -39.5], [-52, 39.5], [52, 39.5]].forEach(function (p) { add(g, Cy(4.2, 4.2, 47, 10), absIn, p[0], -1, p[1]); add(g, Cy(1.3, 1.3, 2, 8), black, p[0], 22.6, p[1], { noCast: true }); });
    [[-29, -24.5], [29, -24.5], [-29, 24.5], [29, 24.5]].forEach(function (p) {
      add(g, Cy(2.8, 2.8, 6, 6), PodMat.brass, cx + p[0], FL + 3, cz + p[1]);
      add(g, Cy(0.9, 0.9, 3, 8), PodMat.brass, cx + p[0], FL + 7.4, cz + p[1]);
    });
    /* telinga pemasangan dan braket L baja */
    [-1, 1].forEach(function (s) {
      bx(g, 12, 2.4, 26, s * 66, -25.2, 0, absIn); bx(g, 10, 2.2, 22, s * 69, -34, 0, PodMat.steel);
      add(g, Cy(2.4, 2.4, 2.6, 12), black, s * 66, -25.2, 0, { noCast: true });
      bx(g, 2.2, 10, 22, s * 64, -30, 0, PodMat.steel);
    });
  });
  base.anchor.set(-40, -26, 42);
  /* --- Raspberry Pi 3B+ --- */
  var pi = mmPart(list, root, 'Raspberry Pi 3B+', [0, 30, 0], function (g) {
    var sx = cx - 42.5, zEdge = cz + 28;
    bx(g, 85, 1.4, 56, cx, PY + 0.7, cz, piG);
    [[-29, -24.5], [29, -24.5], [-29, 24.5], [29, 24.5]].forEach(function (p) { add(g, Cy(1.4, 1.4, 1.5, 10), PodMat.gold, cx + p[0], PY + 0.72, cz + p[1], { noCast: true }); add(g, Cy(0.9, 0.9, 1.6, 8), black, cx + p[0], PY + 0.72, cz + p[1], { noCast: true }); });
    var top = PY + 1.4;
    /* SoC dan heatsink */
    bx(g, 14, 2.2, 14, cx - 1, top + 1.1, cz - 4, silver);
    bx(g, 15, 2, 15, cx - 1, top + 3.2, cz - 4, PodMat.alu);
    for (var f = 0; f < 6; f++) bx(g, 15, 5.5, 1.1, cx - 1, top + 6.8, cz - 4 - 6.2 + f * 2.5, PodMat.alu);
    bx(g, 16, 2.3, 12, cx + 15, top + 1.15, cz + 6, silver);                              /* perisai Wi-Fi */
    bx(g, 11, 1.6, 11, cx - 18, top + 0.8, cz - 4, black);                                /* LAN chip */
    /* header GPIO */
    bx(g, 51, 8.5, 5, cx - 6, top + 4.2, cz - 25.5, black);
    var pg = []; for (var i = 0; i < 20; i++) { [-1.27, 1.27].forEach(function (zo) { pg.push(gbox(0.64, 6, 0.64, cx - 6 - 24.1 + i * 2.54, top + 11.4, cz - 25.5 + zo)); }); }
    mergeMesh(g, pg, PodMat.gold, { noRecv: true });
    /* konektor sisi +x */
    bx(g, 21, 13.5, 16, cx + 42.5 - 8.2, top + 6.7, cz + 14, silver);                    /* RJ45 */
    bx(g, 17, 16, 13.2, cx + 42.5 - 7.2, top + 8, cz - 3, silver); bx(g, 17, 16, 13.2, cx + 42.5 - 7.2, top + 8, cz - 20, silver);
    bx(g, 12, 3, 3, cx + 42.5 - 7, top + 8, cz - 3, black, { noCast: true }); bx(g, 12, 3, 3, cx + 42.5 - 7, top + 8, cz - 20, black, { noCast: true });
    /* konektor sisi +z (daya, HDMI, CSI, audio) */
    bx(g, 8, 2.6, 6, sx + 10.6, top + 1.5, zEdge - 1.5, silver);                         /* micro USB */
    bx(g, 15, 6.4, 11.5, sx + 32, top + 3.2, zEdge - 4, silver);                          /* HDMI */
    bx(g, 22, 5.5, 2.8, sx + 45, top + 2.7, zEdge - 5.5, mat(0xf0f0ea, { roughness: 0.6 })); bx(g, 20, 1.2, 1.6, sx + 45, top + 5.8, zEdge - 5.5, black);   /* CSI */
    bx(g, 7, 6, 12.5, sx + 53.5, top + 3, zEdge - 3.5, black);                            /* audio */
    /* slot microSD di bawah */
    bx(g, 11.5, 1.5, 13, sx + 7, PY - 0.8, cz, silver); bx(g, 11, 0.8, 15, sx + 6, PY - 1.3, cz, mat(0x20262e, { roughness: 0.5 }));
    /* LED kecil */
    bx(g, 1.5, 0.7, 1, sx + 19, top + 0.4, zEdge - 6, mat(0x55e68a, { emissive: lin(0x55e68a), emissiveIntensity: 0.5 }), { noCast: true });
  });
  pi.anchor.set(cx, PY + 12, cz);
  /* --- konverter 12 V ke 5 V dan fuse --- */
  var cv = mmPart(list, root, 'Konverter 12 V ke 5 V dan fuse', [0, 52, 0], function (g) {
    var y0 = FL + 3.5;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) { add(g, Cy(1.8, 1.8, 3.5, 6), PodMat.brass, -41 + s[0] * 8.5, FL + 1.75, 31.5 + s[1] * 6); });
    bx(g, 22, 1.2, 17, -41, y0 + 0.6, 31.5, mat(0x1c4fa8, { roughness: 0.4 }));
    bx(g, 8.5, 5, 8.5, -45, y0 + 3.6, 31.5, black); bx(g, 8, 0.6, 8, -45, y0 + 6.3, 31.5, silver);
    bx(g, 4, 1.5, 4, -37, y0 + 2, 27.5, black); bx(g, 3.5, 3, 3.5, -33.5, y0 + 2.2, 35, PodMat.brass);
    [[-1, 1], [1, 1]].forEach(function (s) { bx(g, 1.8, 0.4, 1.8, -41 + s[0] * 10, y0 + 1.3, 31.5 + s[1] * 5, PodMat.gold, { noCast: true }); });
    /* dudukan fuse inline */
    var fh = add(g, Cy(4.6, 4.6, 32, 14), mat(0x1b1c1f, { roughness: 0.6 }), 2, FL + 6, 38); fh.rotation.z = Math.PI / 2;
    add(g, Cy(2.5, 2.5, 20, 10), mat(0xe6e1d0, { roughness: 0.2, transparent: true, opacity: 0.55 }), 2, FL + 6, 38).rotation.z = Math.PI / 2;
    bx(g, 20, 0.3, 0.3, 2, FL + 6, 38, silver);
    /* kabel */
    var red = mat(0xc42a22, { roughness: 0.6 }), blk = mat(0x15161a, { roughness: 0.6 });
    tube(g, [new V3(22, -5, 46), new V3(22, -12, 42), new V3(18, FL + 7, 40), new V3(14, FL + 6, 38)], 1.3, red, 20, false, { noCast: true });
    tube(g, [new V3(-14, FL + 6, 38), new V3(-26, FL + 5, 36), new V3(-32, y0 + 2, 33)], 1.3, red, 20, false, { noCast: true });
    tube(g, [new V3(-50, y0 + 2, 33), new V3(-46, FL + 12, 24), new V3(-30, FL + 16, 21), new V3(-25, PY + 3, 17.5)], 1.5, blk, 24, false, { noCast: true });
  });
  cv.anchor.set(-41, FL + 12, 31);
  /* --- silica gel --- */
  var gel = mmPart(list, root, 'Silica gel', [0, 66, 0], function (g) {
    add(g, wrinkle(new THREE.BoxGeometry(24, 6, 14, 6, 3, 4), 1.2, 0.4, 5), mat(0xf4f4ef, { roughness: 0.95 }), 38, FL + 3.2, 31);
    bx(g, 14, 0.2, 8, 38, FL + 6.4, 31, mat(0x1c68c4, { roughness: 0.8 }), { noCast: true });
  });
  gel.anchor.set(38, FL + 8, 31);
  /* --- gasket --- */
  var gasket = mmPart(list, root, 'Gasket dan tutup', [0, 52, 0], function (g) {
    var gm = mat(0x6a6e72, { roughness: 0.9 });
    bx(g, 112, 2, 2.4, 0, 22.9, -40, gm); bx(g, 112, 2, 2.4, 0, 22.9, 40, gm); bx(g, 2.4, 2, 80, -54.5, 22.9, 0, gm); bx(g, 2.4, 2, 80, 54.5, 22.9, 0, gm);
    bx(g, 115, 4.2, 90, 0, 25.4, 0, abs);
    bx(g, 98, 1.6, 74, 0, 27.8, 0, mat(0xc0c5c8, { roughness: 0.4 }), { noCast: true });
    [[-52, -39.5], [52, -39.5], [-52, 39.5], [52, 39.5]].forEach(function (p) { add(g, Cy(2.5, 2.5, 1.6, 12), PodMat.steel, p[0], 28.2, p[1]); bx(g, 3.2, 0.5, 0.7, p[0], 29.1, p[1], black, { noCast: true }); });
  });
  gasket.dx = [0, 56, 0];
  gasket.anchor.set(-30, 29, 30);
  /* --- gland 12 V (dinding +z) --- */
  var gl1 = mmPart(list, root, 'Gland kabel 12 V', [0, 0, 36], function (g) {
    var gm = mat(0x1f2124, { roughness: 0.6 });
    var a = add(g, Cy(8.6, 8.6, 6, 6), gm, 22, -5, 44); a.rotation.x = Math.PI / 2;
    add(g, Cy(6.2, 7.4, 9, 18), gm, 22, -5, 51.5).rotation.x = Math.PI / 2;
    add(g, Cy(3.4, 3.4, 18, 12), mat(0x9ea1a4, { roughness: 0.7 }), 22, -5, 60).rotation.x = Math.PI / 2;
    add(g, Cy(5.6, 5.6, 4, 12), gm, 22, -5, 41.5).rotation.x = Math.PI / 2;
  });
  gl1.anchor.set(22, -5, 54);
  /* --- gland conduit dan kabel pita (dinding -x) --- */
  var gl2 = mmPart(list, root, 'Gland conduit', [-46, 0, 0], function (g) {
    var gm = mat(0x1f2124, { roughness: 0.6 });
    add(g, Cy(15, 15, 6, 6), gm, -61, 0, 0).rotation.z = Math.PI / 2;
    add(g, Cy(12.5, 14, 11, 20), gm, -69, 0, 0).rotation.z = Math.PI / 2;
    var prof = [], n = 26;
    for (var i = 0; i <= n; i++) prof.push([12.4 + 0.5 * Math.sin(i * 1.26), -136 + 64 * i / n]);
    for (var j = n; j >= 0; j--) prof.push([11.2, -136 + 64 * j / n]);
    var cm = new THREE.Mesh(latheX(prof, 24), PodMat.conduit); cm.castShadow = true; cm.receiveShadow = true; g.add(cm);
    var rb = ribbonGeo([new V3(-150, 0, 0), new V3(-96, 0, 0), new V3(-72, 0, -2), new V3(-58, -3, -3), new V3(-45, -4, 8), new V3(-26, -7, 20), new V3(-6, -11, 22), new V3(3, -13, 20), new V3(cx - 42.5 + 45, -15.8, cz + 24)], 16, 0.35, 70);
    g.add(new THREE.Mesh(rb.geo, PodMat.ribbon));
    g.userData.ribbon = rb.curve;
  });
  gl2.anchor.set(-69, 12, 0);
  return list;
}

/* ---------- hub skala asli, terbalik di bawah lantai jembatan ---------- */
var hubScene = null, hubSceneParts = null, hubCable = null, cableX = null, cableCurve = null, cableClips = [];
task('Memasang hub dan kabel', function () {
  hubScene = new THREE.Group(); hubScene.scale.setScalar(0.001);
  hubScene.position.set(HUB.x, HUB.y, HUB.z); hubScene.rotation.x = Math.PI;
  world.add(hubScene);
  hubSceneParts = buildHub(hubScene);
  /* kabel 12 V: tiang, tanah, tepi tebing, bawah lantai, gland hub */
  var P = [[-2.57, 2.93, -5.4], [-2.655, 2.7, -5.4], [-2.655, GY + 0.04, -5.4], [-2.45, GY + 0.015, -5.0], [-1.95, GY + 0.015, -3.95], [-1.58, GY + 0.015, -3.1], [-1.45, 1.33, -2.9], [-1.42, 1.263, -2.4],
    [-1.42, 1.262, -1.2], [-1.38, 1.262, -0.2], [-1.2, 1.262, 0.18], [-1.12, 1.208, 0.3], [-1.118, 1.212, 0.46], [-1.118, 1.25, 0.534]];
  cableX = P.map(function (p) { return new V3(p[0], p[1], p[2]); });
  var cm2 = mat(0x16181b, { roughness: 0.55 });
  var t = tube(world, cableX, 0.0032, cm2, 160, false, { noCast: false });
  cableCurve = t.curve;
  /* klip kabel tiap sekitar 35 cm di bagian bawah lantai */
  var clipM = mat(0xe9ecee, { roughness: 0.5 });
  [0.46, 0.54, 0.62, 0.7].forEach(function (u) {
    var p = cableCurve.getPoint(u), c = add(world, B(0.014, 0.004, 0.012), clipM, p.x, p.y + 0.0045, p.z, { noRecv: true });
    add(world, Cy(0.0022, 0.0022, 0.006, 6), steelMat, p.x, p.y + 0.009, p.z, { noCast: true });
  });
  /* tembus pandang */
  var xr = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 160, 0.03, 8, false), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  xr.renderOrder = 20; xr.visible = false; world.add(xr);
  hubCable = [xr];
});
function setCableXray(on) { if (hubCable) hubCable.forEach(function (m) { m.visible = on; }); }

/* =====================================================================
   KAMERA POD: pandangan kamera (PiP), zona pantau, kotak deteksi, tutupan
   ===================================================================== */
/* empat tingkat Riverwatch: Aman, Waspada, Peringatan, Kritis (warna sama dengan dasbor) */
var LVC = [0x34c9a0, 0xffc53d, 0xff8a3d, 0xff4d5e];
var POD_PITCH = 19 * Math.PI / 180, POD_YAW = -5 * Math.PI / 180;
var podCam = new THREE.PerspectiveCamera(31.65, 16 / 9, 0.03, 260);
podCam.layers.enable(1);
var ZONE_IMG = [[0.22, 0.20], [0.78, 0.20], [0.98, 0.97], [0.02, 0.97]];   /* zona pantau di bidang gambar (u, v) */
var zoneWorld = [], podPos = new V3(), podDir = new V3();
var noPipList = [], zoneG = new THREE.Group(), boxG = new THREE.Group(), flowG = new THREE.Group();
zoneG.userData.noPip = flowG.userData.noPip = true;
world.add(zoneG); world.add(flowG);

/* pasang kemiringan pod (pitch) dan arah (yaw); posisi kamera di depan tudung */
function aimPod() {
  podScene.rotation.order = 'YXZ';
  podScene.rotation.set(0, POD_YAW, POD_PITCH);
  var po = new V3(0.013, 0, 0).applyEuler(podScene.rotation);
  podScene.position.set(POD.x - po.x, POD.y - po.y, POD.z - po.z);
  podScene.updateMatrixWorld(true);
  podDir.set(-1, 0, 0).applyQuaternion(podScene.quaternion);
  podPos.set(-14 + 0, 0, 0).applyMatrix4(podScene.matrixWorld);
  podScene.children.forEach(function (c) { });
  podCam.position.copy(podPos);
  podCam.up.set(0, 1, 0);
  podCam.lookAt(podPos.clone().add(podDir));
  podCam.updateMatrixWorld(true);
}

/* sinar dari titik gambar ke bidang air */
function imgToWater(u, v) {
  var rc = new THREE.Raycaster(); rc.setFromCamera(new V2(u * 2 - 1, 1 - v * 2), podCam);
  var o = rc.ray.origin, d = rc.ray.direction;
  if (d.y >= -1e-4) return null;
  var t = (0.0 - o.y) / d.y;
  return new V3(o.x + d.x * t, 0.0, o.z + d.z * t);
}

/* ---------- pandangan kamera ---------- */
var pipRT = null, pipQuadScene = new THREE.Scene(), pipOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), pipMat = null;
var pipEl = $('pip'), hudC = $('pipHud'), hud = hudC.getContext('2d');
function makePipRT() {
  var W = coarse ? 480 : 704, H = Math.round(W * 9 / 16), type = THREE.UnsignedByteType;
  try {
    if (renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')) type = THREE.HalfFloatType;
    else if (!renderer.capabilities.isWebGL2 && renderer.extensions.has('OES_texture_half_float') && renderer.extensions.has('EXT_color_buffer_half_float')) type = THREE.HalfFloatType;
  } catch (e) { }
  pipRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: type, format: THREE.RGBAFormat, depthBuffer: true });
  pipRT.texture.encoding = THREE.LinearEncoding;
  pipMat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: pipRT.texture }, uTime: skyU.uTime, uNight: skyU.uNight, uGain: { value: 1 }, uRes: { value: new V2(W, H) } },
    depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform sampler2D tMap; uniform float uTime; uniform float uNight; uniform float uGain; uniform vec2 uRes;',
      'float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
      'void main(){',
      '  vec2 c = vUv - 0.5; float r2 = dot(c, c);',
      '  vec2 uv = 0.5 + c * (1.0 + 0.07 * r2);',
      '  vec3 col;',
      '  col.r = texture2D(tMap, 0.5 + (uv - 0.5) * 1.003).r; col.g = texture2D(tMap, uv).g; col.b = texture2D(tMap, 0.5 + (uv - 0.5) * 0.997).b;',
      '  col *= uGain;',
      '  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
      '  col = mix(vec3(l), col, 0.9 - 0.8 * uNight);',
      '  col *= mix(vec3(1.0), vec3(0.84, 1.0, 0.9), uNight);',
      '  col = col * 0.96 + 0.01;',
      '  float n = hh(vUv * uRes + fract(uTime * 7.0) * 91.0) - 0.5;',
      '  col += n * (0.014 + 0.085 * uNight) * (0.35 + 1.5 * l);',
      '  col *= 1.0 - 0.42 * smoothstep(0.30, 0.82, length(c) * 1.25);',
      '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <encodings_fragment>',
      '}'].join('\n')
  });
  var q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pipMat); q.frustumCulled = false; pipQuadScene.add(q);
}

/* ---------- kotak deteksi 3D di model dan di gambar ---------- */
var EDGE_GEO = null, boxLineMats = [];
function buildBoxLines() {
  EDGE_GEO = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  boxLineMats = TCLS.map(function (c) { return new THREE.LineBasicMaterial({ color: c.hex, transparent: true, opacity: 0.95, depthTest: false }); });
  T.forEach(function (it) {
    var ls = new THREE.LineSegments(EDGE_GEO, boxLineMats[it.cls]);
    var sz = it.box.getSize(new V3()), ct = it.box.getCenter(new V3());
    ls.scale.set(sz.x + 0.04, sz.y + 0.04, sz.z + 0.04); ls.position.copy(ct); ls.renderOrder = 15; ls.userData.noPip = true;
    it.g.add(ls); it.lines = ls;
  });
}
var tmpV = new V3(), BOXES = [];
function projectItems() {
  BOXES.length = 0;
  podCam.updateMatrixWorld(true); podCam.updateProjectionMatrix();
  var mv = new THREE.Matrix4().multiplyMatrices(podCam.projectionMatrix, podCam.matrixWorldInverse);
  for (var i = 0; i < T.length; i++) {
    var it = T[i];
    if (it.s < 0.6) continue;
    it.g.updateMatrixWorld(true);
    var minX = 9, minY = 9, maxX = -9, maxY = -9, ok = true, P = it.pts, me = it.g.matrixWorld.elements;
    for (var c = 0; c < P.length; c++) {
      var px = P[c].x, py = P[c].y, pz = P[c].z;
      var wx = me[0] * px + me[4] * py + me[8] * pz + me[12], wy = me[1] * px + me[5] * py + me[9] * pz + me[13], wz = me[2] * px + me[6] * py + me[10] * pz + me[14];
      var w = wx * mv.elements[3] + wy * mv.elements[7] + wz * mv.elements[11] + mv.elements[15];
      if (w <= 0.05) { ok = false; break; }
      var x = (wx * mv.elements[0] + wy * mv.elements[4] + wz * mv.elements[8] + mv.elements[12]) / w;
      var y = (wx * mv.elements[1] + wy * mv.elements[5] + wz * mv.elements[9] + mv.elements[13]) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!ok) continue;
    var u0 = (minX + 1) / 2, u1 = (maxX + 1) / 2, v0 = (1 - maxY) / 2, v1 = (1 - minY) / 2;
    if (u1 < 0 || u0 > 1 || v1 < 0 || v0 > 1) continue;
    u0 = clamp(u0, 0, 1); u1 = clamp(u1, 0, 1); v0 = clamp(v0, 0, 1); v1 = clamp(v1, 0, 1);
    if (u1 - u0 < 0.012 || v1 - v0 < 0.012) continue;
    BOXES.push({ it: it, u0: u0, v0: v0, u1: u1, v1: v1 });
  }
}
/* tutupan = luas gabungan kotak di dalam zona / luas zona (dihitung pada kisi 160 x 90) */
var covC = makeCanvas(160, 90), covG = covC.getContext('2d', { willReadFrequently: true }), zoneArea = 0, coverage = 0, covCount = 0;
function zonePath(g, W, H) { g.beginPath(); ZONE_IMG.forEach(function (p, i) { if (i) g.lineTo(p[0] * W, p[1] * H); else g.moveTo(p[0] * W, p[1] * H); }); g.closePath(); }
function computeCoverage() {
  covG.setTransform(1, 0, 0, 1, 0, 0);
  covG.clearRect(0, 0, 160, 90);
  covG.save(); zonePath(covG, 160, 90); covG.clip();
  covG.fillStyle = '#fff'; covG.fillRect(0, 0, 160, 90);
  var d0 = covG.getImageData(0, 0, 160, 90).data, tot = 0, k;
  for (k = 3; k < d0.length; k += 4) if (d0[k] > 127) tot++;
  zoneArea = tot;
  covG.clearRect(0, 0, 160, 90);
  covG.fillStyle = '#fff';
  BOXES.forEach(function (b) { covG.fillRect(b.u0 * 160, b.v0 * 90, (b.u1 - b.u0) * 160, (b.v1 - b.v0) * 90); });
  covG.restore();
  /* hanya bagian di dalam zona yang dihitung: gambar ulang dengan klip */
  covG.save(); zonePath(covG, 160, 90); covG.clip();
  var im = covG.getImageData(0, 0, 160, 90).data, cnt = 0;
  for (k = 3; k < im.length; k += 4) if (im[k] > 127) cnt++;
  covG.restore();
  coverage = zoneArea ? cnt / zoneArea : 0;
  covCount = BOXES.length;
  return coverage;
}

/* ---------- gambar HUD pada kanvas PiP ---------- */
var hudW = 0, hudH = 0;
function sizeHud() {
  var w = pipEl.clientWidth, h = pipEl.clientHeight, d = Math.min(DPR, 2);
  if (!w || !h) return;
  hudC.width = Math.round(w * d); hudC.height = Math.round(h * d); hudW = w; hudH = h;
  hud.setTransform(d, 0, 0, d, 0, 0);
}
function drawHud(lvl, cov) {
  if (!hudW) sizeHud();
  if (!hudW) return;
  var W = hudW, H = hudH, g = hud;
  g.clearRect(0, 0, W, H);
  var lc = '#' + ('000000' + LVC[lvl].toString(16)).slice(-6);
  /* zona */
  g.save(); zonePath(g, W, H);
  g.fillStyle = lc + '22'; g.fill();
  g.setLineDash([6, 4]); g.lineWidth = 1.6; g.strokeStyle = lc; g.stroke(); g.restore();
  /* kotak deteksi */
  var small = W < 260;
  g.font = '500 ' + (small ? 9 : 11) + 'px "IBM Plex Mono", ui-monospace, monospace'; g.textBaseline = 'top';
  BOXES.forEach(function (b) {
    var col = '#' + ('000000' + TCLS[b.it.cls].hex.toString(16)).slice(-6);
    var x = b.u0 * W, y = b.v0 * H, w = (b.u1 - b.u0) * W, h = (b.v1 - b.v0) * H;
    g.lineWidth = 1.5; g.strokeStyle = col; g.strokeRect(x, y, w, h);
    if (w > (small ? 30 : 36) && h > 10) {
      var t = b.it.name + ' ' + b.it.conf.toFixed(2), tw = g.measureText(t).width + 6;
      g.fillStyle = col; g.fillRect(x - 0.75, y - (small ? 10 : 13), Math.min(tw, w + 2), small ? 10 : 13);
      g.fillStyle = '#10161b'; g.fillText(t, x + 2, y - (small ? 9 : 12), w);
    }
  });
  /* teks pojok */
  var fs = small ? 9 : 11;
  g.font = '500 ' + fs + 'px "IBM Plex Mono", ui-monospace, monospace';
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 3;
  g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(small ? 'RW-01' : 'RW-01 / TITIK 1', 8, 6);
  g.textAlign = 'right';
  var hr = Math.floor(state.hour), mn = Math.floor((state.hour - hr) * 60);
  g.fillText(('0' + hr).slice(-2) + ':' + ('0' + mn).slice(-2) + ' WIB', W - 8, 6);
  g.textBaseline = 'bottom'; g.textAlign = 'left';
  g.fillText('ZONA ' + Math.round(cov * 100) + '%  ·  ' + BOXES.length + ' objek', 8, H - 6);
  g.textAlign = 'right'; g.fillStyle = lc;
  g.fillText(['AMAN', 'WASPADA', 'PERINGATAN', 'KRITIS'][lvl], W - 8, H - 6);
  g.shadowBlur = 0;
  /* titik rekam */
  g.beginPath(); g.fillStyle = (Math.floor(state.tm * 1.2) % 2) ? '#ff4b43' : 'rgba(255,75,67,0.25)'; g.arc(small ? W / 2 : W / 2 - 28, 11, 3, 0, 6.283); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = 'rgba(255,255,255,0.85)'; if (!small) g.fillText('ANALISIS', W / 2 + 8, 6);
}

/* ---------- zona dan sudut pandang di model ---------- */
var zoneFill = null, zoneLine = null, coneM = null, coneL = null, zoneMats = [];
function buildZone() {
  var pts = [];
  ZONE_IMG.forEach(function (p) { var w = imgToWater(p[0], p[1]); pts.push(w); });
  zoneWorld = pts;
  var Y = 0.035, pos = [];
  [0, 1, 2, 0, 2, 3].forEach(function (i) { pos.push(pts[i].x, Y, pts[i].z); });
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  var zm = new THREE.MeshBasicMaterial({ color: LVC[1], transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  zoneFill = new THREE.Mesh(g, zm); zoneFill.renderOrder = 3; zoneG.add(zoneFill);
  var lg = new THREE.BufferGeometry().setFromPoints(pts.concat([pts[0]]).map(function (p) { return new V3(p.x, Y + 0.004, p.z); }));
  var lm = new THREE.LineBasicMaterial({ color: LVC[1], transparent: true, opacity: 0.95 });
  zoneLine = new THREE.Line(lg, lm); zoneLine.renderOrder = 4; zoneG.add(zoneLine);
  /* kerucut pandang dari pod */
  var ap = podPos, cp = [];
  [0, 1, 2, 3].forEach(function (i) { var a = pts[i], b = pts[(i + 1) % 4]; cp.push(ap.x, ap.y, ap.z, a.x, Y, a.z, b.x, Y, b.z); });
  var cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  var cmt = new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide });
  coneM = new THREE.Mesh(cg, cmt); coneM.renderOrder = 2; zoneG.add(coneM);
  var lp = []; pts.forEach(function (p) { lp.push(ap.x, ap.y, ap.z, p.x, Y, p.z); });
  var cl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp.length ? (function () { var a = []; for (var i = 0; i < lp.length; i += 3) a.push(new V3(lp[i], lp[i + 1], lp[i + 2])); return a; })() : []), new THREE.LineBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.55 }));
  coneL = cl; zoneG.add(cl);
  zoneMats = [zm, lm];
}
function setZoneColor(lvl) { zoneMats.forEach(function (m) { m.color.setHex(LVC[lvl]); }); }

/* ---------- awan, ponsel, paket data ---------- */
var cloudPos = new V3(-0.2, 7.6, -2.6), phonePos = new V3(4.2, 5.6, 4.6);
var phoneTex = null, phoneC = null, packets = [], flowCurves = [];
function rrectPath(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); }
var LV = [
  { name: 'Aman', css: '#34c9a0', rule: 'Tutupan di bawah 15%. Hanya dicatat.', notif: 'Tidak ada notifikasi ke petugas.' },
  { name: 'Waspada', css: '#ffc53d', rule: 'Tutupan mulai 15%. Dipantau lebih rapat.', notif: 'Notifikasi ke petugas wilayah.' },
  { name: 'Peringatan', css: '#ff8a3d', rule: 'Tutupan mulai 25%. Petugas perlu datang.', notif: 'Notifikasi ke petugas dan koordinator.' },
  { name: 'Kritis', css: '#ff4d5e', rule: 'Tutupan mulai 35% atau naik cepat.', notif: 'Notifikasi diulang sampai dikonfirmasi.' }
];
function drawPhone(l, cov) {
  var g = phoneC.getContext('2d');
  g.fillStyle = '#0f1720'; g.fillRect(0, 0, 256, 460);
  g.fillStyle = '#1b2733'; g.fillRect(0, 0, 256, 46);
  g.fillStyle = '#e8eef3'; g.font = '600 20px sans-serif'; g.fillText('Riverwatch', 14, 31);
  if (l === 0) {
    g.fillStyle = '#8fa2ae'; g.font = '18px sans-serif'; g.fillText('Tidak ada peringatan.', 14, 90); g.fillText('Tutupan ' + cov + '%', 14, 120);
  } else {
    g.fillStyle = '#1f2f3d'; rrectPath(g, 12, 62, 232, 262, 12); g.fill();
    g.fillStyle = LV[l].css; rrectPath(g, 26, 76, 112, 30, 8); g.fill();
    g.fillStyle = '#0f1720'; g.font = '600 17px sans-serif'; g.fillText(LV[l].name, 38, 98);
    g.fillStyle = '#e8eef3'; g.font = '600 20px sans-serif'; g.fillText('Titik 1', 26, 140);
    g.font = '18px sans-serif'; g.fillStyle = '#c3d0da';
    g.fillText('Tutupan ' + cov + '%', 26, 172); g.fillText('Foto terlampir', 26, 202); g.fillText('Tautan peta', 26, 232);
    g.fillStyle = '#8fa2ae'; g.font = '16px sans-serif'; g.fillText('Balas: ditangani', 26, 296);
  }
  phoneTex.needsUpdate = true;
}
function buildFlow() {
  /* awan */
  var cc = makeCanvas(256, 160), g = cc.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.96)';
  [[80, 96, 40], [124, 76, 48], [170, 94, 40], [128, 108, 52]].forEach(function (c) { g.beginPath(); g.arc(c[0], c[1], c[2], 0, 6.283); g.fill(); });
  g.fillStyle = '#18323f'; g.font = '600 22px sans-serif'; g.textAlign = 'center'; g.fillText('Internet', 128, 96); g.font = '500 17px sans-serif'; g.fillText('Bot Telegram', 128, 122);
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(cc, { clamp: true }), transparent: true, depthWrite: false, depthTest: false, opacity: 0.95 }));
  sp.position.copy(cloudPos); sp.scale.set(2.6, 1.62, 1); sp.renderOrder = 18; flowG.add(sp);
  /* ponsel */
  phoneC = makeCanvas(256, 460); phoneTex = canvasTex(phoneC, { clamp: true });
  var ph = new THREE.Group(); ph.position.copy(phonePos); ph.rotation.y = -0.6; flowG.add(ph);
  add(ph, new THREE.BoxGeometry(0.62, 1.12, 0.06), mat(0x15191d, { roughness: 0.4, metalness: 0.5 }), 0, 0, 0, { noCast: true });
  add(ph, new THREE.PlaneGeometry(0.54, 0.97), new THREE.MeshBasicMaterial({ map: phoneTex, toneMapped: false }), 0, 0, 0.032, { noCast: true });
  /* jalur data: hub -> awan -> ponsel */
  var hubP = new V3(HUB.x, HUB.y + 0.02, HUB.z);
  var c1 = new THREE.CatmullRomCurve3([hubP, new V3(-1.0, 3.4, -0.2), new V3(-0.6, 6.2, -1.8), cloudPos.clone().add(new V3(0, -0.6, 0))]);
  var c2 = new THREE.CatmullRomCurve3([cloudPos.clone().add(new V3(0, -0.6, 0)), new V3(2.4, 6.9, 1.2), new V3(3.8, 6.5, 3.0), phonePos.clone().add(new V3(0, 0.4, 0))]);
  flowCurves = [c1, c2];
  [c1, c2].forEach(function (c) {
    var lg = new THREE.BufferGeometry().setFromPoints(c.getPoints(60));
    var ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.4, depthTest: false })); ln.renderOrder = 16; flowG.add(ln);
  });
  var pm = new THREE.MeshBasicMaterial({ color: 0xb8ecff, transparent: true, opacity: 0.95, depthTest: false });
  for (var i = 0; i < 14; i++) { var m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), pm); m.renderOrder = 17; flowG.add(m); packets.push({ m: m, c: i < 7 ? 0 : 1, t: (i % 7) / 7 }); }
  drawPhone(1, 0);
}

/* ---------- ikat semuanya ---------- */
var pipBusy = 0, pipDrawn = false, pipFrame = 0, covTimer = 0, lastLvl = -1, lastCovInt = -1, pipHideList = null;
/* conduit fleksibel dari pod ke hub: kurva halus, belang gelap-terang sebagai gelombang conduit */
function buildConduitLink() {
  podScene.traverse(function (m) { if (m.userData && m.userData.stub) m.visible = false; });
  var s0 = new V3(36, 0, 0).applyMatrix4(podScene.matrixWorld), bk = new V3(1, 0, 0).applyQuaternion(podScene.quaternion);
  var e0 = new V3(HUB.x - 0.136, HUB.y, HUB.z);
  var cu = new THREE.CatmullRomCurve3([s0, s0.clone().addScaledVector(bk, 0.03), s0.clone().addScaledVector(bk, 0.07).lerp(e0, 0.12), e0.clone().add(new V3(-0.05, 0.0, 0)), e0], false, 'catmullrom', 0.4);
  var seg = 220, tg = new THREE.TubeGeometry(cu, seg, 0.0125, 10, false), n = tg.attributes.position.count, col = new Float32Array(n * 3), rad = 11, cc = new THREE.Color();
  for (var i = 0; i < n; i++) { var ring = Math.floor(i / (rad)), k = (ring % 5 < 2) ? 0.55 : 1.0; cc.setRGB(0.12 * k, 0.13 * k, 0.14 * k).convertSRGBToLinear(); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  var cm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 })); cm.castShadow = true; cm.receiveShadow = true; world.add(cm);
  var xr2 = new THREE.Mesh(new THREE.TubeGeometry(cu, 40, 0.022, 8, false), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  xr2.renderOrder = 20; xr2.visible = false; world.add(xr2); hubCable.push(xr2);
}
task('Menyiapkan kamera pod dan zona pantau', function () {
  aimPod(); buildConduitLink(); makePipRT(); buildBoxLines(); buildZone(); buildFlow(); sizeHud();
});
window.__onResize = function () { sizeHud(); };
function levelFromCov(c) { return c < 0.15 ? 0 : (c < 0.35 ? 1 : 2); }
function pipRect() {
  var s = stage.getBoundingClientRect(), r = pipEl.getBoundingClientRect();
  return { x: r.left - s.left, y: s.bottom - r.bottom, w: r.width, h: r.height, sh: s.height };
}
/* dipanggil dari loop utama setelah render adegan */
afterRender.push(function (dt) {
  var showPip = state.showPip && state.view === 0 && pipRT;
  /* paket data bergerak sepanjang jalur */
  var speed = state.level === 0 ? 0.1 : 0.32;
  packets.forEach(function (p) { p.t = (p.t + dt * speed) % 1; var pt = flowCurves[p.c].getPoint(p.t); p.m.position.copy(pt); p.m.scale.setScalar(0.6 + 0.4 * Math.sin(p.t * 3.14)); });
  if (!showPip) return;
  pipFrame++;
  covTimer -= dt;
  if (covTimer <= 0) {
    covTimer = 0.3;
    projectItems();
    var c = computeCoverage(), ci = Math.round(c * 100);
    if (ci !== lastCovInt) { lastCovInt = ci; uiCoverage(c); }
  }
  if (pipFrame % pipSkip === 0 || reduce || !pipDrawn) {
    if (!pipHideList) { pipHideList = []; scene.traverse(function (o) { if (o.userData && o.userData.noPip) pipHideList.push(o); }); }
    pipHideList.forEach(function (o) { o._v = o.visible; o.visible = false; });
    podCam.updateMatrixWorld(true);
    pipMat.uniforms.uGain.value = 1 + 1.6 * state.night;
    var prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(pipRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, podCam);
    renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.autoUpdate = prevAuto;
    pipHideList.forEach(function (o) { o.visible = o._v; });
    pipDrawn = true;
    drawHud(state.level, coverage);
  }
  /* kuadran hasil kamera digambar setiap frame supaya tidak berkedip */
  var r = pipRect(), sz = renderer.getSize(new V2());
  renderer.autoClear = false;
  renderer.setScissorTest(true); renderer.setViewport(r.x, r.y, r.w, r.h); renderer.setScissor(r.x, r.y, r.w, r.h);
  renderer.clearDepth();
  renderer.render(pipQuadScene, pipOrtho);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, sz.x, sz.y);
  renderer.autoClear = true;
});

/* =====================================================================
   LATAR JAUH: hanya terlihat oleh kamera pod (layer 1), menyambung sungai ke arah hulu
   ===================================================================== */
task('Menyambung sungai ke arah hulu', function () {
  var c0 = riverC(XMIN), hw = riverHW(XMIN), D = bankRun(XMIN), FAR = 140;
  function L1(m) { m.layers.set(1); m.frustumCulled = false; scene.add(m); return m; }
  var wm = new THREE.ShaderMaterial({
    uniforms: { uSunDir: skyU.uSunDir, uZenith: skyU.uZenith, uHorizon: skyU.uHorizon, uGround: skyU.uGround, uSunCol: skyU.uSunCol, uNight: skyU.uNight, uTime: skyU.uTime, uCloud: { value: 0 }, uDisc: skyU.uDisc },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying vec3 vW;\n' + SKY_FN + '\nvoid main(){ vec3 V = normalize(cameraPosition - vW); float f = 0.03 + 0.97 * pow(1.0 - max(V.y, 0.0), 5.0);' +
      ' vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0)); vec3 refl = skyCol(R, 0.0);' +
      ' vec3 body = vec3(0.045, 0.095, 0.075) * (0.35 + 0.65 * clamp(uSunDir.y, 0.0, 1.0)) * (1.0 - 0.7 * uNight) + uHorizon * 0.1;' +
      ' gl_FragColor = vec4(mix(body, refl, f), 1.0);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}'
  });
  var water = new THREE.Mesh(new THREE.PlaneGeometry(FAR, hw * 2 + 0.2), wm);
  water.rotation.x = -Math.PI / 2; water.position.set(XMIN - FAR / 2 + 0.05, -0.02, c0); L1(water);
  /* tebing dan daratan: penampang diekstrusi ke arah -x */
  [-1, 1].forEach(function (s) {
    var prof = [[hw + 0.1, -0.33], [hw + D * 0.5, 0.35], [hw + D, GY], [hw + D + 1.0, GY], [hw + D + 70, GY + 0.2]];
    var pos = [], col = [], idx = [];
    prof.forEach(function (p, i) {
      [XMIN + 0.02, XMIN - FAR].forEach(function (x) {
        pos.push(x, p[1], c0 + s * p[0]);
        var t = i < 2 ? [0.35, 0.3, 0.2] : [0.2, 0.34, 0.12];
        var cc = new THREE.Color(t[0], t[1], t[2]); col.push(cc.r, cc.g, cc.b);
      });
    });
    for (var i = 0; i < prof.length - 1; i++) { var a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, c, b, d); }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    L1(m);
  });
  /* barisan pohon di kejauhan */
  var rn = rng(404), geos = [], tr = [];
  for (var k = 0; k < 3; k++) geos.push(blob(2.4 - k * 0.3, 90 + k, [0.5, 0.74, 0.34]).translate((k - 1) * 1.5, 4.4 + k * 0.3, k * 0.6));
  var canopy = BGU.mergeBufferGeometries(geos, false), trunk = Cy(0.18, 0.28, 3.4, 6); trunk.translate(0, 1.7, 0);
  var N = 70, ci = new THREE.InstancedMesh(canopy, canopyMat, N), ti = new THREE.InstancedMesh(trunk, barkMat, N), dm = new THREE.Object3D();
  for (var i = 0; i < N; i++) {
    var x = XMIN - 4 - rn() * 120, s = rn() < 0.5 ? -1 : 1, z = c0 + s * (hw + D + 3 + rn() * 12), sc = 0.9 + rn() * 1.1;
    dm.position.set(x, GY - 0.1, z); dm.rotation.set(0, rn() * 6, 0); dm.scale.setScalar(sc); dm.updateMatrix();
    ci.setMatrixAt(i, dm.matrix); ti.setMatrixAt(i, dm.matrix);
  }
  L1(ci); L1(ti);
});

/* =====================================================================
   PANEL KONTROL, PIN, RINCIAN BAGIAN, TUR
   ===================================================================== */
var detailFloor = null, dimsPod = [], dimsHub = [], podParts = null, hubParts = null;
var POD_S = 0.015, HUB_S = 0.0135, cutPlane = new THREE.Plane(new V3(0, 0, -1), 0);

function dimSprite(text, w) {
  var c = makeCanvas(192, 56), g = c.getContext('2d');
  g.fillStyle = 'rgba(12,22,30,0.88)'; rrectPath(g, 2, 2, 188, 52, 12); g.fill();
  g.strokeStyle = '#ffc247'; g.lineWidth = 2; rrectPath(g, 2, 2, 188, 52, 12); g.stroke();
  g.fillStyle = '#ffd98a'; g.font = '600 30px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 96, 30);
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c, { clamp: true }), transparent: true, depthTest: false, depthWrite: false }));
  sp.scale.set(w, w * 56 / 192, 1); sp.renderOrder = 31; return sp;
}
var dimMat = new THREE.LineBasicMaterial({ color: 0xffc247, transparent: true, depthTest: false });
function dim(parent, a, b, tick, text, sw, lift, list) {
  var g = new THREE.Group();
  var p = [a, b, a.clone().sub(tick), a.clone().add(tick), b.clone().sub(tick), b.clone().add(tick)];
  var ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(p), dimMat); ls.renderOrder = 30; g.add(ls);
  var sp = dimSprite(text, sw); sp.position.copy(a.clone().add(b).multiplyScalar(0.5).add(lift)); g.add(sp);
  parent.add(g); list.push(g); return g;
}

/* ---------- rincian bagian (bahasa Indonesia) ---------- */
var PARTS_A = [
  { name: 'Pod kamera', off: [-20, -16], a: [POD.x, POD.y + 0.2, POD.z], t: [POD.x, POD.y, POD.z], p: [POD.x - 0.34, POD.y + 0.12, POD.z + 0.32],
    fn: 'Silinder kecil bergaris tengah 45 mm yang tergantung di bawah tepi lantai jembatan, dimiringkan sekitar 19° ke arah air dengan pelat spasi miring. Di dalamnya modul kamera OV5647 di balik jendela kaca. Tanpa lampu atau logo, dicat senada beton. Di model ini pod digambar ukuran asli, jadi dekati lewat nomor ini.',
    cost: 'Sekitar Rp0,28 juta (modul kamera, rumah pod dan jendela, kabel pita, cat)' },
  { name: 'Hub: Raspberry Pi di box IP65', off: [20, 16], a: [HUB.x, HUB.y - 0.16, HUB.z], t: [HUB.x, HUB.y, HUB.z], p: [HUB.x + 0.55, HUB.y - 0.55, HUB.z + 0.65],
    fn: 'Box IP65 di bawah lantai jembatan, sekitar 30 cm dari pod, dipasang terbalik supaya tutupnya menghadap ke bawah. Berisi Raspberry Pi 3B+ yang menjalankan model deteksi, konverter 12 V ke 5 V, fuse, dan silica gel. Yang dikirim hanya hasil dan foto bukti.',
    cost: 'Sekitar Rp1,1 juta (Raspberry Pi, microSD, konverter dan fuse, box, silikon dan silica gel)' },
  { name: 'Adaptor dan kabel luar', a: [ADP.x + 0.07, ADP.y + 0.42, ADP.z], t: [-2.2, 2.4, -4.3], p: [-7.2, 4.2, -0.4],
    fn: 'Adaptor 12 V 2 A di kotak kering pada tiang. Satu kabel 2×0,75 mm² turun lewat pipa PVC, melintasi tanah, lalu menyusuri sisi bawah lantai jembatan ke hub. Kabel dijepit tiap 30–40 cm dan dibuat melengkung ke bawah (loop tetes) sebelum masuk gland. Nyalakan Jalur kabel tembus pandang untuk melihat rutenya.',
    cost: 'Sekitar Rp0,36 juta (adaptor, kabel luar, conduit, klip, braket)' },
  { name: 'Zona pantau', a: [-6.2, 0.45, 0.2], t: [-6.0, 0.1, 0.0], p: [-12.0, 6.8, 5.8],
    fn: 'Area permukaan air yang diawasi. Sistem menghitung tutupan, yaitu luas gabungan kotak deteksi dibagi luas zona. Zona hanya mencakup air, bukan jalan atau orang.',
    cost: 'Tanpa biaya, diatur lewat perangkat lunak' },
  { name: 'Saringan sampah', a: [rackX, 1.0, riverC(rackX)], t: [rackX, 0.1, riverC(rackX)], p: [rackX - 3.6, 2.6, riverC(rackX) + 4.3],
    fn: 'Penghalang di sungai tempat sampah tertahan dan menumpuk. Bukan bagian anggaran: pilih titik yang sudah punya saringan, pintu air, atau pilar jembatan.',
    cost: 'Di luar anggaran' },
  { name: 'Papan informasi dan papan duga', a: [-4.1, GY + 2.0, riverC(-4.1) - riverHW(-4.1) - bankRun(-4.1) - 0.8], t: [-4.1, GY + 1.0, riverC(-4.1) - riverHW(-4.1) - bankRun(-4.1) - 0.8], p: [-6.4, GY + 1.6, riverC(-4.1) - riverHW(-4.1) - bankRun(-4.1) + 2.6],
    fn: 'Papan memberi tahu warga bahwa kamera hanya memantau permukaan air dan videonya tidak direkam. Papan duga di dinding sungai menjadi acuan tinggi muka air untuk membaca foto bukti.',
    cost: 'Sekitar Rp0,25 juta bersama survei dan izin' },
  { name: 'Internet dan bot Telegram', a: [cloudPos.x, cloudPos.y + 0.9, cloudPos.z], t: [cloudPos.x, cloudPos.y, cloudPos.z], p: [-7.0, 9.8, 6.5],
    fn: 'Hub mengirim pesan dan foto bukti lewat hotspot ponsel bekas atau Wi-Fi setempat ke bot Telegram. Server dan dashboard menunggu dana lanjutan.',
    cost: 'Paket data sekitar Rp0,3 juta untuk 6 bulan; Telegram gratis' },
  { name: 'Ponsel petugas', a: [phonePos.x, phonePos.y + 0.75, phonePos.z], t: [phonePos.x, phonePos.y, phonePos.z], p: [phonePos.x - 4.2, phonePos.y + 1.4, phonePos.z + 5.0],
    fn: 'Menerima notifikasi Telegram berisi nama titik, level, waktu, foto, tingkat tutupan, dan tautan peta. Petugas membalas ditangani agar waktu respons tercatat.',
    cost: 'Gratis (bot Telegram)' }
];
var PARTS_B_TXT = {
  'Tudung': { fn: 'Cincin pendek dengan jambul di bagian atas. Mencegah silau matahari dan menahan tetesan hujan agar tidak jatuh di depan lensa. Bagian dalamnya dicat hitam doff. Bagian ini opsional.', cost: 'Termasuk di pos pod, sekitar Rp60 ribu bersama jendela dan rumah' },
  'Jendela kaca': { fn: 'Filter UV 37 mm atau kaca bening, direkatkan dari dalam dengan silikon netral. Kaca optik menjaga gambar tetap tajam; akrilik lebih mudah tergores.', cost: 'Termasuk di pos pod' },
  'Cangkang depan': { fn: 'Rumah pod dari cetakan PETG atau ASA, atau potongan pipa PVC. Luarnya dicat senada struktur, dalamnya hitam doff untuk menghilangkan pantulan. Garis tengah luar 45 mm, panjang sekitar 26 mm.', cost: 'Termasuk di pos pod; cat semprot sekitar Rp47 ribu' },
  'Papan kamera': { fn: 'Modul OV5647 5 MP, sekitar 25×24 mm, dengan lensa fokus tetap. Lensa berjarak sekitar 2 mm dari kaca dan tidak boleh menyentuhnya. Soket kabel pita ada di sisi bawah papan.', cost: 'Rp149 ribu di Tokopedia' },
  'Silica gel': { fn: 'Satu sachet kecil di ruang belakang papan, menyerap lembap yang masuk supaya jendela tidak berembun. Diganti tiap tiga bulan.', cost: 'Termasuk di pos silikon dan silica gel' },
  'Tutup belakang dan standoff': { fn: 'Tutup dengan lubang tengah untuk nipple conduit. Dua standoff M2 setinggi sekitar 8 mm menahan papan kamera dan menyisakan ruang tikungan bagi kabel pita. Tepi dan lubangnya disegel silikon netral.', cost: 'Termasuk di pos pod' },
  'Conduit dan kabel pita': { fn: 'Kabel pita CSI sekitar 30 cm masuk ke conduit fleksibel berdiameter dalam minimal 20 mm menuju hub. Kabel pita dilewatkan ke conduit sebelum dipasang ke soket, dan tikungannya dibuat lebar. Gambar ini dipotong; conduit aslinya sekitar 30 cm.', cost: 'Kabel pita sekitar Rp25 ribu; conduit di pos conduit dan klip' },
  'Klem dan pelat spasi': { fn: 'Pita baja berbentuk U melingkari pod dan dibaut ke lantai jembatan lewat pelat spasi. Pelat berbentuk baji memiringkan pod sekitar 19° ke arah air supaya zona pantau terlihat. Tidak perlu mengebor pod.', cost: 'Termasuk di pos adaptor, kabel, conduit, dan braket' }
};
var PARTS_C_TXT = {
  'Box dasar dan braket': { fn: 'Box IP65 115×90×55 mm dari ABS. Dipasang terbalik di bawah lantai jembatan dengan dua braket L baja, sehingga tutup menghadap ke bawah. Empat standoff kuningan menahan Raspberry Pi 6 mm di atas lantai box supaya udara bisa mengalir dan tetes air tidak mengenai papan.', cost: 'Box dan gland sekitar Rp110 ribu' },
  'Raspberry Pi 3B+': { fn: 'Otak sistem. Menjalankan model deteksi sampah dari gambar kamera, menghitung tutupan zona, lalu mengirim pesan dan foto lewat Wi-Fi bawaan ke hotspot. Heatsink kecil menjaga suhu saat siang yang panas. Kabel pita kamera masuk ke soket CSI.', cost: 'Raspberry Pi sekitar Rp850 ribu (kisaran Rp600–850 ribu), microSD sekitar Rp70 ribu' },
  'Konverter 12 V ke 5 V dan fuse': { fn: 'Modul MP1584EN menurunkan 12 V dari adaptor menjadi 5 V yang stabil untuk Pi. Fuse inline 2 A di jalur 12 V memutus arus bila terjadi korsleting, sebelum arus masuk ke konverter.', cost: 'Sekitar Rp25 ribu bersama fuse' },
  'Silica gel': { fn: 'Satu sachet menyerap lembap di dalam box agar tidak ada embun di papan. Diganti tiap tiga bulan, bersamaan dengan pengecekan gasket.', cost: 'Termasuk di pos silikon, silica gel, dan heatsink' },
  'Gasket dan tutup': { fn: 'Tutup dengan gasket busa di alurnya. Empat sekrup stainless di sudut menekan gasket. IP65 berarti tahan semprotan air dari segala arah, bukan terendam, jadi box dipasang di atas muka air banjir.', cost: 'Termasuk di pos box' },
  'Gland kabel 12 V': { fn: 'Gland menyegel kabel 2×0,75 mm² di dinding box. Kabel dibuat melengkung ke bawah sebelum masuk, sehingga air hujan menetes di titik terendah dan tidak merambat ke dalam.', cost: 'Termasuk di pos box dan gland' },
  'Gland conduit': { fn: 'Gland besar untuk conduit fleksibel dari pod. Kabel pita CSI masuk lewat sini dan naik ke soket kamera pada Pi dengan tikungan lebar, bukan lipatan tajam.', cost: 'Termasuk di pos box dan gland' }
};

function pinsFor(list, getWorld) {
  pinsEl.innerHTML = '';
  list.forEach(function (p, i) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pin';
    b.innerHTML = '<span class="dot">' + (i + 1) + '</span><span class="lab"></span>';
    b.lastChild.textContent = p.name; b.setAttribute('aria-label', p.name);
    b.addEventListener('click', function () { selectPart(i); });
    pinsEl.appendChild(b); p.pin = b;
  });
}
var curList = PARTS_A, selected = -1, hiBox = null;
var partsEl = $('parts'), detailEl = $('detail'), hintEl = $('hint');
function renderPartList() {
  partsEl.innerHTML = '';
  curList.forEach(function (p, i) {
    var b = document.createElement('button'); b.type = 'button'; b.innerHTML = '<b>' + (i + 1) + '</b><span></span>'; b.lastChild.textContent = p.name;
    b.addEventListener('click', function () { selectPart(i); });
    if (i === selected) b.className = 'on';
    partsEl.appendChild(b); p.btn = b;
  });
  $('parts-title').textContent = state.view === 0 ? 'Komponen di titik pantau' : state.view === 1 ? 'Bagian pod' : 'Bagian hub';
}
var INTRO = [
  { h: 'Titik pantau Riverwatch', t: 'Satu jembatan, satu saringan sampah, dan satu kamera kecil yang hanya menatap permukaan air di hulu. Pilih tingkat penumpukan, ubah jam, lalu ketuk nomor di model untuk melihat setiap bagian.' },
  { h: 'Pod kamera, bagian dalam', t: 'Pod berskala 20 kali: garis tengah aslinya 45 mm. Geser Uraikan untuk membuka bagian, nyalakan Potong penampang untuk melihat isinya.' },
  { h: 'Hub, bagian dalam', t: 'Box IP65 dengan Raspberry Pi 3B+. Tampilan ini diletakkan dengan tutup di atas; di jembatan box dipasang terbalik. Geser Uraikan untuk membuka bagian.' }
];
function showDetail(p) {
  if (!p) { var s = INTRO[state.view]; detailEl.innerHTML = '<h3></h3><p></p>'; detailEl.firstChild.textContent = s.h; detailEl.lastChild.textContent = s.t; return; }
  detailEl.innerHTML = '<h3></h3><p></p><p class="cost"><b>Biaya</b> <span></span></p>';
  detailEl.children[0].textContent = p.name; detailEl.children[1].textContent = p.fn; detailEl.children[2].lastChild.textContent = p.cost;
}
function selectPart(i) {
  selected = (i === selected) ? -1 : i;
  curList.forEach(function (p, k) { if (p.pin) p.pin.classList.toggle('on', k === selected); if (p.btn) p.btn.classList.toggle('on', k === selected); });
  var p = selected >= 0 ? curList[selected] : null;
  showDetail(p);
  if (hiBox) { scene.remove(hiBox); hiBox = null; }
  if (!p) return;
  if (state.view === 0) { flyTo(new V3().fromArray(p.p), new V3().fromArray(p.t), 1.3); }
  else {
    hiBox = new THREE.BoxHelper(p.g, 0x62bff5); hiBox.material.depthTest = false; hiBox.material.transparent = true; hiBox.renderOrder = 40; scene.add(hiBox);
    var bb = new THREE.Box3().setFromObject(p.g), c = bb.getCenter(new V3()), sz = bb.getSize(new V3()).length();
    var dir = camera.position.clone().sub(controls.target).normalize();
    flyTo(c.clone().addScaledVector(dir, Math.max(0.9, sz * 2.0)), c, 1.0);
  }
}
/* ---------- terbang kamera ---------- */
var fly = null;
function flyTo(pos, tgt, dur) {
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt, d: reduce ? 0.01 : dur, k: 0 };
}
onFrame(function (dt) {
  if (!fly) return;
  fly.k += dt / fly.d;
  var k = Math.min(fly.k, 1), e = k * k * (3 - 2 * k);
  camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
  if (k >= 1) fly = null;
});
controls.addEventListener('start', function () { fly = null; if (touring) stopTour(); });

/* ---------- tampilan ---------- */
function buildDetail() {
  /* pod */
  podParts = buildPod(podDetail); podDetail.scale.setScalar(POD_S); podDetail.position.set(-66 * POD_S, 0, 0);
  podParts.forEach(function (p) { if (p.name === 'Klem dan pelat spasi') { /* biarkan terlihat lengkap */ } });
  var P = function (n) { return podParts.filter(function (p) { return p.name === n; })[0]; };
  dim(P('Cangkang depan').g, new V3(-4, -22.5, 0), new V3(-4, 22.5, 0), new V3(1.5, 0, 0), 'Ø45 mm', 17, new V3(-9, 0, 0), dimsPod);
  dim(P('Cangkang depan').g, new V3(0, -27.5, 0), new V3(26, -27.5, 0), new V3(0, 1.5, 0), '26 mm', 14, new V3(0, -5, 0), dimsPod);
  dim(P('Jendela kaca').g, new V3(4, 18.5, 26), new V3(4, -18.5, 26), new V3(0, 0, 1.5), 'Ø37 mm', 15, new V3(0, 0, 8), dimsPod);
  dim(P('Papan kamera').g, new V3(15.4, -12.5, -28), new V3(15.4, 12.5, -28), new V3(0, 0, 1.5), '25 mm', 13, new V3(0, 0, -7), dimsPod);
  dim(P('Conduit dan kabel pita').g, new V3(70, -12.5, 0), new V3(70, 12.5, 0), new V3(1.5, 0, 0), 'Ø25 mm', 15, new V3(8, 0, 0), dimsPod);
  podParts.forEach(function (p) { p.g.userData.mats = true; });
  /* hub */
  hubParts = buildHub(hubDetail); hubDetail.scale.setScalar(HUB_S); hubDetail.position.set(55 * HUB_S, 0, 0);
  var H = function (n) { return hubParts.filter(function (p) { return p.name === n; })[0]; };
  dim(H('Box dasar dan braket').g, new V3(-57.5, -35, 52), new V3(57.5, -35, 52), new V3(0, 0, 3), '115 mm', 26, new V3(0, -9, 0), dimsHub);
  dim(H('Box dasar dan braket').g, new V3(-64, -35, -45), new V3(-64, -35, 45), new V3(3, 0, 0), '90 mm', 24, new V3(-12, 0, 0), dimsHub);
  dim(H('Box dasar dan braket').g, new V3(62, -27.5, 50), new V3(62, 27.5, 50), new V3(0, 0, 3), '55 mm', 22, new V3(10, 0, 3), dimsHub);
  detailFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
  detailFloor.rotation.x = -Math.PI / 2; detailFloor.position.y = -1.0; detailFloor.receiveShadow = true; scene.add(detailFloor);
  podDetail.visible = hubDetail.visible = detailFloor.visible = false;
  podParts.concat(hubParts).forEach(function (p) { p.g.traverse(function (m) { if (m.isMesh) { m.userData.side0 = m.material.side; } }); });
}
task('Menyiapkan tampilan rincian pod dan hub', function () {
  buildDetail();
  PARTS_A.forEach(function (p) { p.kind = 'w'; });
  podParts.forEach(function (p) { var t = PARTS_B_TXT[p.name]; p.fn = t.fn; p.cost = t.cost; });
  hubParts.forEach(function (p) { var t = PARTS_C_TXT[p.name]; p.fn = t.fn; p.cost = t.cost; });
});

var HINT = [
  'Seret untuk memutar, jepit atau gulir untuk zoom, dua jari untuk menggeser. Ketuk nomor di model untuk melihat bagian. Pod dan hub digambar ukuran asli, jadi sangat kecil dari jauh.',
  'Seret untuk memutar. Geser Uraikan untuk membuka pod, nyalakan Potong penampang untuk melihat isi. Model diperbesar 20 kali.',
  'Seret untuk memutar. Geser Uraikan untuk mengangkat tutup dan isi box. Di jembatan box dipasang terbalik.'
];
var DET_CAM = [null, { p: new V3(1.0, 1.55, 4.9), t: new V3(0, 0.0, 0) }, { p: new V3(1.55, 3.0, 4.9), t: new V3(0, 0.22, 0) }];
function applyExplode() {
  var k = state.explode, list = state.view === 1 ? podParts : hubParts;
  if (!list) return;
  list.forEach(function (p) { p.g.position.set(p.dx[0] * k, p.dx[1] * k, p.dx[2] * k); });
}
function setCut(on) {
  state.cut = on;
  [podParts, hubParts].forEach(function (list) {
    if (!list) return;
    list.forEach(function (p) { p.g.traverse(function (m) {
      if (!m.isMesh) return;
      var mt = m.material; mt.clippingPlanes = on ? [cutPlane] : null; mt.clipShadows = !!on; mt.side = on ? THREE.DoubleSide : (m.userData.side0 !== undefined ? m.userData.side0 : mt.side); mt.needsUpdate = true;
    }); });
  });
}
function setView(v) {
  if (v === state.view && curList !== null && v !== undefined && partsEl.children.length) { /* tetap */ }
  state.view = v; fly = null; selected = -1;
  if (hiBox) { scene.remove(hiBox); hiBox = null; }
  var views = $('views').children;
  for (var i = 0; i < views.length; i++) views[i].setAttribute('aria-pressed', String(Number(views[i].getAttribute('data-v')) === v));
  world.visible = v === 0; podDetail.visible = v === 1; hubDetail.visible = v === 2; if (detailFloor) detailFloor.visible = v > 0;
  $('c-explode').hidden = v === 0; $('c-level').hidden = v > 0; $('c-time').hidden = v > 0; $('c-layers').hidden = v > 0;
  pipEl.hidden = !(state.showPip && v === 0);
  $('chips').style.visibility = v === 0 ? '' : 'hidden';
  $('tourBtn').hidden = $('tourBtn2').hidden = v > 0;
  hintEl.textContent = HINT[v];
  if (v === 0) {
    $('t-cut').checked = false; setCut(false);
    setRig('outdoor');
    curList = PARTS_A; pinsFor(curList);
    sun.shadow.camera.left = -19; sun.shadow.camera.right = 19; sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15; sun.shadow.camera.updateProjectionMatrix();
    camera.near = 0.04; camera.far = 400; controls.minDistance = 0.25; controls.maxDistance = 70; controls.maxPolarAngle = Math.PI * 0.495;
    flyTo(HOME.p.clone(), HOME.t.clone(), 0.9);
  } else {
    setRig('studio');
    curList = v === 1 ? podParts : hubParts; pinsFor(curList);
    sun.shadow.camera.left = -3.5; sun.shadow.camera.right = 3.5; sun.shadow.camera.top = 3.5; sun.shadow.camera.bottom = -3.5; sun.shadow.camera.updateProjectionMatrix();
    camera.near = 0.03; camera.far = 120; controls.minDistance = 0.3; controls.maxDistance = 16; controls.maxPolarAngle = Math.PI * 0.6;
    applyExplode();
    var c = DET_CAM[v];
    flyTo(c.p.clone(), c.t.clone(), 0.9);
  }
  camera.updateProjectionMatrix();
  showDetail(null); renderPartList();
  dimsPod.forEach(function (d) { d.visible = state.dims; }); dimsHub.forEach(function (d) { d.visible = state.dims; });
}
$('views').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { if (touring) stopTour(); setView(Number(b.getAttribute('data-v'))); } });
$('explode').addEventListener('input', function () { state.explode = Number(this.value) / 100; $('explode-val').textContent = this.value + '%'; applyExplode(); });
$('t-cut').addEventListener('change', function () { setCut(this.checked); });
$('t-dim').addEventListener('change', function () { state.dims = this.checked; dimsPod.concat(dimsHub).forEach(function (d) { d.visible = state.dims; }); });
$('t-names').addEventListener('change', function () { pinsEl.classList.toggle('names', this.checked); });
$('reset').addEventListener('click', function () {
  if (touring) stopTour();
  state.explode = 1; $('explode').value = 100; $('explode-val').textContent = '100%'; applyExplode();
  $('t-cut').checked = false; setCut(false);
  selectedClear(); var v = state.view;
  if (v === 0) flyTo(HOME.p.clone(), HOME.t.clone(), 0.9); else { var c = DET_CAM[v]; flyTo(c.p.clone(), c.t.clone(), 0.9); }
});
function selectedClear() { selected = -1; curList.forEach(function (p) { if (p.pin) p.pin.classList.remove('on'); if (p.btn) p.btn.classList.remove('on'); }); showDetail(null); if (hiBox) { scene.remove(hiBox); hiBox = null; } }

/* ---------- tingkat penumpukan dan tutupan ---------- */
function setLevel(l) {
  state.level = l; setTrashLevel(l); setZoneColor(l);
  var bs = $('seg').children; for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(Number(bs[i].getAttribute('data-l')) === l));
  $('rule').textContent = LV[l].rule; $('notif').textContent = LV[l].notif;
  var chip = $('chipLevel'); chip.style.setProperty('--lc', LV[l].css); chip.lastChild.textContent = LV[l].name;
  $('covBar').style.background = LV[l].css;
  drawPhone(l, Math.round(coverage * 100));
  covTimer = 0.05; lastCovInt = -1;
}
function uiCoverage(c) {
  var p = Math.round(c * 100);
  $('cov').innerHTML = p + '<small>%</small>'; $('chipCov').textContent = p + '%';
  $('covBar').style.width = Math.min(100, p) + '%';
  drawPhone(state.level, p);
}
$('seg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setLevel(Number(b.getAttribute('data-l'))); });

/* ---------- waktu ---------- */
var envTimer = 0, envPending = false;
function todLabel(h) { return h < 9.2 ? 'Pagi' : h < 15.2 ? 'Siang' : h < 18.2 ? 'Sore' : h < 19 ? 'Senja' : 'Malam'; }
function setHour(h) {
  state.hour = h; applyTime(h);
  var hr = Math.floor(h), mn = Math.floor((h - hr) * 60 / 5) * 5, t = ('0' + hr).slice(-2) + ':' + ('0' + mn).slice(-2);
  $('hour-val').textContent = t; $('chipTime').textContent = t; $('chipTod').textContent = todLabel(h);
  $('hour').value = h; redrawShade();
  var qs = $('tod').children, best = 0, bd = 99;
  for (var i = 0; i < qs.length; i++) { var d = Math.abs(Number(qs[i].getAttribute('data-h')) - h); if (d < bd) { bd = d; best = i; } }
  for (var j = 0; j < qs.length; j++) qs[j].setAttribute('aria-pressed', String(j === best && bd < 1.6));
  $('todNote').style.fontWeight = state.night > 0.5 ? '500' : '400';
  envPending = true;
}
onFrame(function (dt) { if (envPending) { envTimer -= dt; if (envTimer <= 0) { envPending = false; envTimer = 0.4; if (state.view === 0) genOutdoorEnv(); } } });
$('hour').addEventListener('input', function () { setHour(Number(this.value)); });
$('tod').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setHour(Number(b.getAttribute('data-h'))); });

/* ---------- lapisan ---------- */
$('t-pip').addEventListener('change', function () { state.showPip = this.checked; pipEl.hidden = !(state.showPip && state.view === 0); });
$('t-zone').addEventListener('change', function () { state.showZone = this.checked; zoneG.visible = this.checked; });
$('t-box').addEventListener('change', function () { state.showBoxes = this.checked; T.forEach(function (it) { if (it.lines) it.lines.visible = state.showBoxes; }); });
$('t-flow').addEventListener('change', function () { state.showFlow = this.checked; flowG.visible = this.checked; });
$('t-cable').addEventListener('change', function () { state.showCable = this.checked; setCableXray(this.checked); });
$('t-rot').addEventListener('change', function () { controls.autoRotate = this.checked; });
(function () { var ul = $('classes'); TCLS.forEach(function (c) { var li = document.createElement('li'); li.innerHTML = '<i style="border-color:#' + ('000000' + c.hex.toString(16)).slice(-6) + '"></i>'; li.appendChild(document.createTextNode(c.name)); ul.appendChild(li); }); })();

/* ---------- pin di layar ---------- */
var pv = new V3();
afterRender.push(function () {
  if (!curList) return;
  var w = stage.clientWidth, h = stage.clientHeight;
  camera.updateMatrixWorld();
  for (var i = 0; i < curList.length; i++) {
    var p = curList[i]; if (!p.pin) continue;
    if (state.view === 0) pv.fromArray(p.a); else { pv.copy(p.anchor); p.g.localToWorld(pv); }
    pv.project(camera);
    var vis = pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05;
    if (!vis) { p.pin.style.visibility = 'hidden'; continue; }
    p.pin.style.visibility = '';
    var po = p.off || [0, 0]; p.pin.style.transform = 'translate(' + ((pv.x * 0.5 + 0.5) * w - 13 + po[0]).toFixed(1) + 'px,' + ((-pv.y * 0.5 + 0.5) * h - 13 + po[1]).toFixed(1) + 'px)';
  }
  if (hiBox) hiBox.update();
});

/* ---------- tur ---------- */
var touring = false, tourT = 0, tourI = -1, TOUR = null;
function buildTour() {
  var A = PARTS_A;
  return [
    { cap: '<b>Titik pantau.</b> Jembatan kecil dengan saringan sampah di hulu. Kamera hanya menatap air di depan saringan.', p: HOME.p.clone(), t: HOME.t.clone(), lvl: 0 },
    { cap: '<b>Sampah menumpuk.</b> Arus membawa sampah ke saringan. Makin lama, makin menutup permukaan air.', p: new V3(A[4].p[0] - 2.4, 3.0, A[4].p[2] + 1.0), t: new V3(-6.0, 0.1, 0.0), lvl: 1 },
    { cap: '<b>Pod kamera.</b> Garis tengah 45 mm, tergantung di bawah tepi lantai dan menghadap air.', p: new V3().fromArray(A[0].p), t: new V3().fromArray(A[0].t), lvl: 1 },
    { cap: '<b>Hub.</b> Raspberry Pi di box tertutup, tersambung ke pod lewat conduit sepanjang sekitar 30 cm.', p: new V3().fromArray(A[1].p), t: new V3().fromArray(A[1].t), lvl: 1 },
    { cap: '<b>Satu kabel daya.</b> Dari adaptor di tiang, lewat tanah, lalu menyusuri bawah lantai ke hub.', p: new V3(-6.2, 4.6, 0.6), t: new V3(-2.0, 1.6, -1.6), lvl: 1, cable: true },
    { cap: '<b>Tutupan melewati ambang.</b> Kotak deteksi menghitung luas sampah di zona dan peringatan dikirim.', p: new V3(-10.8, 5.6, 6.6), t: new V3(-5.0, 0.5, 0.0), lvl: 2 },
    { cap: '<b>Ponsel petugas.</b> Pesan Telegram berisi foto bukti, tutupan, dan tautan peta.', p: new V3().fromArray(A[7].p), t: new V3().fromArray(A[7].t), lvl: 2 }
  ];
}
function tourStep(i) {
  var s = TOUR[i]; tourI = i; tourT = 0;
  $('caption').hidden = false; $('caption').innerHTML = s.cap;
  if (state.level !== s.lvl) setLevel(s.lvl);
  $('t-cable').checked = !!s.cable; setCableXray(!!s.cable);
  flyTo(s.p, s.t, 1.6);
}
function startTour() {
  if (state.view !== 0) setView(0);
  if (!TOUR) TOUR = buildTour();
  touring = true; $('tourBtn').setAttribute('aria-pressed', 'true'); $('tourBtn').textContent = 'Hentikan tur'; $('tourBtn2').textContent = 'Hentikan tur';
  tourStep(0);
}
function stopTour() {
  touring = false; $('caption').hidden = true; $('tourBtn').setAttribute('aria-pressed', 'false'); $('tourBtn').textContent = 'Tur singkat'; $('tourBtn2').textContent = 'Tur singkat';
  $('t-cable').checked = state.showCable; setCableXray(false);
}
onFrame(function (dt) { if (!touring) return; tourT += dt; if (tourT > 6.2) { if (tourI + 1 < TOUR.length) tourStep(tourI + 1); else stopTour(); } });
function tourToggle() { if (touring) stopTour(); else startTour(); }
$('tourBtn').addEventListener('click', tourToggle); $('tourBtn2').addEventListener('click', tourToggle);

/* ---------- mulai ---------- */
onReady.push(function () {
  setView(0);
  setLevel(1);
  setHour(12);
  pinsEl.classList.toggle('names', false);
  camera.position.copy(HOME.p); controls.target.copy(HOME.t); fly = null;
});

/* ---------- kualitas adaptif ---------- */
var emaDt = 0.016, adaptT = 0, adapted = 0;
onFrame(function (dt) {
  emaDt = emaDt * 0.96 + dt * 0.04; adaptT += dt;
  if (adaptT > 3 && adapted < 2 && emaDt > 0.045) {
    adaptT = 0; adapted++;
    if (DPR > 1) { DPR = 1; renderer.setPixelRatio(1); resize(); sizeHud(); }
    else { pipSkip = 4; }
  }
});
var pipSkip = 2;

/* =====================================================================
   MODE TANAM: kembar digital yang dikendalikan data CCTV dari dasbor Riverwatch.
   Halaman ini dimuat di dalam <iframe>. Dasbor mengirim keadaan lewat window.postMessage:
     { rw: 1, type: 'state', level: 0..3, coverage: 0..1, hour: 0..24, zone: [[x, y] x4],
       tracks: [{ id, cat, cls, name, box: [x1, y1, x2, y2], v: [vx, vy], in_zone, state, predicted,
                  anomaly: { kind, severity, label } | null }] }
     { rw: 1, type: 'view', view: 'home' | 'cctv' | 'top' }
     { rw: 1, type: 'layers', layers: { zone, labels, rings, flow, cable, rotate, boxes } }
     { rw: 1, type: 'quality', lite: bool }    { rw: 1, type: 'pause', value: bool }
   Balasan ke dasbor: { rw: 1, type: 'ready' } dan { rw: 1, type: 'stats', fps }.
   Posisi benda dari gambar kamera dipetakan ke permukaan air model lewat homografi
   (zona pada gambar kamera nyata -> zona pada kamera pod model) lalu sinar kamera pod.
   ===================================================================== */
var EMB = {
  ready: false, paused: false, level: 0, coverage: 0, count: 0, view: 'home', lite: false,
  layers: { zone: true, labels: true, rings: true, flow: true, cable: false, rotate: false, boxes: true },
  pending: null, H: null, zoneSrc: null
};
/* tutupan -> jumlah sampah yang tampak di model (0..56), naik bertahap */
var COV_COUNT = [[0, 0], [0.02, 2], [0.06, 8], [0.15, 20], [0.25, 32], [0.35, 42], [0.5, 52], [0.6, 56]];
function piecewise(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (var i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  }
  return pts[pts.length - 1][1];
}
function post(msg) { try { msg.rw = 1; window.parent.postMessage(msg, location.origin); } catch (e) { } }

/* ---------- sampah: jumlah mengikuti tutupan ---------- */
var shownCount = -1, foamDirty = false, foamT = 0;
function setTrashCount(n) {
  n = clamp(Math.round(n), 0, T.length);
  if (n === shownCount) return;
  var prev = Math.max(0, shownCount);
  shownCount = n; EMB.count = n;
  T.forEach(function (it) {
    var on = it.idx < n;
    it.target = on ? 1 : 0;
    it.delay = on ? Math.max(0, it.idx - prev) * 0.02 : 0;
    it.foam.on = on;
  });
  foamDirty = true;
}

/* ---------- tingkat: warna zona, layar ponsel ---------- */
function applyLevel(l) {
  l = clamp(l | 0, 0, 3);
  EMB.level = l; state.level = l;
  if (!zoneMats.length) return;
  setZoneColor(l);
  zoneMats[0].opacity = 0.11 + 0.045 * l;
  if (phoneC) drawPhone(l, Math.round(EMB.coverage * 100));
}

/* ---------- jam: hanya diterapkan bila berubah cukup banyak (pembuatan peta lingkungan mahal) ---------- */
function applyHourSoft(h) {
  h = ((+h % 24) + 24) % 24;
  var hh = (h >= 21 || h < 5.0) ? 21 : Math.max(5.5, h);
  if (Math.abs(hh - state.hour) < 0.04) return;
  setHour(hh);
}

/* ---------- homografi: zona di gambar kamera nyata -> zona di kamera pod model ---------- */
function quadOf(poly) {
  if (!poly || poly.length < 3) return null;
  if (poly.length === 4) return poly.map(function (p) { return [+p[0], +p[1]]; });
  var x0 = 9, y0 = 9, x1 = -9, y1 = -9;
  poly.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
function solveHomography(src, dst) {
  /* 8 persamaan linear (eliminasi Gauss) untuk h11..h32 dengan h33 = 1 */
  var A = [], b = [];
  for (var i = 0; i < 4; i++) {
    var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  var n = 8, M = A.map(function (r, k) { return r.concat([b[k]]); });
  for (var c = 0; c < n; c++) {
    var piv = c;
    for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    for (var r2 = c + 1; r2 < n; r2++) {
      var f = M[r2][c] / M[c][c];
      for (var k2 = c; k2 <= n; k2++) M[r2][k2] -= f * M[c][k2];
    }
  }
  var h = new Array(n);
  for (var r3 = n - 1; r3 >= 0; r3--) {
    var s = M[r3][n];
    for (var k3 = r3 + 1; k3 < n; k3++) s -= M[r3][k3] * h[k3];
    h[r3] = s / M[r3][r3];
  }
  return h.concat([1]);
}
function setZoneQuad(poly) {
  var q = quadOf(poly);
  if (!q) return;
  var key = JSON.stringify(q);
  if (key === EMB.zoneSrc) return;
  EMB.zoneSrc = key;
  EMB.H = solveHomography(q, ZONE_IMG);
}
var hOut = [0, 0];
function mapImg(u, v) {
  var H = EMB.H;
  if (!H) { hOut[0] = u; hOut[1] = v; return hOut; }
  var w = H[6] * u + H[7] * v + 1;
  if (Math.abs(w) < 1e-6) w = 1e-6;
  hOut[0] = (H[0] * u + H[1] * v + H[2]) / w;
  hOut[1] = (H[3] * u + H[4] * v + H[5]) / w;
  hOut[0] = clamp(hOut[0], -0.6, 1.6); hOut[1] = clamp(hOut[1], -0.3, 1.4);
  return hOut;
}
var _rc = new THREE.Raycaster(), _nd = new V2();
function imgToWaterInto(u, v, out) {
  _nd.set(u * 2 - 1, 1 - v * 2);
  _rc.setFromCamera(_nd, podCam);
  var o = _rc.ray.origin, d = _rc.ray.direction;
  if (d.y >= -1e-4) return null;
  var t = -o.y / d.y;
  if (t > 160) return null;
  out.set(o.x + d.x * t, 0, o.z + d.z * t);
  return out;
}

/* ---------- benda hidup (manusia, perahu, hewan, kendaraan, tak dikenal) ---------- */
var PX = {
  person:  { color: 0xff375f, name: 'Manusia' },
  animal:  { color: 0xffd60a, name: 'Hewan' },
  vessel:  { color: 0x5ac8fa, name: 'Perahu' },
  vehicle: { color: 0xff9f0a, name: 'Kendaraan' },
  unknown: { color: 0x9a9aa2, name: 'Tak dikenal' }
};
var SEV_COL = { critical: 0xff4d5e, warning: 0xffc53d, info: 0x4cc3ff };
var pxMats = [];
function pxMat(hex, o) {
  var p = { color: lin(hex), roughness: 0.55, metalness: 0.0, emissive: lin(hex), emissiveIntensity: 0.15 };
  if (o) { for (var k in o) p[k] = o[k]; }
  var m = new THREE.MeshStandardMaterial(p); m.userData.e0 = p.emissiveIntensity; pxMats.push(m); return m;
}
function buildBody(cat) {
  var g = new THREE.Group(), c = PX[cat].color, parts = {};
  if (cat === 'person') {
    var cloth = pxMat(c), dark = pxMat(0x2b3440, { emissiveIntensity: 0.05 }), skin = pxMat(0xe0b08a, { emissiveIntensity: 0.1 });
    add(g, Cy(0.085, 0.07, 0.82, 8), dark, 0, 0.41, 0);
    add(g, Cy(0.17, 0.14, 0.62, 10), cloth, 0, 1.1, 0);
    add(g, new THREE.SphereGeometry(0.115, 14, 10), skin, 0, 1.6, 0);
    parts.armL = add(g, Cy(0.042, 0.036, 0.56, 6), cloth, 0, 1.2, 0.23);
    parts.armR = add(g, Cy(0.042, 0.036, 0.56, 6), cloth, 0, 1.2, -0.23);
    parts.armL.geometry.translate(0, -0.2, 0); parts.armR.geometry.translate(0, -0.2, 0);
    parts.armL.position.y = 1.36; parts.armR.position.y = 1.36;
    parts.height = 1.75;
  } else if (cat === 'vessel') {
    var hullMat = pxMat(c, { roughness: 0.5 }), inner = pxMat(0xe8eef2, { emissiveIntensity: 0.04 });
    var sh = new THREE.Shape();
    sh.moveTo(-1.15, -0.42); sh.lineTo(0.75, -0.42); sh.quadraticCurveTo(1.35, -0.2, 1.4, 0); sh.quadraticCurveTo(1.35, 0.2, 0.75, 0.42); sh.lineTo(-1.15, 0.42); sh.lineTo(-1.15, -0.42);
    var hg = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 8 });
    hg.rotateX(-Math.PI / 2); hg.translate(0, -0.12, 0);
    add(g, hg, hullMat, 0, 0, 0);
    add(g, B(2.1, 0.03, 0.62), inner, -0.1, 0.17, 0, { noCast: true });
    add(g, B(0.8, 0.42, 0.62), pxMat(0xf2f4f6, { emissiveIntensity: 0.05 }), -0.35, 0.4, 0);
    add(g, Cy(0.012, 0.012, 0.9, 6), pxMat(0x8a8f95, { emissiveIntensity: 0 }), 0.35, 0.62, 0);
    parts.height = 0.9;
  } else if (cat === 'animal') {
    var fur = pxMat(c, { roughness: 0.8 }), sn = pxMat(0x6b4a2b, { roughness: 0.9, emissiveIntensity: 0.05 });
    var bg = new THREE.SphereGeometry(0.3, 14, 10); bg.scale(1.7, 0.85, 0.95);
    add(g, bg, fur, 0, 0.34, 0);
    add(g, new THREE.SphereGeometry(0.15, 12, 9), fur, 0.52, 0.5, 0);
    var sg = new THREE.SphereGeometry(0.08, 8, 6); sg.scale(1.4, 0.8, 0.9);
    add(g, sg, sn, 0.68, 0.46, 0);
    var tl = add(g, Cy(0.03, 0.012, 0.4, 6), fur, -0.62, 0.38, 0); tl.rotation.z = 1.2;
    parts.height = 0.7;
  } else if (cat === 'vehicle') {
    var body = pxMat(c, { metalness: 0.35, roughness: 0.4 }), glass = pxMat(0x16222c, { roughness: 0.15, metalness: 0.4, emissiveIntensity: 0.02 }), tyre = pxMat(0x15171a, { roughness: 0.9, emissiveIntensity: 0 });
    add(g, B(1.7, 0.5, 0.82), body, 0, 0.5, 0);
    add(g, B(0.9, 0.38, 0.74), glass, -0.1, 0.92, 0);
    [[-0.55, 0.4], [0.55, 0.4], [-0.55, -0.4], [0.55, -0.4]].forEach(function (w) {
      var wh = add(g, Cy(0.19, 0.19, 0.14, 12), tyre, w[0], 0.22, w[1]); wh.rotation.x = Math.PI / 2;
    });
    parts.height = 1.1;
  } else {
    var cr = pxMat(c, { roughness: 0.6, metalness: 0.1 });
    var ig = new THREE.IcosahedronGeometry(0.34, 0);
    var ico = add(g, ig, cr, 0, 0.4, 0);
    parts.ico = ico;
    parts.height = 0.8;
  }
  g.userData.parts = parts;
  return g;
}
var lblCache = {};
function labelTex(text, hex) {
  var key = text + '|' + hex;
  if (lblCache[key]) return lblCache[key];
  var c = makeCanvas(320, 72), g = c.getContext('2d');
  g.font = '600 30px "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  var w = Math.min(300, Math.ceil(g.measureText(text).width) + 58);
  var x0 = (320 - w) / 2;
  g.fillStyle = 'rgba(10,22,32,0.78)'; rrectPath(g, x0, 8, w, 54, 27); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2; rrectPath(g, x0 + 1, 9, w - 2, 52, 26); g.stroke();
  g.fillStyle = '#' + ('000000' + hex.toString(16)).slice(-6); g.beginPath(); g.arc(x0 + 27, 35, 9, 0, 6.283); g.fill();
  g.fillStyle = '#f4f9fb'; g.textBaseline = 'middle'; g.fillText(text, x0 + 46, 37, w - 58);
  var tex = canvasTex(c, { clamp: true });
  lblCache[key] = tex; return tex;
}
var ringGeo = null, trackRoot = new THREE.Group();
world.add(trackRoot);
var proxies = {}, pool = { person: [], animal: [], vessel: [], vehicle: [], unknown: [] };
var tmpP = new V3(), tmpQ = new V3();

function Proxy(cat) {
  this.cat = cat; this.root = new THREE.Group(); this.body = buildBody(cat); this.root.add(this.body);
  this.root.visible = false; trackRoot.add(this.root);
  this.parts = this.body.userData.parts; this.id = 0; this.name = ''; this.labelKey = '';
  this.label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  this.label.renderOrder = 26; this.label.scale.set(1.5, 0.34, 1); this.root.add(this.label);
  if (!ringGeo) ringGeo = new THREE.RingGeometry(0.78, 0.9, 56);
  this.rings = [0, 1].map(function () {
    var m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc53d, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.renderOrder = 6; m.visible = false; trackRoot.add(m); return m;
  });
  this.beacon = new THREE.Mesh(Cy(0.035, 0.035, 2.6, 8), new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.35, depthWrite: false }));
  this.beacon.visible = false; this.beacon.renderOrder = 7; trackRoot.add(this.beacon);
  this.x = this.z = this.tx = this.tz = 0; this.rot = this.trot = 0; this.s = 0; this.ts = 0;
  this.u = this.v = 0.5; this.vx = this.vy = 0; this.tUpd = 0; this.inZone = true; this.sev = null; this.have = false; this.ph = Math.random() * 6.28;
  this.baseS = 1; this.visible = false;
}
Proxy.prototype.setLabel = function (text, hex) {
  var key = text + '|' + hex;
  if (key === this.labelKey) return;
  this.labelKey = key; this.label.material.map = labelTex(text, hex); this.label.material.needsUpdate = true;
};
Proxy.prototype.update = function (t, now) {
  this.id = t.id; this.have = true; this.tUpd = now;
  var b = t.box || [0, 0, 0, 0];
  this.u = (b[0] + b[2]) / 2; this.v = b[3];
  this.vx = t.v ? t.v[0] : 0; this.vy = t.v ? t.v[1] : 0;
  this.inZone = t.in_zone !== false;
  this.ts = 1;
  this.sev = t.anomaly ? (t.anomaly.severity || 'warning') : null;
  var nm = t.name || PX[this.cat].name;
  this.setLabel(nm + ' #' + t.id, this.sev ? (SEV_COL[this.sev] || 0xffc53d) : PX[this.cat].color);
  var wpx = Math.max(0.01, b[2] - b[0]);
  this.sizeHint = wpx;
};
function acquire(cat) {
  var p = pool[cat].pop();
  if (!p) p = new Proxy(cat);
  return p;
}
function release(p) {
  p.root.visible = false; p.rings.forEach(function (r) { r.visible = false; }); p.beacon.visible = false; p.visible = false; p.have = false; p.s = 0;
  pool[p.cat].push(p);
}
function syncTracks(list, now) {
  var seen = {}, n = 0;
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || !PX[t.cat] || t.state === 'lost') continue;
    if (n++ > 40) break;                                         /* batas aman: 40 benda hidup */
    seen[t.id] = 1;
    var p = proxies[t.id];
    if (!p) { p = proxies[t.id] = acquire(t.cat); p.first = true; }
    if (p.cat !== t.cat) { release(p); p = proxies[t.id] = acquire(t.cat); p.first = true; }
    p.update(t, now);
  }
  for (var k in proxies) { if (!seen[k]) proxies[k].ts = 0; }
}
function smoothAngle(a, b, k) {
  var d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}
var nowS = 0;
onFrame(function (dt, tm) {
  nowS += dt;
  /* peta busa dibuat ulang paling cepat tiap 0,4 detik */
  foamT -= dt;
  if (foamDirty && foamT <= 0) { foamDirty = false; foamT = 0.4; redrawFoam(); }
  /* kilau zona saat Peringatan/Kritis */
  if (zoneMats.length) {
    var base = 0.11 + 0.045 * EMB.level;
    zoneMats[0].opacity = EMB.level >= 2 ? base + 0.035 * Math.sin(tm * (EMB.level === 3 ? 5.2 : 3.2)) : base;
  }
  /* malam: benda hidup sedikit menyala supaya tetap terlihat */
  var nf = 1 + 3 * state.night;
  for (var m = 0; m < pxMats.length; m++) pxMats[m].emissiveIntensity = pxMats[m].userData.e0 * nf;
  var k = 1 - Math.exp(-dt * 7.5);
  for (var id in proxies) {
    var p = proxies[id];
    p.s += ((p.ts ? 1 : 0) - p.s) * (1 - Math.exp(-dt * (p.ts ? 6 : 9)));
    /* hilang: kecilkan lalu kembalikan ke kolam */
    if (p.ts === 0 && p.s < 0.02) { release(p); delete proxies[id]; continue; }
    var age = clamp(nowS - p.tUpd, 0, 1.0);
    var uu = p.u + p.vx * age, vv = p.v + p.vy * age;
    var w = mapImg(uu, vv);
    var P = imgToWaterInto(w[0], w[1], tmpP);
    if (!P) { p.root.visible = false; p.rings.forEach(function (r) { r.visible = false; }); p.beacon.visible = false; continue; }
    var tx = P.x, tz = P.z;
    /* arah gerak dari dua titik di dunia */
    var sp = Math.hypot(p.vx, p.vy);
    if (sp > 0.004) {
      var w2 = mapImg(uu + p.vx * 0.25, vv + p.vy * 0.25);
      var Q = imgToWaterInto(w2[0], w2[1], tmpQ);
      if (Q) { var dx = Q.x - tx, dz = Q.z - tz; if (dx * dx + dz * dz > 1e-6) p.trot = Math.atan2(-dz, dx); }
    }
    if (p.first) { p.x = tx; p.z = tz; p.rot = p.trot; p.first = false; p.s = 0; }
    p.x += (tx - p.x) * k; p.z += (tz - p.z) * k;
    p.rot = smoothAngle(p.rot, p.trot, 1 - Math.exp(-dt * 5));
    /* ukuran: lebar kotak di gambar dibanding ukuran bakunya, dibatasi supaya tetap wajar */
    var wp = p.sizeHint || 0.05, canon = { person: 0.12, animal: 0.14, vessel: 0.26, vehicle: 0.22, unknown: 0.1 }[p.cat];
    var rel = clamp(wp / canon, 0.8, 1.6);
    p.baseS += (rel - p.baseS) * Math.min(1, dt * 2);
    var sc = Math.max(0.001, p.s * (0.5 + 0.5 * p.baseS) * 0.95);
    var bob = Math.sin(tm * 1.5 + p.ph) * (p.cat === 'person' ? 0.03 : 0.02);
    var y = 0, wet = p.inZone;
    if (p.cat === 'person') y = wet ? -0.66 : 0.0;
    else if (p.cat === 'animal') y = wet ? -0.16 : 0.0;
    else if (p.cat === 'vessel') y = 0.0;
    else if (p.cat === 'vehicle') y = wet ? -0.3 : 0.0;
    p.root.visible = true; p.visible = true;
    p.root.position.set(p.x, y + bob, p.z);
    p.root.rotation.set(wet && p.cat === 'person' ? Math.sin(tm * 1.1 + p.ph) * 0.06 : 0, p.rot, 0);
    p.root.scale.setScalar(sc);
    /* lengan melambai bila manusia di air dan sedang anomali */
    if (p.cat === 'person' && p.parts.armL) {
      var wave = (wet && p.sev) ? 2.2 + Math.sin(tm * 6 + p.ph) * 0.45 : 0.15;
      p.parts.armL.rotation.x = -wave; p.parts.armR.rotation.x = wave;
    }
    if (p.parts.ico) { p.parts.ico.rotation.y += dt * 0.6; p.parts.ico.rotation.x += dt * 0.3; }
    /* label di atas benda */
    p.label.position.set(0, (p.parts.height || 1) + 0.28, 0);
    p.label.visible = EMB.layers.labels && p.s > 0.5;
    p.label.scale.set(1.5 / Math.max(0.6, sc), 0.34 / Math.max(0.6, sc), 1);
    /* cincin dan suar anomali */
    var an = !!p.sev && EMB.layers.rings;
    for (var r = 0; r < 2; r++) {
      var ring = p.rings[r];
      ring.visible = an && p.s > 0.2;
      if (ring.visible) {
        var ph = ((tm * 0.8 + r * 0.5) % 1);
        ring.position.set(p.x, 0.06, p.z);
        ring.scale.setScalar(0.9 + ph * 1.5);
        ring.material.opacity = (1 - ph) * 0.8;
        ring.material.color.setHex(SEV_COL[p.sev] || 0xffc53d);
      }
    }
    p.beacon.visible = an && p.sev === 'critical' && p.s > 0.5;
    if (p.beacon.visible) { p.beacon.position.set(p.x, 1.4, p.z); p.beacon.material.opacity = 0.2 + 0.18 * (0.5 + 0.5 * Math.sin(tm * 5)); }
  }
});

/* ---------- tampilan kamera ---------- */
var VIEW_FOV = 34;
function setViewMode(name) {
  var prev = EMB.view;
  if (name === prev && EMB.ready) { /* ulangi: kembali ke titik awal tampilan */ }
  EMB.view = name;
  if (typeof coneM !== 'undefined' && coneM) { coneM.visible = name !== 'cctv'; if (coneL) coneL.visible = name !== 'cctv'; }
  if (name === 'cctv') {
    controls.enabled = false; controls.maxPolarAngle = Math.PI; controls.minDistance = 0.01; controls.autoRotate = false;
    camera.fov = podCam.fov; camera.updateProjectionMatrix();
    flyTo(podPos.clone(), podPos.clone().addScaledVector(podDir, 6), reduce ? 0.01 : 1.2);
  } else {
    controls.enabled = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.25;
    camera.fov = VIEW_FOV; camera.updateProjectionMatrix();
    controls.autoRotate = !!EMB.layers.rotate;
    if (name === 'top') flyTo(new V3(-5.2, 15.5, 0.9), new V3(-5.2, 0, 0.7), reduce ? 0.01 : 1.1);
    else flyTo(HOME.p.clone(), HOME.t.clone(), reduce ? 0.01 : 1.0);
  }
}

/* ---------- lapisan ---------- */
function applyLayers(L) {
  if (!L) return;
  for (var k in L) EMB.layers[k] = !!L[k];
  var Ly = EMB.layers;
  if (zoneG) zoneG.visible = Ly.zone;
  if (flowG) flowG.visible = Ly.flow;
  T.forEach(function (it) { if (it.lines) it.lines.visible = Ly.boxes; });
  state.showBoxes = Ly.boxes;
  try { setCableXray(Ly.cable); } catch (e) { }
  controls.autoRotate = Ly.rotate && EMB.view !== 'cctv';
}
function setLite(on) {
  EMB.lite = !!on;
  DPR = on ? 1 : Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
  renderer.setPixelRatio(DPR); resize();
}

/* ---------- pesan dari dasbor ---------- */
function applyState(m) {
  if (m.zone) setZoneQuad(m.zone);
  if (m.coverage !== undefined) { EMB.coverage = clamp(+m.coverage || 0, 0, 1); setTrashCount(piecewise(EMB.coverage, COV_COUNT)); }
  if (m.trash_count !== undefined) setTrashCount(+m.trash_count);
  if (m.level !== undefined) applyLevel(m.level);
  if (m.hour !== undefined) applyHourSoft(m.hour);
  if (m.tracks) syncTracks(m.tracks, nowS);
}
window.addEventListener('message', function (e) {
  if (e.source !== window.parent) return;
  if (e.origin !== location.origin) return;
  var m = e.data;
  if (!m || m.rw !== 1) return;
  if (m.type === 'state') { if (EMB.ready) applyState(m); else EMB.pending = m; }
  else if (m.type === 'view') setViewMode(m.view);
  else if (m.type === 'layers') applyLayers(m.layers);
  else if (m.type === 'quality') setLite(m.lite);
  else if (m.type === 'pause') EMB.paused = !!m.value;
});
var fpsAcc = 0, fpsN = 0;
onFrame(function (dt) {
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 2) { post({ type: 'stats', fps: Math.round(fpsN / fpsAcc), count: EMB.count, proxies: Object.keys(proxies).length }); fpsAcc = 0; fpsN = 0; }
});
onReady.push(function () {
  state.showPip = false; pipEl.hidden = true;
  setZoneQuad([[0.05, 0.45], [0.95, 0.45], [0.98, 0.95], [0.02, 0.95]]);
  setTrashCount(0); applyLevel(0);
  applyLayers(EMB.layers);
  EMB.ready = true;
  if (EMB.pending) { applyState(EMB.pending); EMB.pending = null; }
  post({ type: 'ready', version: 1, trash: T.length });
});
window.RWTwin = { state: EMB, setTrashCount: setTrashCount, setLevel: applyLevel, setHour: applyHourSoft, setView: setViewMode, applyState: applyState };

/* =====================================================================
   LOOP UTAMA
   ===================================================================== */
var HOME = { t: new V3(-2.0, 0.9, 0.6), p: new V3(-12.5, 9.6, 16.5) };
camera.position.copy(HOME.p);
controls.target.copy(HOME.t);

function resize() {
  var w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (window.__onResize) window.__onResize(w, h);
}
if (window.ResizeObserver) { new ResizeObserver(resize).observe(stage); }
window.addEventListener('resize', resize);
var inView = true;
if (window.IntersectionObserver) { new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }).observe(stage); }

var last = performance.now(), booted = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (!booted || document.hidden || !inView || EMB.paused) { last = now; return; }
  var dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!reduce) state.tm += dt;
  state.dt = dt;
  skyU.uTime.value = state.tm;
  for (var i = 0; i < updaters.length; i++) updaters[i](dt, state.tm);
  controls.update();
  renderer.render(scene, camera);
  for (var j = 0; j < afterRender.length; j++) afterRender[j](dt);
}

onReady.push(function () {
  resize();
  genStudioEnv();
  applyTime(state.hour);
  genOutdoorEnv();
  redrawShade();
  redrawFoam();
  booted = true;
});
window.__rw = { setLevel: function (l) { setLevel(l); }, setView: function (v) { setView(v); }, SKY_FN: SKY_FN, skyUEnv: skyUEnv, skyU: skyU, envScene: envScene, state: state, camera: camera, controls: controls, scene: scene, applyTime: applyTime, genOutdoorEnv: genOutdoorEnv, redrawShade: redrawShade, THREE: THREE, renderer: renderer };
resize();
runTasks();
requestAnimationFrame(frame);
})();
