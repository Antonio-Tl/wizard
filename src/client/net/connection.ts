import { RoomCore, type RoomData, createRoomData } from '../../shared/room';
import type { ClientMsg, Difficulty, GameOptions, ServerMsg } from '../../shared/types';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface Connection {
  readonly kind: 'local' | 'remote';
  onMessage: (msg: ServerMsg) => void;
  onStatus: (s: ConnStatus) => void;
  send(msg: ClientMsg): void;
  close(): void;
}

const SAVE_KEY = 'wizard.localGame';

export function hasSavedLocalGame(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw) as RoomData;
    return !!d.game && d.game.phase !== 'gameEnd';
  } catch {
    return false;
  }
}

export function clearSavedLocalGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignorieren */
  }
}

/** Einzelspieler: Der komplette Raum läuft im Browser. */
export class LocalConnection implements Connection {
  readonly kind = 'local';
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};
  private core: RoomCore;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly token = 'local-player';

  constructor(opts: { name: string; avatar: number; bots: Difficulty[]; options: GameOptions } | { resume: true; name: string; avatar: number }) {
    let data: RoomData | null = null;
    if ('resume' in opts) {
      try {
        data = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as RoomData | null;
      } catch {
        data = null;
      }
    }
    const fresh = !data;
    data ??= createRoomData(null, 'options' in opts ? opts.options : undefined);
    this.core = new RoomCore(data, {
      now: () => Date.now(),
      send: (_token, msg) => {
        if (this.closed) return;
        queueMicrotask(() => !this.closed && this.onMessage(msg));
        this.save();
      },
      schedule: (at) => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (at === null || this.closed) return;
        this.timer = setTimeout(() => {
          this.timer = null;
          this.core.tick();
        }, Math.max(0, at - Date.now()));
      },
    });
    queueMicrotask(() => {
      this.onStatus('open');
      if (fresh && 'bots' in opts) {
        this.core.join(this.token, opts.name, opts.avatar);
        for (const b of opts.bots) this.core.addBot(b);
        this.core.startNow();
      } else {
        // Wiederaufnahme: Zeitstempel auffrischen, damit Bots nicht sofort losrennen
        this.core.data.readyAt = Date.now() + 800;
        if (this.core.data.roundEndAt) this.core.data.roundEndAt = Date.now();
        this.core.join(this.token, opts.name, opts.avatar);
      }
    });
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    this.core.handle(this.token, msg);
  }

  /** Nur für die Entwicklung: direkt zu einer bestimmten Runde springen. */
  devStartRound(round: number): void {
    const g = this.core.data.game;
    if (!g) return;
    g.round = Math.max(0, Math.min(g.totalRounds, round) - 1);
    g.phase = 'roundEnd';
    this.core.data.roundEndAt = Date.now() - 60000;
    this.core.data.readyAt = 0;
    this.core.tick();
  }

  private save(): void {
    try {
      if (this.core.data.game && this.core.data.game.phase !== 'gameEnd') localStorage.setItem(SAVE_KEY, JSON.stringify(this.core.data));
      else localStorage.removeItem(SAVE_KEY);
    } catch {
      /* Speicher voll oder gesperrt */
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Multiplayer über WebSocket zum Durable Object. */
export class RemoteConnection implements Connection {
  readonly kind = 'remote';
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (s: ConnStatus) => void = () => {};
  private ws: WebSocket | null = null;
  private closed = false;
  private attempts = 0;
  private queue: ClientMsg[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private fatal = false;

  constructor(
    readonly code: string,
    private join: () => ClientMsg,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    this.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${this.code}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      ws.send(JSON.stringify(this.join()));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.onStatus('open');
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'error' && ['not_found', 'game_running', 'room_full', 'kicked'].includes(msg.code)) this.fatal = true;
      this.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.closed || this.fatal || e.code === 4000 || e.code === 4004) {
        this.onStatus('closed');
        return;
      }
      this.attempts++;
      this.onStatus('reconnecting');
      setTimeout(() => this.connect(), Math.min(8000, 400 * 2 ** Math.min(this.attempts, 5)));
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping') this.queue.push(msg);
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000);
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) throw new Error('Raum konnte nicht erstellt werden.');
  const data = (await res.json()) as { code: string };
  return data.code;
}

export async function roomExists(code: string): Promise<{ exists: boolean; running?: boolean; players?: number }> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return { exists: false };
  return (await res.json()) as { exists: boolean; running?: boolean; players?: number };
}
