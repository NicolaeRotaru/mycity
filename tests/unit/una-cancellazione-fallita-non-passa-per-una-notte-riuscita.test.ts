/**
 * 3/9/2026 — IL NUMERO C'ERA E NON LO LEGGEVA NESSUNO.
 *
 * Il giro notturno delle cancellazioni contava le richieste non riuscite e le
 * scriveva nel corpo della risposta: `{failed: 3}`. Quella risposta la riceve lo
 * scheduler di Vercel, che guarda il codice di stato — 200 — e butta via il
 * corpo. Quindi il conto era esatto, usciva ogni notte, e non lo leggeva nessun
 * essere umano. È il motivo per cui il difetto è rimasto invisibile per mesi.
 *
 * Non è un errore tecnico qualunque: una cancellazione non eseguita è una
 * richiesta fatta per legge che non abbiamo onorato.
 *
 * QUI SI PROVANO DUE COSE INSIEME, E LA SECONDA È QUELLA CHE SI DIMENTICA:
 *
 *  ① la notte che fallisce diventa rossa e sveglia un amministratore;
 *  ② la notte che RINVIA — un fattorino ha ancora contanti da versare e la
 *    cancellazione si ferma apposta — NON suona. Se suonasse, un solo fattorino
 *    con la cassa aperta renderebbe rosso il lavoro tutte le notti per
 *    settimane, e un allarme sempre acceso è un allarme che nessuno guarda più.
 *    Su questo progetto sarebbe anche peggio: il battito del lavoro si scrive
 *    solo quando la risposta è buona, quindi il rinvio farebbe pure annunciare
 *    «process-deletions è fermo» mentre gira benissimo.
 *
 * Il rinvio però non è eterno: dopo un mese dalla richiesta il termine di legge
 * è passato, e allora suona anche quello.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import { verdettoDelGiro, GIORNI_MASSIMI_DI_ATTESA } from '@/lib/cron-cancellazioni';

type Esito = {
  ok: boolean;
  motivo?: 'cassa_da_versare';
  errore?: string;
  fileRimossi: number;
  erroriFile: string[];
};

const mondo: { attuale: ReturnType<typeof fintoGiroNotturno>; esiti: Record<string, Esito> } = {
  attuale: fintoGiroNotturno(),
  esiti: {},
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => mondo.attuale.admin,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
// La cancellazione vera ha la sua prova, in un altro file. Qui si collauda cosa
// fa LA NOTTE con gli esiti che riceve, quindi gli esiti si dettano.
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async (_admin: unknown, userId: string): Promise<Esito> =>
    mondo.esiti[userId] ?? { ok: true, fileRimossi: 0, erroriFile: [] },
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

/** Fa passare la notte con queste richieste scadute e questi esiti. */
async function laNotte(
  richieste: Array<{ userId: string; chiestaIl: string; esito: Esito }>,
) {
  mondo.esiti = Object.fromEntries(richieste.map((r) => [r.userId, r.esito]));
  mondo.attuale = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'cliente-1', role: 'buyer' }],
      notifications: [],
      cron_heartbeats: [],
    },
    rpc: {
      process_expired_deletions: {
        data: richieste.map((r) => ({ user_id: r.userId, deleted_at: r.chiestaIl })),
        error: null,
      },
    },
  });
  const res = await POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { http: res.status, corpo: await res.json(), mondo: mondo.attuale };
}

const RIUSCITA: Esito = { ok: true, fileRimossi: 0, erroriFile: [] };
const GUASTO: Esito = {
  ok: false,
  errore: "L'account non è stato cancellato: database is not available",
  fileRimossi: 0,
  erroriFile: [],
};
const RINVIATA: Esito = {
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 165,50 € di contanti non versati',
  fileRimossi: 0,
  erroriFile: [],
};

describe('la notte che non riesce a cancellare un account', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  it('IL CASO CHE ROMPEVA — una cancellazione fallita rende rossa la notte', async () => {
    const { http, corpo } = await laNotte([
      { userId: 'u1', chiestaIl: giorniFa(8), esito: GUASTO },
      { userId: 'u2', chiestaIl: giorniFa(8), esito: RIUSCITA },
    ]);
    expect(
      http,
      'la notte risponde «riuscita» con una richiesta di legge non eseguita: nessuno lo saprà mai',
    ).toBe(500);
    expect(corpo.failed).toBe(1);
    expect(corpo.processed).toBe(1);
  });

  it('e sveglia un amministratore con una frase che si capisce', async () => {
    const { mondo } = await laNotte([{ userId: 'u1', chiestaIl: giorniFa(8), esito: GUASTO }]);
    const avvisi = mondo.notifiche();
    expect(avvisi.length, 'nessuno è stato avvisato: il numero resta dentro una risposta HTTP').toBe(1);
    expect(avvisi[0].user_id, 'l avviso è andato a chi non è amministratore').toBe('admin-1');
    expect(String(avvisi[0].body)).toContain('1 richiesta di cancellazione account');
    expect(
      String(avvisi[0].body),
      'la frase dell avviso è scritta per un tecnico, non per chi la legge di notte',
    ).not.toMatch(/GDPR|art\.|HTTP|null/);
    expect(avvisi[0].category, 'un allarme di sistema non si spegne con gli interruttori del marketing').toBe('system');
  });

  it('la notte fallita non scrive il battito: se continua, se ne accorge anche il sorvegliante', async () => {
    const { mondo } = await laNotte([{ userId: 'u1', chiestaIl: giorniFa(8), esito: GUASTO }]);
    expect(
      mondo.battitoScritto(),
      'il lavoro fallisce e continua a dichiararsi vivo: il freno anti-silenzio non scatta mai',
    ).toBe(false);
  });

  it('la notte andata bene resta verde, scrive il battito e non sveglia nessuno', async () => {
    const { http, corpo, mondo } = await laNotte([
      { userId: 'u1', chiestaIl: giorniFa(8), esito: RIUSCITA },
    ]);
    expect(http).toBe(200);
    expect(corpo.processed).toBe(1);
    expect(mondo.notifiche().length, 'grida al lupo su una notte perfetta').toBe(0);
    expect(mondo.battitoScritto()).toBe(true);
  });

  it('IL FALSO ALLARME — un rinvio deciso da noi non fa suonare niente', async () => {
    // Il fattorino ha ancora dei contanti da versare: la cancellazione si ferma
    // apposta, per non distruggere il registro di un debito. È la regola che
    // funziona, e si ripete ogni notte finché lui non versa.
    const { http, corpo, mondo } = await laNotte([
      { userId: 'rider-1', chiestaIl: giorniFa(9), esito: RINVIATA },
    ]);
    expect(
      http,
      'un fattorino con la cassa aperta rende rossa ogni notte per settimane: alla terza nessuno guarda più',
    ).toBe(200);
    expect(corpo.rinviate, 'il rinvio non ha un posto suo: sparisce fra i falliti o fra i riusciti').toBe(1);
    expect(corpo.failed, 'un rinvio deciso da noi viene contato come un guasto').toBe(0);
    expect(mondo.notifiche().length, 'sveglia qualcuno per una regola che sta funzionando').toBe(0);
    expect(
      mondo.battitoScritto(),
      'il rinvio spegne il battito, e il sorvegliante annuncia un lavoro fermo che gira benissimo',
    ).toBe(true);
  });

  it('ma un rinvio che dura più di un mese suona: il termine di legge è passato', async () => {
    const { http, corpo, mondo } = await laNotte([
      { userId: 'rider-1', chiestaIl: giorniFa(GIORNI_MASSIMI_DI_ATTESA + 15), esito: RINVIATA },
    ]);
    expect(http, 'una persona aspetta da un mese e mezzo e nessuno se ne accorge').toBe(500);
    expect(corpo.scadute).toBe(1);
    expect(String(mondo.notifiche()[0].body)).toContain('più di 30 giorni');
  });
});

describe('il verdetto della notte, da solo', () => {
  const adesso = Date.parse('2026-09-03T04:00:00Z');
  const giorniPrima = (g: number) => new Date(adesso - g * 86_400_000).toISOString();

  it('conta separatamente fatte, rinviate e fallite', () => {
    const v = verdettoDelGiro(
      [
        { userId: 'a', ok: true },
        { userId: 'b', ok: false, motivo: 'cassa_da_versare', chiestaIl: giorniPrima(9) },
        { userId: 'c', ok: false, errore: 'database is not available' },
      ],
      adesso,
    );
    expect(v).toMatchObject({ fatte: 1, rinviate: 1, fallite: 1, scadute: 0, daSvegliare: true });
  });

  it('un rinvio senza data di richiesta non diventa mai «scaduto» per sbaglio', () => {
    // Se la data non arriva (colonna vuota, RPC cambiata), il conto dei giorni
    // non si può fare: inventare uno zero direbbe «sta aspettando da oggi» e
    // inventare un infinito farebbe suonare l'allarme a vuoto.
    const v = verdettoDelGiro(
      [{ userId: 'b', ok: false, motivo: 'cassa_da_versare', chiestaIl: null }],
      adesso,
    );
    expect(v.scadute).toBe(0);
    expect(v.daSvegliare).toBe(false);
  });

  it('un motivo di rinvio che questo file non conosce vale come guasto', () => {
    // Il verso giusto in cui sbagliare: un motivo nuovo aggiunto domani senza
    // passare di qui fa rumore, invece di sparire in silenzio fra i rinvii.
    const v = verdettoDelGiro(
      [{ userId: 'x', ok: false, motivo: 'motivo_inventato' as 'cassa_da_versare' }],
      adesso,
    );
    expect(v.fallite).toBe(1);
    expect(v.daSvegliare).toBe(true);
  });

  it('una notte senza niente da fare non sveglia nessuno', () => {
    expect(verdettoDelGiro([], adesso)).toMatchObject({ daSvegliare: false, riga: null });
  });
});
