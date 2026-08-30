/**
 * 27/8/2026 (R092) — «STRATEGIA MERGE» ERA SCRITTO SOLO NEL COMMENTO.
 *
 * Chi ha due dispositivi — il telefono mentre cammina, il computer da casa — al momento
 * dell'accesso perdeva in silenzio gli articoli del dispositivo meno recente: il carrello del cloud
 * non veniva fuso con quello locale, lo SOSTITUIVA. In testa al file c'era scritto «Strategia
 * merge»; nel codice c'era una sostituzione integrale.
 *
 * Il caso raggiungibile davvero è quello onesto: il cloud È genuinamente più recente (l'altro
 * dispositivo ha aggiunto qualcosa dopo). Lì i tre articoli scelti qui sparivano senza un avviso, e
 * la perdita è definitiva: nessuno può accorgersene, perché nessuno ricorda cosa c'era.
 *
 * La regola è quella che si aspetterebbe chiunque: si tengono tutti e due, e per la stessa riga —
 * stesso prodotto E stessa variante, come dice `sameLine` — vale la quantità più alta.
 */
import { describe, it, expect } from 'vitest';
import { fondiCarrelli, MAX_PEZZI_PER_ARTICOLO, type CartItem } from '@/lib/cart';

const riga = (id: string, quantity: number, extra: Partial<CartItem> = {}): CartItem => ({
  id, name: `Articolo ${id}`, price: 5, quantity, ...extra,
});

describe('quando il carrello del telefono incontra quello del computer', () => {
  it('tre articoli qui e due di là fanno cinque, non due', () => {
    const locale = [riga('a', 1), riga('b', 2), riga('c', 1)];
    const cloud = [riga('d', 1), riga('e', 3)];

    const fuso = fondiCarrelli(locale, cloud);

    expect(fuso.map((r) => r.id).sort(), 'gli articoli del dispositivo meno recente sparivano senza avviso')
      .toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lo stesso articolo da tutte e due le parti resta uno, con la quantità più alta', () => {
    const fuso = fondiCarrelli([riga('a', 1)], [riga('a', 4)]);
    expect(fuso).toHaveLength(1);
    expect(fuso[0].quantity).toBe(4);
  });

  it('due taglie dello stesso prodotto sono due righe diverse', () => {
    // `sameLine` dice che una riga è prodotto PIÙ variante: la maglia M e la maglia L non si
    // schiacciano l'una sull'altra.
    const fuso = fondiCarrelli(
      [riga('maglia', 1, { variantId: 'M', variantLabel: 'M' })],
      [riga('maglia', 1, { variantId: 'L', variantLabel: 'L' })],
    );
    expect(fuso).toHaveLength(2);
  });

  it('la fusione non sfonda il tetto di pezzi che la cassa accetta', () => {
    const fuso = fondiCarrelli([riga('a', 90)], [riga('a', 99)]);
    expect(fuso[0].quantity).toBeLessThanOrEqual(MAX_PEZZI_PER_ARTICOLO);
  });

  it('un carrello vuoto da una parte lascia intatto l altro', () => {
    expect(fondiCarrelli([], [riga('a', 2)])).toEqual([riga('a', 2)]);
    expect(fondiCarrelli([riga('a', 2)], [])).toEqual([riga('a', 2)]);
  });

  it('l ordine di chi sta guardando lo schermo non si scombina', () => {
    const fuso = fondiCarrelli([riga('a', 1), riga('b', 1)], [riga('c', 1), riga('a', 2)]);
    expect(fuso.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('nessuno dei due carrelli di partenza viene modificato', () => {
    const locale = [riga('a', 1)];
    const cloud = [riga('a', 5)];
    fondiCarrelli(locale, cloud);
    expect(locale[0].quantity).toBe(1);
    expect(cloud[0].quantity).toBe(5);
  });
});
