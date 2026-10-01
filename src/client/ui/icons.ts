/** Schlichte Linien-Icons (24×24, currentColor) für die Werkzeugleiste. */

const PATHS = {
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5M12 7.5V12l3 2"/>',
  chat: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1-4.3A8.5 8.5 0 1 1 20.5 12z"/>',
  soundOn: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4V5z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4V5z"/><path d="M21 9.5l-5 5M16 9.5l5 5"/>',
  sliders: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  exit: '<path d="M9.5 20.5h-3a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3M15.5 16.5 20 12l-4.5-4.5M20 12H9.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}
