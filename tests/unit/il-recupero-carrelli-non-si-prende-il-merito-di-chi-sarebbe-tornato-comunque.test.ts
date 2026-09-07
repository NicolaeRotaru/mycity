import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import {
  contaRendimentoRecupero,
  rendimentoRecuperoCarrelli,
  type RigaDiRecupero,
} from '@/lib/carrelli-abbandonati';

/**
 * 6/9/2026 — «RECUPERATO» METTEVA INSIEME DUE PERSONE DIVERSE.
 *
 * Quando arriva un ordine, il carrello di quella persona viene marcato
 * `recovered = true`. È giusto: serve a non mandarle l'email «hai dimenticato
 * qualcosa» per una spesa che ha già fatto. Ma in quella colonna finiscono
 * insieme chi è tornato GRAZIE all'email e chi è tornato da solo dieci minuti
 * dopo, senza aver ricevuto niente.
 *
 * Il giorno in cui si guarda «quanto rende l'email di recupero», contare le
 * righe con `recovered = true` dà un numero più alto del vero: si terrebbe
 * accesa una leva che magari non porta niente. È una delle poche leve di ricavo
 * già costruite — decidere su un numero gonfiato costa tempo e fiducia.
 *
 * Le due domande hanno già due campi in tabella. Questa prova fissa il conto
 * giusto: l'email si prende il merito solo di chi è tornato DOPO averla
 * ricevuta.
 *
 * ⚪ Da qui non vedo il database di produzione: la prova lavora su righe
 * costruite a mano e su un finto database.
 */

const ORE = 3_600_000;
const oraIso = (msFa: number) => new Date(Date.UTC(2026, 8, 6, 12, 0, 0) - msFa).toISOString();

function riga(p: Partial<RigaDiRecupero>): RigaDiRecupero {
  return { recovered: false, recovered_at: null, recovery_email_sent_at: null, ...p };
}

describe('il rendimento dell email di recupero carrelli', () => {
  it('IL CASO CHE ROMPEVA — chi è tornato senza aver ricevuto niente non conta come merito dell email', () => {
    const conto = contaRendimentoRecupero([
      // Ha ricevuto l'email quattro ore fa ed è tornato: questo è merito nostro.
      riga({ recovered: true, recovery_email_sent_at: oraIso(4 * ORE), recovered_at: oraIso(1 * ORE) }),
      // È tornato da solo dieci minuti dopo aver abbandonato: nessuna email.
      riga({ recovered: true, recovered_at: oraIso(2 * ORE) }),
      // Ha ricevuto l'email e non è più tornato.
      riga({ recovery_email_sent_at: oraIso(5 * ORE) }),
    ]);

    expect(conto.tornatiInTutto, 'i carrelli tornati sono tre? no, due').toBe(2);
    expect(
      conto.tornatiDopoLEmail,
      'il rendimento della campagna conta anche chi sarebbe tornato comunque: il numero esce gonfiato',
    ).toBe(1);
    expect(conto.tornatiDaSoli).toBe(1);
    expect(conto.emailInviate).toBe(2);
  });

  it('un carrello marcato PRIMA che l email partisse non è merito dell email', () => {
    const conto = contaRendimentoRecupero([
      riga({ recovered: true, recovered_at: oraIso(6 * ORE), recovery_email_sent_at: oraIso(1 * ORE) }),
    ]);
    expect(conto.tornatiDopoLEmail).toBe(0);
    expect(conto.tornatiDaSoli).toBe(1);
  });

  it('senza il QUANDO non si tira a indovinare: si dichiara', () => {
    // Succede se la migrazione 148 non è ancora applicata: `recovered_at` manca.
    const conto = contaRendimentoRecupero([
      riga({ recovered: true, recovered_at: null, recovery_email_sent_at: oraIso(3 * ORE) }),
    ]);
    expect(conto.tornatiDopoLEmail, 'un carrello senza data si è preso il merito dell email').toBe(0);
    expect(conto.tornatiSenzaData).toBe(1);
    expect(conto.tornatiInTutto).toBe(1);
  });

  it('su una tabella vuota sono tutti zero, non un errore', () => {
    expect(contaRendimentoRecupero([])).toEqual({
      emailInviate: 0,
      tornatiInTutto: 0,
      tornatiDopoLEmail: 0,
      tornatiDaSoli: 0,
      tornatiSenzaData: 0,
    });
  });

  it('legge dal database solo le tre colonne che servono', async () => {
    let colonneChieste = '';
    const admin = {
      from: () => ({
        select: (colonne: string) => {
          colonneChieste = colonne;
          return Promise.resolve({
            data: [riga({ recovered: true, recovery_email_sent_at: oraIso(4 * ORE), recovered_at: oraIso(1 * ORE) })],
            error: null,
          });
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const conto = await rendimentoRecuperoCarrelli(admin);
    expect(conto.tornatiDopoLEmail).toBe(1);
    expect(colonneChieste, 'sta leggendo tutta la riga: dentro c è la spesa di una persona').not.toContain('*');
    expect(colonneChieste).toContain('recovery_email_sent_at');
  });

  it('se la lettura non riesce non inventa numeri', async () => {
    const admin = {
      from: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'niente rete' } }) }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const conto = await rendimentoRecuperoCarrelli(admin);
    expect(conto.tornatiDopoLEmail).toBe(0);
    expect(conto.tornatiInTutto).toBe(0);
  });
});
