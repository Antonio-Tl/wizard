import { type CardId, type Suit, NUM_CARDS, isJester, isWizard, suitOf, valueOf } from './cards';
import { forbiddenBid, leadSuit, legalCards, playedThisRound, shuffle, trickWinnerIndex } from './rules';
import type { Difficulty, GameState } from './types';

/**
 * Bot-KI: schätzt Gewinnwahrscheinlichkeiten über die noch unbekannten Karten
 * (Kartenzählen) und versucht, das eigene Gebot exakt zu treffen.
 * Die Bots schauen nie in fremde Hände – sie nutzen nur öffentliche Informationen.
 */

interface Knowledge {
  unseen: boolean[];
  U: number;
  wizards: number;
  bySuit: number[];
  trump: Suit | null;
  /** voids[seat][suit] – Spieler hat bewiesenermaßen keine Karte dieser Farbe mehr */
  voids: boolean[][] | null;
}

function knowledge(known: Iterable<CardId>, trump: Suit | null): Knowledge {
  const unseen = new Array<boolean>(NUM_CARDS).fill(true);
  for (const c of known) unseen[c] = false;
  let U = 0;
  let wizards = 0;
  const bySuit = [0, 0, 0, 0];
  for (let c = 0; c < NUM_CARDS; c++) {
    if (!unseen[c]) continue;
    U++;
    if (isWizard(c)) wizards++;
    const s = suitOf(c);
    if (s !== null) bySuit[s]++;
  }
  return { unseen, U: Math.max(U, 1), wizards, bySuit, trump, voids: null };
}

function gameKnowledge(st: GameState, seat: number, diff: Difficulty): Knowledge {
  // Nur "schwer" merkt sich alle gespielten Karten der Runde, die anderen sehen nur den aktuellen Stich
  const useVoids = diff === 'hard';
  const played = diff === 'hard' ? playedThisRound(st) : st.trick.map((t) => t.card);
  const known = [...st.hands[seat], ...played];
  if (st.trumpCard !== null) known.push(st.trumpCard);
  const k = knowledge(known, st.trumpSuit);
  if (useVoids) {
    const voids = Array.from({ length: st.n }, () => [false, false, false, false]);
    for (const cards of [...st.roundTricks.map((t) => t.cards), st.trick]) {
      for (let i = 0; i < cards.length; i++) {
        const lead = leadSuit(cards.slice(0, i));
        if (lead === null) continue;
        const s = suitOf(cards[i].card);
        if (s !== null && s !== lead) voids[cards[i].seat][lead] = true;
      }
    }
    k.voids = voids;
  }
  return k;
}

function unseenHigher(k: Knowledge, suit: Suit, value: number): number {
  let n = 0;
  for (let v = value + 1; v <= 13; v++) if (k.unseen[suit * 13 + v - 1]) n++;
  return n;
}

const atLeastOne = (count: number, U: number, h: number) =>
  count <= 0 || h <= 0 ? 0 : 1 - Math.pow(1 - Math.min(count / U, 1), h);

/**
 * Wahrscheinlichkeit, dass ein Spieler mit h Karten die Karte c (aktuell beste Karte,
 * Bedienfarbe `lead`) noch schlägt.
 */
function beatChance(k: Knowledge, c: CardId, lead: Suit | null, h: number, player: number, willing: number): number {
  if (h === 0) return 0;
  const trump = k.trump;
  const s = suitOf(c)!;
  const v = valueOf(c);
  const isVoid = lead !== null && k.voids !== null && k.voids[player][lead];
  const pW = atLeastOne(k.wizards, k.U, h) * 0.55 * willing;
  const voidLead = lead === null || isVoid ? 1 : Math.pow(1 - Math.min(k.bySuit[lead] / k.U, 1), h);

  let pS = 0;
  let pT = 0;
  if (trump !== null && s === trump) {
    pT = atLeastOne(unseenHigher(k, s, v), k.U, h);
    if (lead !== null && lead !== trump) pT *= voidLead;
    pT *= 0.9 * willing;
  } else {
    if (!isVoid) pS = atLeastOne(unseenHigher(k, s, v), k.U, h) * 0.9 * willing;
    if (trump !== null) pT = voidLead * atLeastOne(k.bySuit[trump], k.U, h) * 0.85 * willing;
  }
  return 1 - (1 - pW) * (1 - pS) * (1 - pT);
}

function willingness(st: GameState, player: number, diff: Difficulty): number {
  if (diff !== 'hard') return 0.8;
  const bid = st.bids[player];
  if (bid === null) return 0.8;
  return bid - st.tricks[player] > 0 ? 1 : 0.6;
}

/** Gewinnwahrscheinlichkeit, wenn `seat` jetzt Karte c in den aktuellen Stich legt. */
function winProb(st: GameState, seat: number, c: CardId, k: Knowledge, diff: Difficulty): number {
  const trick = st.trick;
  if (trick.some((t) => isWizard(t.card))) return 0;
  if (isWizard(c)) return 1;
  if (isJester(c)) return 0;
  if (trick.length > 0) {
    const cards = [...trick.map((t) => t.card), c];
    if (trickWinnerIndex(cards, st.trumpSuit) !== cards.length - 1) return 0;
  }
  const lead = leadSuit(trick) ?? suitOf(c);
  let p = 1;
  for (let i = trick.length + 1; i < st.n; i++) {
    const player = (seat + i - trick.length) % st.n;
    p *= 1 - beatChance(k, c, lead, st.hands[player].length, player, willingness(st, player, diff));
  }
  return p;
}

function strength(c: CardId, trump: Suit | null): number {
  if (isWizard(c)) return 100;
  if (isJester(c)) return -1;
  return (suitOf(c) === trump ? 40 : 0) + valueOf(c);
}

/** Wie gerne eine Karte abgeworfen wird, wenn man den Stich nicht will/kann (niedrig = zuerst). */
function dumpCost(c: CardId, trump: Suit | null): number {
  if (isJester(c)) return 7.5;
  return strength(c, trump);
}

/** Rohschätzung einer Hand: sichere Zauberer-Stiche und "weiche" Stiche aus Farbkarten. */
function rawEstimate(hand: readonly CardId[], n: number, trump: Suit | null, trumpCard: CardId | null) {
  const h = hand.length;
  const known = trumpCard !== null ? [...hand, trumpCard] : hand;
  const k = knowledge(known, trump);
  const counts = [0, 0, 0, 0];
  for (const c of hand) {
    const s = suitOf(c);
    if (s !== null) counts[s]++;
  }
  let wiz = 0;
  let soft = 0;
  let lowTrumps = 0;
  for (const c of hand) {
    if (isWizard(c)) {
      wiz += 0.94;
      continue;
    }
    if (isJester(c)) continue;
    const s = suitOf(c)!;
    let p = Math.pow(1 - beatChance(k, c, s, h, 0, 0.8), n - 1);
    if (s === trump) {
      p = Math.min(1, p * 1.15 + 0.05);
      if (p < 0.55) lowTrumps++;
    } else {
      p *= counts[s] >= 4 ? 0.7 : 0.88;
    }
    soft += p;
  }
  if (trump !== null && h >= 3) {
    let shortness = 0;
    for (let s = 0; s < 4; s++) {
      if (s === trump) continue;
      if (counts[s] === 0) shortness += 1;
      else if (counts[s] === 1) shortness += 0.45;
    }
    soft += Math.min(lowTrumps, shortness) * 0.5;
  }
  return { wiz, soft };
}

/**
 * Erwartete Stiche. Die Rohschätzung wird über zufällige Gegnerhände normalisiert:
 * Alle Stiche einer Runde müssen an irgendwen gehen, die Summe aller Erwartungen ist also h.
 */
export function estimateTricks(st: GameState, seat: number, rnd: () => number = Math.random): number {
  const hand = st.hands[seat];
  const h = hand.length;
  if (h === 0) return 0;
  const me = rawEstimate(hand, st.n, st.trumpSuit, st.trumpCard);
  const mine = new Set(hand);
  const pool: CardId[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!mine.has(c) && c !== st.trumpCard) pool.push(c);
  const samples = 6;
  let oppSoft = 0;
  let oppWiz = 0;
  for (let i = 0; i < samples; i++) {
    shuffle(pool, rnd);
    for (let j = 0; j < st.n - 1; j++) {
      const r = rawEstimate(pool.slice(j * h, (j + 1) * h), st.n, st.trumpSuit, st.trumpCard);
      oppSoft += r.soft / samples;
      oppWiz += r.wiz / samples;
    }
  }
  const target = Math.max(0, h - me.wiz - oppWiz);
  const totalSoft = me.soft + oppSoft;
  const est = me.wiz + (totalSoft > 0 ? (me.soft * target) / totalSoft : 0);
  return Math.min(est, h);
}

export function botBid(st: GameState, seat: number, diff: Difficulty, rnd: () => number = Math.random): number {
  const max = st.round;
  let est = estimateTricks(st, seat, rnd);
  if (diff === 'hard') {
    // Bisherige Gebote der anderen berücksichtigen: hohe Gebote = mehr Konkurrenz um Stiche
    let placed = 0;
    let sum = 0;
    st.bids.forEach((b, i) => {
      if (i !== seat && b !== null) {
        placed++;
        sum += b;
      }
    });
    if (placed > 0) {
      const expected = (placed / (st.n - 1)) * Math.max(0, max - est);
      est = Math.max(0, Math.min(max, est - 0.3 * (sum - expected)));
    }
  }
  let bid = Math.round(est);
  if (diff === 'easy' && rnd() < 0.55) bid += rnd() < 0.5 ? -1 : 1;
  bid = Math.max(0, Math.min(max, bid));
  const forbidden = forbiddenBid(st);
  if (bid === forbidden) {
    const up = bid + 1 <= max;
    const down = bid - 1 >= 0;
    if (up && (!down || est > bid)) bid += 1;
    else bid -= 1;
  }
  return bid;
}

export function botTrump(st: GameState, seat: number): Suit {
  const score = [0, 0, 0, 0];
  for (const c of st.hands[seat]) {
    const s = suitOf(c);
    if (s !== null) score[s] += 1 + valueOf(c) / 13;
  }
  let best: Suit = 0;
  for (let s = 1; s < 4; s++) if (score[s] > score[best]) best = s as Suit;
  return best;
}

export function botPlay(st: GameState, seat: number, diff: Difficulty, rnd: () => number = Math.random): CardId {
  const hand = st.hands[seat];
  const legal = legalCards(hand, st.trick);
  if (legal.length === 1) return legal[0];
  if (diff === 'easy' && rnd() < 0.3) return legal[Math.floor(rnd() * legal.length)];

  const trump = st.trumpSuit;
  const k = gameKnowledge(st, seat, diff);
  const need = (st.bids[seat] ?? 0) - st.tricks[seat];
  const remaining = hand.length;
  const probs = new Map<CardId, number>();
  for (const c of legal) probs.set(c, winProb(st, seat, c, k, diff));
  const p = (c: CardId) => probs.get(c)!;
  const byStrength = (a: CardId, b: CardId) => strength(a, trump) - strength(b, trump);

  if (need > 0) {
    if (need >= remaining) {
      return legal.slice().sort((a, b) => p(b) - p(a) || byStrength(b, a))[0];
    }
    const threshold = st.trick.length === st.n - 1 ? 0.99 : 0.6;
    const good = legal.filter((c) => p(c) >= threshold);
    if (good.length > 0) {
      // Billigsten sicheren Gewinner nehmen; Zauberer möglichst sparen
      return good.sort(byStrength)[0];
    }
    const pressure = need / remaining;
    const best = legal.slice().sort((a, b) => p(b) - p(a) || byStrength(a, b))[0];
    if (p(best) > 0.3 && pressure >= 0.5) return best;
    if (p(best) > 0.45) return best;
    return legal.slice().sort((a, b) => dumpCost(a, trump) - dumpCost(b, trump))[0];
  }

  // Keine Stiche mehr gewollt: gefährliche Karten loswerden, solange es sicher ist
  const safe = legal.filter((c) => p(c) <= 0.12);
  if (safe.length > 0) {
    return safe.sort((a, b) => strength(b, trump) - strength(a, trump))[0];
  }
  return legal.slice().sort((a, b) => p(a) - p(b) || (p(a) >= 0.99 ? byStrength(b, a) : byStrength(a, b)))[0];
}
