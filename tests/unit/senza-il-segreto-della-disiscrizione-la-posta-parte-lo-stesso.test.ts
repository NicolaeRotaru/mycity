import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/8/2026 (R054) — UNA VARIABILE DIMENTICATA, E NON USCIVA PIU' NEMMENO UNA EMAIL.
 *
 * `sendEmail` costruisce il link «annulla l'iscrizione» PRIMA di provare a
 * spedire. Quel link si firma con `UNSUBSCRIBE_SECRET`, e in produzione, se la
 * variabile non c'e', la firma non si fa e lancia un'eccezione (081: prima si
 * ripiegava sulla chiave di servizio del database, e quella strada e' stata
 * chiusa apposta).
 *
 * La chiamata stava fuori dal `try`, quindi l'eccezione usciva da `sendEmail` e
 * ricadeva su chi la stava chiamando: la conferma d'ordine del cliente, l'avviso
 * di nuovo ordine al negozio, il rimborso. Una variabile non messa su Vercel e
 * il marketplace smetteva di scrivere a chiunque — mentre il sito continuava a
 * prendere ordini come se niente fosse.
 *
 * La regola adesso e' quella giusta per ognuno dei due casi: l'ordine che una
 * persona ha pagato le deve arrivare comunque, anche senza il piede di
 * disiscrizione; una email commerciale senza il modo di smettere di riceverla
 * NON parte, perche' spedirla sarebbe peggio che non spedirla.
 */

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
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('UNSUBSCRIBE_SECRET', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('la posta quando manca il segreto della disiscrizione', () => {
  it("la conferma d'ordine arriva lo stesso al cliente", async () => {
    const sendEmail = await posta();
    const esito = await sendEmail(CONFERMA_ORDINE);

    expect(esito, "il cliente ha pagato e non riceve la conferma: una variabile mancante non puo' fermare gli ordini").toEqual({ ok: true, id: 'msg-1' });
    expect(inviate, "la conferma d'ordine non e' nemmeno partita").toHaveLength(1);
  });

  it("la conferma parte senza il piede di disiscrizione, perche' non si puo' firmare", async () => {
    const sendEmail = await posta();
    await sendEmail(CONFERMA_ORDINE);

    const html = String(inviate[0]?.html ?? '');
    expect(html, 'un link di disiscrizione non firmato porta a una pagina che rifiuta: meglio nessun link').not.toContain('/api/unsubscribe');
    expect(inviate[0]?.headers, "senza link non ci possono essere le intestazioni che lo annunciano").toBeUndefined();
  });

  it('la email commerciale invece non parte, e lo dice', async () => {
    const sendEmail = await posta();
    const esito = await sendEmail({
      to: 'maria@example.it',
      subject: 'Ci manchi! Torna con uno sconto',
      html: '<p>Codice RITORNO10</p>',
      tipo: 'marketing',
    });

    expect(inviate, 'una email commerciale senza il modo di smettere di riceverla non si spedisce').toHaveLength(0);
    expect(esito.ok).toBe(false);
    expect('skipped' in esito && esito.skipped, "chi chiama deve capire che e' stata saltata, non che Resend e' rotta").toBe(true);
  });

  it('il guasto finisce nei log: non si ripara da solo e nessuno lo vedrebbe', async () => {
    const sendEmail = await posta();
    await sendEmail(CONFERMA_ORDINE);

    expect(erroriScritti.join(' | '), "una email spedita senza piede di disiscrizione e' un guasto di configurazione, va visto").toMatch(/disiscrizione/i);
  });

  it('col segreto al suo posto, la email commerciale riprende ad avere il suo link', async () => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
    const sendEmail = await posta();
    await sendEmail({
      to: 'maria@example.it',
      subject: 'Ci manchi! Torna con uno sconto',
      html: '<p>Codice RITORNO10</p>',
      tipo: 'marketing',
    });

    expect(inviate).toHaveLength(1);
    expect(String(inviate[0]?.html ?? '')).toContain('/api/unsubscribe');
  });
});
