import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { motivoNegozioChiuso } from '@/lib/store-hours';

/**
 * 13/11/2026 (R24-004) — IL MOTIVO VERO DEL RIFIUTO IN CASSA, ANCHE COL NOME «STRANO».
 *
 * La cassa fa `throw new Error(apiErrorMessage(body, …))` e poi
 * `toast.error(friendlyError(err))` (app/checkout/page.tsx). Il filtro finale di
 * friendlyError indovinava «frase nostra» dalla forma: un negozio che si chiama
 * «Bistrot La Table» o «Row Bar» (parole da database) o «1920 Bottega» (numero di
 * quattro cifre in testa) faceva uscire «Qualcosa non ha funzionato» al posto di
 * «… è chiuso». Il 5/11 erano passati solo cifra singola, virgolette e apostrofo.
 *
 * Adesso il segno lo mette la rotta: un rifiuto CONFLICT è scritto per il cliente.
 */

const comeLaCassa = (body: unknown) => friendlyError(new Error(apiErrorMessage(body, 'Creazione ordine fallita')));
const rifiuto = (message: string) => ({ ok: false, error: { code: 'CONFLICT', message } });

afterEach(() => {
  vi.useRealTimers();
});

describe('il rifiuto della cassa arriva intero, qualunque sia il nome del negozio', () => {
  it.each(['Bistrot La Table', 'Row Bar', '1920 Bottega', '3 Archi', '«Da Mario»', "'L Furnè", 'Pane Quotidiano'])(
    '«%s» è chiuso: il cliente legge il motivo, non il generico',
    (nome) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T21:30:00+01:00'));
      const motivo = motivoNegozioChiuso(nome, null, new Date());
      expect(comeLaCassa(rifiuto(motivo))).toBe(motivo);
      const veloce = `${nome} adesso è chiuso: la consegna veloce non si può. Scegli una fascia oraria: la consegna arriva quando la scegli tu.`;
      expect(comeLaCassa(rifiuto(veloce))).toBe(veloce);
    },
  );

  it('le parentesi del motivo restano', () => {
    const motivo = 'Bistrot La Table (via Roma) adesso è chiuso: la consegna veloce non si può.';
    expect(comeLaCassa(rifiuto(motivo))).toBe(motivo);
  });
});

describe('i filtri restano per tutto il resto', () => {
  it('un errore grezzo del database, senza il segno della rotta, non passa', () => {
    expect(friendlyError(new Error('relation "orders_x" does not exist'))).not.toMatch(/relation|orders_x/);
    expect(comeLaCassa({ ok: false, error: { code: 'INTERNAL', message: 'column "table_row" of relation "x" does not exist' } })).not.toMatch(
      /column|relation/,
    );
  });

  it('il formato vecchio { error: "…" } non porta il segno', () => {
    expect(comeLaCassa({ error: 'canceling statement due to statement timeout' })).not.toMatch(/statement/);
  });
});
