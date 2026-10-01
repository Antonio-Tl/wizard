import {
  type CardId,
  type Suit,
  NUM_CARDS,
  isJester,
  isNumbered,
  isWizard,
  sortHand,
  suitOf,
  valueOf,
} from './cards';
import type { GameEvent, GameOptions, GameState, RoundRecord, TrickCard } from './types';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

export class RuleError extends Error {}

export function totalRoundsFor(n: number, mode: GameOptions['roundsMode']): number {
  const full = Math.floor(NUM_CARDS / n);
  if (mode === 'half') return Math.ceil(full / 2);
  if (mode === 'quick') return Math.min(full, 5);
  return full;
}

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Bedienpflichtige Farbe eines Stichs, null = beliebig (noch keine Farbe oder Zauberer ausgespielt). */
export function leadSuit(trick: readonly TrickCard[]): Suit | null {
  for (const t of trick) {
    if (isJester(t.card)) continue;
    if (isWizard(t.card)) return null;
    return suitOf(t.card);
  }
  return null;
}

export function legalCards(hand: readonly CardId[], trick: readonly TrickCard[]): CardId[] {
  const lead = leadSuit(trick);
  if (lead === null) return hand.slice();
  const canFollow = hand.some((c) => suitOf(c) === lead);
  if (!canFollow) return hand.slice();
  return hand.filter((c) => !isNumbered(c) || suitOf(c) === lead);
}

/** Index der gewinnenden Karte innerhalb der Kartenliste (in Ausspielreihenfolge). */
export function trickWinnerIndex(cards: readonly CardId[], trump: Suit | null): number {
  const w = cards.findIndex(isWizard);
  if (w >= 0) return w;
  let best = -1;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (isJester(c)) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const b = cards[best];
    const cs = suitOf(c);
    const bs = suitOf(b);
    if (trump !== null && cs === trump && bs !== trump) best = i;
    else if (cs === bs && valueOf(c) > valueOf(b)) best = i;
  }
  return best < 0 ? 0 : best;
}

export function scoreFor(bid: number, tricks: number): number {
  return bid === tricks ? 20 + 10 * tricks : -10 * Math.abs(bid - tricks);
}

export function newGame(n: number, options: GameOptions, firstDealer: number): GameState {
  return {
    n,
    options: { ...options },
    totalRounds: totalRoundsFor(n, options.roundsMode),
    round: 0,
    dealer: (firstDealer - 1 + n) % n,
    phase: 'bidding',
    hands: [],
    deck: [],
    trumpCard: null,
    trumpSuit: null,
    bids: [],
    tricks: [],
    scores: new Array(n).fill(0),
    turn: 0,
    leader: 0,
    trick: [],
    roundTricks: [],
    history: [],
  };
}

export function startRound(st: GameState, rnd: () => number = Math.random): GameEvent[] {
  const n = st.n;
  st.round++;
  st.dealer = (st.dealer + 1) % n;
  const deck = shuffle(
    Array.from({ length: NUM_CARDS }, (_, i) => i),
    rnd,
  );
  st.hands = Array.from({ length: n }, () => []);
  for (let i = 0; i < st.round; i++) {
    for (let k = 0; k < n; k++) {
      st.hands[(st.dealer + 1 + k) % n].push(deck.pop()!);
    }
  }
  st.trumpCard = deck.length > 0 ? deck.pop()! : null;
  st.deck = deck;
  st.bids = new Array(n).fill(null);
  st.tricks = new Array(n).fill(0);
  st.trick = [];
  st.roundTricks = [];
  st.leader = (st.dealer + 1) % n;

  const events: GameEvent[] = [{ e: 'roundStart', round: st.round, dealer: st.dealer, handSize: st.round }];
  const tc = st.trumpCard;
  if (tc !== null && isWizard(tc)) {
    st.trumpSuit = null;
    st.phase = 'trump';
    st.turn = st.dealer;
    events.push({ e: 'trump', card: tc, suit: null, needChoice: true });
  } else {
    st.trumpSuit = tc !== null && isNumbered(tc) ? suitOf(tc) : null;
    st.phase = 'bidding';
    st.turn = (st.dealer + 1) % n;
    events.push({ e: 'trump', card: tc, suit: st.trumpSuit, needChoice: false });
  }
  for (let s = 0; s < n; s++) st.hands[s] = sortHand(st.hands[s], st.trumpSuit);
  return events;
}

export function forbiddenBid(st: GameState): number | null {
  if (st.options.bidRule !== 'notEqual' || st.phase !== 'bidding') return null;
  const placed = st.bids.filter((b) => b !== null).length;
  if (placed !== st.n - 1) return null;
  const sum = st.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
  const f = st.round - sum;
  return f >= 0 ? f : null;
}

export function doTrump(st: GameState, seat: number, suit: Suit): GameEvent[] {
  if (st.phase !== 'trump') throw new RuleError('Jetzt wird kein Trumpf gewählt.');
  if (seat !== st.dealer) throw new RuleError('Nur der Geber wählt den Trumpf.');
  if (![0, 1, 2, 3].includes(suit)) throw new RuleError('Ungültige Farbe.');
  st.trumpSuit = suit;
  st.phase = 'bidding';
  st.turn = (st.dealer + 1) % st.n;
  for (let s = 0; s < st.n; s++) st.hands[s] = sortHand(st.hands[s], st.trumpSuit);
  return [{ e: 'trumpChosen', seat, suit }];
}

export function doBid(st: GameState, seat: number, bid: number): GameEvent[] {
  if (st.phase !== 'bidding') throw new RuleError('Es wird gerade nicht geboten.');
  if (seat !== st.turn) throw new RuleError('Du bist nicht an der Reihe.');
  if (!Number.isInteger(bid) || bid < 0 || bid > st.round) throw new RuleError('Ungültiges Gebot.');
  if (bid === forbiddenBid(st)) throw new RuleError(`Gebot ${bid} ist nicht erlaubt – die Gebote dürfen nicht aufgehen.`);
  st.bids[seat] = bid;
  if (st.bids.every((b) => b !== null)) {
    st.phase = 'playing';
    st.turn = st.leader;
  } else {
    st.turn = (seat + 1) % st.n;
  }
  return [{ e: 'bid', seat, bid }];
}

export function doPlay(st: GameState, seat: number, card: CardId): GameEvent[] {
  if (st.phase !== 'playing') throw new RuleError('Es wird gerade nicht gespielt.');
  if (seat !== st.turn) throw new RuleError('Du bist nicht an der Reihe.');
  const hand = st.hands[seat];
  const idx = hand.indexOf(card);
  if (idx < 0) throw new RuleError('Diese Karte hast du nicht.');
  if (!legalCards(hand, st.trick).includes(card)) throw new RuleError('Du musst Farbe bedienen.');

  hand.splice(idx, 1);
  st.trick.push({ seat, card });
  const events: GameEvent[] = [{ e: 'play', seat, card }];

  if (st.trick.length < st.n) {
    st.turn = (seat + 1) % st.n;
    return events;
  }

  const wi = trickWinnerIndex(
    st.trick.map((t) => t.card),
    st.trumpSuit,
  );
  const winner = st.trick[wi].seat;
  st.tricks[winner]++;
  const cards = st.trick;
  st.roundTricks.push({ leader: st.leader, cards, winner });
  events.push({ e: 'trickWon', seat: winner, cards });
  st.trick = [];
  st.leader = winner;
  st.turn = winner;

  if (st.hands.every((h) => h.length === 0)) {
    const record: RoundRecord = { round: st.round, results: [] };
    for (let s = 0; s < st.n; s++) {
      const bid = st.bids[s] ?? 0;
      const delta = scoreFor(bid, st.tricks[s]);
      st.scores[s] += delta;
      record.results.push({ bid, tricks: st.tricks[s], delta, total: st.scores[s] });
    }
    st.history.push(record);
    events.push({ e: 'roundEnd', record });
    st.phase = 'roundEnd';
    if (st.round >= st.totalRounds) {
      st.phase = 'gameEnd';
      events.push({ e: 'gameEnd', ranking: ranking(st.scores) });
    }
  }
  return events;
}

export function ranking(scores: readonly number[]): number[] {
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.i);
}

/** Alle Karten, die in dieser Runde bereits offen gespielt wurden. */
export function playedThisRound(st: GameState): CardId[] {
  const out: CardId[] = [];
  for (const t of st.roundTricks) for (const c of t.cards) out.push(c.card);
  for (const c of st.trick) out.push(c.card);
  return out;
}
