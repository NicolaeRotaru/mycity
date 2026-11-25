/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — Nicola: «aggiungi la possibilità di avere più account e fare lo switch senza doversi
 * disconnettere dall'account». Scelta sua: per tutti, nel menu dell'account, accessi salvati solo
 * sul dispositivo. Dopo quattro collaudi, la base rifatta (Nicola: «rifai la base»): i dati del
 * browser (carrello, bozze) sono dell'account che c'è, e quando ne entra un altro, per qualunque
 * strada, quelli di prima vanno da parte. Regole in lib/account/piu-account.ts.
 *
 * Casi (dato → atteso), raggruppati: l'elenco e gli eventi · la regola dei dati · il cambio · le
 * schede · il rinnovo a parte · il menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const finto = vi.hoisted(() => ({
  sessione: null as null | { access_token: string; refresh_token: string; user: { id: string; email: string } },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: finto.sessione } }),
      setSession: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: async () => ({}),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null }),
  },
}));

import {
  CHIAVE_ACCOUNT, CHIAVE_AGGIUNTA, CHIAVE_CAMBIO, CHIAVE_IN_CORSO, CHIAVE_UTENTE_DEL_BROWSER, DURATA_ACCESSO_SALVATO_MS,
  _riparteLaScheda, allineaUtenteDelBrowser, cambiaAccount, cambioInCorso, dimenticaAccount, dopoEventoAccesso, iniziaAggiunta,
  leggiAccount, preparaAggiunta, ricordaSessione, rinnovaAccesso, segnaUtenteDellaPagina, vedeEntrare,
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
const daParte = () => Object.keys(localStorage).filter((k) => k.startsWith('mycity:da-parte:')).sort();

const accesi: Root[] = [];
beforeEach(() => {
  _riparteLaScheda();
  localStorage.clear();
  sessionStorage.clear();
  finto.sessione = null;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

describe('l elenco e gli eventi dell accesso', () => {
  it('chi non ha mai aggiunto un account non ha niente nell elenco', () => {
    dopoEventoAccesso('SIGNED_IN', sess('a'));
    dopoEventoAccesso('TOKEN_REFRESHED', sess('a', 2));
    expect(localStorage.getItem(CHIAVE_ACCOUNT)).toBeNull();
  });

  it('«Aggiungi» da A, poi entra B: salvati B e A, e l aggiunta finisce', () => {
    iniziaAggiunta(sess('a'));
    dopoEventoAccesso('INITIAL_SESSION', sess('a'));
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

  it('«Esci» pulisce tutto, anche se gli accessi salvati erano già scaduti', () => {
    ricordaSessione(sess('a'), localStorage, Date.now() - DURATA_ACCESSO_SALVATO_MS - 1000);
    localStorage.setItem(CHIAVE_UTENTE_DEL_BROWSER, 'a');
    localStorage.setItem('mycity:da-parte:b:cart', '[1]');
    localStorage.setItem(CHIAVE_CAMBIO, 'a:1');
    localStorage.setItem(CHIAVE_IN_CORSO, 'a:1');
    dopoEventoAccesso('SIGNED_OUT', null);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('mycity:'))).toEqual([]);
  });

  it('accesso finito da solo (cookie sparito) dimentica tutto; con la rete caduta (cookie presente) no', () => {
    ricordaSessione(sess('a'));
    dopoEventoAccesso('INITIAL_SESSION', null, undefined, undefined, { sessioneNelDeposito: true });
    dopoEventoAccesso('INITIAL_SESSION', null);
    expect(leggiAccount().map((x) => x.id)).toEqual(['a']);
    dopoEventoAccesso('INITIAL_SESSION', null, undefined, undefined, { sessioneNelDeposito: false });
    expect(leggiAccount()).toEqual([]);
  });

  it('un accesso salvato da più di 6 mesi non vale più', () => {
    const ora = Date.now();
    ricordaSessione(sess('a'), localStorage, ora - DURATA_ACCESSO_SALVATO_MS - 1000);
    ricordaSessione(sess('b'), localStorage, ora);
    expect(leggiAccount(localStorage, ora).map((x) => x.id)).toEqual(['b']);
  });

  it('i dati messi da parte per un account tolto dall elenco se ne vanno con lui', () => {
    ricordaSessione(sess('a'));
    ricordaSessione(sess('b'));
    localStorage.setItem('mycity:da-parte:a:mc_checkout_draft', '{"via":"di A"}');
    dimenticaAccount('a');
    expect(localStorage.getItem('mycity:da-parte:a:mc_checkout_draft')).toBeNull();
  });

  it('un elenco rovinato non rompe niente', () => {
    localStorage.setItem(CHIAVE_ACCOUNT, '{non json');
    expect(leggiAccount()).toEqual([]);
    localStorage.setItem(CHIAVE_ACCOUNT, JSON.stringify([{ id: 'x' }, { id: 'y', accessToken: 'a', refreshToken: 'r', salvatoIl: Date.now() }]));
    expect(leggiAccount().map((x) => x.id)).toEqual(['y']);
  });
});

describe('la regola: i dati del browser sono dell account che c è', () => {
  it('entra B dopo A, per qualunque strada: carrello e bozze di A vanno da parte, B parte pulito', () => {
    allineaUtenteDelBrowser('a');
    localStorage.setItem('cart', '[{"id":"pane","quantity":2}]');
    localStorage.setItem('mc_new_product_draft', '{"nome":"Torta di A"}');
    // nessuna aggiunta segnata: per esempio un link dalla pagina di accesso e poi «indietro» (quarto collaudo)
    dopoEventoAccesso('SIGNED_IN', sess('b'));
    expect(localStorage.getItem('cart')).toBeNull();
    expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
    expect(daParte()).toEqual(['mycity:da-parte:a:cart', 'mycity:da-parte:a:mc_new_product_draft']);
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toMatch(/^b:\d+$/);
    expect(localStorage.getItem(CHIAVE_IN_CORSO)).toMatch(/^b:\d+$/);
  });

  it('tornando su A tornano i suoi dati, e quelli di B vanno da parte', () => {
    allineaUtenteDelBrowser('a');
    localStorage.setItem('mc_addr_hint', 'via di A');
    allineaUtenteDelBrowser('b');
    localStorage.setItem('mc_addr_hint', 'via di B');
    allineaUtenteDelBrowser('a');
    expect(localStorage.getItem('mc_addr_hint')).toBe('via di A');
    allineaUtenteDelBrowser('b');
    expect(localStorage.getItem('mc_addr_hint')).toBe('via di B');
  });

  it('il carrello da ospite non è di nessuno: entrando resta, e si fonde come sempre', () => {
    localStorage.setItem('cart', '[{"id":"pane","quantity":1}]');
    dopoEventoAccesso('SIGNED_IN', sess('b'));
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane","quantity":1}]');
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toBeNull();
  });

  it('chiamata due volte (sincronizzazione del carrello e ascolto dell accesso) non sposta niente due volte', () => {
    allineaUtenteDelBrowser('a');
    localStorage.setItem('cart', '[1]');
    expect(allineaUtenteDelBrowser('b')).toBe(true);
    localStorage.setItem('cart', '[2]'); // B mette qualcosa nel carrello
    expect(allineaUtenteDelBrowser('b')).toBe(false);
    expect(localStorage.getItem('cart')).toBe('[2]');
    expect(localStorage.getItem('mycity:da-parte:a:cart')).toBe('[1]');
  });

  it('un dato già nel browser vince su quello messo da parte (il più nuovo)', () => {
    localStorage.setItem('mycity:da-parte:a:mc_new_product_draft', '{"nome":"vecchia"}');
    localStorage.setItem(CHIAVE_UTENTE_DEL_BROWSER, 'b');
    // B non ha bozze: entrando A torna la sua; ma se nel frattempo ce n'era una nuova, vince quella
    localStorage.setItem('mc_new_product_draft', '{"nome":"nuova"}');
    localStorage.removeItem(CHIAVE_UTENTE_DEL_BROWSER);
    allineaUtenteDelBrowser('a');
    expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"nuova"}');
  });

  it('«Aggiungi» lascia i dati di A nel browser finché non entra davvero un altro account', async () => {
    localStorage.setItem('mc_new_product_draft', '{"nome":"Torta di A"}');
    const dove = await preparaAggiunta({ sessioneAttuale: async () => sess('a'), salvaCarrello: async () => undefined });
    expect(dove).toBe('/sign-in?aggiungi=1');
    expect(localStorage.getItem('mc_new_product_draft')).toBe('{"nome":"Torta di A"}');
    expect(localStorage.getItem(CHIAVE_UTENTE_DEL_BROWSER)).toBe('a');
    dopoEventoAccesso('SIGNED_IN', sess('b'));
    expect(localStorage.getItem('mc_new_product_draft')).toBeNull();
    expect(localStorage.getItem('mycity:da-parte:a:mc_new_product_draft')).toBe('{"nome":"Torta di A"}');
  });
});

describe('passare a un altro account', () => {
  function mondo(over: Partial<MondoDelCambio> = {}) {
    const passi: string[] = [];
    const m: MondoDelCambio = {
      sessioneAttuale: async () => { passi.push('attuale'); return sess('a', 7); },
      installa: async (s) => {
        passi.push(`installa ${s.refresh_token}`);
        // gli ascolti dell'accesso, entrando, applicano la regola (qui li fa l'installazione finta)
        dopoEventoAccesso('SIGNED_IN', { ...sess('b'), access_token: s.access_token, refresh_token: s.refresh_token });
        return { error: null };
      },
      ruoloDi: async () => 'seller',
      salvaCarrello: async (id) => { passi.push(`carrello-su ${id}`); },
      rinnova: async (r) => { passi.push(`rinnova ${r}`); return sess('b', 2); },
      ...over,
    };
    return { m, passi };
  }

  beforeEach(() => {
    ricordaSessione(sess('b'));
    ricordaSessione(sess('a'));
    allineaUtenteDelBrowser('a');
    localStorage.setItem('cart', '[{"id":"pane"}]');
  });

  it('nell ordine giusto, e la spesa di A va da parte per A', async () => {
    const { m, passi } = mondo();
    expect(await cambiaAccount('b', m)).toEqual({ ok: true, dove: '/seller/dashboard' });
    expect(passi).toEqual(['attuale', 'rinnova ref-b-1', 'carrello-su a', 'installa ref-b-2']);
    expect(localStorage.getItem('cart')).toBeNull();
    expect(localStorage.getItem('mycity:da-parte:a:cart')).toBe('[{"id":"pane"}]');
    expect(Object.fromEntries(leggiAccount().map((x) => [x.id, x.refreshToken]))).toEqual({ a: 'ref-a-7', b: 'ref-b-2' });
  });

  it('accesso di B scaduto: B tolto, niente installato, niente spostato', async () => {
    const { m, passi } = mondo({ rinnova: async () => null });
    expect(await cambiaAccount('b', m)).toEqual({ ok: false, motivo: 'scaduto', email: 'b@esempio.it' });
    expect(passi.some((p) => p.startsWith('installa') || p.startsWith('carrello'))).toBe(false);
    expect(leggiAccount().map((x) => x.id)).toEqual(['a']);
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane"}]');
  });

  it('se il rinnovo risponde un altro utente, non si entra', async () => {
    const { m, passi } = mondo({ rinnova: async () => sess('c') });
    expect((await cambiaAccount('b', m)).ok).toBe(false);
    expect(passi.some((p) => p.startsWith('installa'))).toBe(false);
  });

  it('rete caduta sul rinnovo: B resta salvato', async () => {
    const { m } = mondo({ rinnova: async () => { throw new Error('rete'); } });
    expect(await cambiaAccount('b', m)).toEqual({ ok: false, motivo: 'rete', email: 'b@esempio.it' });
    expect(leggiAccount().map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('installazione non riuscita: niente spostato, e la scheda riprende a salvare le bozze', async () => {
    const { m } = mondo({ installa: async () => ({ error: new Error('no') }) });
    expect((await cambiaAccount('b', m)).ok).toBe(false);
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane"}]');
    expect(daParte()).toEqual([]);
    expect(localStorage.getItem(CHIAVE_IN_CORSO)).toBeNull();
    segnaUtenteDellaPagina('a');
    expect(cambioInCorso()).toBe(false);
  });

  it('già attivo, o non si sa chi è attivo: non si fa niente', async () => {
    const attivo = mondo({ sessioneAttuale: async () => sess('b', 9) });
    expect(await cambiaAccount('b', attivo.m)).toEqual({ ok: false, motivo: 'gia-attivo', email: 'b@esempio.it' });
    const nessuno = mondo({ sessioneAttuale: async () => null });
    expect(await cambiaAccount('b', nessuno.m)).toEqual({ ok: false, motivo: 'rete', email: 'b@esempio.it' });
    expect(nessuno.passi).toEqual([]);
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane"}]');
  });

  it('invio del carrello fallito: la spesa di A resta da parte e torna con A', async () => {
    await cambiaAccount('b', mondo({ salvaCarrello: async () => { throw new Error('rete'); } }).m);
    _riparteLaScheda(); // la pagina si è ricaricata
    allineaUtenteDelBrowser('a');
    expect(localStorage.getItem('cart')).toBe('[{"id":"pane"}]');
  });

  it('durante il cambio questa scheda non salva bozze; le altre schede ricevono il segnale', async () => {
    let durante = false;
    segnaUtenteDellaPagina('a');
    await cambiaAccount('b', mondo({
      installa: async (s) => { durante = cambioInCorso(); dopoEventoAccesso('SIGNED_IN', { ...sess('b'), refresh_token: s.refresh_token }); return { error: null }; },
    }).m);
    expect(durante).toBe(true);
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toMatch(/^b:\d+$/);
  });

  it('un cliente atterra in home, un fattorino nelle sue consegne', async () => {
    expect(await cambiaAccount('b', mondo({ ruoloDi: async () => 'buyer' }).m)).toEqual({ ok: true, dove: '/' });
    ricordaSessione(sess('b'));
    expect(await cambiaAccount('b', mondo({ ruoloDi: async () => 'rider' }).m)).toEqual({ ok: true, dove: '/rider' });
  });
});

describe('le schede', () => {
  it('un account diverso da quello della pagina, su una pagina normale, ferma la scheda per sempre', () => {
    expect(vedeEntrare('a', '/seller/products/new')).toBe(false);
    expect(vedeEntrare('a', '/seller/products/new')).toBe(false);
    expect(vedeEntrare('b', '/seller/products/new')).toBe(true);
    expect(cambioInCorso(localStorage, Date.now() + 3_600_000)).toBe(true);
  });

  it('un rinnovo delle chiavi di A arrivato in ritardo dopo il passaggio a B non sposta niente e non ferma la scheda (quinto collaudo)', () => {
    allineaUtenteDelBrowser('a');
    allineaUtenteDelBrowser('b');
    localStorage.setItem('cart', '[{"id":"di B"}]');
    localStorage.removeItem(CHIAVE_CAMBIO);
    segnaUtenteDellaPagina('b');
    dopoEventoAccesso('TOKEN_REFRESHED', sess('a', 5));
    expect(localStorage.getItem(CHIAVE_UTENTE_DEL_BROWSER)).toBe('b');
    expect(localStorage.getItem('cart')).toBe('[{"id":"di B"}]');
    expect(localStorage.getItem(CHIAVE_CAMBIO)).toBeNull();
    expect(vedeEntrare('a', '/seller/dashboard', 'TOKEN_REFRESHED')).toBe(false);
    expect(cambioInCorso(localStorage, Date.now() + 60_000)).toBe(false);
  });

  it('sulle pagine di accesso un account nuovo è atteso: niente avviso, e la pagina diventa sua', () => {
    vedeEntrare('a', '/sign-in');
    expect(vedeEntrare('b', '/sign-in')).toBe(false);
    localStorage.setItem(CHIAVE_IN_CORSO, `b:${Date.now()}`);
    expect(cambioInCorso()).toBe(false); // i moduli di B, appena entrato, salvano
  });

  it('il segno a tempo ferma per 15 secondi solo le pagine che non sono del nuovo account', () => {
    localStorage.setItem(CHIAVE_IN_CORSO, `b:${Date.now()}`);
    segnaUtenteDellaPagina('a');
    expect(cambioInCorso()).toBe(true);
    expect(cambioInCorso(localStorage, Date.now() + 16_000)).toBe(false);
    segnaUtenteDellaPagina('b');
    expect(cambioInCorso()).toBe(false);
  });

  it('useFormAutosave non scrive mentre la pagina non deve salvare', async () => {
    vi.useFakeTimers();
    try {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const Modulo = ({ v }: { v: string }) => { useFormAutosave('mc_new_product_draft', { nome: v }, { delay: 10 }); return null; };
      const root = createRoot(document.createElement('div'));
      segnaUtenteDellaPagina('a');
      localStorage.setItem(CHIAVE_IN_CORSO, `b:${Date.now()}`);
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

  it('il segnale di un cambio fatto in un altra scheda apre l avviso, senza ricaricare da sola', async () => {
    const ricarica = vi.fn();
    const originale = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originale, pathname: '/seller/dashboard', reload: ricarica } });
    try {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const root = createRoot(document.createElement('div'));
      accesi.push(root);
      await act(async () => { root.render(createElement(RicordaAccount)); });
      segnaUtenteDellaPagina('a');
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: CHIAVE_CAMBIO, newValue: 'a:1' })); });
      expect(document.body.textContent).not.toContain('Hai cambiato account in un’altra scheda');
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: CHIAVE_CAMBIO, newValue: 'b:1' })); });
      expect(document.body.textContent).toContain('Hai cambiato account in un’altra scheda');
      expect(ricarica).not.toHaveBeenCalled();
      expect(cambioInCorso(localStorage, Date.now() + 3_600_000)).toBe(true);
      const bottone = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Ricarica la pagina')!;
      await act(async () => { bottone.click(); });
      expect(ricarica).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originale });
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

  it('«troppe richieste» (429) e i guasti lanciano: l account non va cancellato', async () => {
    for (const status of [429, 503]) {
      const f = (async () => new Response('', { status })) as unknown as typeof fetch;
      await expect(rinnovaAccesso('ref-b', { url: 'https://x', chiave: 'k', fetch: f }), String(status)).rejects.toThrow();
    }
  });

  it('una risposta buona diventa la sessione', async () => {
    const buona = (async () => new Response(JSON.stringify(sess('b', 3)), { status: 200 })) as unknown as typeof fetch;
    expect((await rinnovaAccesso('ref-b', { url: 'https://x', chiave: 'k', fetch: buona }))?.refresh_token).toBe('ref-b-3');
  });
});

describe('il blocco nel menu', () => {
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
  });

  it('con 5 account salvati «Aggiungi» non c è, e lo dice', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) ricordaSessione(sess(id));
    finto.sessione = { ...sess('a'), user: { id: 'a', email: 'a@esempio.it' } };
    const r = await monta();
    expect([...r.querySelectorAll('button')].some((b) => b.textContent === 'Aggiungi un altro account')).toBe(false);
    expect(r.textContent).toContain('Hai già 5 account salvati');
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
