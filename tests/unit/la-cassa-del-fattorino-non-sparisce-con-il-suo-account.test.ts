import { describe, it, expect } from 'vitest';
import { cancellaAccount, contantiAncoraDaVersare } from '@/lib/account/cancellazione';
import { fintoMondo, quandoChiudeLAccount } from './aiuti/finta-cancellazione-account';

/**
 * 3/9/2026 — CANCELLARE UN FATTORINO CANCELLAVA I SOLDI CHE DOVEVA VERSARE.
 *
 * `cod_reconciliations` è il registro della cassa: una riga per ogni giornata,
 * con quanto è entrato in contanti alle consegne e se è già stato versato.
 * Quella riga punta all'utente con ON DELETE CASCADE, cioè se ne va insieme a
 * lui.
 *
 * Il conto della storia: un fattorino incassa 120 euro in contanti il sabato
 * per due negozi, la domenica chiede di cancellare l'account, il sabato dopo
 * la giornata da 120 euro non esiste più in nessun registro. Nessun ammanco
 * visibile, nessun sollecito: quei soldi non risultano mai stati incassati.
 * Vale identico quando è un amministratore a cancellare un fattorino sospetto:
 * cancella insieme la prova del debito.
 *
 * La scelta fatta qui: **i contanti non versati fermano la cancellazione,
 * prima che venga toccata qualunque cosa.** Non è un rifiuto definitivo — è un
 * rinvio, e la persona legge perché: appena il versamento è registrato, il
 * giro della notte dopo riparte da solo. Il diritto a farsi cancellare non
 * cancella un debito (art. 17.3 GDPR tiene fermi gli obblighi contabili e la
 * difesa di un diritto), e le giornate già versate sopravvivono senza nome
 * grazie alla migrazione che accompagna questa riparazione.
 */

const FATTORINO = '22222222-2222-4222-8222-222222222222';

/** Una giornata di cassa: sabato, 120 euro incassati, mai versati. */
const SABATO_NON_VERSATO = {
  for_date: '2026-08-29',
  collected_cents: 12_000,
  status: 'PENDING',
  remitted_at: null,
};

/** Una giornata chiusa: incassata e versata. */
const GIORNATA_VERSATA = {
  for_date: '2026-07-04',
  collected_cents: 8_000,
  status: 'SETTLED',
  remitted_at: '2026-07-05T09:00:00Z',
};

describe('un fattorino con contanti ancora da versare', () => {
  it('la cancellazione si ferma e non tocca niente', async () => {
    const { admin, diario } = fintoMondo({ cassa: [SABATO_NON_VERSATO] });

    const esito = await cancellaAccount(admin as never, FATTORINO);

    expect(esito.ok).toBe(false);
    expect(esito.motivo).toBe('cassa_da_versare');
    expect(
      quandoChiudeLAccount(diario),
      'l’account è stato cancellato con 120 € di contanti aperti: le righe della cassa se ne vanno con lui ' +
        'e di quei soldi non resta traccia in nessun registro',
    ).toBe(-1);
    expect(
      diario.filter((v) => v.op === 'update'),
      'la cancellazione si è fermata ma intanto aveva già svuotato qualcosa',
    ).toEqual([]);
  });

  it('dice quanto manca, in euro, a chi legge', async () => {
    const { admin } = fintoMondo({ cassa: [SABATO_NON_VERSATO] });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.errore).toContain('120,00 €');
    expect(esito.errore).toContain('1 giornata');
  });

  it('conta insieme tutte le giornate aperte', async () => {
    const { admin } = fintoMondo({
      cassa: [SABATO_NON_VERSATO, { ...SABATO_NON_VERSATO, for_date: '2026-08-30', collected_cents: 4_550 }],
    });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.centesimi).toBe(16_550);
    expect(cassa.giornate).toBe(2);
    expect(cassa.motivo).toContain('165,50 €');
    expect(cassa.motivo).toContain('2 giornate');
  });

  it('una giornata che non quadra ferma tutto anche senza incasso', async () => {
    // Ammanco: il registro dice che manca del denaro. Cancellare l’account qui
    // vuol dire cancellare la contestazione insieme alla persona.
    const { admin } = fintoMondo({
      cassa: [{ for_date: '2026-08-31', collected_cents: 0, status: 'MISMATCH', remitted_at: null }],
    });
    expect((await contantiAncoraDaVersare(admin as never, FATTORINO)).bloccante).toBe(true);
  });
});

describe('un fattorino con la cassa in pari', () => {
  it('viene cancellato normalmente', async () => {
    const { admin, diario } = fintoMondo({ cassa: [GIORNATA_VERSATA] });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.ok).toBe(true);
    expect(quandoChiudeLAccount(diario)).toBeGreaterThanOrEqual(0);
  });

  it('e chi non ha mai fatto una consegna nemmeno se ne accorge', async () => {
    const { admin } = fintoMondo({ cassa: [] });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.bloccante).toBe(false);
    expect(cassa.centesimi).toBe(0);
  });
});

describe('quando il registro della cassa non risponde', () => {
  it('la cancellazione si ferma invece di tirare a indovinare', async () => {
    // Su una cassa, «non lo so» vale quanto «sì»: rinviare di un giorno una
    // cancellazione si ripara, cancellare la prova di un debito no.
    const { admin, diario } = fintoMondo({ erroreCassa: 'connessione persa' });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.ok).toBe(false);
    expect(esito.errore).toContain('cassa contanti');
    expect(esito.errore).toContain('connessione persa');
    expect(quandoChiudeLAccount(diario)).toBe(-1);
  });
});
