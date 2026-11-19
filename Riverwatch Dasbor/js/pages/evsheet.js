// Lembar rincian kejadian: bukti bingkai (pemutar + penggeser), keterangan, konfirmasi, MP4.
import { h, fill, openSheet, toast, fmtDay, fmtClock, fmtNum, fmtPct, fmtBytes, LEVELS, copyText, rangeEl, ico } from '../ui.js';
import { icon } from '../icons.js';
import { core, ackEvent, nodeOff } from '../core.js';
import { store } from '../store.js';

export const SEV_LABEL = { critical: 'Kritis', warning: 'Peringatan', info: 'Info' };
export function sevIcon(sev, kind) {
  if (kind === 'level_up' || kind === 'level_down' || kind === 'level_clear' || kind === 'level_ack') return 'layers';
  if (kind && kind.startsWith('health')) return 'pulse';
  if (kind === 'night_on') return 'moon';
  if (kind === 'night_off') return 'sun';
  if (kind === 'fps_mode') return 'gauge';
  if (kind === 'started' || kind === 'stopped') return 'power';
  if (kind && kind.startsWith('anomaly')) return sev === 'info' ? 'check' : 'alert';
  return sev === 'critical' || sev === 'warning' ? 'alert' : 'info';
}
export const actionable = (e) => !e.ack && (e.severity === 'warning' || e.severity === 'critical') && (e.kind === 'anomaly_start' || e.kind === 'level_up');

export async function openEventSheet(evOrId) {
  const id = typeof evOrId === 'string' ? evOrId : evOrId.id;
  const off = nodeOff();
  const body = h('div', { class: 'evs' }, h('div', { class: 'skel', style: 'aspect-ratio:16/9;border-radius:20px' }), h('div', { class: 'skel', style: 'height:90px' }));
  const footer = [];
  const sh = openSheet({ title: typeof evOrId === 'string' ? 'Kejadian' : evOrId.title, body, footer });
  let timer = 0;
  const stop = () => clearTimeout(timer);
  const origClose = sh.close; sh.close = () => { stop(); origClose(); };
  let d;
  try { d = await core.api.get(`/api/events/${encodeURIComponent(id)}`); } catch (e) { body.replaceChildren(h('p', { class: 'mut' }, e.message)); return; }
  const ev = d.event || d;
  const frames = d.frames || [];
  sh.el.querySelector('h2').textContent = ev.title;
  const stage = h('div', { class: 'ev-stage' });
  const img = h('img', { alt: 'Bingkai bukti kejadian', decoding: 'async' });
  const tag = h('span', { class: 'cam-chip mono ev-tag' }, '');
  const med = (u) => core.api.url(u);
  const viewer = [];
  if (frames.length) {
    let idx = 0, playing = false, speed = 1;
    const slider = rangeEl({ min: 0, max: frames.length - 1, step: 1, value: 0, label: 'Posisi bingkai', onInput: (v) => { pause(); show(v); } });
    const playBtn = h('button', { class: 'btn sm icon', 'aria-label': 'Putar', html: icon('play') });
    const spBtn = h('button', { class: 'btn sm' }, '1×');
    const show = (i) => {
      idx = i; img.src = med(frames[i].url); slider.value = i; slider.paint();
      tag.textContent = `+${fmtNum(frames[i].ms / 1000, 2)} dtk · ${i + 1}/${frames.length}`;
      for (let k = 1; k <= 3; k++) { const f = frames[i + k]; if (f) { const pre = new Image(); pre.src = med(f.url); } }
    };
    const tick = () => {
      if (!playing) return;
      const nxt = idx + 1 >= frames.length ? 0 : idx + 1;
      const gap = nxt === 0 ? 700 : Math.max(40, (frames[nxt].ms - frames[idx].ms) / speed);
      timer = setTimeout(() => { show(nxt); tick(); }, gap);
    };
    const play = () => { playing = true; playBtn.innerHTML = icon('pause'); playBtn.setAttribute('aria-label', 'Jeda'); tick(); };
    const pause = () => { playing = false; stop(); playBtn.innerHTML = icon('play'); playBtn.setAttribute('aria-label', 'Putar'); };
    playBtn.addEventListener('click', () => (playing ? pause() : play()));
    spBtn.addEventListener('click', () => { speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; spBtn.textContent = speed + '×'; });
    stage.append(img, tag);
    viewer.push(stage, h('div', { class: 'ev-ctl' }, playBtn, slider, spBtn));
    show(Math.min(frames.length - 1, Math.floor(frames.length / 3)));
  } else if (ev.media && ev.media.snapshot) {
    img.src = med('/media/' + ev.media.snapshot); stage.append(img); viewer.push(stage);
  } else {
    viewer.push(h('div', { class: 'ev-none' }, h('span', { html: icon('film') }), h('div', null, h('b', null, 'Tidak ada gambar bukti'), h('p', { class: 'cap' }, 'Kejadian sistem (mulai, mode FPS, kesehatan) tidak menyimpan gambar.'))));
  }
  const m = ev.meta || {};
  const kv = [['Waktu', `${fmtDay(ev.ts, off)}, ${fmtClock(ev.ts, off)}`], ['Tingkat saat itu', ev.level != null ? LEVELS[ev.level] : '–'], ['Tutupan sampah', ev.coverage != null ? fmtPct(ev.coverage, 1) : '–'],
    ['Objek', ev.cls ? ((((store.get('node') || {}).taxonomy || []).find((t) => t.key === ev.cls) || {}).name || ev.cls) : '–'], ['ID pelacak', ev.track_id != null ? '#' + ev.track_id : '–'], ['Kepercayaan model', m.score != null ? fmtNum(m.score, 2) : '–'],
    ['Posisi', m.in_zone === true ? 'di dalam zona air' : m.in_zone === false ? 'di luar zona air' : '–'], ['Ukuran bukti', ev.media && ev.media.bytes ? fmtBytes(ev.media.bytes) : '–']].filter((r) => r[1] !== '–' || r[0] === 'Waktu');
  fill(body, ...viewer, h('div', { class: 'ev-head' }, h('span', { class: 'badge ' + (ev.severity === 'critical' ? 'bad' : ev.severity === 'warning' ? 'warn' : '') }, SEV_LABEL[ev.severity] || ev.severity), ev.ack ? h('span', { class: 'badge ok' }, 'Sudah dikonfirmasi') : null,
    m.demo ? h('span', { class: 'badge' }, 'Data tiruan') : null), ev.detail ? h('p', { class: 'mut' }, ev.detail) : null,
  h('dl', { class: 'kv' }, kv.map((r) => [h('dt', null, r[0]), h('dd', null, r[1])])));
  const f = sh.el.querySelector('.sheet-f') || sh.el.appendChild(h('div', { class: 'sheet-f' }));
  const btns = [];
  if (actionable(ev)) btns.push(h('button', { class: 'btn primary', onclick: async (e) => { e.currentTarget.classList.add('busy'); const r = await ackEvent(ev.id); if (r) sh.close(); else e.currentTarget.classList.remove('busy'); } }, h('span', { html: icon('check') }), 'Konfirmasi'));
  if (frames.length || (ev.media && ev.media.clip)) {
    btns.push(h('button', { class: 'btn', onclick: async (e) => {
      const b = e.currentTarget; b.classList.add('busy');
      try { const r = await core.api.post(`/api/events/${encodeURIComponent(ev.id)}/mp4`); window.open(core.api.url(r.mp4_url), '_blank', 'noopener'); }
      catch (er) { if (er.status === 401 || er.status === 403) toast('Butuh token kontrol: buka halaman Kontrol lalu coba lagi.', 'err', 5000); else toast(er.message, 'err', 6000); }
      b.classList.remove('busy');
    } }, h('span', { html: icon('film') }), 'Buat MP4'));
  }
  btns.push(h('button', { class: 'btn ghost', onclick: () => copyText(ev.id) }, 'Salin ID'));
  f.replaceChildren(...btns);
}
