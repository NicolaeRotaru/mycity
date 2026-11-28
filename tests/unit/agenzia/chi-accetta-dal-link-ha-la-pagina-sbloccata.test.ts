import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CHI ACCETTA DAL LINK HA LA PAGINA SBLOCCATA NELLA FASCIA CHE ACCETTA — 27/11/2026.
 *
 * Nicola, 27/11 02:26: «in automatico deve sbloccarsi la pagina del venditore in base all'abbonamento», subito
 * e fino alla disdetta. Con il pagamento online spento, accettare il preventivo dal link sblocca la pagina
 * nella fascia accettata (se l'agente ne aveva scelta un'altra, si allinea) e l'avviso a Nicola lo dice.
 * Con il pagamento online acceso lo sblocco resta al webhook di Stripe, come prima.
 */

const stato = vi.hoisted(() => ({
  online: false,
  sblocchi: [] as { id: string; fascia: string }[],
  esitoSblocco: { esito: 'sbloccata', fascia: 'premium' } as Record<string, unknown>,
  avvisi: [] as string[],
  riaperto: null as null | Record<string, unknown>,
  utenteRotto: false,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({ accessoDopoIlPreventivoTemplate: () => ({ subject: 'Entra', html: '<p>Entra</p>' }) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async (_t: string, testo: string) => { stato.avvisi.push(testo); } }));
// Il resto del modulo resta vero: le schede dei prodotti SDG leggono le sue costanti (PAGAMENTO_ONLINE_SERVIZI).
vi.mock('@/lib/agenzia/pagamento-servizi', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenzia/pagamento-servizi')>()),
  pagamentoOnlineAttivo: () => stato.online,
}));
vi.mock('@/lib/agenzia/scheda-dopo-abbonamento', () => ({ leggiSchedaEPagellaAperte: async () => null, schedaPerIlSito: () => null }));
vi.mock('@/lib/agenzia/scheda-cliente', () => ({ campiPerIlProfilo: () => ({}), leggiSchedaSalvata: () => null }));
vi.mock('@/lib/agenzia/abbonamento-contanti', () => ({
  sbloccaInContanti: async (_a: unknown, id: string, fascia: string) => { stato.sblocchi.push({ id, fascia }); return stato.esitoSblocco; },
  sbloccoRiuscito: (e: { esito: string }) => e.esito !== 'guasto',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const catena = (risultato: unknown, quandoAggiorna?: (v: Record<string, unknown>) => void) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) q[m] = () => q;
      q.update = (v: Record<string, unknown>) => { quandoAggiorna?.(v); return q; };
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(risultato).then(ok);
      return q;
    };
    return {
      from: (tabella: string) =>
        tabella === 'preventivi_con_codice'
          ? catena({ data: [{ seller_id: 'negozio-1' }], error: null }, (v) => { if (v.stato === 'aperto') stato.riaperto = v; })
          : catena({ data: null, error: null }),
      auth: {
        admin: {
          updateUserById: async () => ({ error: stato.utenteRotto ? { message: 'email già usata', code: 'email_exists' } : null }),
          generateLink: async () => ({ data: { properties: { action_link: 'https://accesso' } }, error: null }),
        },
      },
    };
  },
}));

const { accettaPreventivoColCodice } = await import('@/lib/agenzia/preventivo-col-codice');

const accetta = (fascia: 'base' | 'business' | 'premium', fasciaDellAgente: 'base' | 'business' | 'premium' | null = 'business') =>
  accettaPreventivoColCodice({
    preventivo: { sellerId: 'negozio-1', stato: 'aperto', fasciaScelta: fasciaDellAgente, nomeAttivita: 'El Tropico Latino' },
    codice: 'c'.repeat(64),
    email: 'titolare@esempio.it',
    fascia,
  });

beforeEach(() => {
  stato.online = false;
  stato.sblocchi = [];
  stato.avvisi = [];
  stato.riaperto = null;
  stato.utenteRotto = false;
  stato.esitoSblocco = { esito: 'sbloccata', fascia: 'premium' };
});

describe('accettare dal link', () => {
  it('col pagamento online spento sblocca la pagina nella fascia accettata, e Nicola lo legge', async () => {
    const esito = await accetta('premium', null);
    expect(esito.ok).toBe(true);
    expect(stato.sblocchi).toEqual([{ id: 'negozio-1', fascia: 'premium' }]);
    expect(stato.avvisi[0]).toContain('sbloccata col Premium');
    expect(stato.avvisi[0]).toContain('contanti');
  });

  it('se l agente aveva scelto un altra fascia, vale quella accettata e l avviso lo dice', async () => {
    stato.esitoSblocco = { esito: 'cambiata', fascia: 'premium', da: 'business' };
    await accetta('premium', 'business');
    expect(stato.sblocchi).toEqual([{ id: 'negozio-1', fascia: 'premium' }]);
    expect(stato.avvisi[0]).toContain('l\'agente aveva scelto il Business');
  });

  it('se lo sblocco non riesce, l avviso a Nicola lo grida', async () => {
    stato.esitoSblocco = { esito: 'guasto', dettaglio: 'tabella giù' };
    await accetta('base');
    expect(stato.avvisi[0]).toContain('NON si è sbloccata');
  });

  it('col pagamento online acceso lo sblocco resta a Stripe', async () => {
    stato.online = true;
    await accetta('premium');
    expect(stato.sblocchi).toEqual([]);
    expect(stato.avvisi[0]).not.toContain('sbloccata');
  });

  it('se l email non si collega, il preventivo torna aperto con la scelta dell agente, e niente si sblocca', async () => {
    stato.utenteRotto = true;
    const esito = await accetta('premium', 'business');
    expect(esito.ok).toBe(false);
    expect(stato.riaperto).toMatchObject({ stato: 'aperto', fascia_scelta: 'business' });
    expect(stato.sblocchi).toEqual([]);
  });
});
