/**
 * 8/9/2026 — UNA CANCELLAZIONE RINVIATA LA SAPEVA SOLO L'AMMINISTRATORE.
 *
 * Un fattorino ha incassato 120 € in contanti il sabato e non li ha ancora
 * versati. La domenica chiede di cancellare l'account. Il giro notturno si
 * ferma apposta — cancellarlo butterebbe via il registro di quel debito — e la
 * regola è giusta: l'art. 17.3 permette di conservare per far valere un
 * diritto.
 *
 * Quello che mancava è l'obbligo che ci sta accanto. L'art. 12.3-12.4 dice che
 * se non diamo seguito a una richiesta dobbiamo dirlo all'interessato, senza
 * ingiustificato ritardo e comunque entro un mese, spiegando il motivo e la
 * possibilità di reclamare al Garante. A lui non arrivava niente: la pagina del
 * suo account mostrava un conto alla rovescia che arrivava a «tra 0 giorni» e lì
 * restava, per settimane. L'unica scrittura era verso `profiles.role = 'admin'`.
 *
 * La spiegazione, intanto, esisteva già: scritta in italiano dentro
 * `contantiAncoraDaVersare`, e finiva nei log.
 *
 * QUI SI PROVANO QUATTRO COSE, E LE ULTIME DUE SONO QUELLE CHE SI DIMENTICANO:
 *
 *  ① la persona riceve la spiegazione, indirizzata a lei, col motivo dentro;
 *  ② la pagina del suo account sa dirgli perché sta aspettando;
 *  ③ trenta notti di rinvio NON fanno trenta messaggi;
 *  ④ un guasto del database non le regala il messaggio tecnico in faccia.
 */
import { describe, it, expect, vi } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import {
  verdettoDelGiro,
  chiaveAvviso,
  GIORNI_MASSIMI_DI_ATTESA,
  type TentativoCancellazione,
} from '@/lib/cron-cancellazioni';
import {
  recapitaAvvisi,
  attesaDichiarata,
  identificativoAvviso,
  type ClienteAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';

const ADESSO = new Date('2026-09-08T04:00:00.000Z').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();
const RECAPITO = 'privacy@mycity.example';

/** La frase vera che oggi esce da `contantiAncoraDaVersare`, per un rinvio. */
const MOTIVO_CASSA =
  'Cancellazione rinviata: risultano 120,00 € di contanti incassati alle consegne e non ancora ' +
  'versati (1 giornata di cassa). Appena il versamento è registrato la cancellazione riparte da sola.';

/** Il fattorino della storia: cassa aperta, richiesta di otto giorni fa. */
const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: MOTIVO_CASSA,
  chiestaIl: giorniFa(8),
};

function registro(): RegistroAvvisi {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Fa passare la notte per davvero: si decide, si recapita, e le righe restano
 * nel finto database — così la notte dopo si riparte da lì, come in produzione.
 */
async function laNotte(
  mondo: ReturnType<typeof fintoGiroNotturno>,
  tentativi: TentativoCancellazione[],
  adessoMs: number = ADESSO,
) {
  const verdetto = verdettoDelGiro(tentativi, adessoMs, RECAPITO);
  const rapporto = await recapitaAvvisi(
    mondo.admin as unknown as ClienteAvvisi,
    verdetto.dovuti,
    registro(),
  );
  return { verdetto, rapporto };
}

/** Un finto database vuoto, con la sola tabella delle notifiche. */
const mondoVuoto = () => fintoGiroNotturno({ tabelle: { notifications: [] } });

describe('chi aspetta la cancellazione sa perché aspetta', () => {
  it('il fattorino con la cassa aperta riceve la spiegazione, indirizzata a lui', async () => {
    const mondo = mondoVuoto();
    await laNotte(mondo, [FATTORINO]);

    const suoi = mondo.righe('notifications').filter((n) => n.user_id === 'rider-1');
    expect(suoi).toHaveLength(1);
    // Il motivo per esteso, quello che prima restava nei log.
    expect(String(suoi[0].body)).toContain('120,00 €');
    expect(String(suoi[0].body)).toContain('non ancora versati');
    // L'art. 12.4 non chiede solo il motivo: chiede anche di dire che si può
    // reclamare. Senza questa riga la risposta è a metà.
    expect(String(suoi[0].body)).toContain('Garante');
    expect(String(suoi[0].body)).toContain(RECAPITO);
    // Non è una promozione: non deve poterla spegnere un interruttore del
    // marketing.
    expect(suoi[0].category).toBe('system');
  });

  it('prima, l unica scrittura era verso gli amministratori: adesso il destinatario è la persona', async () => {
    const mondo = mondoVuoto();
    await laNotte(mondo, [FATTORINO]);

    const destinatari = mondo.righe('notifications').map((n) => n.user_id);
    expect(destinatari).toContain('rider-1');
  });

  it('la pagina del suo account sa dirgli perché sta aspettando', async () => {
    const mondo = mondoVuoto();
    await laNotte(mondo, [FATTORINO]);

    // È esattamente quello che deve poter rispondere GET /api/account/delete:
    // stessa persona, stessa data di richiesta, nessun ricalcolo.
    const stato = await attesaDichiarata(
      mondo.admin as unknown as ClienteAvvisi,
      'rider-1',
      FATTORINO.chiestaIl,
      registro(),
    );
    expect(stato.inAttesa).toBe(true);
    expect(stato.tappa).toBe('rinviata');
    expect(String(stato.motivo)).toContain('120,00 €');
  });

  it('chi non ha nessun avviso non risulta in attesa di niente', async () => {
    const mondo = mondoVuoto();
    await laNotte(mondo, [FATTORINO]);

    const stato = await attesaDichiarata(
      mondo.admin as unknown as ClienteAvvisi,
      'cliente-2',
      giorniFa(8),
      registro(),
    );
    expect(stato).toEqual({ inAttesa: false, motivo: null, tappa: null, dettoIl: null });
  });

  it('trenta notti di rinvio non fanno trenta messaggi', async () => {
    const mondo = mondoVuoto();
    for (let notte = 0; notte < 30; notte++) {
      await laNotte(mondo, [FATTORINO], ADESSO + notte * 86_400_000);
    }
    // Un messaggio per il rinvio. Il secondo — «è passato il mese» — arriva
    // quando il mese passa davvero, e arriva UNA volta.
    const suoi = mondo.righe('notifications').filter((n) => n.user_id === 'rider-1');
    const titoli = suoi.map((n) => n.title);
    expect(new Set(titoli).size).toBe(titoli.length);
    expect(suoi.length).toBeLessThanOrEqual(2);
    expect(titoli).toContain('La tua richiesta di cancellazione è in attesa');
  });

  it('passato il mese glielo diciamo, e diciamo che il termine di legge è scaduto', async () => {
    const mondo = mondoVuoto();
    const vecchio: TentativoCancellazione = {
      ...FATTORINO,
      chiestaIl: giorniFa(GIORNI_MASSIMI_DI_ATTESA + 5),
    };
    const { verdetto } = await laNotte(mondo, [vecchio]);

    expect(verdetto.scadute).toBe(1);
    const ritardo = mondo
      .righe('notifications')
      .find((n) => n.title === 'La tua cancellazione è in ritardo');
    expect(ritardo).toBeTruthy();
    expect(String(ritardo?.body)).toContain('quel mese è passato');
    expect(String(ritardo?.body)).toContain('Garante');
  });

  it('un guasto del database non regala alla persona il messaggio tecnico', async () => {
    const mondo = mondoVuoto();
    const guasto: TentativoCancellazione = {
      userId: 'venditore-9',
      ok: false,
      // Nessun `motivo`: per il giro notturno questo è un GUASTO.
      errore: 'permission denied for table cod_reconciliations',
      chiestaIl: giorniFa(GIORNI_MASSIMI_DI_ATTESA + 2),
    };
    const { verdetto } = await laNotte(mondo, [guasto]);

    expect(verdetto.fallite).toBe(1);
    const suoi = mondo.righe('notifications').filter((n) => n.user_id === 'venditore-9');
    expect(suoi).toHaveLength(1);
    expect(String(suoi[0].body)).not.toContain('permission denied');
    expect(String(suoi[0].body)).not.toContain('cod_reconciliations');
    expect(String(suoi[0].body)).toContain('Garante');
  });

  it('un guasto di stanotte non sveglia la persona: stanotte si sveglia un amministratore', async () => {
    const mondo = mondoVuoto();
    const guasto: TentativoCancellazione = {
      userId: 'venditore-9',
      ok: false,
      errore: 'connection reset',
      chiestaIl: giorniFa(8),
    };
    const { verdetto } = await laNotte(mondo, [guasto]);

    expect(verdetto.daSvegliare).toBe(true);
    expect(mondo.righe('notifications')).toHaveLength(0);
  });

  it('chi viene cancellato davvero non riceve nessun messaggio', async () => {
    const mondo = mondoVuoto();
    const { verdetto } = await laNotte(mondo, [
      { userId: 'cliente-1', ok: true, chiestaIl: giorniFa(8), fileRimossi: 0 } as TentativoCancellazione,
    ]);

    expect(verdetto.fatte).toBe(1);
    expect(verdetto.dovuti).toHaveLength(0);
    expect(mondo.righe('notifications')).toHaveLength(0);
  });

  it('due giri partiti insieme: il secondo sbatte sulla chiave primaria e non duplica', async () => {
    const scritte: Record<string, unknown>[] = [];
    // Un database che si comporta come quello vero: la lettura non vede ancora
    // niente (le due corse partono insieme) ma la scrittura rifiuta il doppione.
    const inCorsa: ClienteAvvisi = {
      from: () => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: async (righe: Record<string, unknown>[]) => {
          const id = String(righe[0].id);
          if (scritte.some((r) => r.id === id)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          }
          scritte.push(righe[0]);
          return { data: righe, error: null };
        },
      }),
    };

    const dovuti = verdettoDelGiro([FATTORINO], ADESSO, RECAPITO).dovuti;
    const primo = await recapitaAvvisi(inCorsa, dovuti, registro());
    const secondo = await recapitaAvvisi(inCorsa, dovuti, registro());

    expect(primo.recapitati).toBe(1);
    expect(secondo.recapitati).toBe(0);
    expect(secondo.giaDetti).toBe(1);
    // E soprattutto: il rifiuto del database NON è un guasto da segnalare.
    expect(secondo.falliti).toBe(0);
    expect(scritte).toHaveLength(1);
  });

  it('un avviso che non parte si conta come guasto, e non fa cadere gli altri', async () => {
    const rotto: ClienteAvvisi = {
      from: () => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: async () => ({ data: null, error: { message: 'permission denied' } }),
      }),
    };
    const dovuti = verdettoDelGiro(
      [FATTORINO, { ...FATTORINO, userId: 'rider-2' }],
      ADESSO,
      RECAPITO,
    ).dovuti;
    const log = registro();
    const rapporto = await recapitaAvvisi(rotto, dovuti, log);

    expect(rapporto.falliti).toBe(2);
    expect(rapporto.esiti).toHaveLength(2);
    expect(log.error).toHaveBeenCalled();
  });

  it('la chiave dipende dall istante, non da come è scritta la data', () => {
    // La stessa colonna arriva al giro notturno dalla funzione del database e
    // alla pagina dell'account da una lettura diretta. Due scritture diverse
    // dello stesso istante non devono produrre due avvisi.
    const a = chiaveAvviso('rider-1', '2026-09-01T10:00:00+00:00', 'rinviata');
    const b = chiaveAvviso('rider-1', '2026-09-01T10:00:00.000Z', 'rinviata');
    expect(a).toBe(b);
    expect(identificativoAvviso(a)).toBe(identificativoAvviso(b));
    // E resta un uuid vero: la colonna è di tipo uuid.
    expect(identificativoAvviso(a)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('senza una casella privacy configurata non si promette una casella che non riceve', () => {
    // R053: l'informativa mandava a un indirizzo che non esisteva. Qui il
    // recapito predefinito viene da `recapitoPrivacy()`, che in mancanza della
    // casella manda al modulo dei contatti.
    const dovuti = verdettoDelGiro([FATTORINO], ADESSO).dovuti;
    expect(dovuti[0].corpo).toContain('il modulo dei contatti');
  });
});
