/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R07-008 (onda 2, 28/11/2026) — LA LISTA DELLE NOTIFICHE MOSTRAVA LA NEWSLETTER (E I GRUPPI) A CHI LI AVEVA SPENTI.
 *
 * Il campanello toglie dal conto promozioni, newsletter e gruppi spenti (`categorieDiNotificheSpente`);
 * la pagina delle notifiche toglieva solo le promozioni (R14-010). Chi aveva spento la newsletter
 * la ritrovava nell'elenco, col pallino «Non letta», mentre il campanello diceva zero.
 * Pagina vera, react-query vero, database finto con la colonna `category` e le tre preferenze.
 * (Banco preso da riparazione-r14-notifiche-promozioni-spente.test.tsx.)
 */
const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-28T10:00:00Z');
const mondo = {
  preferenze: { notif_promos: false, notif_newsletter: false, notif_groups: true } as Record<string, boolean | null>,
  errorePreferenza: false,
};

const righe = [
  { id: 'a', category: 'order', title: 'Ordine spedito' },
  { id: 'b', category: 'promo', title: 'Sconto del weekend' },
  { id: 'c', category: 'newsletter', title: 'Le novità di novembre' },
  { id: 'd', category: 'group', title: 'Il gruppo sta per chiudere' },
  { id: 'e', category: 'system', title: 'Avviso di servizio' },
].map((r, i) => ({ ...r, user_id: 'u1', body: null, link: null, is_read: false, created_at: new Date(ora - i * 3_600_000).toISOString() }));

function database() {
  return {
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'or']) c[m] = () => c;
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const esito =
          tavola === 'profiles'
            ? mondo.errorePreferenza
              ? { data: null, error: { message: 'giù' } }
              : { data: [{ ...mondo.preferenze }], error: null }
            : { data: righe.map((r) => ({ ...r })), error: null, count: 0 };
        return Promise.resolve(esito).then(ok, ko);
      };
      return c;
    },
  };
}

async function lascia(volte = 20) {
  for (let i = 0; i < volte; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function apri() {
  const pagina = await monta('app/notifications/page.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = pagina.default as () => unknown;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const s = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never)));
  await lascia();
  return s;
}

beforeEach(() => {
  mondo.preferenze = { notif_promos: false, notif_newsletter: false, notif_groups: true };
  mondo.errorePreferenza = false;
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__PERCORSO_FINTO__ = '/notifications';
});
afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PERCORSO_FINTO__']) delete globali[k];
});

describe('R07-008 · la lista delle notifiche toglie le stesse categorie spente del campanello', () => {
  it('IL CASO CHE ROMPEVA — newsletter spenta: la newsletter non è nell’elenco; ordini, gruppi e servizio sì', async () => {
    const s = await apri();
    const testo = s.radice.textContent ?? '';
    expect(testo, 'la newsletter spenta è ancora nell’elenco').not.toContain('Le novità di novembre');
    expect(testo).not.toContain('Sconto del weekend');
    expect(testo).toContain('Ordine spedito');
    expect(testo).toContain('Il gruppo sta per chiudere');
    expect(testo).toContain('Avviso di servizio');
    s.smonta();
  }, 60000);

  it('gruppi spenti: anche i gruppi escono dall’elenco, come dal conto del campanello', async () => {
    mondo.preferenze = { notif_promos: false, notif_newsletter: false, notif_groups: false };
    const s = await apri();
    expect(s.radice.textContent).not.toContain('Il gruppo sta per chiudere');
    expect(s.radice.textContent).toContain('Ordine spedito');
    s.smonta();
  }, 60000);

  it('tutto acceso: si vedono tutte', async () => {
    mondo.preferenze = { notif_promos: true, notif_newsletter: true, notif_groups: true };
    const s = await apri();
    const testo = s.radice.textContent ?? '';
    for (const titolo of ['Ordine spedito', 'Sconto del weekend', 'Le novità di novembre', 'Il gruppo sta per chiudere', 'Avviso di servizio']) {
      expect(testo, titolo).toContain(titolo);
    }
    s.smonta();
  }, 60000);

  it('la preferenza non si legge: promozioni e newsletter fuori, il resto dentro', async () => {
    mondo.errorePreferenza = true;
    const s = await apri();
    const testo = s.radice.textContent ?? '';
    expect(testo).not.toContain('Le novità di novembre');
    expect(testo).not.toContain('Sconto del weekend');
    expect(testo).toContain('Il gruppo sta per chiudere');
    s.smonta();
  }, 60000);
});
