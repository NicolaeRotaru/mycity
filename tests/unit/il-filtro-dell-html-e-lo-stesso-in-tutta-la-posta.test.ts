import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeHtml } from '@/lib/html-escape';
import { orderConfirmedBuyerTemplate, giftCardRecipientTemplate, preparaEmailCicloDiVita } from '@/lib/email/templates';

/**
 * 27/8/2026 (R011) — LA STESSA REGOLA SCRITTA IN TRE POSTI, E MANCANTE NEL QUARTO.
 *
 * `lib/html-escape.ts` dichiarava nel proprio commento: «Implementazione
 * condivisa: prima era duplicata inline in piu' route (contact,
 * email/templates). Usare questa per ogni nuova interpolazione HTML». La
 * consolidazione non era mai stata finita: le due copie citate erano ancora al
 * loro posto, e il modulo che si diceva condiviso lo importava un file solo.
 *
 * Tre copie della stessa regola sono tre regole. Il giorno in cui va aggiunto
 * un carattere da filtrare, due restano indietro — e restano indietro in
 * silenzio, perche' nessuno confronta a mano tre funzioni che si assomigliano.
 *
 * E c'era un quarto posto dove il filtro non c'era proprio: i template scritti
 * dentro la rotta del cron, che interpolavano il nome dell'utente grezzo.
 *
 * Questa prova non guarda quante copie ci sono: mette lo stesso testo cattivo
 * dentro ogni superficie che compone posta, e pretende che ne esca sempre
 * esattamente quello che produce la funzione condivisa. Se domani una
 * superficie torna ad avere la sua regola e dimentica un carattere, qui diventa
 * rosso.
 */

/** Il testo che contiene tutti e cinque i caratteri che il filtro deve prendere. */
const CATTIVO = `<img src=x onerror="alert(1)"> Rossi & C'`;
const ATTESO = escapeHtml(CATTIVO);

const spedite: Array<{ html: string; tipo?: string }> = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
  getCurrentUser: async () => null,
}));

vi.mock('@/lib/captcha', () => ({
  verifyTurnstileToken: async () => ({ ok: true, skipped: true }),
}));

vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { html: string; tipo?: string }) => {
    spedite.push(m);
    return { ok: true, id: 'msg-1' };
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

beforeEach(() => {
  spedite.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('SUPPORT_EMAIL', 'assistenza@mycity.example');
});

async function mandaUnMessaggioAllAssistenza(ip: string) {
  vi.resetModules();
  const { POST } = await import('@/app/api/contact/route');
  const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');
  __resetRateLimitBuckets();
  const res = await POST(new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      name: CATTIVO,
      email: 'mario@example.com',
      subject: CATTIVO,
      message: `${CATTIVO} — e questo e' un messaggio abbastanza lungo.`,
    }),
  }));
  return res;
}

describe('il filtro dell HTML nella posta', () => {
  it("il modulo contatti filtra come la funzione condivisa, carattere per carattere", async () => {
    const res = await mandaUnMessaggioAllAssistenza('7.0.0.1');

    expect(res.status).toBe(200);
    expect(spedite, "l'avviso all'assistenza non e' partito").toHaveLength(1);
    const html = spedite[0].html;
    expect(html, "chi scrive dal modulo contatti puo' scrivere quello che vuole nel proprio nome: nell'email deve arrivare come testo").toContain(ATTESO);
    expect(html, 'un tag vivo dentro la posta della nostra assistenza e uno script che gira sul nostro schermo').not.toContain('<img src=x');
  });

  it("la conferma d'ordine filtra allo stesso modo il nome del negozio", () => {
    const t = orderConfirmedBuyerTemplate({
      name: 'Maria',
      orderId: 'ab12cd34-0000-0000-0000-000000000000',
      total: 24.9,
      storeName: CATTIVO,
    });
    expect(t.html).toContain(ATTESO);
    expect(t.html).not.toContain('<img src=x');
  });

  it('il buono regalo filtra allo stesso modo il messaggio di chi lo manda', () => {
    const t = giftCardRecipientTemplate({
      code: 'ABCD-1234',
      amountEuro: 50,
      senderName: 'Luca',
      message: CATTIVO,
    });
    expect(t.html).toContain(ATTESO);
    expect(t.html).not.toContain('<img src=x');
  });

  it("il benvenuto del ciclo di vita filtra allo stesso modo il nome di chi si iscrive", () => {
    // Era questo il quarto posto: qui il filtro non c'era proprio.
    const t = preparaEmailCicloDiVita('welcome', { name: CATTIVO });
    expect(t, 'il benvenuto deve esistere: e la prima email che riceve chi si iscrive').not.toBeNull();
    expect(t!.html).toContain(ATTESO);
    expect(t!.html).not.toContain('<img src=x');
  });

  it("un nome di template che non e' dei nostri non produce nessuna email", () => {
    expect(preparaEmailCicloDiVita('constructor', {}), "cercare il template con la parentesi quadra trovava anche le funzioni di sistema").toBeNull();
    expect(preparaEmailCicloDiVita('__proto__', {})).toBeNull();
    expect(preparaEmailCicloDiVita('inventato_da_qualcuno', {})).toBeNull();
  });
});

describe("l'avviso all'assistenza", () => {
  it("non porta il piede «annulla l'iscrizione»", async () => {
    // 27/8/2026 (R067) — E' un avviso interno alla nostra casella del supporto,
    // non una comunicazione commerciale. Il link di disiscrizione spegne le
    // promozioni dell'indirizzo che lo preme: qui l'indirizzo e' il nostro.
    await mandaUnMessaggioAllAssistenza('7.0.0.2');

    expect(spedite[0].tipo, "un avviso di servizio marcato come commerciale si porta dietro il tasto per smettere").toBe('transazionale');
  });
});
