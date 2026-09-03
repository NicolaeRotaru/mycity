import { describe, it, expect } from 'vitest';
import {
  cancellaAccount,
  CAMPI_KYC_DA_AZZERARE,
  CAMPI_PROFILO_DA_AZZERARE,
  TABELLE_CON_DATI_PERSONALI,
} from '@/lib/account/cancellazione';
import { aggiornamentiSu, fintoMondo, quandoChiudeLAccount } from './aiuti/finta-cancellazione-account';

/**
 * 3/9/2026 — «CANCELLA IL MIO ACCOUNT» SVUOTAVA IL PROFILO E LASCIAVA
 * L'ACCOUNT IN PIEDI.
 *
 * Maria Rossi ordina 30 euro da Pane Quotidiano il 3 settembre. Il 10 chiede
 * di cancellare l'account. Il 17, di notte, il giro delle 4:00 faceva due cose
 * in fila: prima svuotava il profilo — nome, telefono, indirizzo, città, CAP,
 * fotografia, nome del negozio — e poi cancellava l'account.
 *
 * Il secondo passo non riusciva mai, per nessuno che avesse anche un solo
 * ordine: cancellare l'utente mette a NULL `orders.user_id`, e quella
 * scrittura la rifiuta il guardiano degli ordini («modifica di un campo
 * protetto non consentita»). Maria si ritrovava con un profilo vuoto e un
 * account ancora funzionante; un negozio, con la vetrina online e senza più il
 * nome. E siccome la richiesta restava aperta, ogni notte si riprovava e si
 * rifalliva, per sempre, senza che nessuno lo leggesse.
 *
 * Il difetto vero non è il guardiano: è che la catena distruggeva prima e
 * provava dopo. Adesso il passo che può fallire viene prima, e il profilo si
 * svuota solo se l'account è sparito davvero.
 *
 * Queste prove diventano rosse se qualcuno rimette lo svuotamento del profilo
 * davanti alla cancellazione.
 */

const UTENTE = '11111111-1111-4111-8111-111111111111';
/** L'errore vero, copiato dal guardiano di migrations/114. */
const IL_GUARDIANO = 'orders: modifica di un campo protetto non consentita';

describe('quando la cancellazione dell account non riesce', () => {
  it('il profilo non viene svuotato: niente account a metà', async () => {
    const { admin, diario } = fintoMondo({ cancellazioneFallisce: IL_GUARDIANO });

    const esito = await cancellaAccount(admin as never, UTENTE);

    expect(esito.ok).toBe(false);
    const svuotamenti = aggiornamentiSu(diario, 'profiles').filter((v) => 'store_name' in v.valori);
    expect(
      svuotamenti,
      'il profilo è stato svuotato ma l’account è ancora vivo: la persona rientra e trova il proprio profilo vuoto, ' +
        'il negozio resta in vetrina senza nome, e la richiesta di cancellazione riparte ogni notte per fallire di nuovo',
    ).toEqual([]);
  });

  it('lo dice com’è: l’account non è stato cancellato', async () => {
    const { admin } = fintoMondo({ cancellazioneFallisce: IL_GUARDIANO });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.errore).toContain('non è stato cancellato');
    expect(esito.errore).toContain(IL_GUARDIANO);
  });

  it('i documenti d’identità e l’IBAN se ne vanno lo stesso', async () => {
    // Non si vedono a video: toglierli non lascia nessuno con un account
    // mutilato, e sono il dato che meno di tutti deve restare in giro.
    const { admin, diario } = fintoMondo({ cancellazioneFallisce: IL_GUARDIANO });
    await cancellaAccount(admin as never, UTENTE);

    const sensibili = aggiornamentiSu(diario, 'profiles').filter((v) => 'kyc_selfie_url' in v.valori);
    expect(sensibili.length, 'il selfie e il codice fiscale restano nel profilo').toBe(1);
    expect(sensibili[0].valori).toEqual(CAMPI_KYC_DA_AZZERARE);
  });
});

describe('quando la cancellazione dell account riesce', () => {
  it('il profilo si svuota, ma solo dopo che l’account è sparito', async () => {
    const { admin, diario } = fintoMondo();

    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(true);

    const chiusura = quandoChiudeLAccount(diario);
    expect(chiusura, 'l’account non è mai stato chiuso').toBeGreaterThanOrEqual(0);

    const svuotamento = diario.findIndex(
      (v) => v.op === 'update' && v.tabella === 'profiles' && 'store_name' in v.valori,
    );
    expect(svuotamento, 'il profilo non è stato svuotato').toBeGreaterThanOrEqual(0);
    expect(
      svuotamento,
      'il profilo viene svuotato prima di chiudere l’account: se la chiusura fallisce resta un account a metà',
    ).toBeGreaterThan(chiusura);
  });

  it('svuota tutti i campi di vetrina e anagrafica, non una parte', async () => {
    const { admin, diario } = fintoMondo();
    await cancellaAccount(admin as never, UTENTE);
    const svuotamento = aggiornamentiSu(diario, 'profiles').find((v) => 'store_name' in v.valori);
    expect(svuotamento?.valori).toEqual(CAMPI_PROFILO_DA_AZZERARE);
  });
});

/**
 * LA REGOLA CHE VALE ANCHE PER LA PROSSIMA TABELLA.
 *
 * Alcune righe sopravvivono alla cancellazione dell'utente, perché la loro
 * chiave esterna è ON DELETE SET NULL: la riga resta e la colonna che la
 * legava alla persona diventa NULL. Se non le ripuliamo PRIMA, dopo non le
 * ritrova più nessuno — non c'è più niente da cui partire per cercarle.
 *
 * È il motivo per cui «prima cancella l'account, poi pulisci» sarebbe stata la
 * riparazione peggiore di questo difetto: avrebbe lasciato in chiaro per
 * sempre le recensioni, i messaggi del modulo contatti e i dati del
 * destinatario di un buono regalo.
 */
describe('le righe che restano in vita dopo la cancellazione', () => {
  it('vengono ripulite prima di chiudere l’account, tutte', async () => {
    const { admin, diario } = fintoMondo();
    await cancellaAccount(admin as never, UTENTE);
    const chiusura = quandoChiudeLAccount(diario);

    for (const t of TABELLE_CON_DATI_PERSONALI.filter((t) => t.sopravvive)) {
      const quando = diario.findIndex((v) => v.op === 'update' && v.tabella === t.tabella);
      expect(quando, `nessuno ha mai ripulito ${t.tabella}: ${t.perche}`).toBeGreaterThanOrEqual(0);
      expect(
        quando,
        `${t.tabella} viene ripulita dopo la chiusura dell’account, quando il legame con la persona è già NULL: ` +
          `${t.perche} — e nessuno saprà più di chi sono`,
      ).toBeLessThan(chiusura);
    }
  });
});
