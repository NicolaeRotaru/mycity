/**
 * R12-012 — Se il nome del negozio comincia con un numero, un apostrofo, le
 * virgolette o contiene una parola inglese come «Table», il cliente in cassa
 * leggeva «Qualcosa non ha funzionato» invece del motivo vero. Il percorso è
 * quello vero della cassa: la rotta risponde, la pagina fa
 * `new Error(apiErrorMessage(body))` e mostra `friendlyError(err)`.
 */
import { describe, it, expect } from 'vitest';
import { apiErrorMessage, friendlyError } from '@/lib/errors';

const comeLaCassa = (messaggioDellaRotta: string) =>
  friendlyError(new Error(apiErrorMessage({ ok: false, error: { code: 'conflict', message: messaggioDellaRotta } })));

const GENERICO = /Qualcosa non ha funzionato/;

describe('R12-012 il motivo del rifiuto arriva al cliente, qualunque sia il nome del negozio', () => {
  for (const nome of ['3 Archi', '«Da Mario»', "'L Furnè", 'Bistrot La Table', 'Pane Quotidiano', 'Caffè Row & Co']) {
    it(`«${nome}»`, () => {
      const motivo = `${nome} adesso è chiuso: la consegna veloce non si può. Scegli una fascia oraria.`;
      expect(comeLaCassa(motivo)).toBe(motivo);
    });
  }

  it('il motivo del negozio chiuso in quella fascia (motivoNegozioChiuso) passa anche con le parentesi', () => {
    const motivo = 'Bistrot La Table oggi è chiuso in quella fascia (apre alle 18:00): scegline un\'altra.';
    expect(comeLaCassa(motivo)).toBe(motivo);
  });

  it('un errore grezzo del database resta nascosto, anche se arriva dalla stessa strada', () => {
    expect(comeLaCassa('relation "orders" does not exist')).toMatch(GENERICO);
    expect(comeLaCassa('null value in column "seller_id" violates not-null constraint')).toMatch(GENERICO);
    expect(friendlyError(new Error('duplicate key value violates unique constraint "x"'))).not.toMatch(/duplicate key/);
  });

  it('un errore grezzo che non è passato dalla rotta resta filtrato come prima', () => {
    expect(friendlyError(new Error('Bistrot La Table adesso è chiuso'))).toMatch(GENERICO);
  });
});
