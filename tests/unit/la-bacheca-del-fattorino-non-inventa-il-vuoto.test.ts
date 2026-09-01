/**
 * @vitest-environment jsdom
 */

/**
 * 27/8/2026 (R087) — «NESSUN ORDINE PRONTO» DETTO A CHI GLI ORDINI CE LI AVEVA.
 *
 * La bacheca del fattorino leggeva i suoi ordini con `const { data: datiRider, isLoading }`:
 * nessun `isError`, nessun `refetch`. Dentro la lettura c'è un `if (miei.error) throw miei.error`,
 * quindi la lettura fallisce davvero — ma il contenitore delle query non alza gli errori al
 * confine della pagina, così l'errore restava fermo nello stato della query e nessuno lo guardava.
 * Subito sotto, `datiRider?.miei ?? []` e `datiRider?.liberi ?? []` trasformavano quel guasto in
 * due elenchi vuoti, e la pagina scriveva «Nessun ordine pronto al momento. Riprova tra un po'».
 *
 * Il fattorino lavora dal telefono, in strada, con la rete che va e viene. Gli veniva detto che
 * non c'è lavoro mentre il lavoro c'era: le consegne restano ferme, il cliente aspetta, il negozio
 * incassa in ritardo — e lui chiude l'app, perché nessuno gli ha detto che bastava riprovare.
 *
 * Qui la pagina viene MONTATA per davvero, con la lettura in errore, e le si chiede cosa dice.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

/** Gli ordini che il fattorino avrebbe visto, se la lettura fosse andata bene. */
const DUE_ORDINI_LIBERI = {
  liberi: [
    {
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', seller_id: 'v1', store_name: 'Pane Quotidiano',
      store_address: 'Via Roma 1', delivery_city: 'Piacenza', delivery_zip: '29121',
      delivery_status: 'READY', payment_method: 'card', total_price: 24, shipping_cost: 4.9,
      rider_fee_cents: 350, delivery_slot: null, articoli: 3, created_at: '2026-08-30T09:00:00Z',
    },
  ],
  miei: [],
};

function preparaLaPagina(o: { queryKey: unknown[] }) {
  const chiave = JSON.stringify(o.queryKey);
  if (chiave.includes('pref')) return { online: true, zones: [] as string[] };
  if (chiave.includes('rating')) return { avg: 0, count: 0 };
  if (chiave.includes('today') || chiave.includes('Stats')) return { count: 0, earned: 0 };
  return DUE_ORDINI_LIBERI;
}

describe('la bacheca del fattorino', () => {
  beforeEach(() => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    globali.__DATI_QUERY__ = preparaLaPagina;
    globali.__ESITO_QUERY__ = undefined;
  });

  afterEach(() => {
    globali.__DATI_QUERY__ = undefined;
    globali.__ESITO_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
  });

  it('quando la lettura riesce e non c\'è lavoro, lo dice — e questo va bene', async () => {
    // Il verde di controllo: senza di lui la prova qui sotto potrebbe passare
    // perché la frase è sparita dalla pagina, non perché il difetto è chiuso.
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
      const chiave = JSON.stringify(o.queryKey);
      if (chiave.includes('pref')) return { online: true, zones: [] as string[] };
      if (chiave.includes('rating')) return { avg: 0, count: 0 };
      if (chiave.includes('today') || chiave.includes('Stats')) return { count: 0, earned: 0 };
      return { liberi: [], miei: [] };
    };
    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    expect(
      s.radice.textContent,
      'la frase dello stato vuoto è sparita: da qui in poi la prova sull\'errore non misura più niente',
    ).toContain('Nessun ordine pronto');
    s.smonta();
  }, 60000);

  it('con la lettura fallita NON dice al fattorino che non c\'è lavoro', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      JSON.stringify(o.queryKey).includes('orders')
        ? { isError: true, error: new Error('rete caduta'), data: undefined, isSuccess: false }
        : undefined;

    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    const aSchermo = s.radice.textContent ?? '';

    expect(
      aSchermo,
      'Il fattorino legge «non c\'è lavoro» mentre gli ordini ci sono: smette di guardare e le consegne restano ferme',
    ).not.toContain('Nessun ordine pronto');
    expect(
      aSchermo.toLowerCase(),
      'Nessuno gli dice che è la lettura a non essere riuscita: non ha modo di capire che deve solo riprovare',
    ).toMatch(/non (sono )?riesc|non sono riuscit/);
    s.smonta();
  }, 60000);

  it('con la lettura fallita offre di riprovare, e il pulsante rilegge davvero', async () => {
    let riletture = 0;
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      JSON.stringify(o.queryKey).includes('orders')
        ? {
            isError: true, error: new Error('rete caduta'), data: undefined, isSuccess: false,
            refetch: () => { riletture += 1; return Promise.resolve({ data: undefined }); },
          }
        : undefined;

    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    const riprova = Array.from(s.radice.querySelectorAll('button, a')).find((b) =>
      /riprova|riprovare/i.test(b.textContent ?? ''),
    );
    expect(riprova, 'Non c\'è nessun modo di riprovare: al fattorino resta solo chiudere l\'app').toBeTruthy();

    s.agisci(() => clicca(riprova!));
    expect(riletture, 'Il pulsante «Riprova» c\'è ma non rilegge niente: è un pulsante finto').toBeGreaterThan(0);
    s.smonta();
  }, 60000);
});
