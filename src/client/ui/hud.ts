import { type Suit, SUIT_INFO, isWizard } from '../../shared/cards';
import { trickWinnerIndex } from '../../shared/rules';
import { AVATARS, type ClientMsg, type GameEvent, type View } from '../../shared/types';
import { sfx } from '../audio';
import type { TableView } from '../three/tableView';
import { cardPreview, emblemIcon } from '../three/textures';
import { type ModalHandle, banner, clear, h, modal, toast } from './dom';

export interface HudActions {
  send(msg: ClientMsg): void;
  leave(): void;
  again(): void;
  openSettings(): void;
  toggleSound(): boolean;
  soundOn(): boolean;
  isLocal(): boolean;
}

interface LabelEl {
  root: HTMLElement;
  av: HTMLElement;
  nm: HTMLElement;
  st: HTMLElement;
  score: HTMLElement;
}

export class Hud {
  private root = document.getElementById('hud')!;
  private labelsRoot = document.getElementById('labels')!;
  private labels: LabelEl[] = [];
  private view: View | null = null;
  private info: { round: HTMLElement; trump: HTMLElement; bids: HTMLElement } | null = null;
  private actionEl: HTMLElement | null = null;
  private actionKey = '';
  private roundModal: ModalHandle | null = null;
  private roundModalFor = -1;
  private endModal: ModalHandle | null = null;
  private endShown = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private chatPanel: HTMLElement | null = null;
  private chatLog: { name: string; text: string; sys?: boolean }[] = [];
  private chatBtn: HTMLElement | null = null;
  private unread = false;
  private visible = false;
  private lastTurnAlert = '';
  private soundBtn: HTMLElement | null = null;

  constructor(
    private table: TableView,
    private actions: HudActions,
  ) {
    // Ziffertasten zum Bieten
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.target instanceof HTMLInputElement) return;
      if (!/^[0-9]$/.test(e.key)) return;
      const btns = this.actionEl?.querySelectorAll<HTMLButtonElement>('.bids button');
      if (!btns) return;
      const btn = btns[Number(e.key)];
      if (btn && !btn.disabled) btn.click();
    });
  }

  // ───────────────────────── Sichtbarkeit ─────────────────────────

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.buildTopbar();
  }

  hide(): void {
    this.visible = false;
    clear(this.root);
    clear(this.labelsRoot);
    this.labels = [];
    this.info = null;
    this.actionEl = null;
    this.actionKey = '';
    this.chatPanel = null;
    this.roundModal?.close();
    this.roundModal = null;
    this.endModal?.close();
    this.endModal = null;
    this.endShown = false;
    this.roundModalFor = -1;
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    document.querySelectorAll('.banner').forEach((b) => b.remove());
  }

  get chatEntries(): { name: string; text: string; sys?: boolean }[] {
    return this.chatLog;
  }

  resetChat(): void {
    this.chatLog = [];
    this.unread = false;
  }

  private buildTopbar(): void {
    clear(this.root);
    const round = h('div', { class: 'info-v' }, '–');
    const trump = h('div', { class: 'info-cell trump-cell' });
    const bids = h('div', { class: 'info-v bidsum' }, '–');
    this.info = { round, trump, bids };
    this.soundBtn = h('button', { class: 'icon-btn', title: 'Ton an/aus', onclick: () => this.toggleSound() }, this.actions.soundOn() ? '🔊' : '🔇');
    this.chatBtn = this.actions.isLocal()
      ? null
      : h('button', { class: 'icon-btn', title: 'Chat', onclick: () => this.toggleChat() }, '💬', this.unread ? h('span', { class: 'dot' }) : null);
    const bar = h(
      'div',
      { class: 'topbar' },
      h(
        'div',
        { class: 'info panel' },
        h('div', { class: 'info-cell' }, h('div', { class: 'info-k' }, 'Runde'), round),
        trump,
        h('div', { class: 'info-cell hide-sm' }, h('div', { class: 'info-k' }, 'Gebote'), bids),
      ),
      h(
        'div',
        { class: 'tools' },
        h('button', { class: 'icon-btn', title: 'Punktetabelle', onclick: () => this.openScores() }, '📜'),
        h('button', { class: 'icon-btn', title: 'Letzter Stich', onclick: () => this.openLastTrick() }, '👁'),
        this.chatBtn,
        this.soundBtn,
        h('button', { class: 'icon-btn', title: 'Einstellungen', onclick: () => this.actions.openSettings() }, '⚙'),
        h('button', { class: 'icon-btn', title: 'Spiel verlassen', onclick: () => this.confirmLeave() }, '🚪'),
      ),
    );
    this.root.appendChild(bar);
  }

  private toggleSound(): void {
    const on = this.actions.toggleSound();
    if (this.soundBtn) this.soundBtn.textContent = on ? '🔊' : '🔇';
  }

  // ───────────────────────── Zustand ─────────────────────────

  setView(view: View): void {
    this.view = view;
    if (!this.visible) return;
    this.updateInfo(view);
    this.updateLabels(view);
    this.updateAction(view);
    this.updatePhaseModals(view);
    const hh = this.table.handHeightPx(view.hand.length);
    document.documentElement.style.setProperty('--hand-h', `${Math.round(hh)}px`);
  }

  private updateInfo(view: View): void {
    if (!this.info) return;
    this.info.round.innerHTML = '';
    this.info.round.append(String(view.round), h('small', null, ` / ${view.totalRounds}`));
    const t = this.info.trump;
    clear(t);
    let label = 'Kein Trumpf';
    if (view.trumpSuit !== null) label = `${SUIT_INFO[view.trumpSuit].name}`;
    else if (view.trumpCard !== null && isWizard(view.trumpCard)) label = view.phase === 'trump' ? 'wird gewählt …' : 'Kein Trumpf';
    const imgCard = view.trumpCard;
    t.append(
      imgCard !== null ? h('img', { src: cardPreview(imgCard), alt: '' }) : h('div', { class: 'trump-none' }, '∅'),
      h(
        'div',
        null,
        h('div', { class: 'info-k' }, 'Trumpf'),
        h(
          'div',
          { class: 'info-v', style: view.trumpSuit !== null ? `color:${SUIT_INFO[view.trumpSuit].light}` : '' },
          label,
          view.trumpSuit !== null ? h('small', null, ` ${SUIT_INFO[view.trumpSuit].people}`) : null,
        ),
      ),
    );
    const placed = view.players.filter((p) => p.bid !== null);
    const sum = placed.reduce((a, p) => a + (p.bid ?? 0), 0);
    const b = this.info.bids;
    b.className = 'info-v bidsum';
    clear(b);
    if (view.round > 0) {
      b.append(String(sum), h('small', null, ` / ${view.round}`));
      if (placed.length === view.players.length) b.classList.add(sum > view.round ? 'over' : sum < view.round ? 'under' : 'even');
    } else b.textContent = '–';
  }

  private ensureLabels(view: View): void {
    if (this.labels.length === view.players.length) return;
    clear(this.labelsRoot);
    this.labels = view.players.map((_, seat) => {
      const av = h('div', { class: 'av' });
      const nm = h('div', { class: 'nm' });
      const st = h('div', { class: 'st' });
      const score = h('div', { class: 'score' });
      const root = h('div', { class: `plabel ${seat === view.you ? 'me' : ''}` }, av, h('div', { class: 'meta' }, nm, st), score);
      this.labelsRoot.appendChild(root);
      return { root, av, nm, st, score };
    });
  }

  private updateLabels(view: View): void {
    this.ensureLabels(view);
    view.players.forEach((p, seat) => {
      const l = this.labels[seat];
      l.root.classList.toggle('turn', view.turn === seat && ['bidding', 'playing', 'trump'].includes(view.phase));
      l.root.classList.toggle('offline', !p.connected);
      clear(l.av);
      l.av.append(AVATARS[p.avatar] ?? '🧙');
      if (view.dealer === seat) l.av.append(h('span', { class: 'dealer', title: 'Geber' }, 'G'));
      l.nm.textContent = (seat === view.you ? 'Du' : p.name) + (p.bot && !p.replaced ? ' 🤖' : '') + (p.replaced ? ' (Bot)' : '');
      clear(l.st);
      if (!p.connected) l.st.append('getrennt …');
      else if (p.bid === null) {
        l.st.append(view.phase === 'bidding' && view.turn === seat ? 'bietet …' : view.phase === 'trump' && view.dealer === seat ? 'wählt Trumpf …' : 'Gebot –');
      } else {
        const cls = p.tricks === p.bid ? 'hit' : p.tricks > p.bid ? 'over' : '';
        l.st.append(h('span', null, 'Gebot ', h('b', null, String(p.bid))), h('span', { class: cls }, 'Stiche ', h('b', { class: cls }, String(p.tricks))));
      }
      l.score.textContent = String(p.score);
    });
  }

  /** Positioniert die Labels über den Sitzplätzen (jeden Frame). */
  frame(): void {
    const v = this.view;
    if (!v || !this.visible) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.labels.forEach((l, seat) => {
      if (seat === v.you) return;
      const p = this.table.seatScreen(seat);
      const w = l.root.offsetWidth;
      const hgt = l.root.offsetHeight;
      const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, p.x));
      const y = Math.max(hgt + 64, Math.min(H - 80, p.y));
      l.root.style.transform = `translate(${x - w / 2}px, ${y - hgt}px)`;
    });
  }

  // ───────────────────────── Aktionen ─────────────────────────

  private updateAction(view: View): void {
    const myTurn = view.turn === view.you;
    let key = 'none';
    if (view.phase === 'bidding' && myTurn) key = `bid-${view.round}-${view.forbiddenBid}`;
    else if (view.phase === 'trump' && myTurn) key = `trump-${view.round}`;
    else if (view.phase === 'playing' && myTurn) key = `play-${view.round}-${view.trick.length}-${view.hand.length}`;
    else if (view.phase === 'bidding' || view.phase === 'trump') key = `wait-${view.phase}-${view.turn}`;
    else if (view.phase === 'playing') key = `waitplay-${view.turn}`;
    if (key === this.actionKey) return;
    this.actionKey = key;
    this.actionEl?.remove();
    this.actionEl = null;

    if (myTurn && ['bidding', 'trump', 'playing'].includes(view.phase)) {
      const alertKey = `${view.round}-${view.phase}-${view.trick.length}-${view.hand.length}`;
      if (alertKey !== this.lastTurnAlert) {
        this.lastTurnAlert = alertKey;
        sfx.turn();
      }
    }

    if (key.startsWith('bid-')) {
      const sum = view.players.reduce((a, p) => a + (p.bid ?? 0), 0);
      const placed = view.players.filter((p) => p.bid !== null).length;
      const btns = h('div', { class: 'bids' });
      for (let i = 0; i <= view.round; i++) {
        const forbidden = view.forbiddenBid === i;
        btns.appendChild(
          h(
            'button',
            {
              disabled: forbidden,
              'aria-label': `${i} Stiche`,
              title: forbidden ? 'Nicht erlaubt: Die Gebote dürfen nicht aufgehen' : `${i} Stich${i === 1 ? '' : 'e'} ansagen`,
              onclick: () => {
                this.actions.send({ t: 'bid', bid: i });
                this.actionEl?.remove();
                this.actionEl = null;
              },
            },
            String(i),
          ),
        );
      }
      this.actionEl = h(
        'div',
        { class: 'action panel' },
        h('h3', { class: 'gold-text' }, 'Wie viele Stiche machst du?'),
        h(
          'div',
          { class: 'sub' },
          placed > 0 ? `Bisher ${sum} von ${view.round} angesagt` : `Du bietest zuerst · ${view.round} Stich${view.round === 1 ? '' : 'e'} zu vergeben`,
          view.forbiddenBid !== null ? ` · ${view.forbiddenBid} ist verboten` : '',
        ),
        btns,
      );
    } else if (key.startsWith('trump-')) {
      const suits = h('div', { class: 'suits' });
      ([0, 1, 2, 3] as Suit[]).forEach((s) => {
        const info = SUIT_INFO[s];
        suits.appendChild(
          h(
            'button',
            {
              style: `background:linear-gradient(180deg, ${info.color}, ${info.dark}); color:#fff`,
              onclick: () => {
                this.actions.send({ t: 'trump', suit: s });
                this.actionEl?.remove();
                this.actionEl = null;
              },
            },
            h('img', { src: emblemIcon(s, 76), alt: '' }),
            info.name,
            h('small', null, info.people),
          ),
        );
      });
      this.actionEl = h(
        'div',
        { class: 'action panel' },
        h('h3', { class: 'gold-text' }, 'Ein Zauberer wurde aufgedeckt!'),
        h('div', { class: 'sub' }, 'Als Geber bestimmst du die Trumpffarbe.'),
        suits,
      );
    } else if (key.startsWith('play-')) {
      this.actionEl = h('div', { class: 'prompt panel gold-text' }, view.trick.length === 0 ? 'Du spielst aus – wähle eine Karte' : 'Du bist dran – wähle eine Karte');
    } else if (key.startsWith('wait')) {
      const p = view.players[view.turn];
      if (p) {
        const what = view.phase === 'bidding' ? 'bietet' : view.phase === 'trump' ? 'wählt Trumpf' : 'ist am Zug';
        this.actionEl = h('div', { class: 'prompt panel wait' }, `${p.name} ${what} …`);
      }
    }
    if (this.actionEl) this.root.appendChild(this.actionEl);
  }

  // ───────────────────────── Ereignisse ─────────────────────────

  onEvent(ev: GameEvent, view: View): void {
    if (!this.visible) return;
    const name = (seat: number) => (seat === view.you ? 'Du' : (view.players[seat]?.name ?? '?'));
    switch (ev.e) {
      case 'roundStart':
        this.roundModal?.close();
        this.roundModal = null;
        this.actionEl?.remove();
        this.actionEl = null;
        this.actionKey = '';
        banner(`Runde ${ev.round}`, `${ev.handSize} Karte${ev.handSize === 1 ? '' : 'n'} · ${name(ev.dealer)} ${ev.dealer === view.you ? 'gibst' : 'gibt'}`);
        break;
      case 'trump':
        if (ev.card === null) toast('Letzte Runde – es gibt keinen Trumpf.');
        else if (ev.needChoice) toast(`Zauberer aufgedeckt – ${name(view.dealer)} ${view.dealer === view.you ? 'wählst' : 'wählt'} die Trumpffarbe.`);
        else if (ev.suit === null) toast('Narr aufgedeckt – diese Runde gibt es keinen Trumpf.');
        else toast(`Trumpf ist ${SUIT_INFO[ev.suit].name} (${SUIT_INFO[ev.suit].people}).`);
        break;
      case 'trumpChosen':
        toast(`${name(ev.seat)} ${ev.seat === view.you ? 'wählst' : 'wählt'} Trumpf: ${SUIT_INFO[ev.suit].name}`);
        break;
      case 'bid':
        this.bubble(ev.seat, ev.bid === 0 ? 'Keinen Stich!' : `${ev.bid} Stich${ev.bid === 1 ? '' : 'e'}`);
        this.clearTurnHint(ev.seat);
        break;
      case 'play':
      case 'trumpChosen':
        this.clearTurnHint(ev.seat);
        break;
      case 'info':
        toast(ev.text);
        this.chatLog.push({ name: '', text: ev.text, sys: true });
        this.renderChat();
        break;
      default:
        break;
    }
  }

  afterEvent(ev: GameEvent, view: View): void {
    if (!this.visible) return;
    if (ev.e === 'trickWon') {
      if (ev.seat === view.you) toast('Du gewinnst den Stich!');
    }
    if (ev.e === 'roundEnd') {
      const mine = ev.record.results[view.you];
      if (mine) mine.delta > 0 ? sfx.success() : sfx.fail();
      ev.record.results.forEach((r, seat) => {
        const l = this.labels[seat];
        if (!l) return;
        const d = h('div', { class: `delta ${r.delta > 0 ? 'pos' : 'neg'}` }, r.delta > 0 ? `+${r.delta}` : String(r.delta));
        l.root.appendChild(d);
        setTimeout(() => d.remove(), 2500);
      });
    }
  }

  /** Veraltete "ist am Zug"-Anzeige entfernen, sobald der Spieler gehandelt hat. */
  private clearTurnHint(seat: number): void {
    this.labels[seat]?.root.classList.remove('turn');
    if (this.actionKey.startsWith('wait')) {
      this.actionEl?.remove();
      this.actionEl = null;
      this.actionKey = '';
    }
  }

  private bubble(seat: number, text: string, chat = false): void {
    const l = this.labels[seat];
    if (!l) return;
    l.root.querySelectorAll(chat ? '.bubble.chat' : '.bubble:not(.chat)').forEach((b) => b.remove());
    const b = h('div', { class: `bubble ${chat ? 'chat' : ''}` }, text);
    l.root.appendChild(b);
    setTimeout(() => b.remove(), chat ? 5100 : 2700);
  }

  // ───────────────────────── Runden- & Spielende ─────────────────────────

  private updatePhaseModals(view: View): void {
    if (view.phase === 'roundEnd' && this.roundModalFor !== view.round) this.openRoundEnd(view);
    else if (view.phase === 'roundEnd' && this.roundModal) this.refreshRoundEnd(view);
    if (view.phase === 'gameEnd' && !this.endShown) this.openGameEnd(view);
    if (view.phase !== 'gameEnd' && this.endShown) {
      this.endModal?.close();
      this.endModal = null;
      this.endShown = false;
    }
    if (view.phase !== 'roundEnd' && this.roundModal) {
      this.roundModal.close();
      this.roundModal = null;
    }
  }

  private readyBtn: HTMLButtonElement | null = null;
  private readyInfo: HTMLElement | null = null;
  private countdown = 0;

  private openRoundEnd(view: View): void {
    this.roundModalFor = view.round;
    const rec = view.history[view.history.length - 1];
    if (!rec) return;
    const order = view.players.map((_, i) => i).sort((a, b) => view.players[b].score - view.players[a].score);
    const rows = order.map((seat, idx) => {
      const r = rec.results[seat];
      const p = view.players[seat];
      return h(
        'div',
        { class: `rr ${seat === view.you ? 'me' : ''}`, style: `animation-delay:${idx * 70}ms` },
        h('div', { class: 'av' }, AVATARS[p.avatar]),
        h('div', { class: 'nm' }, seat === view.you ? 'Du' : p.name, r.bid === r.tricks ? h('small', null, '✓') : null),
        h('div', { class: 'c' }, `${r.tricks} / ${r.bid}`),
        h('div', { class: `d ${r.delta > 0 ? 'pos' : 'neg'}` }, r.delta > 0 ? `+${r.delta}` : String(r.delta)),
        h('div', { class: 't' }, String(r.total)),
      );
    });
    this.readyBtn = h('button', { class: 'btn primary', onclick: () => this.sendReady() }, 'Weiter') as HTMLButtonElement;
    this.readyInfo = h('div', { class: 'countdown' });
    this.countdown = view.autoNextIn ?? 30;
    const content = h(
      'div',
      null,
      h('h2', { class: 'gold-text' }, `Runde ${rec.round} beendet`),
      h(
        'div',
        { class: 'round-res' },
        h('div', { class: 'rr head' }, h('div'), h('div', null, 'Spieler'), h('div', { class: 'c' }, 'Stiche'), h('div', { class: 'd' }, 'Punkte'), h('div', { class: 't' }, 'Gesamt')),
        rows,
      ),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => this.openScores() }, 'Tabelle'), this.readyBtn),
      this.readyInfo,
    );
    // kurz warten, damit die Punkte-Animation an den Labels sichtbar ist
    setTimeout(() => {
      if (this.view?.phase !== 'roundEnd' || this.roundModalFor !== rec.round) return;
      this.roundModal = modal(content, { closable: false, id: 'round' });
      this.refreshRoundEnd(this.view);
    }, 1100);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      this.countdown = Math.max(0, this.countdown - 1);
      if (this.view) this.refreshRoundEnd(this.view);
    }, 1000);
  }

  private refreshRoundEnd(view: View): void {
    if (!this.readyInfo || !this.readyBtn) return;
    const me = view.players[view.you];
    const humans = view.players.filter((p) => !p.bot && p.connected);
    const readyCount = humans.filter((p) => p.ready).length;
    if (me?.ready) {
      this.readyBtn.disabled = true;
      this.readyBtn.textContent = humans.length > 1 ? `Bereit (${readyCount}/${humans.length})` : 'Bereit';
    }
    this.readyInfo.textContent = `Nächste Runde startet automatisch in ${this.countdown} s`;
  }

  private sendReady(): void {
    this.actions.send({ t: 'ready' });
    if (this.readyBtn) {
      this.readyBtn.disabled = true;
      this.readyBtn.textContent = 'Bereit';
    }
  }

  private openGameEnd(view: View): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.roundModal?.close();
    this.roundModal = null;
    const order = view.players.map((_, i) => i).sort((a, b) => view.players[b].score - view.players[a].score);
    const podiumOrder = [order[1], order[0], order[2]].filter((x) => x !== undefined);
    const winner = view.players[order[0]];
    const top = winner.score;
    const leaders = order.filter((s) => view.players[s].score === top);
    const placeOf = (seat: number) => 1 + view.players.filter((p) => p.score > view.players[seat].score).length;
    const iWon = leaders.includes(view.you);
    const title =
      leaders.length > 1
        ? iWon
          ? 'Geteilter Sieg!'
          : `Gleichstand: ${leaders.map((s) => view.players[s].name).join(' & ')}`
        : iWon
          ? 'Du hast gewonnen!'
          : `${winner.name} gewinnt!`;
    const isHost = view.players[view.you]?.isHost;
    const podium = h(
      'div',
      { class: 'podium' },
      podiumOrder.map((seat) => {
        const place = placeOf(seat);
        const p = view.players[seat];
        return h(
          'div',
          { class: `pod p${Math.min(3, order.indexOf(seat) + 1)}` },
          h('div', { class: 'av' }, AVATARS[p.avatar]),
          h('div', { class: 'nm' }, seat === view.you ? 'Du' : p.name),
          h('div', { class: 'pts' }, `${p.score} Punkte`),
          h('div', { class: 'block' }, String(place)),
        );
      }),
    );
    const rest = order.slice(3).map((seat) =>
      h(
        'div',
        { class: `rr ${seat === view.you ? 'me' : ''}` },
        h('div', { class: 'av' }, AVATARS[view.players[seat].avatar]),
        h('div', { class: 'nm' }, `${placeOf(seat)}. ${seat === view.you ? 'Du' : view.players[seat].name}`),
        h('div'),
        h('div'),
        h('div', { class: 't' }, String(view.players[seat].score)),
      ),
    );
    const actions: HTMLElement[] = [h('button', { class: 'btn', onclick: () => this.openScores() }, 'Tabelle')];
    if (this.actions.isLocal()) actions.push(h('button', { class: 'btn primary', onclick: () => this.actions.again() }, 'Nochmal spielen'));
    else if (isHost) actions.push(h('button', { class: 'btn primary', onclick: () => this.actions.send({ t: 'toLobby' }) }, 'Zurück zur Lobby'));
    actions.push(h('button', { class: 'btn', onclick: () => this.actions.leave() }, 'Hauptmenü'));
    const content = h(
      'div',
      null,
      h('h2', { class: 'gold-text', style: 'font-size:28px' }, title),
      podium,
      rest.length ? h('div', { class: 'round-res' }, rest) : null,
      !this.actions.isLocal() && !isHost ? h('div', { class: 'countdown' }, 'Der Host kann eine neue Partie starten.') : null,
      h('div', { class: 'modal-actions' }, actions),
    );
    this.endShown = true;
    setTimeout(() => {
      if (this.view?.phase !== 'gameEnd' || !this.endShown) return;
      this.endModal = modal(content, { closable: false, id: 'end' });
    }, 1800);
  }

  // ───────────────────────── Weitere Fenster ─────────────────────────

  openScores(): void {
    const v = this.view;
    if (!v) return;
    const head = h(
      'tr',
      null,
      h('th', null, 'Rd.'),
      v.players.map((p, i) => h('th', null, h('span', { class: 'av' }, AVATARS[p.avatar]), i === v.you ? 'Du' : p.name)),
    );
    const rows = v.history.map((rec) =>
      h(
        'tr',
        { class: rec.round === v.round ? 'cur' : '' },
        h('td', null, String(rec.round)),
        rec.results.map((r) =>
          h(
            'td',
            { class: r.bid === r.tricks ? 'hit' : 'miss' },
            h('div', { class: 'tot' }, String(r.total)),
            h('div', { class: 'sub' }, `${r.tricks}/${r.bid} · ${r.delta > 0 ? '+' : ''}${r.delta}`),
          ),
        ),
      ),
    );
    const foot = h(
      'tr',
      null,
      h('td', null, 'Σ'),
      v.players.map((p) => h('td', null, String(p.score))),
    );
    modal(
      h(
        'div',
        null,
        h('h2', { class: 'gold-text' }, 'Punktetabelle'),
        v.history.length === 0
          ? h('p', { class: 'hint', style: 'text-align:center' }, 'Noch keine Runde beendet.')
          : h('div', { class: 'score-wrap' }, h('table', { class: 'scores' }, h('thead', null, head), h('tbody', null, rows), h('tfoot', null, foot))),
        h('p', { class: 'hint', style: 'text-align:center' }, 'Kleine Zahlen: Stiche / Gebot · Punkte der Runde'),
      ),
      { wide: true, id: 'scores' },
    );
  }

  private openLastTrick(): void {
    const v = this.view;
    if (!v) return;
    const t = v.lastTrick;
    let content: HTMLElement;
    if (!t || t.length === 0) content = h('p', { class: 'hint', style: 'text-align:center' }, 'In dieser Runde wurde noch kein Stich gespielt.');
    else {
      const wi = trickWinnerIndex(
        t.map((x) => x.card),
        v.trumpSuit,
      );
      content = h(
        'div',
        { class: 'last-trick' },
        t.map((x, i) =>
          h(
            'figure',
            { class: i === wi ? 'win' : '' },
            h('img', { src: cardPreview(x.card), alt: '' }),
            h('figcaption', null, (x.seat === v.you ? 'Du' : v.players[x.seat].name) + (i === wi ? ' ★' : '')),
          ),
        ),
      );
    }
    modal(h('div', null, h('h2', { class: 'gold-text' }, 'Letzter Stich'), content), { id: 'last' });
  }

  private confirmLeave(): void {
    const local = this.actions.isLocal();
    const m = modal(
      h(
        'div',
        null,
        h('h2', null, 'Spiel verlassen?'),
        h(
          'p',
          { class: 'hint', style: 'text-align:center' },
          local ? 'Dein Spielstand wird gespeichert – du kannst später im Hauptmenü fortsetzen.' : 'Ein Bot übernimmt deinen Platz, damit die anderen weiterspielen können.',
        ),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                m.close();
                this.actions.leave();
              },
            },
            'Verlassen',
          ),
        ),
      ),
      { id: 'leave' },
    );
  }

  // ───────────────────────── Chat ─────────────────────────

  chat(seat: number, name: string, text: string): void {
    this.chatLog.push({ name, text });
    if (this.chatLog.length > 80) this.chatLog.shift();
    if (this.visible) this.bubble(seat, text, true);
    if (!this.chatPanel) {
      this.unread = true;
      if (this.chatBtn && !this.chatBtn.querySelector('.dot')) this.chatBtn.appendChild(h('span', { class: 'dot' }));
      sfx.chat();
    }
    this.renderChat();
  }

  private toggleChat(): void {
    if (this.chatPanel) {
      this.chatPanel.remove();
      this.chatPanel = null;
      return;
    }
    this.unread = false;
    this.chatBtn?.querySelector('.dot')?.remove();
    const input = h('input', { class: 'input', maxlength: 160, placeholder: 'Nachricht …', autocomplete: 'off' }) as HTMLInputElement;
    const send = (text: string) => {
      const t = text.trim();
      if (!t) return;
      this.actions.send({ t: 'chat', text: t });
    };
    const quick = h(
      'div',
      { class: 'quick' },
      ['👍', '😂', '😮', '😅', '🔥', '🧙', 'GG'].map((q) => h('button', { onclick: () => send(q) }, q)),
    );
    this.chatPanel = h(
      'div',
      { class: 'chat panel' },
      h('div', { class: 'chat-log' }),
      quick,
      h(
        'form',
        {
          onsubmit: (e: Event) => {
            e.preventDefault();
            send(input.value);
            input.value = '';
          },
        },
        input,
        h('button', { class: 'btn small primary', type: 'submit' }, '➤'),
      ),
    );
    this.root.appendChild(this.chatPanel);
    this.renderChat();
    input.focus();
  }

  private renderChat(): void {
    const log = this.chatPanel?.querySelector('.chat-log');
    if (!log) return;
    clear(log);
    for (const m of this.chatLog) {
      log.appendChild(m.sys ? h('div', { class: 'sys' }, m.text) : h('div', null, h('b', null, `${m.name}: `), m.text));
    }
    log.scrollTop = log.scrollHeight;
  }
}
