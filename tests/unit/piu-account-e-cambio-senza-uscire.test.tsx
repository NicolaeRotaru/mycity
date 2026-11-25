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
  CHIAVE_ACCOUNT, CHIAVE_AGGIUNTA, CHIAVE_CAMBIO, CHIAVE_IN_CORSO, DURATA_ACCESSO_SALVATO_MS, cambiaAccount, cambioInCorso,
  dimenticaAccount, dimenticaTutti, dopoEventoAccesso, iniziaAggiunta, leggiAccount, preparaAggiunta, ricordaSessione, rinnovaAccesso,
  type MondoDelCambio, type SessioneMinima,
} from '@/lib/account/piu-account';
import { useFormAutosave } from '@/lib/hooks/useFormAutosave';
import CambiaAccount from '@/components/account/CambiaAccount';
import RicordaAccount from '@/components/account/RicordaAccount';

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
    dopoEventoAccesso('INITIAL_SESSION', sess('a'), undefined, undefined, { percorso: '/sign-in' }); // la pagina di accesso si apre ancora con A
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

  it('un accesso finito senza «Esci» (la pagina riparte e il cookie non c è più) dimentica tutto (collaudo)', () => {
    iniziaAggiunta(sess('a'));
    dopoEventoAccesso('SIGNED_IN', sess('b'));
    localStorage.setItem('mycity:da-parte:a:mc_addr_hint', 'via di A');
    dopoEventoAccesso('INITIAL_SESSION', null, undefined, undefined, { sessioneNelDeposito: false });
    expect(leggiAccount()).toEqual([]);
    expect(localStorage.getItem('mycity:da-parte:a:mc_addr_hint')).toBeNull();
  });

  it('con la rete caduta all apertura (sessione vuota ma cookie presente) non si cancella niente (secondo collaudo)', () => {
    ricordaSessione(sess('a'));
    ricordaSessione(sess('b'));
    dopoEventoAccesso('INITIAL_SESSION', null, undefined, undefined, { sessioneNelDeposito: true });
    dopoEventoAccesso('INITIAL_SESSION', null); // senza sapere del cookie: nel dubbio non si cancella
    expect(leggiAccount().map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('«Aggiungi» lasciato a metà: sulla pagina di accesso le bozze restano da parte, uscendone tornano (secondo collaudo)', async () => {
    localStorage.setItem('mc_new_product_draft', '{"nome":"Torta di A"}');
    await preparaAggiunta({ sessioneAttuale: async () => sess('a'), salvaCarrello: async () => undefined });
    dopoEventoAccesso('INITIAL_SESSION', sess('a'), undefined, undefined, { percorso: '/sign-in' });
    expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
    dopoEventoAccesso('INITIAL_SESSION', sess('a'), undefined, undefined, { percorso: '/seller/dashboard' });
    expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"Torta di A"}');
    expect(sessionStorage.getItem(CHIAVE_AGGIUNTA)).toBeNull();
  });

  it('«Aggiungi» e poi si rientra con lo stesso account: le bozze tornano', async () => {
    localStorage.setItem('mc_addr_hint', 'via di A');
    await preparaAggiunta({ sessioneAttuale: async () => sess('a'), salvaCarrello: async () => undefined });
    dopoEventoAccesso('SIGNED_IN', sess('a', 2), undefined, undefined, { percorso: '/sign-in' });
    expect(localStorage.getItem('mc_addr_hint')).toBe('via di A');
  });

  it('le bozze di un account tolto dall elenco se ne vanno con lui; «Esci» toglie anche i segnali', () => {
    ricordaSessione(sess('a'));
    ricordaSessione(sess('b'));
    localStorage.setItem('mycity:da-parte:a:mc_checkout_draft', '{"via":"di A"}');
    dimenticaAccount('a');
    expect(localStorage.getItem('mycity:da-parte:a:mc_checkout_draft')).toBeNull();
    localStorage.setItem(CHIAVE_CAMBIO, 'b:1');
    localStorage.setItem(CHIAVE_IN_CORSO, String(Date.now()));
    dimenticaTutti();
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toBeNull();
    expect(localStorage.getItem(CHIAVE_IN_CORSO)).toBeNull();
  });

  it('un accesso salvato da più di 6 mesi non vale più', () => {
    const ora = Date.now();
    ricordaSessione(sess('a'), localStorage, ora - DURATA_ACCESSO_SALVATO_MS - 1000);
    ricordaSessione(sess('b'), localStorage, ora);
    expect(leggiAccount(localStorage, ora).map((x) => x.id)).toEqual(['b']);
  });

  it('«Esci» toglie anche le bozze messe da parte per gli altri account', () => {
    ricordaSessione(sess('a'));
    localStorage.setItem('mycity:da-parte:a:mc_checkout_draft', '{"via":"di A"}');
    dimenticaTutti();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('mycity:'))).toEqual([]);
  });

  it('«Aggiungi» mette da parte carrello e bozze di A, e B entrando non li trova (collaudo)', async () => {
    localStorage.setItem('cart', '[{"id":"pane","quantity":3}]');
    localStorage.setItem('mc_new_product_draft', '{"nome":"Torta di A"}');
    const passi: string[] = [];
    const dove = await preparaAggiunta({
      sessioneAttuale: async () => sess('a'),
      salvaCarrello: async (id) => { passi.push(`carrello-su ${id}`); },
    });
    expect(dove).toBe('/sign-in?aggiungi=1');
    expect(passi).toEqual(['carrello-su a']);
    expect(localStorage.getItem('cart')).toBeNull();
    expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
    dopoEventoAccesso('SIGNED_IN', sess('b'));
    expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toMatch(/^b:/);
    expect(leggiAccount().map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('un elenco rovinato non rompe niente', () => {
    localStorage.setItem(CHIAVE_ACCOUNT, '{non json');
    expect(leggiAccount()).toEqual([]);
    localStorage.setItem(CHIAVE_ACCOUNT, JSON.stringify([{ id: 'x' }, { id: 'y', accessToken: 'a', refreshToken: 'r', salvatoIl: Date.now() }, { id: 'z', accessToken: 'a', refreshToken: 'r' }]));
    expect(leggiAccount().map((x) => x.id)).toEqual(['y']);
  });
});

describe('passare a un altro account', () => {
  function mondo(over: Partial<MondoDelCambio> = {}) {
    const passi: string[] = [];
    localStorage.setItem('cart', '[{"id":"pane"}]');
    const m: MondoDelCambio = {
      sessioneAttuale: async () => { passi.push('attuale'); return sess('a', 7); },
      installa: async (s) => {
        // Quando entra il nuovo account il carrello del browser deve essere già vuoto.
        passi.push(`installa ${s.refresh_token} carrello=${localStorage.getItem('cart')}`);
        return { error: null };
      },
      ruoloDi: async () => 'seller',
      salvaCarrello: async (id) => { passi.push(`carrello-su ${id}`); },
      rinnova: async (r) => { passi.push(`rinnova ${r}`); return sess('b', 2); },
      ...over,
    };
    return { m, passi, carrello: () => localStorage.getItem('cart') };
  }

  beforeEach(() => {
    ricordaSessione(sess('b'));
    ricordaSessione(sess('a'));
  });

  it('nell ordine giusto: guarda chi è attivo, rinnova B a parte, salva A, mette da parte il carrello, installa B', async () => {
    const { m, passi, carrello } = mondo();
    const esito = await cambiaAccount('b', m);
    expect(esito).toEqual({ ok: true, dove: '/seller/dashboard' });
    expect(passi).toEqual(['attuale', 'rinnova ref-b-1', 'carrello-su a', 'installa ref-b-2 carrello=null']);
    expect(carrello()).toBeNull();
    expect(localStorage.getItem('mycity:da-parte:a:cart')).toBe('[{"id":"pane"}]');
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
    expect(carrello()).toBe('[{"id":"pane"}]');
    expect(cambioInCorso()).toBe(false);
  });

  it('passare all account già attivo non fa niente: la sua chiave salvata non si tocca (collaudo)', async () => {
    const { m, passi } = mondo({ sessioneAttuale: async () => { passi.push('attuale'); return sess('b', 9); } });
    expect(await cambiaAccount('b', m)).toEqual({ ok: false, motivo: 'gia-attivo', email: 'b@esempio.it' });
    expect(passi).toEqual(['attuale']);
  });

  it('le bozze di A si mettono da parte e tornano quando si torna su A; quelle di B tornano su B (collaudo)', async () => {
    localStorage.setItem('mc_new_product_draft', '{"nome":"Torta di A"}');
    localStorage.setItem('mc_addr_hint', 'via di A');
    await cambiaAccount('b', mondo().m);
    expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
    expect(localStorage.getItem('mc_addr_hint')).toBeNull();
    // su B si scrive una bozza sua, poi si torna su A
    localStorage.setItem('mc_new_product_draft', '{"nome":"Pane di B"}');
    ricordaSessione(sess('a', 8));
    const verso = mondo({ sessioneAttuale: async () => sess('b', 2), rinnova: async () => sess('a', 9) });
    expect((await cambiaAccount('a', verso.m)).ok).toBe(true);
    expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"Torta di A"}');
    expect(localStorage.getItem('mc_addr_hint')).toBe('via di A');
    // e di nuovo su B: torna la bozza di B
    ricordaSessione(sess('b', 3));
    const ancora = mondo({ sessioneAttuale: async () => sess('a', 9), rinnova: async () => sess('b', 4) });
    expect((await cambiaAccount('b', ancora.m)).ok).toBe(true);
    expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"Pane di B"}');
  });

  it('se l installazione non riesce anche le bozze tornano com erano', async () => {
    localStorage.setItem('mc_checkout_draft', '{"via":"di A"}');
    await cambiaAccount('b', mondo({ installa: async () => ({ error: new Error('no') }) }).m);
    expect(localStorage.getItem('mc_checkout_draft')).toBe('{"via":"di A"}');
    expect(Object.keys(localStorage).some((k) => k.startsWith('mycity:da-parte:'))).toBe(false);
  });

  it('se l invio del carrello fallisce, la spesa di A resta da parte e torna con A (secondo collaudo)', async () => {
    await cambiaAccount('b', mondo({ salvaCarrello: async () => { throw new Error('rete'); } }).m);
    expect(localStorage.getItem('cart')).toBeNull();
    ricordaSessione(sess('a', 8));
    const verso = mondo({ sessioneAttuale: async () => sess('b', 2), rinnova: async () => sess('a', 9) });
    localStorage.removeItem('cart'); // su B il carrello è vuoto
    expect((await cambiaAccount('a', verso.m)).ok).toBe(true);
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane"}]');
  });

  it('se non si sa chi è attivo non si tocca niente: bozze e carrello restano (secondo collaudo)', async () => {
    localStorage.setItem('mc_new_product_draft', '{"nome":"Torta di A"}');
    const { m, passi } = mondo({ sessioneAttuale: async () => null });
    expect(await cambiaAccount('b', m)).toEqual({ ok: false, motivo: 'rete', email: 'b@esempio.it' });
    expect(passi.some((p) => p.startsWith('rinnova') || p.startsWith('installa'))).toBe(false);
    expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"Torta di A"}');
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane"}]');
  });

  it('durante il cambio i moduli non salvano bozze (secondo collaudo)', async () => {
    let durante = false;
    await cambiaAccount('b', mondo({ installa: async () => { durante = cambioInCorso(); return { error: null }; } }).m);
    expect(durante).toBe(true);
    expect(cambioInCorso()).toBe(true); // fino al ricaricamento della pagina (15 secondi al massimo)
    expect(cambioInCorso(localStorage, Date.now() + 16_000)).toBe(false);
  });

  it('dopo un cambio riuscito le altre schede ricevono il segnale', async () => {
    await cambiaAccount('b', mondo().m);
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toMatch(/^b:\d+$/);
  });

  it('un cliente atterra in home, un fattorino nelle sue consegne', async () => {
    expect(await cambiaAccount('b', mondo({ ruoloDi: async () => 'buyer' }).m)).toEqual({ ok: true, dove: '/' });
    ricordaSessione(sess('b'));
    expect(await cambiaAccount('b', mondo({ ruoloDi: async () => 'rider' }).m)).toEqual({ ok: true, dove: '/rider' });
  });
});

describe('il freno sui salvataggi automatici dei moduli', () => {
  it('con un cambio in corso useFormAutosave non scrive la bozza (secondo collaudo)', async () => {
    vi.useFakeTimers();
    try {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const Modulo = ({ v }: { v: string }) => { useFormAutosave('mc_new_product_draft', { nome: v }, { delay: 10 }); return null; };
      const div = document.createElement('div');
      const root = createRoot(div);
      localStorage.setItem(CHIAVE_IN_CORSO, String(Date.now()));
      await act(async () => { root.render(createElement(Modulo, { v: 'Torta di A' })); });
      await act(async () => { vi.advanceTimersByTime(50); });
      expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
      localStorage.removeItem(CHIAVE_IN_CORSO);
      await act(async () => { root.render(createElement(Modulo, { v: 'Torta di A2' })); });
      await act(async () => { vi.advanceTimersByTime(50); });
      expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"Torta di A2"}');
      act(() => root.unmount());
    } finally {
      vi.useRealTimers();
    }
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

  it('«troppe richieste» (429) non vuol dire scaduto: lancia, e l account resta salvato (collaudo)', async () => {
    const troppe = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await expect(rinnovaAccesso('ref-b', { url: 'https://x', chiave: 'k', fetch: troppe })).rejects.toThrow();
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

  it('con 5 account salvati «Aggiungi» non c è, e lo dice', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) ricordaSessione(sess(id));
    finto.sessione = { ...sess('a'), user: { id: 'a', email: 'a@esempio.it' } };
    const r = await monta();
    expect([...r.querySelectorAll('button')].some((b) => b.textContent === 'Aggiungi un altro account')).toBe(false);
    expect(r.textContent).toContain('Hai già 5 account salvati');
  });

  it('un cambio fatto in un altra scheda ferma questa con un avviso, senza ricaricarla da sola (collaudi)', async () => {
    const ricarica = vi.fn();
    const originale = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originale, reload: ricarica } });
    try {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const div = document.createElement('div');
      document.body.appendChild(div);
      const root = createRoot(div);
      accesi.push(root);
      await act(async () => { root.render(createElement(RicordaAccount)); });
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'altra-chiave', newValue: 'x' })); });
      expect(document.body.textContent).not.toContain('Hai cambiato account in un’altra scheda');
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: CHIAVE_CAMBIO, newValue: 'b:1' })); });
      expect(document.body.textContent).toContain('Hai cambiato account in un’altra scheda');
      expect(ricarica).not.toHaveBeenCalled();
      const bottone = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Ricarica la pagina')!;
      await act(async () => { bottone.click(); });
      expect(ricarica).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originale });
    }
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
