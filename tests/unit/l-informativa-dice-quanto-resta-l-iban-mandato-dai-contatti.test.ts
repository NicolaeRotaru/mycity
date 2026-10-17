import { describe, it, expect, vi } from 'vitest';
import { eseguiPotature, type ClientePotature } from '@/lib/privacy/potature-ritenzione';
import { DOVE_CHIEDIAMO_L_IBAN, QUANTO_TENIAMO_L_IBAN, durataDetta } from '@/lib/privacy/iban-per-email';

/**
 * Riesame del 16/10, terzo giro — LA TABELLA DICEVA CHE L'IBAN SI CANCELLA COL BONIFICO, ANCHE QUELLO
 * MANDATO DAI CONTATTI.
 *
 * Ogni reclamo su un ordine in contanti chiuso a favore del cliente passava dai Contatti: l'email del
 * rimborso chiedeva l'IBAN, il cliente lo mandava con un messaggio, e il messaggio restava fra i
 * messaggi dell'assistenza fino alla potatura notturna, cioe' due anni. La tabella delle
 * conservazioni (l'articolo 13.2.a del GDPR vuole il tempo proprio li') non lo diceva.
 *
 * 17/10/2026 — Dalla semplificazione l'IBAN arriva rispondendo all'email del rimborso, e le parole
 * dicono di non scriverlo nei Contatti. Ma chi lo scrive li' lo stesso lascia un messaggio che resta
 * due anni: la frase deve continuare a dirlo, con il numero vero della potatura.
 *
 * La prova non cerca una parola nel file: esegue la potatura VERA dei messaggi dei Contatti, misura
 * la finestra che applica davvero, e pretende che la riga dell'IBAN la dica. Se domani la potatura
 * cambia finestra e la frase no, diventa rossa.
 *
 * ⚪ Quanto tiene la casella email dell'assistenza non lo dice nessun codice: lo decide Nicola col legale.
 */

const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** La finestra, in mesi, che la potatura notturna applica davvero ai messaggi dei Contatti. */
async function mesiCheTieneLaPotatura(): Promise<number> {
  const adesso = Date.parse('2026-10-16T04:00:00Z');
  let soglia: string | null = null;
  const admin = {
    from: (tabella: string) => {
      const q: Record<string, unknown> = { then: (r: (v: { error: null }) => unknown) => Promise.resolve(r({ error: null })) };
      for (const f of ['eq', 'is', 'not', 'or']) q[f] = () => q;
      q.lt = (_c: string, v: string) => { if (tabella === 'contact_messages') soglia = v; return q; };
      return { update: () => q, delete: () => q };
    },
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as ClientePotature;
  await eseguiPotature(admin, registro, adesso);
  expect(soglia, 'la potatura dei messaggi dei Contatti non e partita: la prova non misura niente').not.toBeNull();
  return Math.round((adesso - Date.parse(soglia!)) / (30 * 86_400_000));
}

describe('la riga dell IBAN dice quanto resta la copia mandata dai Contatti', () => {
  it('IL CASO CHE ROMPEVA — la tabella dice il tempo che la potatura applica ai messaggi', async () => {
    const mesi = await mesiCheTieneLaPotatura();
    expect(mesi).toBe(24);
    const frase = QUANTO_TENIAMO_L_IBAN.slice(QUANTO_TENIAMO_L_IBAN.indexOf('pagina Contatti'));
    expect(frase, 'la tabella non dice niente dell IBAN mandato dai Contatti').not.toBe(QUANTO_TENIAMO_L_IBAN.slice(-1));
    expect(frase, 'la tabella promette la cancellazione col bonifico anche per la copia nei messaggi').toContain(
      `al massimo ${durataDetta(mesi)}`,
    );
  });

  it('e la voce dei dati raccolti dice lo stesso tempo', async () => {
    expect(DOVE_CHIEDIAMO_L_IBAN).toContain(`al massimo ${durataDetta(await mesiCheTieneLaPotatura())}`);
  });

  it('i mesi detti come li direbbe una persona', () => {
    expect(durataDetta(24)).toBe('2 anni');
    expect(durataDetta(12)).toBe('1 anno');
    expect(durataDetta(18)).toBe('18 mesi');
  });
});
