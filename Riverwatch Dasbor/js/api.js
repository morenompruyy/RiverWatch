// Klien API Riverwatch: JSON, aliran SSE dengan sambung ulang, gambar bingkai. DemoApi (demo.js) memakai antarmuka yang sama.
import { prefs } from './store.js';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}

function readTokenFromHash() {
  const m = /(?:^|[#&])token=([A-Za-z0-9_\-]{8,128})/.exec(location.hash);
  if (!m) return null;
  prefs.set('token', m[1]);
  try { history.replaceState(null, '', location.pathname + location.search + '#pantau'); } catch (e) { /* abaikan */ }
  return m[1];
}

export class LiveApi {
  constructor() {
    this.mode = 'live';
    this.token = readTokenFromHash() || prefs.get('token', '') || '';
    this.readNeedsToken = false;
  }
  setToken(t) { this.token = (t || '').trim(); if (this.token) prefs.set('token', this.token); else prefs.del('token'); }
  hasToken() { return !!this.token; }

  url(path, params) {
    const u = new URL(path, location.origin + location.pathname.replace(/[^/]*$/, ''));
    if (params) for (const k of Object.keys(params)) if (params[k] != null && params[k] !== '') u.searchParams.set(k, params[k]);
    if (this.token && this.readNeedsToken) u.searchParams.set('token', this.token);
    return u.pathname + u.search;
  }
  async req(method, path, body, params, timeout = 12000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let r;
    try {
      const u = new URL(path, location.origin + location.pathname.replace(/[^/]*$/, ''));
      if (params) for (const k of Object.keys(params)) if (params[k] != null && params[k] !== '') u.searchParams.set(k, params[k]);
      r = await fetch(u.pathname + u.search, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, e && e.name === 'AbortError' ? 'Server tidak menjawab (waktu habis).' : 'Tidak bisa menghubungi server Riverwatch.', 'network');
    } finally { clearTimeout(t); }
    let data = null;
    try { data = await r.json(); } catch (e) { /* bukan JSON */ }
    if (!r.ok) throw new ApiError(r.status, (data && data.error) || `Galat ${r.status}`, (data && data.code) || 'error');
    return data;
  }
  get(path, params) { return this.req('GET', path, undefined, params); }
  post(path, body) { return this.req('POST', path, body || {}); }

  /** Aliran kejadian waktu nyata. cb(kind, data). Kembalikan {close()}. */
  stream(cb) {
    let es = null, closed = false, retry = 0, timer = null;
    const open = () => {
      if (closed) return;
      es = new EventSource(this.url('/api/stream'));
      es.onopen = () => { retry = 0; cb('open', null); };
      es.onerror = () => {
        cb('down', null);
        if (es.readyState === 2 && !closed) { es.close(); timer = setTimeout(open, Math.min(8000, 800 * 2 ** retry++)); }
      };
      for (const k of ['hello', 'frame', 'event', 'telemetry', 'control', 'ping']) {
        es.addEventListener(k, (e) => { let d = null; try { d = JSON.parse(e.data); } catch (x) { return; } cb(k, d); });
      }
    };
    open();
    return { close() { closed = true; clearTimeout(timer); if (es) es.close(); } };
  }

  /** Gambar bingkai (ImageBitmap) untuk kanvas. */
  async frameImage(frame) {
    const id = frame && frame.frame_id;
    const get = async (p) => { const r = await fetch(this.url(p), { cache: 'no-store' }); if (!r.ok) throw new Error('gambar ' + r.status); return createImageBitmap(await r.blob()); };
    try { return await get(`/api/frame/${id}.jpg`); } catch (e) { return get('/api/frame/latest.jpg'); }
  }
  async ping() { try { await this.req('GET', '/api/health', undefined, undefined, 2500); return true; } catch (e) { return false; } }
}
