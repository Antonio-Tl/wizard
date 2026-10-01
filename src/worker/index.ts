import { DurableObject } from 'cloudflare:workers';
import { RoomCore, type RoomData, createRoomData } from '../shared/room';
import type { ClientMsg, ServerMsg } from '../shared/types';

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
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
  }
}
