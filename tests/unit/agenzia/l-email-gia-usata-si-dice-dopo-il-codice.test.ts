import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'EMAIL GIÀ USATA SI DICE, DOPO IL CODICE GIUSTO — 27/11/2026 23:34.
 *
 * Nicola ha confermato il Business di Luna Rossa dal link: codice dell'email giusto, e la pagina diceva solo
 * «Non sono riuscito a collegare questa email». L'email aveva già un account da cliente. Supabase non risponde
 * «email già usata»: risponde 500 «Error updating user» con codice `unexpected_failure` (nel suo log c'è il
 * doppione sull'indice unico delle email). Il sito leggeva solo la parola nel messaggio, quindi pensava a un
 * guasto e dava il messaggio vago.
 *
 * Ora, dopo il codice giusto: se l'email è già di un altro utente, il titolare legge che ha già un account e
 * cosa fare, e Nicola riceve un avviso per chiamarlo. Se non si riesce a sapere, resta il messaggio prudente.
 */

const stato = vi.hoisted(() => ({
  utenti: [] as { id: string; email: string }[],
  listaRotta: false,
  listaCheLancia: false,
  riaperturaRotta: false,
  avvisi: [] as { titolo: string; testo: string }[],
  riaperto: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({ accessoDopoIlPreventivoTemplate: () => ({ subject: 'Entra', html: '<p>Entra</p>' }) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async (titolo: string, testo: string) => { stato.avvisi.push({ titolo, testo }); } }));
vi.mock('@/lib/agenzia/pagamento-servizi', () => ({ pagamentoOnlineAttivo: () => false }));
vi.mock('@/lib/agenzia/scheda-dopo-abbonamento', () => ({ leggiSchedaEPagellaAperte: async () => null, schedaPerIlSito: () => null }));
vi.mock('@/lib/agenzia/scheda-cliente', () => ({ campiPerIlProfilo: () => ({}), leggiSchedaSalvata: () => null }));
vi.mock('@/lib/agenzia/abbonamento-contanti', () => ({ sbloccaInContanti: async () => ({ esito: 'sbloccata' }), sbloccoRiuscito: () => true }));
vi.mock('@/lib/agenzia/ordine-sdg', () => ({ creaOrdineSdg: async () => undefined }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const catena = (risultato: unknown, quandoAggiorna?: (v: Record<string, unknown>) => void) => {
      const q: Record<string, unknown> = {};
      let riapre = false;
      for (const m of ['select', 'eq', 'in', 'limit']) q[m] = () => q;
      q.update = (v: Record<string, unknown>) => { riapre = v.stato === 'aperto'; quandoAggiorna?.(v); return q; };
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(riapre && stato.riaperturaRotta ? { data: null, error: { message: 'database giù' } } : risultato).then(ok);
      return q;
    };
    return {
      from: (tabella: string) =>
        tabella === 'preventivi_con_codice'
          ? catena({ data: [{ seller_id: 'negozio-luna' }], error: null }, (v) => { if (v.stato === 'aperto') stato.riaperto = v; })
          : catena({ data: null, error: null }),
      auth: {
        admin: {
          // Quello che risponde davvero Supabase quando l'email è già di un altro (log del 27/11 22:34 UTC).
          updateUserById: async () => ({ error: { message: 'Error updating user', code: 'unexpected_failure', status: 500 } }),
          listUsers: async ({ page }: { page: number }) => {
            if (stato.listaCheLancia) throw new SyntaxError('Unexpected token < in JSON');
            return stato.listaRotta
              ? { data: null, error: { message: 'auth giù' } }
              : { data: { users: page === 1 ? stato.utenti : [] }, error: null };
          },
          generateLink: async () => ({ data: { properties: { action_link: 'https://accesso' } }, error: null }),
        },
      },
    };
  },
}));

const { accettaPreventivoColCodice, EMAIL_DI_UN_ALTRO_ACCOUNT } = await import('@/lib/agenzia/preventivo-col-codice');

const accetta = (email: string) =>
  accettaPreventivoColCodice({
    preventivo: { sellerId: 'negozio-luna', stato: 'aperto', fasciaScelta: 'business', nomeAttivita: "Luna Rossa Pizzeria D'Asporto" },
    codice: 'c'.repeat(64),
    email,
    fascia: 'business',
  });

beforeEach(() => {
  stato.utenti = [
    { id: 'negozio-luna', email: 'luna-rossa.preventivo@mycity-system.local' },
    { id: 'cliente-1', email: 'agenzia.social.n8n@gmail.com' },
  ];
  stato.listaRotta = false;
  stato.listaCheLancia = false;
  stato.riaperturaRotta = false;
  stato.avvisi = [];
  stato.riaperto = null;
});

describe('confermare con un email che ha già un account', () => {
  it('il titolare legge che l email ha già un account e cosa fare, non un errore vago', async () => {
    const esito = await accetta('agenzia.social.n8n@gmail.com');
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.motivo).toBe('EMAIL_GIA_USATA');
    expect(esito.messaggio).toBe(EMAIL_DI_UN_ALTRO_ACCOUNT);
    expect(esito.messaggio).toContain('ha già un account');
    expect(esito.messaggio).toContain('ho sbagliato email');
  });

  it('vale anche se l email arriva con le maiuscole', async () => {
    const esito = await accetta('Agenzia.Social.N8N@gmail.com');
    expect(esito.ok).toBe(false);
    if (!esito.ok) expect(esito.messaggio).toBe(EMAIL_DI_UN_ALTRO_ACCOUNT);
  });

  it('Nicola riceve l avviso con l attività e l email, per chiamare il titolare', async () => {
    await accetta('agenzia.social.n8n@gmail.com');
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0].titolo).toContain('Luna Rossa');
    expect(stato.avvisi[0].testo).toContain('agenzia.social.n8n@gmail.com');
    expect(stato.avvisi[0].testo).toContain('ancora aperto');
  });

  it('il preventivo torna aperto con la fascia di prima', async () => {
    await accetta('agenzia.social.n8n@gmail.com');
    expect(stato.riaperto).toMatchObject({ stato: 'aperto', fascia_scelta: 'business' });
  });

  it('se l email non è di nessun altro, resta il messaggio prudente e nessun avviso', async () => {
    const esito = await accetta('titolare-nuovo@esempio.it');
    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.messaggio).not.toBe(EMAIL_DI_UN_ALTRO_ACCOUNT);
      expect(esito.messaggio).toContain('Non sono riuscito a collegare questa email');
    }
    expect(stato.avvisi).toHaveLength(0);
  });

  it('se gli utenti non si leggono, non si dice che l email è già usata', async () => {
    stato.listaRotta = true;
    const esito = await accetta('agenzia.social.n8n@gmail.com');
    expect(esito.ok).toBe(false);
    if (!esito.ok) expect(esito.messaggio).not.toBe(EMAIL_DI_UN_ALTRO_ACCOUNT);
    expect(stato.avvisi).toHaveLength(0);
  });

  it('se la lettura degli utenti lancia, la conferma non cade: resta il messaggio prudente', async () => {
    stato.listaCheLancia = true;
    const esito = await accetta('agenzia.social.n8n@gmail.com');
    expect(esito.ok).toBe(false);
    if (!esito.ok) expect(esito.messaggio).toContain('Non sono riuscito a collegare questa email');
  });

  it('se il preventivo non si riapre, il titolare non viene mandato a chiedere un codice e Nicola lo legge', async () => {
    stato.riaperturaRotta = true;
    const esito = await accetta('agenzia.social.n8n@gmail.com');
    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.messaggio).toContain('ha già un account');
      expect(esito.messaggio).not.toContain('ho sbagliato email');
      expect(esito.messaggio).toContain('Scrivici');
    }
    expect(stato.avvisi[0].testo).toContain('NON è tornato aperto');
    expect(stato.avvisi[0].testo).not.toContain('ancora aperto');
  });
});
