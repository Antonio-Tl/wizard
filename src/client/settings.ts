import type { Quality } from './three/stage';

export interface Settings {
  name: string;
  avatar: number;
  quality: Quality;
  sound: boolean;
  volume: number;
  fast: boolean;
  token: string;
}

const KEY = 'wizard.settings';

function randomToken(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultQuality(): Quality {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  return mobile ? 'medium' : 'high';
}

export function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  } catch {
    s = {};
  }
  const settings: Settings = {
    name: typeof s.name === 'string' ? s.name : '',
    avatar: typeof s.avatar === 'number' ? s.avatar : Math.floor(Math.random() * 12),
    quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : defaultQuality(),
    sound: s.sound !== false,
    volume: typeof s.volume === 'number' ? s.volume : 0.7,
    fast: s.fast === true,
    token: typeof s.token === 'string' && s.token.length >= 16 ? s.token : randomToken(),
  };
  saveSettings(settings);
  return settings;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* privater Modus */
  }
}
