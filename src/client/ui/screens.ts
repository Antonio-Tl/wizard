import { MAX_PLAYERS, MIN_PLAYERS, totalRoundsFor } from '../../shared/rules';
import { AVATAR_COUNT, type ClientMsg, type Difficulty, type GameOptions, type View } from '../../shared/types';
import type { Settings } from '../settings';
import type { Quality } from '../three/stage';
import { AVATAR_NAMES, avatarImg } from './avatars';
import { clear, fadeRemove, h, modal, seg, toast } from './dom';
import { icon } from './icons';

const screens = () => document.getElementById('screens')!;

export function clearScreens(): void {
  for (const el of Array.from(screens().children)) fadeRemove(el, 350);
}

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };

// ───────────────────────── Hauptmenü ─────────────────────────

export interface MenuActions {
  single(): void;
  resume(): void;
  create(): void;
  join(code: string): void;
  settings(): void;
  rules(): void;
  canResume: boolean;
}

export function showMenu(settings: Settings, actions: MenuActions, onChange: () => void): void {
  clearScreens();
  const nameInput = h('input', {
    class: 'input',
    maxlength: 16,
    placeholder: 'Dein Name',
    value: settings.name,
    autocomplete: 'nickname',
    oninput: (e: Event) => {
      settings.name = (e.target as HTMLInputElement).value;
      onChange();
    },
  }) as HTMLInputElement;
  const avatars = h('div', { class: 'avatars', role: 'radiogroup', 'aria-label': 'Avatar' });
  const avatarName = h('span', { class: 'avatar-name' });
  const renderAvatars = () => {
    clear(avatars);
    avatarName.textContent = AVATAR_NAMES[settings.avatar] ?? '';
    for (let i = 0; i < AVATAR_COUNT; i++) {
      avatars.appendChild(
        h(
          'button',
          {
            class: i === settings.avatar ? 'on' : '',
            title: AVATAR_NAMES[i],
            role: 'radio',
            'aria-checked': String(i === settings.avatar),
            'aria-label': AVATAR_NAMES[i],
            onclick: () => {
              settings.avatar = i;
              onChange();
              renderAvatars();
            },
          },
          avatarImg(i),
        ),
      );
    }
  };
  renderAvatars();
  const needName = (fn: () => void) => () => {
    if (!settings.name.trim()) {
      nameInput.focus();
      nameInput.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 250, iterations: 2 });
      toast('Bitte gib zuerst deinen Namen ein.');
      return;
    }
    fn();
  };
  const codeInput = h('input', {
    class: 'input code',
    maxlength: 5,
    placeholder: 'CODE',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    oninput: (e: Event) => {
      const el = e.target as HTMLInputElement;
      el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') joinBtn.click();
    },
  }) as HTMLInputElement;
  const joinBtn = h(
    'button',
    {
      class: 'btn',
      onclick: needName(() => {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length !== 5) {
          toast('Der Raumcode hat 5 Zeichen.');
          codeInput.focus();
          return;
        }
        actions.join(code);
      }),
    },
    'Beitreten',
  );

  const el = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'menu panel' },
      h('div', { class: 'title' }, h('h1', { class: 'gold-text' }, 'Wizard'), h('p', null, 'Das magische Stichspiel')),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Name'), nameInput),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Wappen', avatarName), avatars),
      h(
        'div',
        { class: 'menu-actions' },
        actions.canResume ? h('button', { class: 'btn primary', onclick: needName(actions.resume) }, 'Spiel fortsetzen') : null,
        h('button', { class: `btn ${actions.canResume ? '' : 'primary'}`, onclick: needName(actions.single) }, 'Gegen Bots spielen'),
        h('button', { class: 'btn', onclick: needName(actions.create) }, 'Online-Raum erstellen'),
        h('div', { class: 'divider' }, 'oder beitreten'),
        h('div', { class: 'menu-row' }, codeInput, joinBtn),
      ),
      h(
        'div',
        { class: 'menu-foot' },
        h('button', { class: 'btn ghost small', onclick: actions.rules }, 'Regeln'),
        h('button', { class: 'btn ghost small', onclick: actions.settings }, 'Einstellungen'),
      ),
    ),
  );
  screens().appendChild(el);
}

// ───────────────────────── Einzelspieler ─────────────────────────

export interface SingleConfig {
  players: number;
  difficulty: Difficulty;
  options: GameOptions;
}

const SINGLE_KEY = 'wizard.single';

export function openSingleSetup(onStart: (cfg: SingleConfig) => void): void {
  let cfg: SingleConfig = { players: 4, difficulty: 'medium', options: { bidRule: 'free', roundsMode: 'full' } };
  try {
    cfg = { ...cfg, ...(JSON.parse(localStorage.getItem(SINGLE_KEY) ?? '{}') as Partial<SingleConfig>) };
  } catch {
    /* Standard */
  }
  const roundsInfo = h('div', { class: 'hint' });
  const updateInfo = () => {
    roundsInfo.textContent = `${totalRoundsFor(cfg.players, cfg.options.roundsMode)} Runden · ${cfg.players - 1} Bots`;
  };
  updateInfo();
  const m = modal(
    h(
      'div',
      null,
      h('h2', { class: 'gold-text' }, 'Gegen Bots spielen'),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Spieler am Tisch'),
        seg(
          [3, 4, 5, 6].map((n) => [n, String(n)] as [number, string]),
          cfg.players,
          (v) => {
            cfg.players = v;
            updateInfo();
          },
        ),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Stärke der Bots'),
        seg(
          (['easy', 'medium', 'hard'] as Difficulty[]).map((d) => [d, DIFF_LABEL[d]] as [Difficulty, string]),
          cfg.difficulty,
          (v) => (cfg.difficulty = v),
        ),
      ),
      optionFields(cfg.options, (o) => {
        cfg.options = o;
        updateInfo();
      }),
      roundsInfo,
      h(
        'div',
        { class: 'modal-actions' },
        h(
          'button',
          {
            class: 'btn primary block',
            onclick: () => {
              try {
                localStorage.setItem(SINGLE_KEY, JSON.stringify(cfg));
              } catch {
                /* egal */
              }
              m.close();
              onStart(cfg);
            },
          },
          'Spiel starten',
        ),
      ),
    ),
    { id: 'single' },
  );
}

function optionFields(options: GameOptions, onChange: (o: GameOptions) => void, disabled = false, columns = false): HTMLElement {
  const o = { ...options };
  return h(
    'div',
    { class: columns ? 'opts' : '' },
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label' }, 'Spiellänge'),
      seg(
        [
          ['full', 'Voll'],
          ['half', 'Halb'],
          ['quick', 'Schnell'],
        ],
        o.roundsMode,
        (v) => {
          o.roundsMode = v;
          onChange({ ...o });
        },
        disabled,
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label' }, 'Gebote'),
      seg(
        [
          ['free', 'Frei'],
          ['notEqual', 'Dürfen nicht aufgehen'],
        ],
        o.bidRule,
        (v) => {
          o.bidRule = v;
          onChange({ ...o });
        },
        disabled,
      ),
      columns ? null : h('div', { class: 'hint' }, 'Bei „Dürfen nicht aufgehen“ darf der letzte Bieter nicht so bieten, dass die Summe aller Gebote der Stichzahl entspricht.'),
    ),
  );
}

// ───────────────────────── Lobby ─────────────────────────

export interface ChatEntry {
  name: string;
  text: string;
  sys?: boolean;
}

function lobbyChat(log: ChatEntry[], chat: (text: string) => boolean): HTMLElement {
  const input = h('input', { class: 'input', maxlength: 160, placeholder: 'Nachricht an alle …', autocomplete: 'off' }) as HTMLInputElement;
  const list = h('div', { class: 'lobby-chat-log' });
  renderChatEntries(list, log);
  return h(
    'div',
    { class: 'lobby-chat' },
    list,
    h(
      'form',
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          const t = input.value.trim();
          if (!t) return;
          if (chat(t)) input.value = '';
          else input.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 });
        },
      },
      input,
      h('button', { class: 'btn small primary', type: 'submit' }, 'Senden'),
    ),
  );
}

function renderChatEntries(list: HTMLElement, log: ChatEntry[]): void {
  clear(list);
  if (!log.length) list.appendChild(h('div', { class: 'sys' }, 'Noch keine Nachrichten.'));
  for (const m of log.slice(-30)) list.appendChild(m.sys ? h('div', { class: 'sys' }, m.text) : h('div', null, h('b', null, `${m.name}: `), m.text));
  list.scrollTop = list.scrollHeight;
}

export function updateLobbyChat(log: ChatEntry[]): void {
  const list = document.querySelector('.lobby-chat-log') as HTMLElement | null;
  if (list) renderChatEntries(list, log);
}

export function renderLobby(
  view: View,
  send: (msg: ClientMsg) => void,
  leave: () => void,
  chatLog: ChatEntry[] = [],
  chat: (text: string) => boolean = (text) => (send({ t: 'chat', text }), true),
): void {
  let el = screens().querySelector('.screen.lobby-screen') as HTMLElement | null;
  if (!el) {
    clearScreens();
    el = h('div', { class: 'screen lobby-screen' });
    screens().appendChild(el);
  }
  const focused = document.activeElement instanceof HTMLInputElement && el.contains(document.activeElement) ? document.activeElement.value : null;
  clear(el);
  const me = view.players[view.you];
  const isHost = !!me?.isHost;
  const link = `${location.origin}/?room=${view.room}`;
  const copy = async () => {
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Wizard', text: `Spiel mit mir Wizard! Raum ${view.room}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast('Einladungslink kopiert!');
    } catch {
      toast(`Raumcode: ${view.room}`);
    }
  };

  const seats = h('div', { class: 'seats' });
  view.players.forEach((p, i) => {
    seats.appendChild(
      h(
        'div',
        { class: 'seat' },
        h('div', { class: 'av' }, avatarImg(p.avatar)),
        h('div', { class: 'nm' }, p.name),
        h(
          'div',
          { class: 'tags' },
          i === view.you ? h('span', { class: 'tag you' }, 'Du') : null,
          p.isHost ? h('span', { class: 'tag gold' }, 'Host') : null,
          p.bot ? h('span', { class: 'tag' }, `Bot · ${DIFF_LABEL[p.bot]}`) : null,
          !p.connected ? h('span', { class: 'tag off' }, 'getrennt') : null,
          isHost && i !== view.you ? h('button', { class: 'btn ghost small', title: 'Entfernen', onclick: () => send({ t: 'kick', seat: i }) }, '✕') : null,
        ),
      ),
    );
  });
  const free = MAX_PLAYERS - view.players.length;
  if (free > 0) {
    seats.appendChild(
      h(
        'div',
        { class: 'seat empty' },
        h('span', null, view.players.length < MIN_PLAYERS ? `Noch ${MIN_PLAYERS - view.players.length} Spieler nötig` : `${free} ${free === 1 ? 'Platz' : 'Plätze'} frei`),
        isHost
          ? h(
              'div',
              { class: 'tags' },
              h('span', { class: 'hint', style: 'margin:0 4px 0 0' }, 'Bot:'),
              (['easy', 'medium', 'hard'] as Difficulty[]).map((d) =>
                h('button', { class: 'btn small', onclick: () => send({ t: 'addBot', difficulty: d }) }, `+ ${DIFF_LABEL[d]}`),
              ),
            )
          : null,
      ),
    );
  }

  const canStart = view.players.length >= MIN_PLAYERS;
  el.appendChild(
    h(
      'div',
      { class: 'lobby panel' },
      h(
        'div',
        { class: 'lobby-head' },
        h('div', null, h('div', { class: 'room-sub' }, 'Raumcode'), h('div', { class: 'room-code gold-text' }, view.room ?? '')),
        h('button', { class: 'btn small', onclick: copy }, icon('link', 16), 'Einladen'),
      ),
      seats,
      optionFields(view.options, (o) => send({ t: 'options', options: o }), !isHost, true),
      lobbyChat(chatLog, chat),
      h(
        'div',
        { class: 'modal-actions', style: 'margin-top:0' },
        h('button', { class: 'btn', onclick: leave }, 'Verlassen'),
        isHost
          ? h('button', { class: 'btn primary', disabled: !canStart, onclick: () => send({ t: 'start' }) }, canStart ? 'Spiel starten' : 'Mindestens 3 Spieler')
          : h('button', { class: 'btn', disabled: true }, 'Warte auf den Host …'),
      ),
      h('p', { class: 'hint', style: 'text-align:center;margin-top:14px' }, `${totalRoundsFor(Math.max(view.players.length, 3), view.options.roundsMode)} Runden · Freunde treten mit dem Code oder Link bei`),
    ),
  );
  if (focused !== null) {
    const input = el.querySelector('.lobby-chat input') as HTMLInputElement | null;
    if (input) {
      input.value = focused;
      input.focus();
    }
  }
}

// ───────────────────────── Regeln & Einstellungen ─────────────────────────

export function openRules(): void {
  modal(
    h(
      'div',
      { class: 'rules' },
      h('h2', { class: 'gold-text' }, 'So wird Wizard gespielt'),
      h('p', null, 'Wizard ist ein Stichspiel für 3–6 Spieler mit 60 Karten: Zahlenkarten 1–13 in vier Farben (Menschen, Zwerge, Elfen, Riesen) sowie je vier ', h('b', null, 'Zauberer'), ' und ', h('b', null, 'Narren'), '.'),
      h('h3', null, 'Ablauf'),
      h(
        'ul',
        null,
        h('li', null, 'In Runde 1 bekommt jeder 1 Karte, in Runde 2 zwei Karten usw. – bis alle Karten verteilt sind.'),
        h('li', null, 'Die oberste übrige Karte bestimmt den ', h('b', null, 'Trumpf'), '. Ein Narr bedeutet: kein Trumpf. Bei einem Zauberer wählt der Geber die Trumpffarbe. In der letzten Runde gibt es keinen Trumpf.'),
        h('li', null, 'Jeder sagt reihum an, wie viele Stiche er machen wird.'),
      ),
      h('h3', null, 'Stiche'),
      h(
        'ul',
        null,
        h('li', null, 'Die ausgespielte Farbe muss ', h('b', null, 'bedient'), ' werden. Zauberer und Narren dürfen immer gespielt werden.'),
        h('li', null, 'Der erste Zauberer gewinnt den Stich. Sonst gewinnt der höchste Trumpf, sonst die höchste Karte der ausgespielten Farbe.'),
        h('li', null, 'Narren verlieren immer – außer es liegen nur Narren im Stich, dann gewinnt der erste.'),
        h('li', null, 'Wird ein Zauberer ausgespielt, dürfen alle anderen beliebige Karten legen. Bei einem Narren bestimmt die nächste Karte die Farbe.'),
      ),
      h('h3', null, 'Punkte'),
      h(
        'ul',
        null,
        h('li', null, 'Gebot genau erfüllt: ', h('b', null, '20 Punkte + 10 pro Stich'), '.'),
        h('li', null, 'Daneben: ', h('b', null, '−10 Punkte pro Stich Abweichung'), '.'),
      ),
      h('p', null, 'Wer nach der letzten Runde die meisten Punkte hat, gewinnt.'),
    ),
    { id: 'rules' },
  );
}

export function openSettings(settings: Settings, apply: (s: Settings) => void): void {
  const update = () => apply(settings);
  modal(
    h(
      'div',
      null,
      h('h2', { class: 'gold-text' }, 'Einstellungen'),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Grafikqualität'),
        seg(
          [
            ['low', 'Niedrig'],
            ['medium', 'Mittel'],
            ['high', 'Hoch'],
          ] as [Quality, string][],
          settings.quality,
          (v) => {
            settings.quality = v;
            update();
          },
        ),
        h('div', { class: 'hint' }, 'Hoch: Schatten, Leuchteffekte & Kantenglättung. Niedrig für ältere Geräte.'),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Animationen'),
        seg(
          [
            [false, 'Normal'],
            [true, 'Schnell'],
          ].map(([v, l]) => [v ? 'fast' : 'normal', l] as ['fast' | 'normal', string]),
          settings.fast ? 'fast' : 'normal',
          (v) => {
            settings.fast = v === 'fast';
            update();
          },
        ),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Ton'),
        seg(
          [
            ['on', 'An'],
            ['off', 'Aus'],
          ],
          settings.sound ? 'on' : 'off',
          (v) => {
            settings.sound = v === 'on';
            update();
          },
        ),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Lautstärke'),
        h('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.05,
          value: String(settings.volume),
          style: 'width:100%;accent-color:#e6c06a',
          oninput: (e: Event) => {
            settings.volume = Number((e.target as HTMLInputElement).value);
            update();
          },
        }),
      ),
    ),
    { id: 'settings' },
  );
}
