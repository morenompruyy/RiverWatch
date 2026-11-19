// Dijalankan sebelum gambar tampil: pasang tema dan mode ringan supaya tidak berkedip.
(function () {
  var r = document.documentElement, theme = 'auto', lite = '0';
  try { theme = localStorage.getItem('rw.theme') || 'auto'; lite = localStorage.getItem('rw.lite') || '0'; } catch (e) { /* penyimpanan diblokir: pakai bawaan */ }
  var host = r.getAttribute('data-theme');                    // tema yang dipasang penampil (bila ada); dipakai saat pilihan "Otomatis"
  window.__rwHostTheme = host === 'dark' || host === 'light' ? host : null;
  var light = false;
  try { light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { /* abaikan */ }
  var dark = theme === 'dark' || (theme === 'auto' && (window.__rwHostTheme ? window.__rwHostTheme === 'dark' : !light));
  if (!r.getAttribute('lang')) r.setAttribute('lang', 'id');
  r.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (lite === '1') r.setAttribute('data-lite', '1');
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', dark ? '#061620' : '#D5E8EE');
})();
