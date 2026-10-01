/**
 * Kartendefinition für Wizard.
 * 60 Karten: Ids 0–51 = Zahlenkarten (4 Farben × 1–13), 52–55 = Zauberer, 56–59 = Narren.
 */

export type Suit = 0 | 1 | 2 | 3;
export type CardId = number;

export const NUM_CARDS = 60;
export const SUITS: readonly Suit[] = [0, 1, 2, 3];

export interface SuitInfo {
  name: string;
  people: string;
  color: string;
  dark: string;
  light: string;
}

export const SUIT_INFO: readonly SuitInfo[] = [
  { name: 'Blau', people: 'Menschen', color: '#2f6fd6', dark: '#10306e', light: '#a9c8ff' },
  { name: 'Rot', people: 'Zwerge', color: '#d03a33', dark: '#5e1210', light: '#ffb3aa' },
  { name: 'Grün', people: 'Elfen', color: '#2c9b54', dark: '#0e4626', light: '#aef0c4' },
  { name: 'Gelb', people: 'Riesen', color: '#d4961a', dark: '#5e3c00', light: '#ffe2a0' },
];

export const isWizard = (c: CardId): boolean => c >= 52 && c < 56;
export const isJester = (c: CardId): boolean => c >= 56 && c < 60;
export const isNumbered = (c: CardId): boolean => c >= 0 && c < 52;

export function suitOf(c: CardId): Suit | null {
  return c < 52 ? (Math.floor(c / 13) as Suit) : null;
}

export function valueOf(c: CardId): number {
  return c < 52 ? (c % 13) + 1 : 0;
}

export function cardId(suit: Suit, value: number): CardId {
  return suit * 13 + (value - 1);
}

export function cardLabel(c: CardId): string {
  if (isWizard(c)) return 'Zauberer';
  if (isJester(c)) return 'Narr';
  const s = suitOf(c)!;
  return `${SUIT_INFO[s].name} ${valueOf(c)}`;
}

/** Sortierwert: Narren links, dann Farben aufsteigend, Trumpf rechts, Zauberer ganz rechts. */
function sortKey(c: CardId, trump: Suit | null): number {
  if (isJester(c)) return c - 56;
  if (isWizard(c)) return 1000 + c;
  const s = suitOf(c)!;
  // feste Farbreihenfolge mit abwechselnden Hell/Dunkel-Tönen für bessere Lesbarkeit
  const order = [0, 3, 2, 1];
  const rank = s === trump ? 10 : order.indexOf(s);
  return 100 + rank * 20 + valueOf(c);
}

export function sortHand(hand: readonly CardId[], trump: Suit | null): CardId[] {
  return hand.slice().sort((a, b) => sortKey(a, trump) - sortKey(b, trump));
}
