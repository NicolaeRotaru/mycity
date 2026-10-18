/**
 * @vitest-environment jsdom
 */

/**
 * 15/10/2026 (R33) — IL GRANDE PULSANTE VERDE CHIUDEVA LA CONSEGNA E I
 * CONTANTI RESTAVANO NON DICHIARATI.
 *
 * Sulla pagina della consegna, in fondo allo schermo, c'era sempre «Conferma
 * consegna». Il riquadro dell'incasso stava piu' in alto, sotto la mappa e le
 * schede del cliente: su un telefono da 360 pixel fuori schermo. Il fattorino
 * dettava il codice, la pagina tornava da sola alla bacheca, la bacheca non
 * mostrava nessun «incasso da confermare» — e la rimessa della sera saltava
 * l'ordine: il negozio non veniva pagato.
 *
 * Qui le due pagine del fattorino vengono MONTATE per davvero, con un ordine
 * in contanti in mano, e si guarda cosa c'e' sotto il suo pollice.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const ORDINE = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

function ordine(sopra: Record<string, unknown> = {}) {
  return {
    id: ORDINE,
    user_id: 'cliente-1',
    seller_id: 'negozio-1',
    total_price: 25,
    shipping_cost: 0,
    rider_fee_cents: 300,
    pickup_in_store: false,
    delivery_status: 'OUT_FOR_DELIVERY',
    created_at: '2026-10-14T17:00:00Z',
    accepted_at: '2026-10-14T17:05:00Z',
    ready_at: null,
    picked_up_at: '2026-10-14T17:30:00Z',
    delivered_at: null,
    canceled_at: null,
    payment_method: 'cod',
    cash_confirmed_at: null,
    delivery_full_name: 'Maria Rossi',
    delivery_phone: '3331234567',
    delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza',
    delivery_zip: '29121',
    delivery_notes: null,
    delivery_lat: null,
    delivery_lng: null,
    seller: { store_name: 'Pane Quotidiano', store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null },
    order_items: [{ id: 'r1', quantity: 2, unit_price: 12.5, products: { name: 'Pane di Altamura' } }],
    ...sopra,
  };
}

/** Il testo dei pulsanti a schermo, come li legge chi li deve premere. */
function pulsanti(radice: HTMLElement): string[] {
  return Array.from(radice.querySelectorAll('button, a'))
    .map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function paginaDellaConsegna(datiOrdine: Record<string, unknown>) {
  globali.__DATI_QUERY__ = () => datiOrdine;
  const mod = await monta('app/rider/orders/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: ORDINE } });
  await attendi();
  return s;
}

describe('la barra in fondo alla consegna in contanti', () => {
  beforeEach(() => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
  });
  afterEach(() => {
    globali.__DATI_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
    document.body.innerHTML = '';
  });

  it('in strada, senza incasso dichiarato, offre i contanti e NON la chiusura col codice', async () => {
    const s = await paginaDellaConsegna(ordine());
    const visti = pulsanti(s.radice);

    expect(visti, 'il passo che manca, i contanti, non e sotto il pollice del fattorino').toContain('Conferma incasso contanti');
    expect(
      visti.some((t) => /^Conferma consegna/.test(t)),
      'il verde «Conferma consegna» e ancora li: si chiude col codice e il negozio non viene pagato',
    ).toBe(false);
    s.smonta();
  }, 60000);

  it('appena ritirato (prima di partire) vale la stessa regola', async () => {
    const s = await paginaDellaConsegna(ordine({ delivery_status: 'PICKED_UP' }));
    const visti = pulsanti(s.radice);
    expect(visti).toContain('Sto andando dal cliente');
    expect(visti).toContain('Conferma incasso contanti');
    expect(visti.some((t) => /^Conferma consegna/.test(t))).toBe(false);
    s.smonta();
  }, 60000);

  it('il pulsante dei contanti apre davvero il pannello a tutto schermo', async () => {
    const s = await paginaDellaConsegna(ordine());
    const bottone = Array.from(s.radice.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').includes('Conferma incasso contanti'),
    );
    expect(bottone).toBeTruthy();
    s.agisci(() => clicca(bottone!));
    await attendi();
    const pannello = s.radice.querySelector('[role="dialog"]');
    expect(pannello, 'il pulsante c e ma non apre niente: e un pulsante finto').toBeTruthy();
    expect(pannello?.textContent).toContain('Conferma incasso contanti');
    // Fuori dalla barra: la barra e spostata con una trasformazione CSS, e un
    // pannello fixed disegnato li dentro resterebbe chiuso nella barra.
    expect(
      pannello?.closest('.fixed.bottom-0'),
      'il pannello e disegnato dentro la barra fissa: non copre lo schermo',
    ).toBeNull();
    s.smonta();
  }, 60000);

  it('con l incasso gia dichiarato si chiude col codice, come prima', async () => {
    const s = await paginaDellaConsegna(ordine({ cash_confirmed_at: '2026-10-14T17:50:00Z' }));
    const visti = pulsanti(s.radice);
    expect(visti).toContain('Conferma consegna al cliente');
    expect(visti).not.toContain('Conferma incasso contanti');
    s.smonta();
  }, 60000);

  it('con la carta non cambia niente', async () => {
    const s = await paginaDellaConsegna(ordine({ payment_method: 'card' }));
    const visti = pulsanti(s.radice);
    expect(visti).toContain('Conferma consegna al cliente');
    expect(visti).not.toContain('Conferma incasso contanti');
    s.smonta();
  }, 60000);

  it('consegnato senza incasso: il passo che resta sono i contanti, non «torna alle consegne»', async () => {
    const s = await paginaDellaConsegna(
      ordine({ delivery_status: 'DELIVERED', delivered_at: '2026-10-14T17:55:00Z' }),
    );
    const visti = pulsanti(s.radice);
    expect(visti, 'consegna chiusa senza contanti e nessun pulsante per dichiararli').toContain('Conferma incasso contanti');
    expect(visti).not.toContain('Torna alle consegne');
    expect(s.radice.textContent).toContain('il negozio non viene pagato');
    s.smonta();
  }, 60000);
});

describe('la bacheca del fattorino ricorda i contanti', () => {
  afterEach(() => {
    globali.__DATI_QUERY__ = undefined;
    globali.__ESITO_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
    document.body.innerHTML = '';
  });

  it('una consegna chiusa senza incasso compare in cima, col pulsante per confermarlo', async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
      const chiave = JSON.stringify(o.queryKey);
      if (chiave.includes('incassi-da-dichiarare')) {
        return [{
          id: ORDINE, deliveredAt: '2026-10-06T19:30:00Z', storeName: 'Pane Quotidiano',
          expectedCents: 2200, compensoTenutoCents: 300,
        }];
      }
      if (chiave.includes('pref')) return { online: true, zones: [] as string[] };
      if (chiave.includes('rating')) return { avg: 0, count: 0 };
      if (chiave.includes('today') || chiave.includes('Stats')) return { count: 0, earned: 0 };
      return { liberi: [], miei: [] };
    };
    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();

    const testo = s.radice.textContent ?? '';
    expect(testo, 'la bacheca non ricorda al fattorino i contanti da dichiarare').toContain('Incassi da confermare (1)');
    expect(testo).toContain('Pane Quotidiano');
    expect(testo).toContain('22,00');
    expect(pulsanti(s.radice)).toContain('Conferma incasso contanti');
    s.smonta();
  }, 60000);

  it('senza incassi in sospeso la sezione non compare', async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
      const chiave = JSON.stringify(o.queryKey);
      if (chiave.includes('incassi-da-dichiarare')) return [];
      if (chiave.includes('pref')) return { online: true, zones: [] as string[] };
      if (chiave.includes('rating')) return { avg: 0, count: 0 };
      if (chiave.includes('today') || chiave.includes('Stats')) return { count: 0, earned: 0 };
      return { liberi: [], miei: [] };
    };
    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();
    expect(s.radice.textContent ?? '').not.toContain('Incassi da confermare');
    expect(s.radice.textContent ?? '').not.toContain('Non riesco a controllare');
    s.smonta();
  }, 60000);

  /**
   * 16/10/2026 — «NESSUN INCASSO» E «NON LO SO» ERANO LA STESSA SCHERMATA.
   *
   * La lettura degli incassi da confermare ignorava l'errore: con la rotta che
   * rispondeva 500, il riquadro semplicemente non compariva. Il fattorino con
   * due consegne in contanti mai dichiarate leggeva una bacheca pulita e
   * chiudeva la giornata.
   */
  function bachecaCon(incassi: unknown, guasto: Record<string, unknown> | undefined) {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
      const chiave = JSON.stringify(o.queryKey);
      if (chiave.includes('incassi-da-dichiarare')) return incassi;
      if (chiave.includes('pref')) return { online: true, zones: [] as string[] };
      if (chiave.includes('rating')) return { avg: 0, count: 0 };
      if (chiave.includes('today') || chiave.includes('Stats')) return { count: 0, earned: 0 };
      return { liberi: [], miei: [] };
    };
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      JSON.stringify(o.queryKey).includes('incassi-da-dichiarare') ? guasto : undefined;
  }

  it('se la lettura degli incassi fallisce lo dice, con «Riprova», invece di tacere', async () => {
    let riprove = 0;
    bachecaCon(undefined, {
      isError: true,
      isSuccess: false,
      error: new Error('Non riesco a leggere gli incassi da confermare'),
      refetch: () => { riprove += 1; return Promise.resolve({ data: undefined }); },
    });
    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();

    const testo = s.radice.textContent ?? '';
    expect(
      testo,
      'la lettura degli incassi e fallita e la bacheca tace: il fattorino crede di non avere contanti da confermare',
    ).toContain('Non riesco a controllare gli incassi da confermare');
    // Il resto della bacheca resta: e solo questo riquadro a non sapere.
    expect(testo).toContain('Sei online');

    const avviso = s.radice.querySelector('[role="alert"]');
    expect(avviso, 'l avviso non e annunciato a chi usa il lettore di schermo').toBeTruthy();
    const riprova = Array.from(avviso!.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Riprova',
    );
    expect(riprova, 'senza «Riprova» il fattorino deve ricaricare tutta la pagina').toBeTruthy();
    s.agisci(() => clicca(riprova!));
    await attendi();
    expect(riprove, '«Riprova» non rilegge gli incassi').toBe(1);
    s.smonta();
  }, 60000);

  it('se la rilettura fallisce ma l ultimo elenco c era, l elenco resta sotto l avviso', async () => {
    bachecaCon(
      [{
        id: ORDINE, deliveredAt: '2026-10-06T19:30:00Z', storeName: 'Pane Quotidiano',
        expectedCents: 2200, compensoTenutoCents: 300, residuoDovutoCents: 0,
      }],
      { isError: true, isSuccess: false, error: new Error('500') },
    );
    const mod = await monta('app/rider/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();

    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Non riesco a controllare gli incassi da confermare');
    expect(testo, 'una rilettura fallita fa sparire consegne che il fattorino deve ancora confermare').toContain('Pane Quotidiano');
    expect(pulsanti(s.radice)).toContain('Conferma incasso contanti');
    s.smonta();
  }, 60000);
});

describe('la pagina delle rimesse ha un pulsante per gli incassi mancanti', () => {
  afterEach(() => {
    globali.__DATI_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
    document.body.innerHTML = '';
  });

  it('una consegna senza incasso registrato si puo registrare da li, non solo «chiedere al fattorino»', async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isAdmin: true, profile: { full_name: 'Nicola', role: 'admin' } };
    const riga = (id: string, incasso: string | null) => ({
      id, rider_id: 'fattorino-1', delivered_at: '2026-10-14T19:30:00Z', total_price: 25, shipping_cost: 0,
      rider_fee_cents: 300, pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED',
      cash_confirmed_at: incasso, rider: { full_name: 'Luca Verdi' },
    });
    globali.__DATI_QUERY__ = () => [
      riga('aaaaaaaa-0000-4000-8000-000000000001', '2026-10-14T19:31:00Z'),
      riga('bbbbbbbb-0000-4000-8000-000000000002', null),
    ];
    const mod = await monta('app/admin/cod-remittance/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();

    const testo = s.radice.textContent ?? '';
    expect(testo, 'la pagina non dice quali consegne la rimessa saltera').toContain('senza incasso registrato');
    expect(testo).toContain('#bbbbbbbb');
    expect(testo, 'compare anche la consegna gia incassata fra quelle da registrare').not.toContain('#aaaaaaaa');
    expect(pulsanti(s.radice), 'l amministratore non ha un pulsante: resta solo il database a mano').toContain('Registra incasso');
    s.smonta();
  }, 60000);
});
