import { botBid, botPlay, botTrump } from './bot';
import { type Suit } from './cards';
import { MAX_PLAYERS, MIN_PLAYERS, RuleError, doBid, doPlay, doTrump, forbiddenBid, newGame, startRound } from './rules';
import {
  type ClientMsg,
  DEFAULT_OPTIONS,
  type Difficulty,
  type GameEvent,
  type GameOptions,
  type GameState,
  type PlayerPublic,
  type ServerMsg,
  type StatsEvent,
  type View,
} from './types';

/**
 * Transportunabhängiger Spielraum. Wird im Browser (Einzelspieler) und im
 * Cloudflare Durable Object (Multiplayer) identisch verwendet.
 */

export interface RoomPlayer {
  token: string;
  name: string;
  bot: Difficulty | null;
  connected: boolean;
  ready: boolean;
  avatar: number;
  replaced: boolean;
  /** Zeitpunkt der Trennung (für automatisches Weiterspielen) */
  disconnectedAt: number | null;
  /** Zeitpunkte der letzten Chatnachrichten (Spamschutz) */
  chatTimes?: number[];
  lastChat?: string;
}

export interface RoomData {
  code: string | null;
  hostToken: string | null;
  /** Ersteller des Raums – bekommt nach einem Reload den Host zurück */
  creatorToken?: string | null;
  players: RoomPlayer[];
  options: GameOptions;
  game: GameState | null;
  /** Wann die aktuelle Aktion frühestens erfolgen darf (Bot-Bedenkzeit, Animationen) */
  readyAt: number;
  roundEndAt: number | null;
  lastActive: number;
  /** Kennung des laufenden Spiels für die Statistik */
  statsId?: string | null;
}

export interface RoomHooks {
  send(token: string, msg: ServerMsg): void;
  now(): number;
  /** Wunsch, `tick()` zum Zeitpunkt `at` aufzurufen (null = kein Termin nötig) */
  schedule(at: number | null): void;
  /** Spielbeginn und -ende für die Admin-Statistik */
  stats?(ev: StatsEvent): void;
}

const BOT_NAMES = [
  'Merlin',
  'Morgana',
  'Balthasar',
  'Elara',
  'Grimbart',
  'Ysolde',
  'Kasimir',
  'Sigrun',
  'Alarich',
  'Lysander',
  'Brunhild',
  'Corvin',
];

const AUTO_PLAY_AFTER_DISCONNECT = 15000;
/** Spamschutz: Mindestabstand zwischen Nachrichten und max. Anzahl pro Zeitfenster */
export const CHAT_MIN_GAP = 1500;
const CHAT_WINDOW = 10000;
const CHAT_MAX_IN_WINDOW = 4;
const CHAT_DUPLICATE_WINDOW = 6000;
const AUTO_NEXT_ROUND = 30000;

export function createRoomData(code: string | null, options: GameOptions = DEFAULT_OPTIONS): RoomData {
  return {
    code,
    hostToken: null,
    players: [],
    options: { ...options },
    game: null,
    readyAt: 0,
    roundEndAt: null,
    lastActive: Date.now(),
  };
}

export function sanitizeName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) : '';
  return s || 'Spieler';
}

export class RoomCore {
  constructor(
    public data: RoomData,
    private hooks: RoomHooks,
  ) {}

  // ───────────────────────── Verbindung ─────────────────────────

  join(token: string, name: string, avatar: number): boolean {
    const d = this.data;
    d.lastActive = this.hooks.now();
    let p = d.players.find((x) => x.token === token);
    if (p) {
      p.connected = true;
      p.disconnectedAt = null;
      if (!d.game) {
        p.name = this.uniqueName(sanitizeName(name), p);
        p.avatar = clampAvatar(avatar);
      }
    } else {
      if (d.game) {
        this.hooks.send(token, { t: 'error', code: 'game_running', message: 'In diesem Raum läuft bereits ein Spiel.' });
        return false;
      }
      if (d.players.length >= MAX_PLAYERS) {
        this.hooks.send(token, { t: 'error', code: 'room_full', message: 'Der Raum ist voll (max. 6 Spieler).' });
        return false;
      }
      p = {
        token,
        name: this.uniqueName(sanitizeName(name)),
        bot: null,
        connected: true,
        ready: false,
        avatar: clampAvatar(avatar),
        replaced: false,
        disconnectedAt: null,
      };
      d.players.push(p);
    }
    d.creatorToken ??= token;
    if (!d.hostToken || !this.isConnectedHuman(d.hostToken) || (!d.game && token === d.creatorToken)) d.hostToken = token;
    this.broadcast([], token);
    return true;
  }

  disconnect(token: string): void {
    const d = this.data;
    const p = d.players.find((x) => x.token === token);
    if (!p || p.bot) return;
    p.connected = false;
    p.disconnectedAt = this.hooks.now();
    if (d.hostToken === token) {
      const next = d.players.find((x) => !x.bot && x.connected);
      if (next) d.hostToken = next.token;
    }
    this.broadcast([]);
  }

  // ───────────────────────── Nachrichten ─────────────────────────

  handle(token: string, msg: ClientMsg): void {
    const d = this.data;
    const seat = d.players.findIndex((x) => x.token === token);
    if (seat < 0) return;
    d.lastActive = this.hooks.now();
    const isHost = d.hostToken === token;
    try {
      switch (msg.t) {
        case 'ping':
          this.hooks.send(token, { t: 'pong' });
          return;
        case 'chat': {
          const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
          if (!text) return;
          const sender = d.players[seat];
          const now = this.hooks.now();
          const times = (sender.chatTimes ?? []).filter((t) => now - t < CHAT_WINDOW);
          const last = times[times.length - 1] ?? 0;
          let wait = 0;
          if (now - last < CHAT_MIN_GAP) wait = CHAT_MIN_GAP - (now - last);
          if (times.length >= CHAT_MAX_IN_WINDOW) wait = Math.max(wait, CHAT_WINDOW - (now - times[0]));
          if (text === sender.lastChat && now - last < CHAT_DUPLICATE_WINDOW) wait = Math.max(wait, CHAT_DUPLICATE_WINDOW - (now - last));
          sender.chatTimes = times;
          if (wait > 0) {
            const secs = Math.ceil(wait / 1000);
            this.hooks.send(token, {
              t: 'error',
              code: 'chat_rate',
              message: `Nicht so schnell – du kannst in ${secs} s wieder schreiben.`,
              retryIn: wait,
            });
            return;
          }
          times.push(now);
          sender.lastChat = text;
          for (const p of d.players) if (!p.bot) this.hooks.send(p.token, { t: 'chat', seat, name: sender.name, text });
          return;
        }
        case 'options':
          if (!isHost || d.game) return;
          d.options = sanitizeOptions(msg.options);
          this.broadcast([]);
          return;
        case 'addBot': {
          if (!isHost || d.game || d.players.length >= MAX_PLAYERS) return;
          const diff: Difficulty = ['easy', 'medium', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'medium';
          this.addBot(diff);
          this.broadcast([]);
          return;
        }
        case 'kick': {
          if (!isHost || d.game) return;
          const target = d.players[msg.seat];
          if (!target || target.token === token) return;
          d.players.splice(msg.seat, 1);
          if (!target.bot) this.hooks.send(target.token, { t: 'error', code: 'kicked', message: 'Du wurdest aus dem Raum entfernt.' });
          this.broadcast([]);
          return;
        }
        case 'start':
          if (!isHost || d.game) return;
          this.startGame();
          return;
        case 'leave':
          this.leave(token);
          return;
        case 'toLobby':
          if (!isHost || !d.game || d.game.phase !== 'gameEnd') return;
          this.backToLobby();
          return;
        case 'ready':
          if (!d.game || d.game.phase !== 'roundEnd') return;
          d.players[seat].ready = true;
          this.broadcast([]);
          return;
        case 'bid':
          if (!d.game) return;
          this.apply(doBid(d.game, seat, Number(msg.bid)));
          return;
        case 'trump':
          if (!d.game) return;
          this.apply(doTrump(d.game, seat, Number(msg.suit) as Suit));
          return;
        case 'play':
          if (!d.game) return;
          this.apply(doPlay(d.game, seat, Number(msg.card)));
          return;
      }
    } catch (err) {
      if (err instanceof RuleError) {
        this.hooks.send(token, { t: 'error', code: 'rule', message: err.message });
        // Zustand neu senden, damit der Client sicher synchron ist
        this.hooks.send(token, { t: 'state', view: this.viewFor(seat), events: [] });
      } else throw err;
    }
  }

  /** Vom Host-System aufgerufen, wenn der geplante Zeitpunkt erreicht ist. */
  tick(): void {
    const d = this.data;
    const g = d.game;
    if (!g) return this.reschedule();
    const now = this.hooks.now();
    const due = this.nextActionAt();
    if (due === null || due > now + 30) return this.reschedule();

    if (g.phase === 'roundEnd') {
      this.nextRound();
      return;
    }
    if (g.phase === 'gameEnd') return this.reschedule();
    const actor = g.turn;
    const p = d.players[actor];
    const diff: Difficulty = p.bot ?? 'medium';
    if (g.phase === 'trump') this.apply(doTrump(g, actor, botTrump(g, actor)));
    else if (g.phase === 'bidding') this.apply(doBid(g, actor, botBid(g, actor, diff)));
    else if (g.phase === 'playing') this.apply(doPlay(g, actor, botPlay(g, actor, diff)));
  }

  // ───────────────────────── Spielablauf ─────────────────────────

  private startGame(): void {
    const d = this.data;
    d.players = d.players.filter((p) => p.bot || p.connected);
    if (d.players.length < MIN_PLAYERS) {
      const host = d.hostToken!;
      this.hooks.send(host, { t: 'error', code: 'too_few', message: 'Mindestens 3 Spieler nötig – füge Bots hinzu.' });
      this.broadcast([]);
      return;
    }
    for (const p of d.players) {
      p.ready = false;
      p.replaced = false;
    }
    const n = d.players.length;
    d.game = newGame(n, d.options, Math.floor(Math.random() * n));
    d.statsId = randomId();
    this.hooks.stats?.({
      type: 'start',
      id: d.statsId,
      mode: d.code ? 'online' : 'solo',
      players: n,
      humans: d.players.filter((p) => !p.bot).map((p) => p.name),
      rounds: d.game.totalRounds,
      roundsMode: d.options.roundsMode,
      room: d.code,
    });
    const events = startRound(d.game);
    this.apply(events);
  }

  private reportEnd(ranking: number[]): void {
    const d = this.data;
    const winner = d.players[ranking[0]];
    if (!d.statsId || !winner) return;
    this.hooks.stats?.({
      type: 'end',
      id: d.statsId,
      mode: d.code ? 'online' : 'solo',
      winner: winner.name,
      winnerBot: !!winner.bot && !winner.replaced,
    });
    d.statsId = null;
  }

  private nextRound(): void {
    const g = this.data.game!;
    for (const p of this.data.players) p.ready = false;
    this.data.roundEndAt = null;
    this.apply(startRound(g));
  }

  private backToLobby(): void {
    const d = this.data;
    d.game = null;
    d.players = d.players.filter((p) => !p.replaced && (p.bot || p.connected));
    for (const p of d.players) p.ready = false;
    d.roundEndAt = null;
    this.broadcast([]);
  }

  private leave(token: string): void {
    const d = this.data;
    const idx = d.players.findIndex((p) => p.token === token);
    if (idx < 0) return;
    const p = d.players[idx];
    const events: GameEvent[] = [];
    if (!d.game) {
      d.players.splice(idx, 1);
    } else {
      p.bot = 'medium';
      p.replaced = true;
      p.connected = false;
      events.push({ e: 'info', text: `${p.name} hat das Spiel verlassen – ein Bot übernimmt.` });
    }
    if (d.hostToken === token) {
      const next = d.players.find((x) => !x.bot && x.connected);
      d.hostToken = next ? next.token : null;
    }
    this.broadcast(events);
  }

  private apply(events: GameEvent[]): void {
    const g = this.data.game;
    const now = this.hooks.now();
    let delay = 650 + Math.random() * 650;
    for (const ev of events) {
      if (ev.e === 'roundStart') delay += 1600 + ev.handSize * this.data.players.length * 70;
      if (ev.e === 'trump') delay += 900;
      if (ev.e === 'trickWon') delay += 1500;
      if (ev.e === 'roundEnd') this.data.roundEndAt = now;
      if (ev.e === 'gameEnd') this.reportEnd(ev.ranking);
    }
    this.data.readyAt = now + delay;
    if (g && g.phase !== 'roundEnd' && g.phase !== 'gameEnd') {
      // Spieler, die geboten haben, sind nicht mehr "bereit" für die nächste Runde
      for (const p of this.data.players) p.ready = false;
    }
    this.broadcast(events);
  }

  private nextActionAt(): number | null {
    const d = this.data;
    const g = d.game;
    if (!g) return null;
    const humansOnline = d.players.some((p) => !p.bot && p.connected);
    if (!humansOnline) return null;
    if (g.phase === 'gameEnd') return null;
    if (g.phase === 'roundEnd') {
      const humans = d.players.filter((p) => !p.bot && p.connected);
      const start = d.roundEndAt ?? this.hooks.now();
      if (humans.every((p) => p.ready)) return Math.max(d.readyAt, start + 800);
      return start + AUTO_NEXT_ROUND;
    }
    const p = d.players[g.turn];
    if (p.bot) return d.readyAt;
    if (!p.connected) return Math.max(d.readyAt, (p.disconnectedAt ?? this.hooks.now()) + AUTO_PLAY_AFTER_DISCONNECT);
    return null;
  }

  private reschedule(): void {
    this.hooks.schedule(this.nextActionAt());
  }

  // ───────────────────────── Ansichten ─────────────────────────

  private broadcast(events: GameEvent[], fullFor?: string): void {
    const d = this.data;
    d.players.forEach((p, seat) => {
      if (p.bot || !p.connected) return;
      this.hooks.send(p.token, { t: 'state', view: this.viewFor(seat), events, full: p.token === fullFor || undefined });
    });
    this.reschedule();
  }

  viewFor(seat: number): View {
    const d = this.data;
    const g = d.game;
    const players: PlayerPublic[] = d.players.map((p, i) => ({
      name: p.name,
      bot: p.bot,
      connected: p.bot ? true : p.connected,
      avatar: p.avatar,
      isHost: p.token === d.hostToken,
      ready: p.ready,
      replaced: p.replaced,
      bid: g ? (g.bids[i] ?? null) : null,
      tricks: g ? (g.tricks[i] ?? 0) : 0,
      score: g ? g.scores[i] : 0,
      handCount: g ? (g.hands[i]?.length ?? 0) : 0,
    }));
    const last = g && g.roundTricks.length > 0 ? g.roundTricks[g.roundTricks.length - 1].cards : null;
    let autoNextIn: number | null = null;
    if (g && g.phase === 'roundEnd' && d.roundEndAt) {
      autoNextIn = Math.max(0, Math.round((d.roundEndAt + AUTO_NEXT_ROUND - this.hooks.now()) / 1000));
    }
    return {
      room: d.code,
      you: seat,
      phase: g ? g.phase : 'lobby',
      options: d.options,
      players,
      round: g?.round ?? 0,
      totalRounds: g?.totalRounds ?? 0,
      dealer: g?.dealer ?? -1,
      turn: g?.turn ?? -1,
      leader: g?.leader ?? -1,
      trumpCard: g?.trumpCard ?? null,
      trumpSuit: g?.trumpSuit ?? null,
      hand: g ? (g.hands[seat] ?? []).slice() : [],
      trick: g ? g.trick.slice() : [],
      lastTrick: last,
      history: g ? g.history : [],
      forbiddenBid: g && g.turn === seat ? forbiddenBid(g) : null,
      deckCount: g ? g.deck.length : 0,
      autoNextIn,
    };
  }

  // ───────────────────────── Hilfen ─────────────────────────

  addBot(diff: Difficulty): void {
    const d = this.data;
    const used = new Set(d.players.map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : `Bot ${d.players.length + 1}`;
    const usedAvatars = new Set(d.players.map((p) => p.avatar));
    let avatar = Math.floor(Math.random() * 12);
    for (let i = 0; i < 12 && usedAvatars.has(avatar); i++) avatar = (avatar + 1) % 12;
    d.players.push({
      token: `bot-${Math.random().toString(36).slice(2, 10)}`,
      name,
      bot: diff,
      connected: true,
      ready: true,
      avatar,
      replaced: false,
      disconnectedAt: null,
    });
  }

  /** Startet direkt ein Spiel (Einzelspieler). */
  startNow(): void {
    this.startGame();
  }

  hasConnectedHumans(): boolean {
    return this.data.players.some((p) => !p.bot && p.connected);
  }

  private isConnectedHuman(token: string): boolean {
    return this.data.players.some((p) => p.token === token && !p.bot && p.connected);
  }

  private uniqueName(name: string, self?: RoomPlayer): string {
    const taken = new Set(this.data.players.filter((p) => p !== self).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 20; i++) {
      const n = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function clampAvatar(a: unknown): number {
  const n = Math.floor(Number(a));
  return Number.isFinite(n) && n >= 0 && n < 12 ? n : 0;
}

export function sanitizeOptions(o: Partial<GameOptions> | undefined): GameOptions {
  return {
    bidRule: o?.bidRule === 'notEqual' ? 'notEqual' : 'free',
    roundsMode: o?.roundsMode === 'half' || o?.roundsMode === 'quick' ? o.roundsMode : 'full',
  };
}
