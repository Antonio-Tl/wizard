import { DurableObject } from 'cloudflare:workers';
import { RoomCore, type RoomData, createRoomData, sanitizeName, sanitizeOptions } from '../shared/room';
import { MAX_PLAYERS, MIN_PLAYERS, totalRoundsFor } from '../shared/rules';
import type { ClientMsg, GameMode, ServerMsg, StatsEvent, StatsGame, StatsResponse } from '../shared/types';

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  STATS: DurableObjectNamespace<GameStats>;
  ASSETS: Fetcher;
  /** Passwort für die Admin-Seite /admin (online per `wrangler secret put`, lokal in .dev.vars) */
  ADMIN_PASSWORD?: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
/** Leere Räume werden nach dieser Zeit ohne Aktivität gelöscht */
const IDLE_CLEANUP_MS = 2 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Es gibt genau ein Statistik-Objekt für alle Spiele. */
function statsStub(env: Env): DurableObjectStub<GameStats> {
  return env.STATS.get(env.STATS.idFromName('global'));
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Einzelspieler-Spiele laufen im Browser und melden sich selbst. Die Angaben werden
 * deshalb streng geprüft und dürfen nur Einzelspieler-Einträge anlegen oder beenden.
 */
function parseSoloStats(raw: unknown): StatsEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[0-9a-f]{24}$/.test(o.id)) return null;
  if (o.type === 'start') {
    const players = Number(o.players);
    if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) return null;
    const { roundsMode } = sanitizeOptions({ roundsMode: o.roundsMode as never });
    const humans = Array.isArray(o.humans) ? o.humans.slice(0, 1).map(sanitizeName) : [];
    return { type: 'start', id: o.id, mode: 'solo', players, humans, rounds: totalRoundsFor(players, roundsMode), roundsMode, room: null };
  }
  if (o.type === 'end') return { type: 'end', id: o.id, mode: 'solo', winner: sanitizeName(o.winner), winnerBot: o.winnerBot === true };
  return null;
}

/** Prüft das Admin-Passwort aus dem Authorization-Header. Gibt bei Erfolg null zurück. */
async function checkAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.ADMIN_PASSWORD) return json({ error: 'no_password' }, 503);
  let given = '';
  try {
    given = decodeURIComponent(request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '');
  } catch {
    given = '';
  }
  if (given && (await sameSecret(given, env.ADMIN_PASSWORD))) return null;
  // kleine Bremse gegen Durchprobieren
  await new Promise((r) => setTimeout(r, 700));
  return json({ error: 'unauthorized' }, 401);
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await stub.create(code)) return json({ code });
      }
      return json({ error: 'Kein freier Raumcode gefunden.' }, 503);
    }

    const roomInfo = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{5})$/);
    if (roomInfo && request.method === 'GET') {
      const code = roomInfo[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ exists: false });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return json(await stub.info());
    }

    const ws = url.pathname.match(/^\/ws\/([A-Za-z0-9]{5})$/);
    if (ws) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket erwartet', { status: 426 });
      }
      const code = ws[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('Ungültiger Raumcode', { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname === '/api/stats' && request.method === 'POST') {
      const ev = parseSoloStats(await readJson(request));
      if (ev) await statsStub(env).record(ev);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/api/admin/stats') {
      const denied = await checkAdmin(request, env);
      if (denied) return denied;
      if (request.method === 'GET') return json(await statsStub(env).list());
      if (request.method === 'DELETE') return json({ deleted: await statsStub(env).clear() });
      return json({ error: 'Methode nicht erlaubt' }, 405);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'Nicht gefunden' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface SocketAttachment {
  token: string | null;
}

/**
 * Ein Spielraum. Nutzt die WebSocket-Hibernation-API: Der Zustand wird nach jeder
 * Änderung gespeichert, Bot-Züge laufen über Alarme. So kostet ein ruhender Raum nichts.
 */
export class GameRoom extends DurableObject<Env> {
  private data: RoomData | null = null;
  private core: RoomCore | null = null;
  private pendingStats: StatsEvent[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<RoomData>('room')) ?? null;
      if (this.data) this.core = this.makeCore(this.data);
    });
  }

  private makeCore(data: RoomData): RoomCore {
    return new RoomCore(data, {
      now: () => Date.now(),
      send: (token, msg) => this.sendTo(token, msg),
      schedule: (at) => this.scheduleAt(at),
      stats: (ev) => this.pendingStats.push(ev),
    });
  }

  async create(code: string): Promise<boolean> {
    if (this.data) return false;
    this.data = createRoomData(code);
    this.core = this.makeCore(this.data);
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
    return true;
  }

  async info(): Promise<{ exists: boolean; players?: number; running?: boolean }> {
    if (!this.data) return { exists: false };
    return { exists: true, players: this.data.players.length, running: !!this.data.game };
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: null } satisfies SocketAttachment);
    if (!this.core) {
      server.send(JSON.stringify({ t: 'error', code: 'not_found', message: 'Diesen Raum gibt es nicht (mehr).' } satisfies ServerMsg));
      server.close(4004, 'not found');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.core || typeof raw !== 'string' || raw.length > 4000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    const att = (ws.deserializeAttachment() ?? { token: null }) as SocketAttachment;
    if (msg.t === 'join') {
      const token = String(msg.token ?? '').slice(0, 64);
      if (token.length < 8 || token.startsWith('bot-')) return;
      // ältere Verbindungen desselben Spielers schließen (z. B. zweiter Tab)
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const a = other.deserializeAttachment() as SocketAttachment | null;
        if (a?.token === token) {
          other.serializeAttachment({ token: null } satisfies SocketAttachment);
          other.close(4000, 'replaced');
        }
      }
      ws.serializeAttachment({ token } satisfies SocketAttachment);
      if (!this.core.join(token, String(msg.name ?? ''), Number(msg.avatar ?? 0))) {
        ws.serializeAttachment({ token: null } satisfies SocketAttachment);
      }
    } else if (att.token) {
      this.core.handle(att.token, msg);
      if (msg.t === 'leave') {
        ws.serializeAttachment({ token: null } satisfies SocketAttachment);
        ws.close(1000, 'left');
      }
    }
    await this.save();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!this.core || !att?.token) return;
    const token = att.token;
    const stillOpen = this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() as SocketAttachment | null)?.token === token);
    if (!stillOpen) {
      this.core.disconnect(token);
      await this.save();
    }
  }

  async alarm(): Promise<void> {
    if (!this.core || !this.data) return;
    const now = Date.now();
    const idle = !this.core.hasConnectedHumans() && now - this.data.lastActive > IDLE_CLEANUP_MS - 1000;
    if (idle) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'room closed');
      await this.ctx.storage.deleteAll();
      this.data = null;
      this.core = null;
      return;
    }
    try {
      this.core.tick();
    } catch (err) {
      console.error('tick failed', err);
    }
    await this.save();
  }

  private sendTo(token: string, msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as SocketAttachment | null;
      if (a?.token === token) {
        try {
          ws.send(payload);
        } catch {
          /* Socket bereits geschlossen */
        }
      }
    }
  }

  private pendingAlarm: number | null | undefined;

  private scheduleAt(at: number | null): void {
    // Ohne Termin trotzdem einen Aufräum-Alarm setzen
    this.pendingAlarm = at ?? Date.now() + IDLE_CLEANUP_MS;
  }

  private async save(): Promise<void> {
    if (!this.data) return;
    await this.ctx.storage.put('room', this.data);
    if (this.pendingAlarm !== undefined) {
      const at = this.pendingAlarm;
      this.pendingAlarm = undefined;
      if (at !== null) await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 10));
    }
    for (const ev of this.pendingStats.splice(0)) {
      try {
        await statsStub(this.env).record(ev);
      } catch (err) {
        console.error('stats failed', err);
      }
    }
  }
}

/** Höchstens so viele Spiele werden aufbewahrt, die ältesten fallen heraus. */
const MAX_STORED_GAMES = 50_000;
/** So viele Spiele bekommt die Admin-Seite höchstens auf einmal. */
const LIST_LIMIT = 20_000;

type GameRow = {
  id: string;
  mode: string;
  started_at: number;
  ended_at: number | null;
  players: number;
  humans: string;
  rounds: number;
  rounds_mode: string;
  room: string | null;
  winner: string | null;
  winner_bot: number;
};

/**
 * Statistik für die Admin-Seite: ein einziges Objekt mit einer SQLite-Tabelle
 * aller gestarteten Spiele (online und gegen Bots).
 */
export class GameStats extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      players INTEGER NOT NULL,
      humans TEXT NOT NULL,
      rounds INTEGER NOT NULL,
      rounds_mode TEXT NOT NULL,
      room TEXT,
      winner TEXT,
      winner_bot INTEGER NOT NULL DEFAULT 0
    )`);
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS games_started ON games (started_at)');
  }

  async record(ev: StatsEvent): Promise<void> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    if (ev.type === 'start') {
      sql.exec(
        'INSERT OR IGNORE INTO games (id, mode, started_at, players, humans, rounds, rounds_mode, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ev.id,
        ev.mode,
        now,
        ev.players,
        JSON.stringify(ev.humans),
        ev.rounds,
        ev.roundsMode,
        ev.room,
      );
      sql.exec(
        'DELETE FROM games WHERE started_at < (SELECT started_at FROM games ORDER BY started_at DESC LIMIT 1 OFFSET ?)',
        MAX_STORED_GAMES - 1,
      );
    } else {
      sql.exec(
        'UPDATE games SET ended_at = ?, winner = ?, winner_bot = ? WHERE id = ? AND mode = ? AND ended_at IS NULL',
        now,
        ev.winner,
        ev.winnerBot ? 1 : 0,
        ev.id,
        ev.mode,
      );
    }
  }

  async list(): Promise<StatsResponse> {
    const sql = this.ctx.storage.sql;
    const total = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM games').one().n;
    const games = sql
      .exec<GameRow>('SELECT * FROM games ORDER BY started_at DESC LIMIT ?', LIST_LIMIT)
      .toArray()
      .map(
        (r): StatsGame => ({
          id: r.id,
          mode: r.mode as GameMode,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          players: r.players,
          humans: JSON.parse(r.humans) as string[],
          rounds: r.rounds,
          roundsMode: sanitizeOptions({ roundsMode: r.rounds_mode as never }).roundsMode,
          room: r.room,
          winner: r.winner,
          winnerBot: r.winner_bot === 1,
        }),
      );
    return { total, games, now: Date.now() };
  }

  async clear(): Promise<number> {
    const sql = this.ctx.storage.sql;
    const n = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM games').one().n;
    sql.exec('DELETE FROM games');
    return n;
  }
}
