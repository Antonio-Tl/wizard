import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-900.css';
import '@fontsource/cinzel-decorative/latin-700.css';
import '@fontsource/cinzel-decorative/latin-900.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './ui/styles.css';

import { CHAT_MIN_GAP } from '../shared/room';
import type { GameEvent, ServerMsg, View } from '../shared/types';
import { sfx } from './audio';
import {
  type Connection,
  LocalConnection,
  RemoteConnection,
  clearSavedLocalGame,
  createRoom,
  hasSavedLocalGame,
  roomExists,
} from './net/connection';
import { loadSettings, saveSettings } from './settings';
import { Stage } from './three/stage';
import { TableView } from './three/tableView';
import { ensureFonts } from './three/textures';
import { h, toast } from './ui/dom';
import { Hud } from './ui/hud';
import {
  type SingleConfig,
  clearScreens,
  openRules,
  openSettings,
  openSingleSetup,
  renderLobby,
  showMenu,
  updateLobbyChat,
} from './ui/screens';

class App {
  private settings = loadSettings();
  private stage!: Stage;
  private table!: TableView;
  private hud!: Hud;
  private conn: Connection | null = null;
  private view: View | null = null;
  private queue: ServerMsg[] = [];
  private processing = false;
  private mode: 'menu' | 'lobby' | 'game' = 'menu';
  private lastSingle: SingleConfig | null = null;
  private connPill: HTMLElement | null = null;
  private generation = 0;

  async init(): Promise<void> {
    if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = this;
    await ensureFonts();
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.stage = new Stage(canvas, this.settings.quality);
    this.table = new TableView(this.stage);
    this.table.onPlay = (card) => this.conn?.send({ t: 'play', card });
    this.table.onIllegal = () => toast('Du musst die ausgespielte Farbe bedienen!', 'err');
    this.hud = new Hud(this.table, {
      send: (m) => this.conn?.send(m),
      chat: (text) => this.sendChat(text),
      leave: () => this.leave(),
      again: () => this.again(),
      openSettings: () => this.openSettings(),
      toggleSound: () => {
        this.settings.sound = !this.settings.sound;
        this.applySettings();
        return this.settings.sound;
      },
      soundOn: () => this.settings.sound,
      isLocal: () => this.conn?.kind !== 'remote',
    });
    this.stage.addFrameCallback(() => this.hud.frame());
    this.stage.onResize(() => this.view && this.hud.setView(this.view));
    this.applySettings();
    document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
    document.addEventListener('keydown', () => sfx.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.view && this.mode === 'game') {
        this.stage.tweens.finishAll();
      }
    });

    requestAnimationFrame(() => {
      setTimeout(() => document.getElementById('loading')?.classList.add('done'), 250);
    });

    const room = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (room && /^[A-Z0-9]{5}$/.test(room) && this.settings.name.trim()) void this.joinRoom(room);
    else this.toMenu(room ?? undefined);
  }

  // ───────────────────────── Navigation ─────────────────────────

  private toMenu(prefillCode?: string): void {
    this.closeConn();
    this.mode = 'menu';
    this.view = null;
    this.queue = [];
    this.hud.hide();
    this.table.layoutLobby(true);
    this.stage.setCameraMode('orbit');
    this.setUrlRoom(null);
    showMenu(
      this.settings,
      {
        canResume: hasSavedLocalGame(),
        single: () => openSingleSetup((cfg) => this.startSingle(cfg)),
        resume: () => this.resumeSingle(),
        create: () => void this.createRoom(),
        join: (code) => void this.joinRoom(code),
        settings: () => this.openSettings(),
        rules: () => openRules(),
      },
      () => saveSettings(this.settings),
    );
    if (prefillCode) {
      const input = document.querySelector('.input.code') as HTMLInputElement | null;
      if (input) input.value = prefillCode;
      toast('Gib deinen Namen ein und tritt dem Raum bei.');
    }
  }

  private startSingle(cfg: SingleConfig): void {
    this.lastSingle = cfg;
    clearSavedLocalGame();
    this.connect(
      new LocalConnection({
        name: this.settings.name,
        avatar: this.settings.avatar,
        bots: Array.from({ length: cfg.players - 1 }, () => cfg.difficulty),
        options: cfg.options,
      }),
    );
  }

  private resumeSingle(): void {
    this.connect(new LocalConnection({ resume: true, name: this.settings.name, avatar: this.settings.avatar }));
  }

  private again(): void {
    if (this.conn?.kind === 'local') {
      const cfg = this.lastSingle ?? this.singleFromView();
      this.startSingle(cfg);
    }
  }

  private singleFromView(): SingleConfig {
    const v = this.view;
    const bots = v?.players.filter((p) => p.bot) ?? [];
    return {
      players: v?.players.length ?? 4,
      difficulty: bots[0]?.bot ?? 'medium',
      options: v?.options ?? { bidRule: 'free', roundsMode: 'full' },
    };
  }

  private async createRoom(): Promise<void> {
    try {
      const code = await createRoom();
      await this.joinRoom(code, true);
    } catch {
      toast('Der Raum konnte nicht erstellt werden. Läuft der Server?', 'err');
    }
  }

  private async joinRoom(code: string, fresh = false): Promise<void> {
    if (!fresh) {
      try {
        const info = await roomExists(code);
        if (!info.exists) {
          toast(`Raum ${code} wurde nicht gefunden.`, 'err');
          if (this.mode !== 'menu') this.toMenu();
          else this.setUrlRoom(null);
          return;
        }
      } catch {
        toast('Server nicht erreichbar.', 'err');
        return;
      }
    }
    this.setUrlRoom(code);
    this.connect(
      new RemoteConnection(code, () => ({ t: 'join', token: this.settings.token, name: this.settings.name, avatar: this.settings.avatar })),
    );
  }

  private connect(conn: Connection): void {
    this.closeConn();
    this.generation++;
    const gen = this.generation;
    this.conn = conn;
    this.view = null;
    this.queue = [];
    this.hud.resetChat();
    conn.onMessage = (m) => {
      if (gen !== this.generation) return;
      this.queue.push(m);
      void this.process();
    };
    conn.onStatus = (s) => {
      if (gen !== this.generation) return;
      this.showConnStatus(s === 'reconnecting' ? 'Verbindung unterbrochen – verbinde neu …' : null);
      if (s === 'closed' && conn.kind === 'remote') {
        // Server hat den Raum geschlossen (z. B. nach langer Inaktivität)
        setTimeout(() => {
          if (gen === this.generation && this.mode !== 'menu') {
            toast('Die Verbindung zum Raum wurde beendet.', 'err');
            this.toMenu();
          }
        }, 300);
      }
    };
  }

  private closeConn(): void {
    this.conn?.close();
    this.conn = null;
    this.generation++;
    this.showConnStatus(null);
  }

  private leave(): void {
    if (this.conn?.kind === 'remote') this.conn.send({ t: 'leave' });
    this.toMenu();
  }

  private setUrlRoom(code: string | null): void {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }

  private showConnStatus(text: string | null): void {
    this.connPill?.remove();
    this.connPill = null;
    if (text) {
      this.connPill = h('div', { class: 'conn panel' }, text);
      document.body.appendChild(this.connPill);
    }
  }

  // ───────────────────────── Nachrichten ─────────────────────────

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    const gen = this.generation;
    try {
      while (this.queue.length && gen === this.generation) {
        const msg = this.queue.shift()!;
        if (msg.t === 'state') await this.applyState(msg.view, msg.events, !!msg.full);
        else if (msg.t === 'error') this.onError(msg.code, msg.message, msg.retryIn);
        else if (msg.t === 'chat') {
          this.hud.chat(msg.seat, msg.name, msg.text);
          if (this.mode === 'lobby') updateLobbyChat(this.hud.chatEntries);
        }
      }
    } catch (err) {
      console.error(err);
      if (this.view) this.table.rebuild(this.view);
    } finally {
      this.processing = false;
    }
  }

  private async applyState(view: View, events: GameEvent[], full: boolean): Promise<void> {
    const gen = this.generation;
    if (view.phase === 'lobby') {
      if (this.mode !== 'lobby') {
        this.mode = 'lobby';
        this.hud.hide();
        this.stage.setCameraMode('orbit');
        this.table.layoutLobby(true);
      }
      this.view = view;
      renderLobby(
        view,
        (m) => this.conn?.send(m),
        () => this.leave(),
        this.hud.chatEntries,
        (text) => this.sendChat(text),
      );
      return;
    }

    if (this.mode !== 'game') {
      this.mode = 'game';
      clearScreens();
      this.hud.show();
      this.stage.setCameraMode('seat');
      full = true;
    }

    const backlog = this.queue.filter((m) => m.t === 'state').length;
    const skip = full || !this.view || document.hidden || backlog > 8;
    if (skip) {
      this.stage.tweens.finishAll();
      this.view = view;
      this.table.rebuild(view);
      this.hud.setView(view);
      return;
    }
    // während Animationen mit schnellerem Tempo aufholen, wenn sich Nachrichten stauen
    this.stage.tweens.speed = (this.settings.fast ? 1.6 : 1) * (backlog > 2 ? 1.8 : 1);
    for (const ev of events) {
      if (gen !== this.generation) return;
      this.hud.onEvent(ev, view);
      await this.table.animate(ev, view);
      this.hud.afterEvent(ev, view);
    }
    if (gen !== this.generation) return;
    this.view = view;
    this.table.applyView(view);
    this.hud.setView(view);
  }

  /** Entwicklungshilfe: aktuelle Verbindung (für Tests in der Konsole) */
  get devConn(): Connection | null {
    return this.conn;
  }

  /** Spamschutz im Client: kurze Sperre nach jeder Nachricht (der Server prüft zusätzlich). */
  private chatBlockedUntil = 0;

  private sendChat(text: string): boolean {
    const now = Date.now();
    if (now < this.chatBlockedUntil) {
      toast(`Nicht so schnell – du kannst in ${Math.ceil((this.chatBlockedUntil - now) / 1000)} s wieder schreiben.`, 'err');
      return false;
    }
    this.chatBlockedUntil = now + CHAT_MIN_GAP;
    this.conn?.send({ t: 'chat', text });
    return true;
  }

  private onError(code: string, message: string, retryIn?: number): void {
    if (code === 'chat_rate' && retryIn) this.chatBlockedUntil = Date.now() + retryIn;
    toast(message, 'err');
    if (code === 'rule') this.table.clearPending();
    if (['not_found', 'game_running', 'room_full', 'kicked'].includes(code)) this.toMenu();
  }

  // ───────────────────────── Einstellungen ─────────────────────────

  private openSettings(): void {
    openSettings(this.settings, () => this.applySettings());
  }

  private applySettings(): void {
    saveSettings(this.settings);
    sfx.enabled = this.settings.sound;
    sfx.setVolume(this.settings.volume);
    this.stage.tweens.speed = this.settings.fast ? 1.6 : 1;
    this.stage.setQuality(this.settings.quality);
  }
}

void new App().init().catch((err) => {
  console.error(err);
  const el = document.querySelector('.loading-text');
  if (el) el.textContent = 'WebGL konnte nicht gestartet werden. Bitte einen aktuellen Browser verwenden.';
});
