// Ikon garis (24x24) buatan sendiri, satu gaya: garis 1.8, ujung bulat. Dipakai sebagai string SVG.
const P = {
  logo: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M12 8.6c1.9 2 2.8 3.1 2.8 4.3a2.8 2.8 0 11-5.6 0c0-1.2.9-2.3 2.8-4.3z" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cube: '<path d="M12 2.5l8.5 4.7v9.6L12 21.5l-8.5-4.7V7.2L12 2.5z"/><path d="M3.8 7.4L12 12l8.2-4.6M12 12v9.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pulse: '<path d="M3 12h4l2.2-5 3.6 10 2.2-5H21"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5M12 17.4v.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.3 9.4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  xc: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>',
  camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1 1 0 011 1V18a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5a1 1 0 011-1z"/><circle cx="12" cy="13.3" r="3.3"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
  wifi: '<path d="M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M8.7 16a5 5 0 016.6 0"/><circle cx="12" cy="19.2" r=".8"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  therm: '<path d="M14 14.5V5a2 2 0 10-4 0v9.5a4 4 0 104 0z"/>',
  drop: '<path d="M12 3s6.5 6.7 6.5 11A6.5 6.5 0 015.5 14C5.5 9.7 12 3 12 3z"/>',
  db: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  pin: '<path d="M12 21.5s7-6.2 7-11.5a7 7 0 10-14 0c0 5.3 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1112 0v5.5l1.5 2h-15l1.5-2zM10 21h4"/>',
  bellOff: '<path d="M6 16.5V11a6 6 0 013-5.2M18 11v5.5l1.5 2H8M10 21h4M3.5 3.5l17 17"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  play: '<path d="M7.5 4.8v14.4L19 12 7.5 4.8z"/>',
  download: '<path d="M12 4v11M7.5 11L12 15.5 16.5 11M5 19.5h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  chevd: '<path d="M5 9l7 7 7-7"/>',
  refresh: '<path d="M20 11a8 8 0 00-14.5-4M4 5v3.5h3.5M4 13a8 8 0 0014.5 4M20 19v-3.5h-3.5"/>',
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5c.5-4.2 3.3-6.5 7-6.5s6.5 2.3 7 6.5"/>',
  paw: '<circle cx="6.5" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14" cy="6" r="1.8"/><circle cx="17.5" cy="10" r="1.8"/><path d="M12 12.5c-3 0-5 2.2-5 4.2 0 1.6 1.4 2.3 3 2 .8-.2 1.3-.5 2-.5s1.2.3 2 .5c1.6.3 3-.4 3-2 0-2-2-4.2-5-4.2z"/>',
  boat: '<path d="M3 15.5h18l-2.5 4h-13L3 15.5zM12 3v12M12 4.5l6 7.5h-6"/>',
  car: '<path d="M4 16.5V12l2-5h12l2 5v4.5M4 16.5h16M4 16.5v2M20 16.5v2"/><circle cx="7.5" cy="14" r=".8"/><circle cx="16.5" cy="14" r=".8"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v6M13.5 11v6"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.6a2.6 2.6 0 015.1.7c0 1.7-2.600 2.200-2.600 3.700M12 17.400v.01"/>',
  layers: '<path d="M12 3.5l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  lamp: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 16v4M17 18h4"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18M3 14.5h18M8 5v14M16 5v14"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  shield: '<path d="M12 3l8 3v5.5c0 4.6-3.2 8.300-8 9.500-4.800-1.200-8-4.900-8-9.500V6l8-3z"/><path d="M8.500 12l2.5 2.500 4.500-5"/>',
  power: '<path d="M12 3v8.5M7 6.2a8 8 0 1010 0"/>',
  gauge: '<path d="M4.200 17A9 9 0 1119.800 17"/><path d="M12 13l4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.500 20.500c.8-4 3.700-6 7.500-6s6.700 2 7.500 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  wave: '<path d="M2.500 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2.500 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>'
};

/** Kembalikan string SVG. `cls` opsional untuk kelas tambahan. */
export function icon(name, cls) {
  const body = P[name] || P.info;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
}

/** Ikon menurut kategori taksonomi kelas. */
export function catIcon(cat) {
  return icon({ trash: 'trash', person: 'person', animal: 'paw', vessel: 'boat', vehicle: 'car', unknown: 'unknown' }[cat] || 'unknown');
}
