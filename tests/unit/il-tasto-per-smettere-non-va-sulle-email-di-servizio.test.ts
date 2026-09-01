import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/8/2026 (R067) — «ANNULLA L'ISCRIZIONE» IN FONDO ALLA CONFERMA D'ORDINE.
 *
 * `sendEmail` attaccava a OGNI messaggio la riga «Non vuoi piu' ricevere queste
 * email? Annulla l'iscrizione con un clic» e le due intestazioni che accendono
 * il pulsante «Annulla iscrizione» dentro Gmail. Non c'era modo di distinguere
 * un messaggio di servizio da una email commerciale: nel modulo d'ingresso non
 * esisteva nessun campo che lo dicesse.
 *
 * Quel link disiscrive dall'ambito «marketing», e la funzione del database
 * spegne `email_marketing` e `notif_promos` (migrazione 118). Due strade,
 * tutte e due storte:
 *
 *  · chi lo preme in fondo alla conferma di un ordine crede di aver spento gli
 *    avvisi sull'ordine — e invece ha spento le promozioni, mentre le email
 *    d'ordine continuano ad arrivare. Quando arrivano, ci segnala come spam;
 *  · oppure ha spento le promozioni senza volerlo, e noi abbiamo perso un
 *    contatto per un equivoco che avevamo scritto noi.
 *
 * La distinzione esisteva gia' nel giro della coda (welcome e tutorial erano
 * gia' dichiarati esenti dal consenso marketing): mancava solo nel punto in cui
 * la email viene davvero impacchettata.
 *
 * Il valore di ripiego resta «marketing»: chi chiama e non dichiara niente
 * continua ad avere il link. Un'email commerciale a cui togliamo il modo di
 * smettere e' un problema piu' grave di un piede di troppo su una ricevuta.
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

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

async function posta() {
  vi.resetModules();
  return (await import('@/lib/email/client')).sendEmail;
}

beforeEach(() => {
  inviate.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il piede «annulla l\'iscrizione»', () => {
  it("non compare sulla conferma d'ordine", async () => {
    const sendEmail = await posta();
    await sendEmail({
      to: 'maria@example.it',
      subject: 'Ordine #ab12cd34 ricevuto — MyCity',
      html: '<html><body><p>Abbiamo ricevuto il tuo ordine.</p></body></html>',
      tipo: 'transazionale',
    });

    const html = String(inviate[0]?.html ?? '');
    expect(html, "chi lo preme sulla ricevuta spegne le promozioni credendo di spegnere gli avvisi dell'ordine").not.toContain('/api/unsubscribe');
    expect(html).not.toContain("Annulla l'iscrizione");
  });

  it("non accende il pulsante «Annulla iscrizione» di Gmail sulle email di servizio", async () => {
    const sendEmail = await posta();
    await sendEmail({
      to: 'maria@example.it',
      subject: 'Rimborso emesso',
      html: '<p>Abbiamo emesso un rimborso.</p>',
      tipo: 'transazionale',
    });

    const intestazioni = (inviate[0]?.headers ?? {}) as Record<string, string>;
    expect(intestazioni['List-Unsubscribe'], 'un clic distratto sul pulsante di Gmail spegneva le promozioni di un cliente che voleva solo archiviare una ricevuta').toBeUndefined();
    expect(intestazioni['List-Unsubscribe-Post']).toBeUndefined();
  });

  it("resta sulle email commerciali, dove e' obbligatorio", async () => {
    const sendEmail = await posta();
    await sendEmail({
      to: 'maria@example.it',
      subject: 'Ci manchi! Torna con uno sconto',
      html: '<html><body><p>Codice RITORNO10</p></body></html>',
      tipo: 'marketing',
    });

    const html = String(inviate[0]?.html ?? '');
    const intestazioni = (inviate[0]?.headers ?? {}) as Record<string, string>;
    expect(html, "senza questo link una email commerciale non si puo' spedire").toContain('/api/unsubscribe');
    expect(html).toContain("Annulla l'iscrizione");
    expect(intestazioni['List-Unsubscribe']).toMatch(/^<https:\/\/mycity\.example\/api\/unsubscribe/);
    expect(intestazioni['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('chi non dichiara niente resta trattato come commerciale, e il link non sparisce', async () => {
    // Il ripiego prudente: meglio un piede di troppo su una ricevuta che una
    // promozione senza il modo di smettere di riceverla.
    const sendEmail = await posta();
    await sendEmail({
      to: 'maria@example.it',
      subject: 'Cosa succede in citta questa settimana',
      html: '<p>Eventi della settimana.</p>',
    });

    expect(String(inviate[0]?.html ?? '')).toContain('/api/unsubscribe');
  });
});
