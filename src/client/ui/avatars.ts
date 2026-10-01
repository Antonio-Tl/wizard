/**
 * Avatar-Medaillons: Goldprägung auf Emaille, im selben Stil wie die Kartenmedaillons.
 * Alles als SVG gezeichnet – scharf in jeder Größe, keine Bilddateien.
 */

const INK = '#2b1a06';

interface AvatarDef {
  name: string;
  light: string;
  dark: string;
  glyph: (enamel: string) => string;
}

function star4(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return `M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`;
}

function star5(cx: number, cy: number, ro: number, ri: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

const line = (d: string, w = 1.6) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ink = (d: string) => `<path d="${d}" fill="${INK}" stroke="none"/>`;
const cut = (d: string, enamel: string) => `<path d="${d}" fill="${enamel}"/>`;

const DEFS: AvatarDef[] = [
  {
    name: 'Zauberhut',
    light: '#6a44b8',
    dark: '#1f1245',
    glyph: (e) => `
      <ellipse cx="50" cy="68" rx="26" ry="6.5"/>
      <path d="M33 66.5Q40 48 47.5 34Q54 22.5 67 24Q58.5 28 56.5 36Q60.5 52 67 66.5Z"/>
      ${cut('M35.2 60.5Q50 64.5 64.8 60.5L66.2 65.5Q50 70 33.8 65.5Z', e)}
      ${ink(star5(50, 49, 5.5, 2.3))}
      ${ink(star4(58, 38.5, 3))}`,
  },
  {
    name: 'Eule',
    light: '#2e7378',
    dark: '#0c2a2d',
    glyph: (e) => `
      <path d="M31 25L41 32C44 31 47 30.5 50 30.5C53 30.5 56 31 59 32L69 25L67 40C69 45 70 50 69 56C67 68 59 75 50 76C41 75 33 68 31 56C30 50 31 45 33 40Z"/>
      <circle cx="42" cy="47" r="7.5" fill="${e}"/>
      <circle cx="58" cy="47" r="7.5" fill="${e}"/>
      <circle cx="42" cy="47" r="2.8" stroke="none"/>
      <circle cx="58" cy="47" r="2.8" stroke="none"/>
      ${line('M35 39L50 44.5L65 39')}
      <path d="M50 50.5L46.5 55.5L50 60L53.5 55.5Z"/>
      ${line('M41 64q2.5 2.5 5 0M47.5 64q2.5 2.5 5 0M54 64q2.5 2.5 5 0M44 69.5q2.5 2.5 5 0M51 69.5q2.5 2.5 5 0', 1.3)}`,
  },
  {
    name: 'Fuchs',
    light: '#c06a2b',
    dark: '#4a2008',
    glyph: (e) => `
      <path d="M50 75L37 60L31 47L28 25L42 35L50 33.5L58 35L72 25L69 47L63 60Z"/>
      ${cut('M31.5 30L33 41.5L39 37Z', e)}
      ${cut('M68.5 30L67 41.5L61 37Z', e)}
      ${ink('M37 48.5Q41.5 45 46 49Q41.5 51 37 48.5Z')}
      ${ink('M63 48.5Q58.5 45 54 49Q58.5 51 63 48.5Z')}
      ${line('M39 55L50 66L61 55', 1.4)}
      ${ink('M46.5 68L53.5 68L50 72.5Z')}`,
  },
  {
    name: 'Hirsch',
    light: '#3f7d3f',
    dark: '#123012',
    glyph: () => {
      const antler =
        'M45 42C43 34 38 29 31 23M38 30.5L30.5 32M34 26L34.5 18.5M41.5 35.5L35.5 37.5M55 42C57 34 62 29 69 23M62 30.5L69.5 32M66 26L65.5 18.5M58.5 35.5L64.5 37.5';
      return `
      <path d="${antler}" fill="none" stroke="${INK}" stroke-width="6.2" stroke-linecap="round"/>
      <path d="${antler}" fill="none" stroke="url(#au)" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M41.5 47L31 44.5L37.5 51.5Z"/>
      <path d="M58.5 47L69 44.5L62.5 51.5Z"/>
      <path d="M50 77C46 77 44 73 43 67L40.5 53C39.5 47.5 42.5 43 47 42.5L53 42.5C57.5 43 60.5 47.5 59.5 53L57 67C56 73 54 77 50 77Z"/>
      <circle cx="45.5" cy="53" r="1.9" fill="${INK}" stroke="none"/>
      <circle cx="54.5" cy="53" r="1.9" fill="${INK}" stroke="none"/>
      ${line('M50 58L50 67', 1.1)}
      ${ink('M47.5 70.5L52.5 70.5L50 73.8Z')}`;
    },
  },
  {
    name: 'Wolf',
    light: '#56657a',
    dark: '#1b222d',
    glyph: (e) => `
      <path d="M50 76L41 70L35 63L29 60L32 55L29 47L33 44L31 23L42 35L50 34L58 35L69 23L67 44L71 47L68 55L71 60L65 63L59 70Z"/>
      ${cut('M33.5 28.5L35 40L40 36.5Z', e)}
      ${cut('M66.5 28.5L65 40L60 36.5Z', e)}
      ${ink('M37 46L45.5 48.5L39 50.5Z')}
      ${ink('M63 46L54.5 48.5L61 50.5Z')}
      ${line('M36 42.5L45 45.5M64 42.5L55 45.5', 1.4)}
      ${line('M43 55L50 61L57 55', 1.4)}
      ${line('M50 49L50 60', 0.9)}
      ${ink('M45.5 63L54.5 63L50 68.5Z')}`,
  },
  {
    name: 'Krone',
    light: '#2d5cc0',
    dark: '#0c1f55',
    glyph: (e) => `
      <path d="M27 64L25 37L37.5 49L50 29L62.5 49L75 37L73 64Z"/>
      <rect x="26" y="61" width="48" height="10" rx="2"/>
      <circle cx="37" cy="66" r="2.6" fill="${e}"/>
      <circle cx="50" cy="66" r="3.2" fill="${e}"/>
      <circle cx="63" cy="66" r="2.6" fill="${e}"/>
      <circle cx="25" cy="35" r="3.6"/>
      <circle cx="50" cy="27" r="4.2"/>
      <circle cx="75" cy="35" r="3.6"/>
      ${cut('M50 41L53 48L50 55L47 48Z', e)}`,
  },
  {
    name: 'Kristallkugel',
    light: '#8a3f8f',
    dark: '#2e0f33',
    glyph: () => `
      <path d="M36 72L40.5 61L59.5 61L64 72Z"/>
      <rect x="32" y="71.5" width="36" height="6" rx="2"/>
      <circle cx="50" cy="43" r="18" fill="url(#orb)" stroke="url(#au)" stroke-width="3.2"/>
      <path d="${star4(44, 39, 6)}" stroke="none"/>
      <path d="${star4(56.5, 48.5, 3.6)}" stroke="none"/>
      <path d="${star4(55, 35, 2)}" stroke="none"/>
      <path d="M38.5 37A13 13 0 0 1 46 29.5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`,
  },
  {
    name: 'Pilz',
    light: '#a33040',
    dark: '#3d0d16',
    glyph: (e) => `
      <path d="M42.5 55.5Q41 66 39.5 75L60.5 75Q59 66 57.5 55.5Q50 57.5 42.5 55.5Z"/>
      <path d="M25 52C25 36 37 27 50 27C63 27 75 36 75 52Q50 59 25 52Z"/>
      <circle cx="40" cy="39" r="4.2" fill="${e}"/>
      <circle cx="56.5" cy="35.5" r="3.6" fill="${e}"/>
      <circle cx="64" cy="46" r="3.2" fill="${e}"/>
      <circle cx="49" cy="47" r="3" fill="${e}"/>
      <circle cx="32.5" cy="47" r="2.6" fill="${e}"/>
      ${line('M29 52.5Q50 58.5 71 52.5', 1.2)}`,
  },
  {
    name: 'Mond',
    light: '#2a4585',
    dark: '#090f2b',
    glyph: () => `
      <path d="M49.2 26A24 24 0 1 0 69.7 60.2A20 20 0 1 1 49.2 26Z"/>
      <path d="${star4(63, 33, 6)}"/>
      <path d="${star4(72, 50, 3.6)}"/>
      <path d="${star4(58.5, 52.5, 2.4)}" stroke="none"/>`,
  },
  {
    name: 'Flamme',
    light: '#4a3530',
    dark: '#140d0b',
    glyph: (e) => `
      <path d="M50 77C36 77 30 67 31 57C32 47 40 43 40 33C46 37 48 43 47 49C52 43 52.5 33 50 24C62 32 70 44 69 58C68 69 62 77 50 77Z"/>
      ${cut('M50 73C43.5 73 40.5 67.5 41.5 61.5C42.5 56.5 46 54.5 47 49.5C51 53.5 53 51 54 47C58 53 60 57.5 59 62.5C58 68.5 55 73 50 73Z', e)}
      <path d="M50 70.5C47.2 70.5 45.8 67.5 46.8 64.5C47.8 61.5 50 60.5 50 57.5C53 60.5 54.2 63.5 53.4 66.5C52.8 69 51.8 70.5 50 70.5Z"/>
      <circle cx="38" cy="27" r="1.7" stroke="none"/>
      <circle cx="63.5" cy="25.5" r="1.4" stroke="none"/>
      <circle cx="68" cy="36" r="1.1" stroke="none"/>`,
  },
  {
    name: 'Turm',
    light: '#75695c',
    dark: '#29231d',
    glyph: (e) => `
      ${line('M50 32L50 19.5', 1.8)}
      <path d="M50.8 20L61 23.2L50.8 26.6Z"/>
      <path d="M38.5 75L40.5 43L36 43L36 32L41.5 32L41.5 36.5L47 36.5L47 32L53 32L53 36.5L58.5 36.5L58.5 32L64 32L64 43L59.5 43L61.5 75Z"/>
      <path d="M45 75L45 66Q50 59.5 55 66L55 75Z" fill="${e}"/>
      <rect x="47.5" y="46.5" width="5" height="8.5" rx="2.5" fill="${e}"/>
      ${line('M41.5 50.5L45 50.5M55 50.5L58.7 50.5M41.2 58L46 58M54 58L59.2 58M43 65.5L44.5 65.5M55.5 65.5L58 65.5', 1)}`,
  },
  {
    name: 'Schwert',
    light: '#6f7a2e',
    dark: '#262b0c',
    glyph: (e) => `
      <path d="M47.2 23L50 17.5L52.8 23L52.8 61L47.2 61Z"/>
      ${line('M50 24L50 57', 1.2)}
      <path d="M34 61.5Q50 65.5 66 61.5L66 66.5Q50 70.5 34 66.5Z"/>
      <circle cx="33.5" cy="64" r="2.8"/>
      <circle cx="66.5" cy="64" r="2.8"/>
      <rect x="47" y="68" width="6" height="10" rx="1.5" fill="${e}"/>
      ${line('M47.3 71.2L52.7 70.2M47.3 74.4L52.7 73.4M47.3 77.4L52.7 76.6', 1.1)}
      <circle cx="50" cy="81" r="3.4"/>`,
  },
];

export const AVATAR_NAMES = DEFS.map((d) => d.name);

function svgFor(def: AvatarDef): string {
  const beads = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return `<circle cx="${(50 + Math.cos(a) * 44.6).toFixed(2)}" cy="${(50 + Math.sin(a) * 44.6).toFixed(2)}" r=".95"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="bg" cx="42%" cy="34%" r="72%">
      <stop offset="0" stop-color="${def.light}"/>
      <stop offset="1" stop-color="${def.dark}"/>
    </radialGradient>
    <radialGradient id="orb" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".35"/>
      <stop offset=".35" stop-color="${def.light}"/>
      <stop offset="1" stop-color="${def.dark}"/>
    </radialGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="50%">
      <stop offset=".62" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <linearGradient id="au" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff1b8"/>
      <stop offset=".3" stop-color="#e6bf62"/>
      <stop offset=".62" stop-color="#b3842c"/>
      <stop offset="1" stop-color="#f0cf7a"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbe3a0"/>
      <stop offset=".5" stop-color="#b8862b"/>
      <stop offset="1" stop-color="#e9c46a"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.4" stdDeviation="1.1" flood-color="#000" flood-opacity=".55"/>
    </filter>
  </defs>
  <circle cx="50" cy="50" r="48" fill="url(#bg)"/>
  <circle cx="50" cy="50" r="48" fill="url(#vig)"/>
  <ellipse cx="50" cy="27" rx="27" ry="13" fill="#fff" opacity=".06"/>
  <g fill="url(#au)" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round" filter="url(#sh)" transform="translate(50 50.5) scale(1.13) translate(-50 -50.5)">${def.glyph(def.dark)}</g>
  <circle cx="50" cy="50" r="47.6" fill="none" stroke="url(#rim)" stroke-width="3.6"/>
  <circle cx="50" cy="50" r="41.6" fill="none" stroke="url(#rim)" stroke-width=".8" opacity=".55"/>
  <g fill="#e6c06a" opacity=".75">${beads}</g>
</svg>`;
}

const cache = new Map<number, string>();

export function avatarSrc(index: number): string {
  const i = Number.isInteger(index) && index >= 0 && index < DEFS.length ? index : 0;
  let url = cache.get(i);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(DEFS[i]))}`;
    cache.set(i, url);
  }
  return url;
}

export function avatarImg(index: number, className = 'avatar'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.src = avatarSrc(index);
  img.alt = AVATAR_NAMES[index] ?? '';
  img.draggable = false;
  return img;
}
