/**
 * Simuliert viele Bot-Spiele, um Regeln und KI zu prüfen.
 * Aufruf: npm run sim [-- anzahlSpiele]
 */
import { botBid, botPlay, botTrump } from '../src/shared/bot';
import { NUM_CARDS } from '../src/shared/cards';
import { doBid, doPlay, doTrump, newGame, startRound } from '../src/shared/rules';
import type { Difficulty, GameState } from '../src/shared/types';

declare const process: { argv: string[] };
const games = Number(process.argv[2] ?? 300);

function checkInvariants(st: GameState) {
  const seen = new Set<number>();
  const add = (c: number) => {
    if (seen.has(c)) throw new Error(`Karte doppelt: ${c}`);
    seen.add(c);
  };
  st.hands.flat().forEach(add);
  st.deck.forEach(add);
  if (st.trumpCard !== null) add(st.trumpCard);
  st.roundTricks.forEach((t) => t.cards.forEach((c) => add(c.card)));
  st.trick.forEach((c) => add(c.card));
  if (seen.size !== NUM_CARDS) throw new Error(`Kartenanzahl falsch: ${seen.size}`);
}

function play(diffs: Difficulty[], bidRule: 'free' | 'notEqual') {
  const n = diffs.length;
  const st = newGame(n, { bidRule, roundsMode: 'full' }, 0);
  const stats = diffs.map(() => ({ hits: 0, rounds: 0 }));
  startRound(st);
  for (;;) {
    checkInvariants(st);
    if (st.phase === 'trump') doTrump(st, st.turn, botTrump(st, st.turn));
    else if (st.phase === 'bidding') doBid(st, st.turn, botBid(st, st.turn, diffs[st.turn]));
    else if (st.phase === 'playing') doPlay(st, st.turn, botPlay(st, st.turn, diffs[st.turn]));
    else {
      const rec = st.history[st.history.length - 1];
      rec.results.forEach((r, i) => {
        stats[i].rounds++;
        if (r.bid === r.tricks) stats[i].hits++;
      });
      if (st.phase === 'gameEnd') break;
      startRound(st);
    }
  }
  return { scores: st.scores.slice(), stats };
}

for (const n of [3, 4, 5, 6]) {
  const agg: Record<Difficulty, { hits: number; rounds: number; score: number; games: number }> = {
    easy: { hits: 0, rounds: 0, score: 0, games: 0 },
    medium: { hits: 0, rounds: 0, score: 0, games: 0 },
    hard: { hits: 0, rounds: 0, score: 0, games: 0 },
  };
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const pool: Difficulty[] = ['easy', 'medium', 'hard'];
    const diffs = Array.from({ length: n }, (_, i) => pool[(i + g) % 3]);
    const r = play(diffs, g % 2 ? 'notEqual' : 'free');
    diffs.forEach((d, i) => {
      agg[d].hits += r.stats[i].hits;
      agg[d].rounds += r.stats[i].rounds;
      agg[d].score += r.scores[i];
      agg[d].games++;
    });
  }
  const ms = (Date.now() - t0) / games;
  const line = (Object.keys(agg) as Difficulty[])
    .map((d) => `${d}: ${((100 * agg[d].hits) / agg[d].rounds).toFixed(1)}% Treffer, Ø ${(agg[d].score / agg[d].games).toFixed(0)} Pkt`)
    .join(' | ');
  console.log(`${n} Spieler (${ms.toFixed(1)} ms/Spiel) → ${line}`);
}
