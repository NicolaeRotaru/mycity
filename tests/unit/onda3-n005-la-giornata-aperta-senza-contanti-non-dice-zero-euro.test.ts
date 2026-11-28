import { describe, it, expect } from 'vitest';
import { cancellaAccount, contantiAncoraDaVersare } from '@/lib/account/cancellazione';
import { fintoMondo, quandoChiudeLAccount } from './aiuti/finta-cancellazione-account';

/**
 * 28/11/2026 (N-005, onda 3) — UNA GIORNATA DI CASSA APERTA SENZA CONTANTI NON SI SPIEGA CON «0,00 €».
 *
 * La guardia della cancellazione ferma (giustamente) l'account del fattorino quando il registro delle
 * giornate tiene aperta una giornata — per esempio un ammanco da chiarire — anche se dagli ordini non
 * risulta nessun contante in tasca. La frase però diceva sempre la cifra: «risultano 0,00 € di contanti
 * incassati alle consegne e non ancora versati (1 giornata di cassa)». Falso, e alla persona che aspetta
 * la cancellazione non dice cosa la tiene ferma. Adesso dice che c'è una giornata di cassa da chiudere,
 * e la cifra compare solo quando c'è.
 */

const FATTORINO = '22222222-2222-4222-8222-222222222222';

const conto = (centesimi: number, giornate: number, ordini = 0) => ({
  data: { centesimi, giornate, ordini },
  error: null,
});

describe('N-005 · giornata di cassa aperta solo nel registro', () => {
  it('dal conto degli ordini: si ferma, e la frase dice la giornata da chiudere, non «0,00 €»', async () => {
    const { admin } = fintoMondo({ cassa: [], contoCassa: conto(0, 1) });

    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);

    expect(cassa.bloccante).toBe(true);
    expect(cassa.esito).toBe('da_versare');
    expect(cassa.motivo, 'la ragione del rinvio stampa una cifra che non c’è').not.toContain('0,00 €');
    expect(cassa.motivo).not.toContain('non ancora versati');
    expect(cassa.motivo).toBe(
      'Cancellazione rinviata: risulta ancora aperta 1 giornata di cassa contanti da chiudere con ' +
        'l’amministrazione. Appena è chiusa la cancellazione riparte da sola.',
    );
  });

  it('più giornate aperte senza contanti: il plurale, sempre senza cifra', async () => {
    const { admin } = fintoMondo({ cassa: [], contoCassa: conto(0, 2) });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.bloccante).toBe(true);
    expect(cassa.motivo).not.toMatch(/\d+,\d{2} €/);
    expect(cassa.motivo).toContain('risultano ancora aperte 2 giornate di cassa contanti da chiudere');
  });

  it('dal registro (funzione non ancora applicata): un ammanco senza incasso non dice «0,00 €»', async () => {
    const { admin } = fintoMondo({
      cassa: [{ for_date: '2026-11-24', collected_cents: 0, status: 'MISMATCH', remitted_at: null }],
    });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.bloccante).toBe(true);
    expect(cassa.motivo).not.toContain('0,00 €');
    expect(cassa.motivo).toContain('1 giornata di cassa contanti da chiudere');
  });

  it('la cancellazione resta ferma e la persona legge la ragione vera', async () => {
    const { admin, diario } = fintoMondo({ cassa: [], contoCassa: conto(0, 1) });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toBe('cassa_da_versare');
    expect(esito.errore).not.toContain('0,00 €');
    expect(esito.errore).toContain('giornata di cassa contanti da chiudere');
    expect(quandoChiudeLAccount(diario)).toBe(-1);
  });

  it('quando i contanti ci sono, la frase con la cifra resta quella di sempre', async () => {
    const { admin } = fintoMondo({ cassa: [], contoCassa: conto(1_500, 1, 1) });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.motivo).toBe(
      'Cancellazione rinviata: risultano 15,00 € di contanti incassati alle consegne e non ancora versati ' +
        '(1 giornata di cassa). Appena il versamento è registrato la cancellazione riparte da sola.',
    );
  });
});
