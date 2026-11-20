/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R01-varie — Il fornitore delle domande (QueryProvider) e l'ingresso dopo un tempo senza sessione.
 *
 * Senza sessione le domande a video si rileggono, e alcune (chiave senza l'utente) rispondono
 * «niente». Quando poi qualcuno entra, quella risposta non vale per lui: al primo ingresso dopo
 * un'uscita, o dopo un avvio senza sessione, le domande ripartono da zero e si rileggono con la
 * sessione nuova, sia quelle a video sia quelle che si apriranno dopo.
 *
 * Qui si monta QueryProvider vero intorno al bottone vero dello stato dei pagamenti del negozio
 * (StripeConnectButton, chiave ['seller','stripe-status']), con react-query vero. Il database è un
 * finto con la stessa regola del vero sui profili: ognuno legge il suo. Gli avvisi di sessione
 * arrivano come li manda il client, a tutti quelli in ascolto.
 */

const globali = globalThis as Record<string, unknown>;

type Profilo = {
  id: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  approval_status: string;
};
const negozio = (id: string): Profilo => ({
  id,
  stripe_account_id: `acct_${id}`,
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  approval_status: 'approved',
});

const mondo = { profili: [] as Profilo[], letture: [] as Array<string | null> };

function database() {
  return {
    from: (tavola: string) => {
      const filtri: Record<string, unknown> = {};
      const risposta = () => {
        const chi = (globali.__UTENTE__ as { id: string } | null | undefined)?.id ?? null;
        if (tavola !== 'profiles') return { data: null, error: null };
        mondo.letture.push(chi);
        const riga = mondo.profili.find((p) => p.id === chi && p.id === filtri.id) ?? null;
        return riga
          ? { data: { ...riga }, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'nessuna riga' } };
      };
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (colonna: string, valore: unknown) => { filtri[colonna] = valore; return c; };
      c.single = async () => risposta();
      c.maybeSingle = c.single;
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
      return c;
    },
  };
}

async function lascia(volte = 20) {
  for (let i = 0; i < volte; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function apri() {
  const fornitore = await monta('components/providers/QueryProvider.tsx', { veri: ['@tanstack/react-query'] });
  const bottone = await monta('components/seller/StripeConnectButton.tsx', { veri: ['@tanstack/react-query'] });
  const Fornitore = fornitore.default as (p: { children: unknown }) => unknown;
  const Bottone = bottone.default as () => unknown;
  let client: QueryClient | null = null;
  let mostra: (si: boolean) => void = () => {};
  // La pagina del negozio: c'è o non c'è (si va altrove e si torna).
  const Pagina = () => {
    const [si, setSi] = useState(true);
    mostra = setSi;
    client = useQueryClient();
    return si ? createElement(Bottone as never) : null;
  };
  const s = accendi(() => createElement(Fornitore as never, null, createElement(Pagina)));
  await lascia();
  const avviso = async (evento: string, utente: string | null) => {
    globali.__UTENTE__ = utente ? { id: utente } : null;
    await act(async () => {
      for (const ascolto of [...(globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>)]) {
        ascolto(evento, utente ? { user: { id: utente } } : null);
      }
    });
    await lascia();
  };
  const vaiAltrove = async () => { await act(async () => mostra(false)); await lascia(); };
  const torna = async () => { await act(async () => mostra(true)); await lascia(); };
  return { s, avviso, vaiAltrove, torna, client: () => client! };
}

const statoPagamenti = (radice: HTMLElement) => testoVisibile(radice);
const ATTIVI = /Pagamenti attivi/;
const DA_VERIFICARE = /Completa prima la verifica del negozio/;

beforeEach(() => {
  mondo.profili = [negozio('negozio-a'), negozio('negozio-b')];
  mondo.letture = [];
  globali.__UTENTE__ = { id: 'negozio-a' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__PERCORSO_FINTO__ = '/seller/earnings';
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PERCORSO_FINTO__']) delete globali[k];
});

describe('R01-varie · al primo ingresso dopo un tempo senza sessione le domande si rileggono', () => {
  it('esce un negozio, ne entra un altro con la pagina aperta: lo stato dei pagamenti è il suo', async () => {
    const { s, avviso } = await apri();
    const lettureAllApertura = mondo.letture.length;
    await avviso('INITIAL_SESSION', 'negozio-a');
    expect(mondo.letture.length, 'all’apertura con la sessione già presente si rilegge tutto').toBe(lettureAllApertura);
    expect(statoPagamenti(s.radice), 'controprova: il negozio A ha i pagamenti attivi').toMatch(ATTIVI);
    const lettureDiA = mondo.letture.length;
    await avviso('TOKEN_REFRESHED', 'negozio-a');
    expect(mondo.letture.length, 'controprova: la stessa sessione non rilegge').toBe(lettureDiA);

    await avviso('SIGNED_OUT', null);
    expect(statoPagamenti(s.radice), 'controprova: senza sessione non si dicono attivi i pagamenti di A').not.toMatch(ATTIVI);

    await avviso('SIGNED_IN', 'negozio-b');
    expect(mondo.letture, 'entrato il negozio B, lo stato dei pagamenti non si rilegge').toContain('negozio-b');
    expect(statoPagamenti(s.radice), 'entrato il negozio B, resta la risposta letta senza sessione').not.toMatch(DA_VERIFICARE);
    expect(statoPagamenti(s.radice)).toMatch(ATTIVI);
    s.smonta();
  }, 60000);

  it('esce un negozio, ne entra un altro e torna alla pagina dei pagamenti: lo stato si rilegge', async () => {
    const { s, avviso, vaiAltrove, torna, client } = await apri();
    await avviso('INITIAL_SESSION', 'negozio-a');
    expect(statoPagamenti(s.radice), 'controprova: il negozio A ha i pagamenti attivi').toMatch(ATTIVI);

    await avviso('SIGNED_OUT', null);
    await vaiAltrove();
    await avviso('SIGNED_IN', 'negozio-b');
    expect(client().getQueryData(['seller', 'stripe-status']), 'entrato il negozio B, in memoria resta la risposta letta senza sessione').not.toBeNull();

    await torna();
    expect(mondo.letture, 'tornato alla pagina, lo stato dei pagamenti non si rilegge').toContain('negozio-b');
    expect(statoPagamenti(s.radice), 'tornato alla pagina, il negozio B legge la risposta data senza sessione').not.toMatch(DA_VERIFICARE);
    expect(statoPagamenti(s.radice)).toMatch(ATTIVI);
    s.smonta();
  }, 60000);

  it('la pagina si apre senza sessione e poi il negozio entra: lo stato si rilegge con la sua sessione', async () => {
    globali.__UTENTE__ = null;
    const { s, avviso } = await apri();
    await avviso('INITIAL_SESSION', null);
    expect(statoPagamenti(s.radice), 'controprova: senza sessione i pagamenti non risultano attivi').not.toMatch(ATTIVI);

    await avviso('SIGNED_IN', 'negozio-b');
    expect(mondo.letture, 'entrato il negozio, lo stato dei pagamenti non si rilegge').toContain('negozio-b');
    expect(statoPagamenti(s.radice)).toMatch(ATTIVI);
    s.smonta();
  }, 60000);

  it('chi entra di nuovo dopo l’uscita ritrova il suo stato, e un secondo avviso della stessa sessione non rilegge', async () => {
    const { s, avviso } = await apri();
    await avviso('INITIAL_SESSION', 'negozio-a');
    await avviso('SIGNED_OUT', null);
    await avviso('SIGNED_IN', 'negozio-a');
    expect(statoPagamenti(s.radice), 'rientrato il negozio A, resta la risposta letta senza sessione').toMatch(ATTIVI);
    const letture = mondo.letture.length;
    await avviso('SIGNED_IN', 'negozio-a');
    expect(mondo.letture.length, 'un secondo avviso della stessa sessione ha riletto tutto').toBe(letture);
    s.smonta();
  }, 60000);
});
