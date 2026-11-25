/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — Nicola: «aggiungi la possibilità di avere più account e fare lo switch senza doversi
 * disconnettere dall'account». Scelta sua: per tutti, nel menu dell'account, accessi salvati solo
 * sul dispositivo. Regole in lib/account/piu-account.ts.
 *
 * Casi (dato → atteso):
 *  · chi non ha mai aggiunto un account → niente di salvato, a nessun evento;
 *  · «Aggiungi» da A, poi entra B → salvati B e A, l'aggiunta finisce;
 *  · la libreria rinnova le chiavi di A (TOKEN_REFRESHED) → A salvato con le chiavi nuove;
 *  · «Esci» (SIGNED_OUT) → nessun account resta sul dispositivo;
 *  · passare a B con un accesso scaduto → B tolto, l'accesso attivo NON si tocca;
 *  · passare a B → prima si rinnova B a parte, poi si salva A, si mette da parte il carrello e solo
 *    dopo si installa B; si va alla home del ruolo di B;
 *  · se l'installazione non riesce → il carrello torna com'era;
 *  · rete caduta sul rinnovo → B resta salvato;
 *  · il menu mostra gli altri account (non quello attivo) e «Aggiungi un altro account»;
 *  · il menu del negozio ha il blocco.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const finto = vi.hoisted(() => ({
  sessione: null as null | { access_token: string; refresh_token: string; user: { id: string; email: string } },
  setSession: [] as Array<{ access_token: string; refresh_token: string }>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: finto.sessione } }),
      setSession: async (s: { access_token: string; refresh_token: string }) => { finto.setSession.push(s); return { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: async () => ({}),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null }),
  },
}));

import {
  CHIAVE_ACCOUNT, CHIAVE_AGGIUNTA, cambiaAccount, dopoEventoAccesso, iniziaAggiunta, leggiAccount, ricordaSessione, rinnovaAccesso,
  type MondoDelCambio, type SessioneMinima,
} from '@/lib/account/piu-account';
import CambiaAccount from '@/components/account/CambiaAccount';

const sess = (id: string, giro = 1): SessioneMinima => ({
  access_token: `acc-${id}-${giro}`,
  refresh_token: `ref-${id}-${giro}`,
  user: { id, email: `${id}@esempio.it`, user_metadata: { full_name: `Nome ${id}` } },
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  finto.sessione = null;
  finto.setSession = [];
});

describe('gli account salvati seguono gli eventi dell accesso', () => {
  it('chi non ha mai aggiunto un account non ha niente di salvato', () => {
    dopoEventoAccesso('SIGNED_IN', sess('a'));
    dopoEventoAccesso('TOKEN_REFRESHED', sess('a', 2));
    expect(localStorage.getItem(CHIAVE_ACCOUNT)).toBeNull();
  });

  it('«Aggiungi» da A, poi entra B: salvati B e A, e l aggiunta finisce', () => {
    iniziaAggiunta(sess('a'));
    expect(sessionStorage.getItem(CHIAVE_AGGIUNTA)).toBe('a');
    dopoEventoAccesso('INITIAL_SESSION', sess('a')); // la pagina di accesso si apre ancora con A
    expect(sessionStorage.getItem(CHIAVE_AGGIUNTA)).toBe('a');
    dopoEventoAccesso('SIGNED_IN', sess('b'));
    expect(leggiAccount().map((x) => x.id)).toEqual(['b', 'a']);
    expect(sessionStorage.getItem(CHIAVE_AGGIUNTA)).toBeNull();
    expect(leggiAccount()[1].nome).toBe('Nome a');
  });

  it('le chiavi rinnovate dalla libreria sostituiscono quelle salvate', () => {
    ricordaSessione(sess('a'));
    dopoEventoAccesso('TOKEN_REFRESHED', sess('a', 2));
    expect(leggiAccount()[0].refreshToken).toBe('ref-a-2');
  });

  it('«Esci» dimentica tutti gli account del dispositivo', () => {
    ricordaSessione(sess('a'));
    ricordaSessione(sess('b'));
    dopoEventoAccesso('SIGNED_OUT', null);
    expect(leggiAccount()).toEqual([]);
    expect(localStorage.getItem(CHIAVE_ACCOUNT)).toBeNull();
  });

  it('un elenco rovinato non rompe niente', () => {
    localStorage.setItem(CHIAVE_ACCOUNT, '{non json');
    expect(leggiAccount()).toEqual([]);
    localStorage.setItem(CHIAVE_ACCOUNT, JSON.stringify([{ id: 'x' }, { id: 'y', accessToken: 'a', refreshToken: 'r' }]));
    expect(leggiAccount().map((x) => x.id)).toEqual(['y']);
  });
});

describe('passare a un altro account', () => {
  function mondo(over: Partial<MondoDelCambio> = {}) {
    const passi: string[] = [];
    let carrello: string | null = '[{"id":"pane"}]';
    const m: MondoDelCambio = {
      sessioneAttuale: async () => { passi.push('attuale'); return sess('a', 7); },
      installa: async (s) => { passi.push(`installa ${s.refresh_token}`); return { error: null }; },
      ruoloDi: async () => 'seller',
      salvaCarrello: async (id) => { passi.push(`carrello-su ${id}`); },
      svuotaCarrello: () => {
        passi.push('carrello-via');
        const prima = carrello;
        carrello = null;
        return () => { passi.push('carrello-torna'); carrello = prima; };
      },
      rinnova: async (r) => { passi.push(`rinnova ${r}`); return sess('b', 2); },
      ...over,
    };
    return { m, passi, carrello: () => carrello };
  }

  beforeEach(() => {
    ricordaSessione(sess('b'));
    ricordaSessione(sess('a'));
  });

  it('nell ordine giusto: rinnova B a parte, salva A, mette da parte il carrello, installa B', async () => {
    const { m, passi, carrello } = mondo();
    const esito = await cambiaAccount('b', m);
    expect(esito).toEqual({ ok: true, dove: '/seller/dashboard' });
    expect(passi).toEqual(['rinnova ref-b-1', 'attuale', 'carrello-su a', 'carrello-via', 'installa ref-b-2']);
    expect(carrello()).toBeNull();
    const salvati = Object.fromEntries(leggiAccount().map((x) => [x.id, x.refreshToken]));
    // B con le chiavi appena rinnovate (le vecchie sono già usate), A con quelle di adesso.
    expect(salvati).toEqual({ a: 'ref-a-7', b: 'ref-b-2' });
  });

  it('con l accesso di B scaduto: B tolto e l account attivo non si tocca', async () => {
    const { m, passi } = mondo({ rinnova: async () => null });
    const esito = await cambiaAccount('b', m);
    expect(esito).toEqual({ ok: false, motivo: 'scaduto', email: 'b@esempio.it' });
    expect(passi.some((p) => p.startsWith('installa') || p.startsWith('carrello'))).toBe(false);
    expect(leggiAccount().map((x) => x.id)).toEqual(['a']);
  });

  it('se il rinnovo risponde un altro utente, non si entra', async () => {
    const { m, passi } = mondo({ rinnova: async () => sess('c') });
    expect((await cambiaAccount('b', m)).ok).toBe(false);
    expect(passi.some((p) => p.startsWith('installa'))).toBe(false);
  });

  it('con la rete caduta sul rinnovo B resta salvato', async () => {
    const { m } = mondo({ rinnova: async () => { throw new Error('rete'); } });
    expect(await cambiaAccount('b', m)).toEqual({ ok: false, motivo: 'rete', email: 'b@esempio.it' });
    expect(leggiAccount().map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('se l installazione non riesce, il carrello torna com era', async () => {
    const { m, passi, carrello } = mondo({ installa: async () => ({ error: new Error('no') }) });
    expect((await cambiaAccount('b', m)).ok).toBe(false);
    expect(passi.at(-1)).toBe('carrello-torna');
    expect(carrello()).toBe('[{"id":"pane"}]');
  });

  it('un cliente atterra in home, un fattorino nelle sue consegne', async () => {
    expect(await cambiaAccount('b', mondo({ ruoloDi: async () => 'buyer' }).m)).toEqual({ ok: true, dove: '/' });
    ricordaSessione(sess('b'));
    expect(await cambiaAccount('b', mondo({ ruoloDi: async () => 'rider' }).m)).toEqual({ ok: true, dove: '/rider' });
  });
});

describe('il rinnovo a parte', () => {
  it('chiama l endpoint dei token con la chiave pubblica; un rifiuto vuol dire scaduto', async () => {
    const chiamate: Array<[string, RequestInit]> = [];
    const fetchFinto = (async (url: string, init: RequestInit) => {
      chiamate.push([url, init]);
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }) as unknown as typeof fetch;
    expect(await rinnovaAccesso('ref-b', { url: 'https://db.esempio.it/', chiave: 'anon', fetch: fetchFinto })).toBeNull();
    expect(chiamate[0][0]).toBe('https://db.esempio.it/auth/v1/token?grant_type=refresh_token');
    expect(chiamate[0][1].method).toBe('POST');
    expect((chiamate[0][1].headers as Record<string, string>).apikey).toBe('anon');
    expect(JSON.parse(String(chiamate[0][1].body))).toEqual({ refresh_token: 'ref-b' });
  });

  it('una risposta buona diventa la sessione; un guasto del servizio lancia', async () => {
    const buona = (async () => new Response(JSON.stringify(sess('b', 3)), { status: 200 })) as unknown as typeof fetch;
    expect((await rinnovaAccesso('ref-b', { url: 'https://x', chiave: 'k', fetch: buona }))?.refresh_token).toBe('ref-b-3');
    const guasta = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(rinnovaAccesso('ref-b', { url: 'https://x', chiave: 'k', fetch: guasta })).rejects.toThrow();
  });
});

describe('il blocco nel menu', () => {
  const accesi: Root[] = [];
  afterEach(() => {
    for (const r of accesi.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';
  });
  async function monta() {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    accesi.push(root);
    await act(async () => { root.render(createElement(CambiaAccount)); });
    await act(async () => { await Promise.resolve(); });
    return div;
  }

  it('mostra gli altri account, non quello attivo, e «Aggiungi un altro account»', async () => {
    ricordaSessione(sess('b'));
    ricordaSessione(sess('a'));
    finto.sessione = { ...sess('a'), user: { id: 'a', email: 'a@esempio.it' } };
    const r = await monta();
    const testi = [...r.querySelectorAll('button')].map((b) => b.textContent);
    expect(testi).toContain('Passa a Nome bb@esempio.it');
    expect(testi.some((t) => t?.includes('Nome a'))).toBe(false);
    expect(testi).toContain('Aggiungi un altro account');
    expect(r.querySelector('button[aria-label="Passa all’account Nome b (b@esempio.it)"]')).not.toBeNull();
  });

  it('«Aggiungi un altro account» salva chi c è e apre l accesso', async () => {
    finto.sessione = { ...sess('a'), user: { id: 'a', email: 'a@esempio.it' } };
    const vai = vi.fn();
    const originale = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originale, assign: vai } });
    try {
      const r = await monta();
      const aggiungi = [...r.querySelectorAll('button')].find((b) => b.textContent === 'Aggiungi un altro account')!;
      await act(async () => { aggiungi.click(); });
      expect(vai).toHaveBeenCalledWith('/sign-in?aggiungi=1');
      expect(leggiAccount().map((x) => x.id)).toEqual(['a']);
      expect(sessionStorage.getItem(CHIAVE_AGGIUNTA)).toBe('a');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originale });
    }
  });
});
