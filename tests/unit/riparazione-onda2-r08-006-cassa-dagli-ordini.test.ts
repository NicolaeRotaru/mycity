import { describe, it, expect } from 'vitest';
import { cancellaAccount, contantiAncoraDaVersare } from '@/lib/account/cancellazione';
import { fintoMondo, quandoChiudeLAccount } from './aiuti/finta-cancellazione-account';

/**
 * 28/11/2026 (R08-004, R08-005, R08-006, onda 2) — LA CASSA DA VERSARE SI CONTA DAGLI ORDINI.
 *
 * La guardia della cancellazione leggeva solo la riga del giorno in `cod_reconciliations`: aperta se
 * `remitted_at` è vuoto, cifra `collected_cents` (tutto l'incassato del giorno).
 *
 *  · R08-006 — il fattorino versa alle 15 e alle 18 incassa ancora 37 €: la riga ha `remitted_at` pieno,
 *    per il registro non deve niente e l'account si cancellava coi contanti in tasca.
 *  · R08-004/005 — giornata riaperta (`remitted_at` svuotato dopo il versamento): «risultano 55 € non
 *    versati», 40 dei quali versati da ore.
 *
 * Il conto adesso lo fa il database (`cassa_da_versare_del_fattorino`, migrazione 999n, provata in
 * tests/sql/rls/onda2-c2-la-cassa-da-versare-si-conta-dagli-ordini.test.sql). Qui si prova che la guardia
 * crede a quel conto, che non torna al registro quando il conto cade, e che ci torna solo quando la
 * funzione non è ancora applicata.
 */

const FATTORINO = '22222222-2222-4222-8222-222222222222';

/** La riga del giorno com'è dopo il versamento delle 15 e la quadratura delle 18. */
const GIORNO_VERSATO_POI_ALTRI_CONTANTI = {
  for_date: '2026-11-20',
  collected_cents: 5_900,
  status: 'MISMATCH',
  remitted_at: '2026-11-20T14:00:00Z',
};

/** La stessa giornata, riaperta: remitted_at svuotato, 40 € dei 55 già versati. */
const GIORNO_RIAPERTO = {
  for_date: '2026-11-21',
  collected_cents: 5_500,
  status: 'MISMATCH',
  remitted_at: null,
};

const conto = (centesimi: number, giornate: number, ordini = giornate) => ({
  data: { centesimi, giornate, ordini },
  error: null,
});

describe('R08-006 · contanti incassati dopo il versamento dello stesso giorno', () => {
  it('la cancellazione si ferma: i 37 € delle 18 non sono più invisibili', async () => {
    const { admin, diario } = fintoMondo({ cassa: [GIORNO_VERSATO_POI_ALTRI_CONTANTI], contoCassa: conto(3_700, 1) });

    const esito = await cancellaAccount(admin as never, FATTORINO);

    expect(esito.ok, 'account cancellato con 37 € dei negozi ancora in tasca al fattorino').toBe(false);
    expect(esito.motivo).toBe('cassa_da_versare');
    expect(esito.errore).toContain('37,00 €');
    expect(esito.errore).toContain('1 giornata');
    expect(quandoChiudeLAccount(diario)).toBe(-1);
    expect(diario.filter((v) => v.op === 'update'), 'fermata, ma intanto aveva già svuotato qualcosa').toEqual([]);
  });
});

describe('R08-004 / R08-005 · giornata di cassa riaperta', () => {
  it('la cifra è quella ancora da versare, non tutto l’incassato del giorno', async () => {
    const { admin } = fintoMondo({ cassa: [GIORNO_RIAPERTO], contoCassa: conto(1_500, 1) });

    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);

    expect(cassa.esito).toBe('da_versare');
    expect(cassa.centesimi, 'la guardia gonfia la cifra coi 40 € già versati').toBe(1_500);
    expect(cassa.motivo).toContain('15,00 €');
    expect(cassa.motivo, 'dichiara «non ancora versati» anche i contanti versati quel giorno').not.toContain('55,00 €');
    // La frase resta quella di sempre (la fissa chi-aspetta-la-cancellazione-sa-perche-aspetta).
    expect(cassa.motivo).toBe(
      'Cancellazione rinviata: risultano 15,00 € di contanti incassati alle consegne e non ancora versati ' +
        '(1 giornata di cassa). Appena il versamento è registrato la cancellazione riparte da sola.',
    );
  });

  it('una giornata che il conto dice aperta senza contanti (ammanco) ferma ancora la cancellazione', async () => {
    const { admin } = fintoMondo({ cassa: [], contoCassa: conto(0, 1, 0) });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.bloccante).toBe(true);
    expect(cassa.esito).toBe('da_versare');
  });

  it('tutto versato: la cancellazione passa', async () => {
    const { admin, diario } = fintoMondo({ cassa: [GIORNO_VERSATO_POI_ALTRI_CONTANTI], contoCassa: conto(0, 0) });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.ok).toBe(true);
    expect(quandoChiudeLAccount(diario)).toBeGreaterThanOrEqual(0);
  });
});

describe('quando il conto dagli ordini non risponde', () => {
  it('un guasto della funzione ferma la cancellazione invece di ripiegare sul registro che dice «libera»', async () => {
    const { admin, diario } = fintoMondo({
      cassa: [GIORNO_VERSATO_POI_ALTRI_CONTANTI],
      contoCassa: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } },
    });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.ok).toBe(false);
    expect(esito.motivo, 'un guasto non è un rinvio deciso da noi').toBeUndefined();
    expect(esito.errore).toContain('statement timeout');
    expect(quandoChiudeLAccount(diario)).toBe(-1);
  });

  it('una risposta che non si legge vale quanto un registro che non si legge', async () => {
    const { admin } = fintoMondo({ cassa: [], contoCassa: { data: null, error: null } });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.esito).toBe('non_verificabile');
    expect(cassa.bloccante).toBe(true);
  });

  it('funzione non ancora applicata: si legge il registro come prima', async () => {
    const { admin } = fintoMondo({ cassa: [{ ...GIORNO_RIAPERTO, collected_cents: 12_000 }] });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.esito).toBe('da_versare');
    expect(cassa.centesimi).toBe(12_000);
  });
});
