import type { CardId, Suit } from './cards';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameOptions {
  /** 'notEqual': Die Summe aller Gebote darf nicht der Stichzahl entsprechen. */
  bidRule: 'free' | 'notEqual';
  /** Spiellänge */
  roundsMode: 'full' | 'half' | 'quick';
}

export const DEFAULT_OPTIONS: GameOptions = { bidRule: 'free', roundsMode: 'full' };

export type GamePhase = 'bidding' | 'trump' | 'playing' | 'roundEnd' | 'gameEnd';
export type Phase = 'lobby' | GamePhase;

export interface TrickCard {
  seat: number;
  card: CardId;
}

export interface RoundResult {
  bid: number;
  tricks: number;
  delta: number;
  total: number;
}

export interface RoundRecord {
  round: number;
  results: RoundResult[];
}

export interface CompletedTrick {
  leader: number;
  cards: TrickCard[];
  winner: number;
}

export interface GameState {
  n: number;
  options: GameOptions;
  totalRounds: number;
  round: number;
  dealer: number;
  phase: GamePhase;
  hands: CardId[][];
  deck: CardId[];
  trumpCard: CardId | null;
  trumpSuit: Suit | null;
  bids: (number | null)[];
  tricks: number[];
  scores: number[];
  turn: number;
  leader: number;
  trick: TrickCard[];
  roundTricks: CompletedTrick[];
  history: RoundRecord[];
}

export type GameEvent =
  | { e: 'roundStart'; round: number; dealer: number; handSize: number }
  | { e: 'trump'; card: CardId | null; suit: Suit | null; needChoice: boolean }
  | { e: 'trumpChosen'; seat: number; suit: Suit }
  | { e: 'bid'; seat: number; bid: number }
  | { e: 'play'; seat: number; card: CardId }
  | { e: 'trickWon'; seat: number; cards: TrickCard[] }
  | { e: 'roundEnd'; record: RoundRecord }
  | { e: 'gameEnd'; ranking: number[] }
  | { e: 'info'; text: string };

export interface PlayerPublic {
  name: string;
  bot: Difficulty | null;
  connected: boolean;
  avatar: number;
  isHost: boolean;
  ready: boolean;
  /** Mensch hat das Spiel verlassen, ein Bot spielt weiter */
  replaced: boolean;
  bid: number | null;
  tricks: number;
  score: number;
  handCount: number;
}

export interface View {
  room: string | null;
  you: number;
  phase: Phase;
  options: GameOptions;
  players: PlayerPublic[];
  round: number;
  totalRounds: number;
  dealer: number;
  turn: number;
  leader: number;
  trumpCard: CardId | null;
  trumpSuit: Suit | null;
  hand: CardId[];
  trick: TrickCard[];
  lastTrick: TrickCard[] | null;
  history: RoundRecord[];
  forbiddenBid: number | null;
  deckCount: number;
  /** Sekunden bis zur automatischen nächsten Runde (nur Phase roundEnd) */
  autoNextIn: number | null;
}

export type ClientMsg =
  | { t: 'join'; token: string; name: string; avatar: number }
  | { t: 'options'; options: GameOptions }
  | { t: 'addBot'; difficulty: Difficulty }
  | { t: 'kick'; seat: number }
  | { t: 'start' }
  | { t: 'bid'; bid: number }
  | { t: 'trump'; suit: Suit }
  | { t: 'play'; card: CardId }
  | { t: 'ready' }
  | { t: 'toLobby' }
  | { t: 'leave' }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'state'; view: View; events: GameEvent[]; full?: boolean }
  | { t: 'error'; code: string; message: string; retryIn?: number }
  | { t: 'chat'; seat: number; name: string; text: string }
  | { t: 'pong' };

/** Anzahl der wählbaren Avatar-Medaillons */
export const AVATAR_COUNT = 12;

// ───────────────────────── Statistik (Admin-Seite) ─────────────────────────

export type GameMode = 'online' | 'solo';

/** Beginn und Ende eines Spiels, gemeldet vom Spielraum */
export type StatsEvent =
  | {
      type: 'start';
      id: string;
      mode: GameMode;
      players: number;
      /** Namen der menschlichen Spieler */
      humans: string[];
      rounds: number;
      roundsMode: GameOptions['roundsMode'];
      room: string | null;
    }
  | { type: 'end'; id: string; mode: GameMode; winner: string; winnerBot: boolean };

export interface StatsGame {
  id: string;
  mode: GameMode;
  startedAt: number;
  endedAt: number | null;
  players: number;
  humans: string[];
  rounds: number;
  roundsMode: GameOptions['roundsMode'];
  room: string | null;
  winner: string | null;
  winnerBot: boolean;
}

export interface StatsResponse {
  /** Anzahl aller gespeicherten Spiele (die Liste kann gekürzt sein) */
  total: number;
  games: StatsGame[];
  now: number;
}
