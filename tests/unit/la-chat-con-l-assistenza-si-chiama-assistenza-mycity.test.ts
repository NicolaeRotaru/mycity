import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * LA CHAT CON L'ASSISTENZA SI CHIAMAVA «UTENTE».
 *
 * 25/10/2026 (scheda 1360) — La conversazione con l'Assistenza ha come seller_id
 * il primo account amministratore. Quell'account non è un negozio: non sta nella
 * vetrina pubblica, e il suo profilo un cliente non lo legge. `nomeDellaControparte`
 * ripiegava quindi su «Utente», e la testata aggiungeva «Negozio».
 *
 * Esempio: un cliente scrive all'Assistenza dal pulsante tondo, poi apre /messages
 * e vede la riga «Utente». Entrando, legge «Utente · Negozio». Non capisce che è
 * l'Assistenza di MyCity, cioè proprio chi stava cercando.
 *
 * Adesso la pagina chiede a GET /api/support/conversation chi fa da Assistenza e
 * la riconosce dal seller_id.
 */

const stato: { admin: { id: string } | null } = { admin: { id: 'adm' } };

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'cliente' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, remaining: 19, retryAfterSec: 0, limit: 20 }),
  getClientIp: () => '10.0.0.1',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: stato.admin }) }) }) }),
      }),
    }),
  }),
}));

import {
  NOME_ASSISTENZA,
  conversazioneConLAssistenza,
  leggiIdAssistenza,
  nomeDellaControparte,
} from '@/lib/queries/controparte-della-chat';
import { GET } from '@/app/api/support/conversation/route';

const conAssistenza = { buyer_id: 'cliente', seller_id: 'adm', buyer: null, seller: null, insegna: null };

beforeEach(() => {
  stato.admin = { id: 'adm' };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('come il cliente vede la chat con l\'Assistenza', () => {
  it('IL CASO CHE ROMPEVA — il cliente vede «Assistenza MyCity», non «Utente»', () => {
    expect(nomeDellaControparte(conAssistenza, 'cliente', 'adm')).toBe('Assistenza MyCity');
    expect(NOME_ASSISTENZA).toBe('Assistenza MyCity');
  });

  it('la testata la riconosce come Assistenza, non come negozio', () => {
    expect(conversazioneConLAssistenza(conAssistenza, 'cliente', 'adm')).toBe(true);
  });

  it('senza l\'id dell\'Assistenza resta il comportamento di prima, senza fermarsi', () => {
    expect(nomeDellaControparte(conAssistenza, 'cliente', null)).toBe('Utente');
    expect(nomeDellaControparte(conAssistenza, 'cliente')).toBe('Utente');
    expect(conversazioneConLAssistenza(conAssistenza, 'cliente', null)).toBe(false);
  });

  it('un negozio vero resta col suo nome', () => {
    const conNegozio = { ...conAssistenza, seller_id: 'pane', insegna: 'Pane Quotidiano' };
    expect(nomeDellaControparte(conNegozio, 'cliente', 'adm')).toBe('Pane Quotidiano');
    expect(conversazioneConLAssistenza(conNegozio, 'cliente', 'adm')).toBe(false);
  });

  it('dal lato dell\'Assistenza si vede il nome del cliente, come prima', () => {
    const vistaDallAssistenza = { ...conAssistenza, buyer: { full_name: 'Mario Rossi', store_name: null } };
    expect(nomeDellaControparte(vistaDallAssistenza, 'adm', 'adm')).toBe('Mario Rossi');
    expect(conversazioneConLAssistenza(vistaDallAssistenza, 'adm', 'adm')).toBe(false);
  });
});

describe('GET /api/support/conversation dice chi fa da Assistenza', () => {
  it('risponde con l\'id del primo amministratore', async () => {
    const risposta = await GET(new Request('http://localhost/api/support/conversation') as never);
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ supportId: 'adm' });
  });

  it('senza amministratori risponde null invece di un errore', async () => {
    stato.admin = null;
    const risposta = await GET(new Request('http://localhost/api/support/conversation') as never);
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ supportId: null });
  });
});

describe('leggiIdAssistenza non ferma la chat se la rotta non risponde', () => {
  it('legge l\'id quando la rotta risponde', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ supportId: 'adm' }), { status: 200 })));
    expect(await leggiIdAssistenza()).toBe('adm');
  });

  it('una risposta d\'errore dà null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    expect(await leggiIdAssistenza()).toBeNull();
  });

  it('una rete caduta dà null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rete caduta'); }));
    expect(await leggiIdAssistenza()).toBeNull();
  });
});
