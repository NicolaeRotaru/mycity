import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 6/9/2026 — IL COMMENTO PROMETTEVA UNA COSA, IL CODICE NE FACEVA UN'ALTRA.
 *
 * `lib/env.ts` dichiarava, nero su bianco, che in rete senza RESEND_FROM «la
 * posta non parte e lo si sa subito, lib/email/client.ts e /api/health».
 * Nessuna delle tre cose esisteva: `resendFrom()` ripiegava sempre su un
 * mittente che nessuno aveva configurato, il client lo infilava dritto in
 * `from:` e il semaforo non guardava nemmeno quella variabile.
 *
 * Il danno non e' teorico. Resend rifiuta una busta con un dominio che non ha
 * verificato, quindi il guasto usciva UNA EMAIL PER VOLTA: la conferma
 * d'ordine di Maria, l'avviso di nuovo ordine al fornaio, il rimborso — ognuno
 * il suo errore, in un log che nessuno guardava, mentre il sito continuava a
 * incassare. Un guasto di configurazione va scoperto una volta sola, alla
 * configurazione.
 *
 * Questa prova non cerca parole in un file: mette in piedi la produzione,
 * toglie il mittente, chiama `sendEmail` vera e pretende che verso Resend non
 * parta NIENTE. Il pezzo del semaforo lo tiene chiuso
 * `tests/unit/il-semaforo-guarda-i-segreti-che-contano.test.ts`, che toglie
 * RESEND_FROM e pretende che `/api/health` lo dica.
 *
 * ⚠️ Cosa NON copre: che il dominio del mittente sia davvero verificato su
 * Resend. Quello si vede solo nel pannello di Resend, non da qui.
 */

/** Tutto quello che il codice ha provato a spedire davvero. */
const inviate: Array<Record<string, unknown>> = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        inviate.push(payload);
        return { data: { id: 'msg-1' }, error: null };
      },
    };
  },
}));

const erroriScritti: string[] = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: (messaggio: string) => { erroriScritti.push(messaggio); },
  },
}));

/** Il client tiene in cache l'oggetto Resend: ogni prova riparte pulita. */
async function posta() {
  vi.resetModules();
  return (await import('@/lib/email/client')).sendEmail;
}

async function variabili() {
  vi.resetModules();
  return (await import('@/lib/env')).env;
}

const CONFERMA_ORDINE = {
  to: 'maria@example.it',
  subject: 'Ordine #ab12cd34 ricevuto — MyCity',
  html: '<p>Abbiamo ricevuto il tuo ordine.</p>',
  tipo: 'transazionale' as const,
};

beforeEach(() => {
  inviate.length = 0;
  erroriScritti.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** La produzione vera: su Vercel, senza nessuno che abbia messo il mittente. */
function inProduzione() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'production');
}

/** Il computer di chi sviluppa: nessun segno di Vercel, nessuna produzione. */
function sulComputerDiChiSviluppa() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', undefined);
}

describe('in produzione, senza il mittente configurato', () => {
  beforeEach(() => {
    inProduzione();
    vi.stubEnv('RESEND_FROM', undefined);
  });

  it('non esiste nessun mittente di ripiego da infilare nella busta', async () => {
    const env = await variabili();
    expect(
      env.resendFrom(),
      'in rete si riparte da un mittente che nessuno ha configurato: Resend lo rifiuta una email alla volta',
    ).toBeUndefined();
  });

  it("la conferma d'ordine non viene nemmeno provata", async () => {
    const sendEmail = await posta();
    const esito = await sendEmail(CONFERMA_ORDINE);

    expect(
      inviate,
      'e partita una busta senza mittente configurato: Resend la rifiuta e il guasto si scopre una email per volta',
    ).toHaveLength(0);
    expect(esito.ok).toBe(false);
    expect('skipped' in esito && esito.skipped, "chi chiama deve capire che e' un guasto di configurazione, non Resend rotta").toBe(true);
    expect('reason' in esito ? esito.reason : '', 'il motivo deve nominare la variabile che manca').toContain('RESEND_FROM');
  });

  it('nemmeno la email commerciale', async () => {
    const sendEmail = await posta();
    await sendEmail({
      to: 'maria@example.it',
      subject: 'Ci manchi! Torna con uno sconto',
      html: '<p>Codice RITORNO10</p>',
      tipo: 'marketing',
    });

    expect(inviate).toHaveLength(0);
  });

  it('lo si sa subito: il guasto finisce nei log e nomina la variabile', async () => {
    const sendEmail = await posta();
    await sendEmail(CONFERMA_ORDINE);

    expect(
      erroriScritti.join(' | '),
      'senza una riga di errore il guasto resta invisibile finche non lo segnala un cliente',
    ).toMatch(/RESEND_FROM/);
  });

  it('una variabile fatta di spazi vale come mancante, non come mittente', async () => {
    vi.stubEnv('RESEND_FROM', '   ');
    const sendEmail = await posta();
    await sendEmail(CONFERMA_ORDINE);

    expect(inviate, 'uno spazio non e un indirizzo: Resend rifiuterebbe lo stesso').toHaveLength(0);
  });
});

describe('in produzione, col mittente al suo posto', () => {
  beforeEach(() => {
    inProduzione();
    vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity-marketplace.com>');
  });

  it("la conferma d'ordine parte, e parte da quell'indirizzo", async () => {
    const sendEmail = await posta();
    const esito = await sendEmail(CONFERMA_ORDINE);

    expect(esito, "il cliente ha pagato e deve ricevere la conferma").toEqual({ ok: true, id: 'msg-1' });
    expect(inviate).toHaveLength(1);
    expect(inviate[0]?.from).toBe('MyCity <ordini@mycity-marketplace.com>');
  });
});

describe('sul computer di chi sviluppa', () => {
  beforeEach(() => {
    sulComputerDiChiSviluppa();
    vi.stubEnv('RESEND_FROM', undefined);
  });

  it('il ripiego resta, perche in locale la posta non parte comunque', async () => {
    const env = await variabili();
    const mittente = env.resendFrom() ?? '';

    expect(mittente, 'in locale chiedere una variabile che non spedisce niente rompe le prove e basta').toContain('@');
    expect(mittente, 'il ripiego non deve mai essere un dominio preso in prestito').not.toContain('example.com');
  });

  it('e la email parte lo stesso', async () => {
    const sendEmail = await posta();
    const esito = await sendEmail(CONFERMA_ORDINE);

    expect(esito.ok, 'la guardia sul mittente non deve spegnere lo sviluppo in locale').toBe(true);
    expect(inviate).toHaveLength(1);
  });
});
