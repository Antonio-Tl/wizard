import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-900.css';
import '@fontsource/cinzel-decorative/latin-900.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './admin.css';

import { clear, h } from '../client/ui/dom';
import type { GameMode, GameOptions, StatsGame, StatsResponse } from '../shared/types';

/**
 * Admin-Seite unter /admin: zeigt, wie viele Spiele wann gespielt wurden.
 * Die Daten kommen passwortgeschützt aus dem GameStats-Durable-Object.
 */

const app = document.getElementById('app')!;
const PW_KEY = 'wizard.admin';
const RANGE_KEY = 'wizard.admin.range';
const DAY = 86_400_000;
/** Unbeendete Spiele gelten so lange als „läuft“, danach als abgebrochen */
const RUNNING_MS = 3 * 60 * 60 * 1000;
const REFRESH_MS = 60_000;
const TABLE_PAGE = 25;

type RangeKey = 7 | 30 | 90 | 0;
const RANGES: [RangeKey, string][] = [
  [7, '7 Tage'],
  [30, '30 Tage'],
  [90, '90 Tage'],
  [0, 'Alles'],
];

const SERIES: { key: GameMode; label: string }[] = [
  { key: 'online', label: 'Online' },
  { key: 'solo', label: 'Gegen Bots' },
];
const MODE_LABEL: Record<GameMode, string> = { online: 'Online', solo: 'Gegen Bots' };
const LENGTH_LABEL: Record<GameOptions['roundsMode'], string> = { full: 'Voll', half: 'Halb', quick: 'Kurz' };
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

type Status = 'done' | 'running' | 'open';
const STATUS_LABEL: Record<Status, string> = { done: 'Beendet', running: 'Läuft', open: 'Abgebrochen' };

const nf = new Intl.NumberFormat('de-DE');
const fmtClock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtRowDay = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtRowDayYear = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtLongDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtAxisDay = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });
const fmtWeek = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });

// ───────────────────────── Hilfen ─────────────────────────

function store(key: string, value: string | null, persistent = true): void {
  for (const s of persistent ? [localStorage, sessionStorage] : [sessionStorage]) {
    try {
      if (value === null) s.removeItem(key);
      else s.setItem(key, value);
    } catch {
      /* privater Modus */
    }
  }
}

function load(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Montag = 0 … Sonntag = 6 */
function weekday(ts: number): number {
  return (new Date(ts).getDay() + 6) % 7;
}

function statusOf(g: StatsGame, now: number): Status {
  if (g.endedAt) return 'done';
  return now - g.startedAt < RUNNING_MS ? 'running' : 'open';
}

function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function fmtWhen(ts: number, now: number): string {
  const d = new Date(ts);
  const day = d.getFullYear() === new Date(now).getFullYear() ? fmtRowDay.format(d) : fmtRowDayYear.format(d);
  return `${day} · ${fmtClock.format(d)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${nf.format(n)} ${n === 1 ? one : many}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>, ...children: (Node | string)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

/** Säule mit 4px-Rundung oben, unten eckig an der Grundlinie */
function roundedTop(x: number, y: number, w: number, hgt: number, r: number): string {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + hgt}Z`;
}

/** Runde Achsenschritte: 1, 2, 5, 10, 20 … */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  const raw = Math.max(1, max) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const s = Math.max(1, step);
  return { top: Math.max(s, Math.ceil(max / s) * s), step: s };
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

// ───────────────────────── Tooltip & Toast ─────────────────────────

const tip = h('div', { class: 'tip', role: 'tooltip' });
document.body.appendChild(tip);

function showTip(e: { clientX: number; clientY: number }, ...content: (Node | string)[]): void {
  tip.replaceChildren(...content);
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14;
  let y = e.clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 18;
  tip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
}

function hideTip(): void {
  tip.classList.remove('on');
}

function tipRow(value: string, label: string, key?: string): HTMLElement {
  return h('div', { class: 'tip-row' }, key ? h('i', { class: `key k-${key}` }) : null, h('b', null, value), h('span', null, label));
}

function toast(text: string, kind: 'info' | 'err' = 'info'): void {
  const el = h('div', { class: `toast ${kind}` }, text);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}

function confirmDialog(title: string, text: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      wrap.classList.add('out');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 220);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done(false);
    const cancel = h('button', { class: 'btn', onclick: () => done(false) }, 'Abbrechen');
    const wrap = h(
      'div',
      { class: 'dialog-wrap', onpointerdown: (e: Event) => e.target === wrap && done(false) },
      h(
        'div',
        { class: 'dialog panel', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
        h('div', { class: 'dialog-icon' }, '!'),
        h('h2', { id: 'dlg-title' }, title),
        h('p', null, text),
        h('div', { class: 'dialog-actions' }, cancel, h('button', { class: 'btn danger', onclick: () => done(true) }, okLabel)),
      ),
    );
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    cancel.focus();
  });
}

// ───────────────────────── Server ─────────────────────────

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function api<T>(method: 'GET' | 'DELETE', pw: string): Promise<T> {
  const res = await fetch('/api/admin/stats', {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${encodeURIComponent(pw)}` },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'error');
  return body as T;
}

// ───────────────────────── Anmeldung ─────────────────────────

const SIGIL = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e2a4"/><stop offset="0.5" stop-color="#e6c06a"/><stop offset="1" stop-color="#8a6420"/></linearGradient></defs><rect x="6" y="2" width="52" height="60" rx="7" fill="#161a4d" stroke="url(#sg)" stroke-width="3"/><path d="M20 46 Q26 30 33 16 Q38 10 46 13 Q40 15 38 21 Q41 34 44 46 Z" fill="#3b2a7a" stroke="#0b0820" stroke-width="1.5"/><ellipse cx="32" cy="46" rx="17" ry="4" fill="#2a1d5c" stroke="#0b0820" stroke-width="1.5"/><path d="M30 30 l1.5 3 3.3.4-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.4z" fill="url(#sg)"/></svg>`;

function sigil(): HTMLElement {
  const el = h('span', { class: 'sigil' });
  el.innerHTML = SIGIL;
  return el;
}

function showLogin(message = '', setup = false): void {
  hideTip();
  clear(app);
  const input = h('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Passwort',
    autocomplete: 'current-password',
    'aria-label': 'Admin-Passwort',
  }) as HTMLInputElement;
  const remember = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const msg = h('div', { class: 'login-msg', role: 'alert' }, message);
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Eintreten') as HTMLButtonElement;
  const form = h(
    'form',
    {
      class: 'login panel',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const pw = input.value;
        if (!pw) return input.focus();
        btn.disabled = true;
        btn.textContent = 'Prüfe …';
        msg.textContent = '';
        try {
          const data = await api<StatsResponse>('GET', pw);
          store(PW_KEY, pw, remember.checked);
          new Dashboard(pw, data);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Eintreten';
          if (err instanceof ApiError && err.code === 'no_password') return showLogin('', true);
          msg.textContent = err instanceof ApiError && err.status === 401 ? 'Falsches Passwort.' : 'Server nicht erreichbar.';
          form.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 240, iterations: 2 });
          input.select();
        }
      },
    },
    h('div', { class: 'login-title' }, sigil(), h('h1', { class: 'gold-text' }, 'Wizard'), h('p', null, 'Admin-Bereich')),
    setup
      ? h(
          'div',
          { class: 'setup' },
          h('b', null, 'Noch kein Admin-Passwort gesetzt.'),
          h('p', null, 'Online: ', h('code', null, 'npx wrangler secret put ADMIN_PASSWORD')),
          h('p', null, 'Lokal: ', h('code', null, 'ADMIN_PASSWORD=…'), ' in die Datei ', h('code', null, '.dev.vars'), ' schreiben und den Dev-Server neu starten.'),
        )
      : null,
    h('label', { class: 'label' }, 'Passwort'),
    input,
    h('label', { class: 'check' }, remember, h('span', null, 'Auf diesem Gerät angemeldet bleiben')),
    msg,
    btn,
  );
  app.appendChild(h('main', { class: 'login-screen' }, form));
  input.focus();
}

// ───────────────────────── Dashboard ─────────────────────────

interface Bucket {
  start: number;
  end: number;
  online: number;
  solo: number;
}

class Dashboard {
  private range: RangeKey;
  private tableLimit = TABLE_PAGE;
  private body: HTMLElement;
  private stamp: HTMLElement;
  private rangeSeg: HTMLElement;
  private refreshBtn: HTMLButtonElement;
  private timer: ReturnType<typeof setInterval>;
  private resize: ResizeObserver;
  private redrawChart: (() => void) | null = null;

  constructor(
    private pw: string,
    private data: StatsResponse,
  ) {
    const saved = Number(load(RANGE_KEY));
    this.range = RANGES.some(([k]) => k === saved) && load(RANGE_KEY) !== null ? (saved as RangeKey) : 30;
    hideTip();
    clear(app);

    this.stamp = h('span', { class: 'stamp' });
    this.refreshBtn = h(
      'button',
      { class: 'icon-btn', title: 'Aktualisieren', 'aria-label': 'Aktualisieren', onclick: () => void this.refresh(true) },
      refreshIcon(),
    ) as HTMLButtonElement;
    this.rangeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Zeitraum' });
    this.body = h('div', { class: 'body' });

    app.appendChild(
      h(
        'div',
        { class: 'shell' },
        h(
          'header',
          { class: 'top' },
          h(
            'div',
            { class: 'brand' },
            sigil(),
            h('div', null, h('div', { class: 'brand-name gold-text' }, 'Wizard'), h('div', { class: 'brand-sub' }, 'Chronik der Spiele')),
          ),
          h(
            'div',
            { class: 'top-actions' },
            this.stamp,
            this.refreshBtn,
            h(
              'button',
              { class: 'btn ghost small logout', 'aria-label': 'Abmelden', onclick: () => this.logout() },
              exitIcon(),
              h('span', null, 'Abmelden'),
            ),
          ),
        ),
        h('div', { class: 'filters' }, h('span', { class: 'filters-label' }, 'Zeitraum'), this.rangeSeg),
        this.body,
      ),
    );

    this.resize = new ResizeObserver(() => this.redrawChart?.());
    this.timer = setInterval(() => !document.hidden && void this.refresh(false), REFRESH_MS);
    this.render();
  }

  private logout(): void {
    clearInterval(this.timer);
    this.resize.disconnect();
    store(PW_KEY, null);
    showLogin();
  }

  private async refresh(manual: boolean): Promise<void> {
    if (!app.contains(this.body)) return clearInterval(this.timer);
    this.body.classList.add('refreshing');
    this.refreshBtn.classList.add('spin');
    try {
      this.data = await api<StatsResponse>('GET', this.pw);
      this.render();
      if (manual) toast('Aktualisiert.');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'no_password')) {
        clearInterval(this.timer);
        store(PW_KEY, null);
        return showLogin('Bitte erneut anmelden.');
      }
      if (manual) toast('Aktualisieren fehlgeschlagen.', 'err');
    } finally {
      this.body.classList.remove('refreshing');
      this.refreshBtn.classList.remove('spin');
    }
  }

  private async wipe(): Promise<void> {
    const n = this.data.total;
    const ok = await confirmDialog(
      'Statistik löschen?',
      `Alle ${plural(n, 'gespeicherte Spiel', 'gespeicherten Spiele')} werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
      'Endgültig löschen',
    );
    if (!ok) return;
    try {
      const res = await api<{ deleted: number }>('DELETE', this.pw);
      toast(`${plural(res.deleted, 'Spiel', 'Spiele')} gelöscht.`);
      await this.refresh(false);
    } catch {
      toast('Löschen fehlgeschlagen.', 'err');
    }
  }

  // ───────── Zeitraum ─────────

  private since(now: number, games: StatsGame[]): number {
    if (this.range) return addDays(startOfDay(now), -(this.range - 1));
    const oldest = games.length ? games[games.length - 1].startedAt : now;
    return Math.min(startOfDay(oldest), addDays(startOfDay(now), -6));
  }

  private renderRange(): void {
    clear(this.rangeSeg);
    for (const [key, label] of RANGES) {
      this.rangeSeg.appendChild(
        h(
          'button',
          {
            class: key === this.range ? 'on' : '',
            role: 'radio',
            'aria-checked': String(key === this.range),
            onclick: () => {
              this.range = key;
              this.tableLimit = TABLE_PAGE;
              store(RANGE_KEY, String(key));
              this.render();
            },
          },
          label,
        ),
      );
    }
  }

  // ───────── Aufbau ─────────

  private render(): void {
    const now = Date.now();
    const all = this.data.games;
    const since = this.since(now, all);
    const games = all.filter((g) => g.startedAt >= since);

    this.stamp.textContent = `Stand ${fmtClock.format(now)} Uhr`;
    hideTip();
    this.renderRange();
    this.resize.disconnect();
    this.redrawChart = null;
    clear(this.body);

    this.body.append(this.kpis(games, all, since, now));

    if (!this.data.total) {
      this.body.append(
        h(
          'section',
          { class: 'card empty' },
          h('div', { class: 'empty-glyph' }, '✦'),
          h('h2', null, 'Noch keine Spiele aufgezeichnet'),
          h('p', null, 'Sobald jemand eine Partie startet – online oder gegen Bots –, erscheint sie hier.'),
        ),
      );
    } else {
      this.body.append(
        this.timeline(games, since, now),
        this.heatmap(games),
        h('div', { class: 'grid-2' }, this.breakdown(games), this.players(games)),
        this.table(games, now),
      );
    }
    this.body.append(this.dangerZone());
  }

  private kpis(games: StatsGame[], all: StatsGame[], since: number, now: number): HTMLElement {
    const today = startOfDay(now);
    const todayGames = all.filter((g) => g.startedAt >= today);
    const running = all.filter((g) => statusOf(g, now) === 'running').length;
    const done = games.filter((g) => g.endedAt);
    const settled = games.filter((g) => statusOf(g, now) !== 'running').length;
    const avg = done.length ? done.reduce((s, g) => s + (g.endedAt! - g.startedAt), 0) / done.length : 0;
    const people = new Set(games.flatMap((g) => g.humans.map((n) => n.toLowerCase())));

    let delta: HTMLElement | null = null;
    if (this.range && all.length && all[all.length - 1].startedAt < since) {
      const prevSince = addDays(since, -this.range);
      const prev = all.filter((g) => g.startedAt >= prevSince && g.startedAt < since).length;
      if (prev > 0) {
        const pct = Math.round(((games.length - prev) / prev) * 100);
        const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
        delta = h(
          'div',
          { class: `delta ${dir}` },
          h('span', { 'aria-hidden': 'true' }, dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'),
          `${pct > 0 ? '+' : ''}${pct} % ggü. den ${this.range} Tagen davor`,
        );
      }
    }

    const rangeLabel = this.range ? `in den letzten ${this.range} Tagen` : 'insgesamt';
    const tile = (label: string, value: string, sub: Node | string | null) =>
      h('div', { class: 'tile panel' }, h('div', { class: 'tile-k' }, label), h('div', { class: 'tile-v' }, value), h('div', { class: 'tile-s' }, sub));

    return h(
      'section',
      { class: 'kpis' },
      h(
        'div',
        { class: 'hero panel' },
        h('div', { class: 'tile-k' }, `Spiele ${rangeLabel}`),
        h('div', { class: 'hero-v gold-text' }, nf.format(games.length)),
        delta ??
          h(
            'div',
            { class: 'tile-s' },
            this.range
              ? `${plural(this.data.total, 'Spiel', 'Spiele')} gespeichert`
              : all.length
                ? `seit ${fmtWeek.format(all[all.length - 1].startedAt)}`
                : 'noch keine Spiele',
          ),
      ),
      tile(
        'Heute',
        nf.format(todayGames.length),
        running ? h('span', { class: 'live' }, h('i', null), `${nf.format(running)} ${running === 1 ? 'läuft' : 'laufen'} gerade`) : 'gerade keins aktiv',
      ),
      tile('Beendet', settled ? `${Math.round((done.length / settled) * 100)} %` : '–', `${nf.format(done.length)} von ${nf.format(settled)} zu Ende gespielt`),
      tile('Ø Dauer', done.length ? fmtDuration(avg) : '–', 'pro beendetem Spiel'),
      tile('Mitspieler', nf.format(people.size), 'verschiedene Namen'),
    );
  }

  // ───────── Spiele pro Tag ─────────

  private timeline(games: StatsGame[], since: number, now: number): HTMLElement {
    const days = Math.round((startOfDay(now) - since) / DAY) + 1;
    const unit: 'day' | 'week' = days > 120 ? 'week' : 'day';
    let cursor = since;
    if (unit === 'week') cursor = addDays(since, -weekday(since));
    const buckets: Bucket[] = [];
    while (cursor <= now) {
      const next = addDays(cursor, unit === 'week' ? 7 : 1);
      buckets.push({ start: cursor, end: next, online: 0, solo: 0 });
      cursor = next;
    }
    for (const g of games) {
      let lo = 0;
      let hi = buckets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (buckets[mid].start <= g.startedAt) lo = mid;
        else hi = mid - 1;
      }
      if (buckets[lo]) buckets[lo][g.mode]++;
    }

    const chart = h('div', { class: 'chart', role: 'img' });
    const peak = buckets.reduce((a, b) => (b.online + b.solo > a.online + a.solo ? b : a), buckets[0]);
    const peakN = peak ? peak.online + peak.solo : 0;
    chart.setAttribute('aria-label', `Spiele pro ${unit === 'week' ? 'Woche' : 'Tag'}, höchstens ${peakN}`);

    const draw = () => drawColumns(chart, buckets, unit);
    this.redrawChart = draw;
    requestAnimationFrame(() => {
      draw();
      this.resize.observe(chart);
    });

    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h(
          'div',
          null,
          h('h2', null, unit === 'week' ? 'Spiele pro Woche' : 'Spiele pro Tag'),
          h(
            'p',
            { class: 'card-sub' },
            peakN
              ? `Spitze: ${plural(peakN, 'Spiel', 'Spiele')} ${unit === 'week' ? `in der Woche ab ${fmtWeek.format(peak.start)}` : `am ${fmtLongDay.format(peak.start)}`}`
              : 'In diesem Zeitraum wurde nicht gespielt.',
          ),
        ),
        h(
          'div',
          { class: 'legend' },
          SERIES.map((s) => h('span', null, h('i', { class: `sw k-${s.key}` }), s.label)),
        ),
      ),
      chart,
    );
  }

  // ───────── Wochentag × Uhrzeit ─────────

  private heatmap(games: StatsGame[]): HTMLElement {
    const counts = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const g of games) counts[weekday(g.startedAt)][new Date(g.startedAt).getHours()]++;
    let max = 0;
    let best: [number, number] | null = null;
    counts.forEach((row, d) =>
      row.forEach((c, hr) => {
        if (c > max) {
          max = c;
          best = [d, hr];
        }
      }),
    );

    const grid = h('div', { class: 'heat', role: 'img' });
    grid.setAttribute('aria-label', 'Spiele nach Wochentag und Uhrzeit');
    counts.forEach((row, d) => {
      grid.appendChild(h('div', { class: 'heat-day' }, WEEKDAYS[d].slice(0, 2)));
      row.forEach((c, hr) => {
        const cell = h('div', { class: `heat-cell${c ? '' : ' zero'}` });
        if (c) cell.style.background = heatColor(c / max);
        const label = () => [tipRow(plural(c, 'Spiel', 'Spiele'), ''), h('div', { class: 'tip-sub' }, `${WEEKDAYS[d]}, ${hr}–${hr + 1} Uhr`)];
        cell.addEventListener('pointermove', (e) => showTip(e, ...label()));
        cell.addEventListener('pointerleave', hideTip);
        grid.appendChild(cell);
      });
    });
    grid.appendChild(h('div'));
    for (let hr = 0; hr < 24; hr++) grid.appendChild(h('div', { class: 'heat-hour' }, hr % 3 === 0 ? String(hr) : ''));

    const ramp = h('div', { class: 'ramp' }, h('span', null, 'weniger'));
    for (const t of [0.15, 0.36, 0.57, 0.78, 1]) ramp.appendChild(h('i', { style: `background:${heatColor(t)}` }));
    ramp.appendChild(h('span', null, 'mehr'));

    const b = best as [number, number] | null;
    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h(
          'div',
          null,
          h('h2', null, 'Wann gespielt wird'),
          h('p', { class: 'card-sub' }, b ? `Am meisten los: ${WEEKDAYS[b[0]]}s, ${b[1]}–${b[1] + 1} Uhr` : 'Noch keine Daten in diesem Zeitraum.'),
        ),
        ramp,
      ),
      grid,
    );
  }

  // ───────── Aufschlüsselung ─────────

  private breakdown(games: StatsGame[]): HTMLElement {
    const total = games.length;
    const group = (title: string, rows: [string, number, string?][]) =>
      h(
        'div',
        { class: 'bd-group' },
        h('h3', null, title),
        rows.map(([label, n, key]) =>
          h(
            'div',
            { class: 'bd-row' },
            h('span', { class: 'bd-label' }, label),
            h('span', { class: 'bd-track' }, h('span', { class: `bd-fill k-${key ?? 'gold'}`, style: `width:${total ? (n / total) * 100 : 0}%` })),
            h('span', { class: 'bd-val' }, nf.format(n)),
            h('span', { class: 'bd-pct' }, total ? `${Math.round((n / total) * 100)} %` : '–'),
          ),
        ),
      );
    const count = (fn: (g: StatsGame) => boolean) => games.filter(fn).length;
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Spielarten'), h('p', { class: 'card-sub' }, `${plural(total, 'Spiel', 'Spiele')} im Zeitraum`))),
      group(
        'Modus',
        SERIES.map((s) => [s.label, count((g) => g.mode === s.key), s.key]),
      ),
      group(
        'Spiellänge',
        (['full', 'half', 'quick'] as const).map((m) => [LENGTH_LABEL[m], count((g) => g.roundsMode === m)]),
      ),
      group(
        'Spieler am Tisch',
        [3, 4, 5, 6].map((n) => [String(n), count((g) => g.players === n)]),
      ),
    );
  }

  // ───────── Stammgäste ─────────

  private players(games: StatsGame[]): HTMLElement {
    const map = new Map<string, { name: string; games: number; wins: number; last: number }>();
    for (const g of games) {
      for (const name of g.humans) {
        const key = name.toLowerCase();
        const p = map.get(key) ?? { name, games: 0, wins: 0, last: 0 };
        p.games++;
        if (g.winner === name && !g.winnerBot) p.wins++;
        p.last = Math.max(p.last, g.startedAt);
        map.set(key, p);
      }
    }
    const top = [...map.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 8);
    const maxGames = top[0]?.games ?? 1;
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Stammgäste'), h('p', { class: 'card-sub' }, 'Wer am häufigsten am Tisch sitzt'))),
      top.length
        ? h(
            'ol',
            { class: 'regulars' },
            top.map((p, i) =>
              h(
                'li',
                null,
                h('span', { class: `rank${i < 3 ? ` r${i + 1}` : ''}` }, String(i + 1)),
                h(
                  'div',
                  { class: 'reg-main' },
                  h('div', { class: 'reg-name' }, p.name),
                  h('span', { class: 'bd-track' }, h('span', { class: 'bd-fill k-gold', style: `width:${(p.games / maxGames) * 100}%` })),
                ),
                h(
                  'div',
                  { class: 'reg-stats' },
                  h('b', null, plural(p.games, 'Spiel', 'Spiele')),
                  h('span', null, plural(p.wins, 'Sieg', 'Siege')),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Keine Mitspieler in diesem Zeitraum.'),
    );
  }

  // ───────── Tabelle ─────────

  private table(games: StatsGame[], now: number): HTMLElement {
    const rows = games.slice(0, this.tableLimit);
    const more = games.length - rows.length;
    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h('div', null, h('h2', null, 'Letzte Spiele'), h('p', { class: 'card-sub' }, `${plural(games.length, 'Spiel', 'Spiele')} im Zeitraum, neueste zuerst`)),
      ),
      games.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              null,
              h(
                'thead',
                null,
                h('tr', null, ['Beginn', 'Modus', 'Spieler', 'Länge', 'Dauer', 'Sieger', 'Status'].map((t) => h('th', null, t))),
              ),
              h(
                'tbody',
                null,
                rows.map((g) => {
                  const st = statusOf(g, now);
                  const bots = g.players - g.humans.length;
                  return h(
                    'tr',
                    null,
                    h('td', { class: 'nowrap num' }, fmtWhen(g.startedAt, now)),
                    h(
                      'td',
                      { class: 'nowrap' },
                      h('span', { class: 'mode' }, h('i', { class: `sw k-${g.mode}` }), MODE_LABEL[g.mode]),
                      g.room ? h('span', { class: 'room' }, g.room) : null,
                    ),
                    h(
                      'td',
                      { class: 'players' },
                      g.humans.join(', ') || '–',
                      bots > 0 ? h('span', { class: 'muted nowrap' }, ` + ${plural(bots, 'Bot', 'Bots')}`) : null,
                    ),
                    h('td', { class: 'nowrap' }, `${LENGTH_LABEL[g.roundsMode]} `, h('span', { class: 'muted' }, `· ${g.rounds} R.`)),
                    h('td', { class: 'nowrap num' }, g.endedAt ? fmtDuration(g.endedAt - g.startedAt) : '–'),
                    h('td', { class: 'nowrap' }, g.winner ?? '–', g.winner && g.winnerBot ? h('span', { class: 'bot-tag' }, 'Bot') : null),
                    h('td', null, h('span', { class: `status ${st}` }, STATUS_LABEL[st])),
                  );
                }),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Keine Spiele in diesem Zeitraum.'),
      more > 0
        ? h(
            'div',
            { class: 'more' },
            h(
              'button',
              {
                class: 'btn small',
                onclick: () => {
                  this.tableLimit += TABLE_PAGE * 2;
                  this.render();
                },
              },
              `${nf.format(Math.min(more, TABLE_PAGE * 2))} weitere anzeigen`,
            ),
          )
        : null,
    );
  }

  private dangerZone(): HTMLElement {
    const n = this.data.total;
    return h(
      'section',
      { class: 'card danger-zone' },
      h(
        'div',
        null,
        h('h2', null, 'Statistik löschen'),
        h(
          'p',
          { class: 'card-sub' },
          n ? `Entfernt alle ${plural(n, 'gespeicherte Spiel', 'gespeicherten Spiele')} endgültig. Neue Spiele werden danach wieder gezählt.` : 'Es sind keine Spiele gespeichert.',
        ),
      ),
      h('button', { class: 'btn danger', disabled: !n, onclick: () => void this.wipe() }, 'Alle Spiele löschen'),
    );
  }
}

function heatColor(t: number): string {
  // Ein Farbton (Gold), von dunkel zu hell
  return mix('#3a2c4a', '#f3d48a', 0.12 + 0.88 * t);
}

function refreshIcon(): SVGElement {
  return svg(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.6' }),
    svg('path', { d: 'M20.5 3.5v5h-5' }),
  );
}

function exitIcon(): SVGElement {
  return svg(
    'svg',
    { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: 'M9.5 20.5h-3a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3M15.5 16.5 20 12l-4.5-4.5M20 12H9.5' }),
  );
}

// ───────────────────────── Säulendiagramm ─────────────────────────

function drawColumns(el: HTMLElement, buckets: Bucket[], unit: 'day' | 'week'): void {
  const W = Math.max(260, el.clientWidth);
  const H = 230;
  const m = { l: 34, r: 4, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxV = Math.max(0, ...buckets.map((b) => b.online + b.solo));
  const { top, step } = niceScale(maxV);
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const band = iw / buckets.length;
  const bw = Math.max(2, Math.min(24, band * 0.66));

  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const grid = svg('g', { class: 'grid' });
  for (let v = 0; v <= top; v += step) {
    grid.append(
      svg('line', { x1: m.l, x2: W - m.r, y1: y(v) + 0.5, y2: y(v) + 0.5, class: v === 0 ? 'base' : '' }),
      svg('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, nf.format(v)),
    );
  }
  root.append(grid);

  const hover = svg('rect', { class: 'band-hover', y: m.t, height: ih, width: band, x: -999, rx: 6 });
  root.append(hover);

  // Achsenbeschriftung: nur so viele, dass sie sich nicht überlappen (vom heutigen Tag aus gezählt)
  const every = Math.max(1, Math.ceil(46 / band));
  const marks = svg('g', { class: 'marks' });
  const labels = svg('g', { class: 'xlabels' });
  const hits = svg('g', {});
  const n = buckets.length;

  buckets.forEach((b, i) => {
    const x = m.l + band * i + (band - bw) / 2;
    const total = b.online + b.solo;
    let base = y(0);
    const segs = SERIES.map((s) => ({ key: s.key, v: b[s.key] })).filter((s) => s.v > 0);
    segs.forEach((s, si) => {
      const full = (s.v / top) * ih;
      const gap = si > 0 ? 2 : 0;
      const hgt = Math.max(1.5, full - gap);
      const yTop = base - gap - hgt;
      const last = si === segs.length - 1;
      marks.append(
        last
          ? svg('path', { d: roundedTop(x, yTop, bw, hgt, 4), class: `k-${s.key}` })
          : svg('rect', { x, y: yTop, width: bw, height: hgt, class: `k-${s.key}` }),
      );
      base = yTop;
    });

    if ((n - 1 - i) % every === 0) {
      labels.append(svg('text', { x: m.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle' }, fmtAxisDay.format(b.start)));
    }

    const hit = svg('rect', { x: m.l + band * i, y: m.t, width: band, height: ih + m.b, class: 'hit' });
    hit.addEventListener('pointermove', (e) => {
      hover.setAttribute('x', String(m.l + band * i));
      const title = unit === 'week' ? `Woche ab ${fmtWeek.format(b.start)}` : fmtLongDay.format(b.start);
      showTip(
        e as PointerEvent,
        h('div', { class: 'tip-title' }, title),
        tipRow(plural(total, 'Spiel', 'Spiele'), ''),
        ...SERIES.map((s) => tipRow(nf.format(b[s.key]), s.label, s.key)),
      );
    });
    hit.addEventListener('pointerleave', () => {
      hover.setAttribute('x', '-999');
      hideTip();
    });
    hits.append(hit);
  });

  root.append(marks, labels, hits);
  el.replaceChildren(root);
}

// ───────────────────────── Start ─────────────────────────

async function boot(): Promise<void> {
  const pw = load(PW_KEY);
  if (!pw) return showLogin();
  try {
    new Dashboard(pw, await api<StatsResponse>('GET', pw));
  } catch (err) {
    if (err instanceof ApiError && err.code === 'no_password') return showLogin('', true);
    if (err instanceof ApiError && err.status === 401) store(PW_KEY, null);
    showLogin(err instanceof ApiError && err.status === 401 ? '' : 'Server nicht erreichbar.');
  }
}

void boot();
