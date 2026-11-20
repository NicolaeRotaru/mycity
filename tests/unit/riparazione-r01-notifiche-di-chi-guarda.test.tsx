/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * R01-varie — Le notifiche si rileggono da capo quando cambia chi le guarda.
 *
 * Con la pagina aperta cambia la sessione: come fa QueryProvider, la memoria si svuota e la pagina
 * rilegge da capo, con la sua attesa. «Carica altre» nella stessa sessione invece tiene l'elenco a
 * video mentre carica.
 * Qui react-query è quello vero e il database un finto che risponde o aspetta a comando.
 *
 * Seconda passata (collaudo): QueryProvider svuota la memoria senza avvisare chi la sta guardando:
 * la pagina non si ridisegnava e la lettura nuova non partiva. Le prove qui sotto montano
 * QueryProvider vero intorno alla pagina vera e mandano gli avvisi di sessione come li manda il
 * client: niente memoria svuotata a mano, niente ridisegno forzato dalla prova. E l'elenco tenuto da
 * parte vale solo per la sessione che l'ha letto.
 */

const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-19T10:00:00Z');

type Riga = { id: string; user_id: string; title: string; body: null; link: null; is_read: boolean; created_at: string };
const righeDi = (utente: string, quante: number): Riga[] =>
  Array.from({ length: quante }, (_, i) => ({
    id: `${utente}-n${i}`,
    user_id: utente,
    title: `${utente}-avviso-${i}`,
    body: null,
    link: null,
    is_read: true,
    created_at: new Date(ora - i * 3_600_000).toISOString(),
  }));

const mondo = {
  righe: [] as Riga[],
  attesa: null as Promise<void> | null,
  /** Se vero, aspetta anche il conto del campanello, non solo l'elenco. */
  contoLento: false,
};

function database() {
  return {
    from: () => {
      const filtri: Record<string, unknown> = {};
      let limite = Number.POSITIVE_INFINITY;
      let conta = false;
      const risposta = () => {
        const scelte = mondo.righe.filter((r) => Object.entries(filtri).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        if (conta) return { data: null, count: scelte.length, error: null };
        return { data: scelte.slice(0, limite).map((r) => ({ ...r })), error: null };
      };
      const c: Record<string, unknown> = {};
      c.select = (_colonne: string, opzioni?: { head?: boolean }) => { conta = !!opzioni?.head; return c; };
      c.eq = (colonna: string, valore: unknown) => { filtri[colonna] = valore; return c; };
      c.order = () => c;
      c.limit = (n: number) => { limite = n; return c; };
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const prima = mondo.attesa && (!conta || mondo.contoLento) ? mondo.attesa : Promise.resolve();
        return prima.then(() => risposta()).then(ok, ko);
      };
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
  const mod = await monta('app/notifications/page.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = mod.default as () => unknown;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  let ridisegna = () => {};
  function Involucro() {
    const [, setGiro] = useState(0);
    ridisegna = () => setGiro((g) => g + 1);
    return createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never));
  }
  const s = accendi(Involucro);
  await lascia();
  /** Come quando cambia la sessione: l'avviso, la memoria svuotata, la pagina che rilegge. */
  const entra = async (utente: string) => {
    globali.__UTENTE__ = { id: utente };
    await act(async () => {
      for (const ascolto of globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>) ascolto('SIGNED_IN', { user: { id: utente } });
      qc.clear();
      ridisegna();
    });
    await lascia();
  };
  /** La sessione cambia per la pagina (la sua domanda «chi è collegato» si rilegge), senza avvisi. */
  const cambiaUtente = async (utente: string) => {
    globali.__UTENTE__ = { id: utente };
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['auth', 'utente-corrente'] });
    });
    await lascia();
  };
  return { s, entra, cambiaUtente };
}

/**
 * La pagina vera dentro QueryProvider vero: gli avvisi di sessione arrivano a tutti, uno dopo l'altro,
 * nell'ordine in cui si sono messi in ascolto (la pagina prima, QueryProvider dopo) o al contrario
 * (come quando si arriva alla pagina da un'altra, e QueryProvider ascoltava già).
 */
async function apriColProvider(ordine: 'pagina prima' | 'QueryProvider prima') {
  const pagina = await monta('app/notifications/page.tsx', { veri: ['@tanstack/react-query'] });
  const fornitore = await monta('components/providers/QueryProvider.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = pagina.default as () => unknown;
  const Fornitore = fornitore.default as (p: { children: unknown }) => unknown;
  const s = accendi(() => createElement(Fornitore as never, null, createElement(Pagina as never)));
  await lascia();
  const avviso = async (evento: string, utente: string | null) => {
    globali.__UTENTE__ = utente ? { id: utente } : null;
    const ascolti = [...(globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>)];
    if (ordine === 'QueryProvider prima') ascolti.reverse();
    await act(async () => {
      for (const ascolto of ascolti) ascolto(evento, utente ? { user: { id: utente } } : null);
    });
    await lascia();
  };
  return { s, avviso };
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;

beforeEach(() => {
  mondo.righe = [];
  mondo.attesa = null;
  mondo.contoLento = false;
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__NAVIGAZIONI__']) delete globali[k];
});

describe('R01-varie · le notifiche si rileggono da capo quando cambia chi le guarda', () => {
  it('cambiata la sessione, l’elenco si rilegge da capo', async () => {
    mondo.righe = [...righeDi('u1', 3), ...righeDi('u2', 2)];
    const { s, entra } = await apri();
    expect(s.radice.textContent, 'controprova: la prima lettura deve riuscire').toContain('u1-avviso-2');

    let lascialaArrivare = () => {};
    mondo.attesa = new Promise<void>((r) => { lascialaArrivare = r; });
    await entra('u2');
    expect(s.radice.textContent, 'l’elenco non si è riletto da capo').not.toContain('u1-avviso');

    await act(async () => { lascialaArrivare(); });
    mondo.attesa = null;
    await lascia();
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('u2-avviso-1');
    expect(testo).not.toContain('u1-avviso');
    s.smonta();
  }, 60000);

  it('nella stessa sessione «Carica altre» tiene a video l’elenco già letto mentre carica', async () => {
    mondo.righe = righeDi('u1', 60);
    const { s } = await apri();
    expect(s.radice.querySelectorAll('li'), 'controprova: le prime 50 devono essere a video').toHaveLength(50);

    let lascialeArrivare = () => {};
    mondo.attesa = new Promise<void>((r) => { lascialeArrivare = r; });
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    expect(s.radice.querySelectorAll('li'), 'mentre carica, l’elenco già letto è sparito').toHaveLength(50);
    expect(pulsante(s.radice, /Caricamento…/)).not.toBeNull();

    await act(async () => { lascialeArrivare(); });
    mondo.attesa = null;
    await lascia();
    expect(s.radice.querySelectorAll('li')).toHaveLength(60);
    s.smonta();
  }, 60000);

  for (const [giro, ordine] of [
    [['SIGNED_IN u2'], 'pagina prima'],
    [['SIGNED_OUT', 'SIGNED_IN u2'], 'pagina prima'],
    [['SIGNED_IN u2'], 'QueryProvider prima'],
    [['SIGNED_OUT', 'SIGNED_IN u2'], 'QueryProvider prima'],
  ] as const) {
    it(`con QueryProvider vero, quando cambia la sessione (${giro.join(' poi ')}, ${ordine}) la pagina si rilegge da capo, con la sua attesa`, async () => {
      mondo.righe = [...righeDi('u1', 3), ...righeDi('u2', 2)];
      globali.__NAVIGAZIONI__ = [];
      const { s, avviso } = await apriColProvider(ordine);
      expect(s.radice.textContent, 'controprova: la prima lettura deve riuscire').toContain('u1-avviso-2');
      await avviso('INITIAL_SESSION', 'u1');
      expect(s.radice.textContent, 'controprova: la stessa sessione non cambia l’elenco').toContain('u1-avviso-2');

      let lascialaArrivare = () => {};
      mondo.attesa = new Promise<void>((r) => { lascialaArrivare = r; });
      for (const passo of giro) {
        const [evento, utente] = passo.split(' ');
        await avviso(evento, utente ?? null);
      }
      expect(s.radice.textContent, 'cambiata la sessione, la pagina non si è riletta da capo').not.toContain('u1-avviso');

      await act(async () => { lascialaArrivare(); });
      mondo.attesa = null;
      await lascia();
      const testo = s.radice.textContent ?? '';
      expect(testo, 'cambiata la sessione, la lettura nuova non arriva').toContain('u2-avviso-1');
      expect(testo).not.toContain('u1-avviso');
      s.smonta();
    }, 60000);
  }

  it('l’elenco tenuto da parte vale per la sessione che l’ha letto: cambiata quella della pagina, si rilegge da capo con la sua attesa', async () => {
    mondo.righe = [...righeDi('u1', 3), ...righeDi('u2', 2)];
    const { s, cambiaUtente } = await apri();
    expect(s.radice.textContent, 'controprova: la prima lettura deve riuscire').toContain('u1-avviso-2');

    // Lente sia la lettura dell'elenco sia quella del campanello: nessun'altra risposta ridisegna la pagina.
    let lascialaArrivare = () => {};
    mondo.attesa = new Promise<void>((r) => { lascialaArrivare = r; });
    mondo.contoLento = true;
    await cambiaUtente('u2');
    expect(s.radice.textContent, 'cambiata la sessione, a video c’è l’elenco tenuto da parte invece dell’attesa').not.toContain('u1-avviso');

    await act(async () => { lascialaArrivare(); });
    mondo.attesa = null;
    await lascia();
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('u2-avviso-1');
    expect(testo).not.toContain('u1-avviso');
    s.smonta();
  }, 60000);
});
