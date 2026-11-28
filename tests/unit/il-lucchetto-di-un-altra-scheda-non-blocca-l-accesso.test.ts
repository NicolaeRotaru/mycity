import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * 28/11/2026 — UNA SCHEDA CONGELATA TENEVA IL LUCCHETTO, E LA PAGINA NUOVA ASPETTAVA PER SEMPRE.
 *
 * Nicola entrava nell'area dell'amministratore dal telefono e la pagina restava su «Caricamento…»
 * con «Accedi» in basso, anche se il server lo aveva riconosciuto. Prima di leggere la sessione, la
 * libreria di accesso prende un lucchetto condiviso fra le schede (Web Locks). Un'altra scheda
 * MyCity, ferma in sottofondo, lo teneva; la libreria doveva riprenderselo dopo 5 secondi, ma
 * supabase-js 2.106.1 le passa un tetto vuoto e l'attesa diventa infinita.
 *
 * Qui gira la libreria vera (nessun finto per @supabase/ssr né per supabase-js). Il lucchetto è di
 * un'altra scheda e non viene mai lasciato: si concede solo a chi lo «ruba» (steal), come fa il
 * browser. Col vecchio client la sessione non arriva mai; col nuovo arriva dopo i 5 secondi.
 */

const URL_PROGETTO = 'https://progetto.supabase.co';
const CHIAVE = 'sb-progetto-auth-token';

function base64url(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sessioneValida() {
  const scade = Math.floor(Date.now() / 1000) + 3600;
  const gettone = [
    base64url('{"alg":"HS256","typ":"JWT"}'),
    base64url(JSON.stringify({ sub: 'u1', role: 'authenticated', aud: 'authenticated', exp: scade, iat: scade - 3600 })),
    'firma',
  ].join('.');
  return {
    access_token: gettone, token_type: 'bearer', expires_in: 3600, expires_at: scade, refresh_token: 'rt',
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'admin@esempio.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

/** Il lucchetto come lo vede una scheda, con un'altra scheda che lo tiene e non lo lascia. */
function lucchettoTenutoDaUnAltraScheda() {
  let altraScheda = true;
  let inUso = false;
  const coda: Array<() => void> = [];
  const libera = () => {
    inUso = false;
    const prossimo = coda.shift();
    if (prossimo) prossimo();
  };
  const esegui = async <T>(cb: (l: { name: string }) => Promise<T>, nome: string): Promise<T> => {
    inUso = true;
    try {
      return await cb({ name: nome });
    } finally {
      libera();
    }
  };
  return {
    rubati: 0,
    request<T>(nome: string, opz: { steal?: boolean; ifAvailable?: boolean; signal?: AbortSignal }, cb: (l: { name: string } | null) => Promise<T>): Promise<T> {
      if (opz.steal) {
        this.rubati += 1;
        altraScheda = false;
        return esegui(cb as (l: { name: string }) => Promise<T>, nome);
      }
      if (!altraScheda && !inUso) return esegui(cb as (l: { name: string }) => Promise<T>, nome);
      if (opz.ifAvailable) return cb(null);
      return new Promise<T>((risolvi, rifiuta) => {
        const parti = () => { esegui(cb as (l: { name: string }) => Promise<T>, nome).then(risolvi, rifiuta); };
        coda.push(parti);
        opz.signal?.addEventListener('abort', () => {
          const i = coda.indexOf(parti);
          if (i >= 0) coda.splice(i, 1);
          rifiuta(new DOMException('Il tempo di attesa del lucchetto è scaduto', 'AbortError'));
        });
      });
    },
    query: async () => ({ held: [], pending: [] }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('il lucchetto di un\'altra scheda non blocca l\'accesso', () => {
  it('con un\'altra scheda ferma sul lucchetto, la sessione arriva lo stesso in pochi secondi', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_PROGETTO;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-pubblica-finta';
    const biscotto = `${CHIAVE}=base64-${base64url(JSON.stringify(sessioneValida()))}`;
    const lucchetto = lucchettoTenutoDaUnAltraScheda();
    vi.stubGlobal('document', {
      get cookie() { return biscotto; },
      set cookie(_v: string) { /* la sessione resta quella */ },
      visibilityState: 'hidden',
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal('window', {
      location: new URL('https://www.mycity-marketplace.com/admin?auth=signin&via=google'),
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal('navigator', { locks: lucchetto, userAgent: 'prova' });
    // Nessuna chiamata di rete serve: la sessione è valida e si legge dal biscotto.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('rete non prevista in questa prova')));

    const { supabase } = await import('@/lib/supabase/client');
    const MAI = Symbol('mai');
    const esito = await Promise.race([
      supabase.auth.getSession(),
      new Promise<typeof MAI>((r) => setTimeout(() => r(MAI), 9000)),
    ]);

    expect(esito, 'dopo 9 secondi la sessione non è arrivata: la pagina resterebbe su «Caricamento…»').not.toBe(MAI);
    expect((esito as { data: { session: { user: { id: string } } | null } }).data.session?.user.id).toBe('u1');
    expect(lucchetto.rubati, 'il lucchetto della scheda ferma si riprende, non si aspetta per sempre').toBeGreaterThan(0);
  }, 14000);
});
