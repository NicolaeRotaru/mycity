/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 16/10/2026 — IL FATTORINO SENZA FOTO RESTAVA FERMO ALLA PORTA.
 *
 * Dal lotto R33, sulle consegne in contanti il codice del cliente si chiede
 * DOPO l'incasso: la pagina mostra solo «Conferma incasso contanti» finche'
 * l'incasso non c'e', e il database risponde CASH_NOT_CONFIRMED al codice.
 *
 * Il pannello dei contanti dice «le foto sono facoltative», ma senza foto
 * mandava `"photoUrl": null`, e la rotta accettava solo «testo oppure niente»:
 * 400 «Dati non validi» su qualunque importo. Martedi' sera, ordine da 10 euro:
 * il fattorino preme Conferma senza foto, legge «Dati non validi», riprova, e
 * la consegna non si chiude piu'. Il negozio non viene pagato.
 *
 * E da 50 euro in su la foto era obbligatoria per davvero (o la firma, che il
 * pannello non chiede nemmeno): con la fotocamera rotta o il permesso negato
 * non c'era nessuna strada.
 *
 * Qui il pannello vero viene MONTATO e la sua richiesta arriva alla rotta vera:
 * il corpo e' quello che il pannello scrive, non uno scritto a mano.
 */

type Riga = Record<string, unknown>;

const ID = '44444444-4444-4444-8444-444444444444';

const stato: {
  utente: { id: string };
  ordine: Riga | null;
  scritture: Array<{ valori: Riga; filtri: Array<[string, string, unknown]> }>;
  avvisi: Riga[];
  attivita: Riga[];
  risposte: Array<{ stato: number; corpo: Riga; inviato: Riga }>;
} = { utente: { id: 'fattorino-1' }, ordine: null, scritture: [], avvisi: [], attivita: [], risposte: [] };

function soddisfa(riga: Riga, filtri: Array<[string, string, unknown]>): boolean {
  return filtri.every(([op, col, val]) => {
    if (op === 'eq') return riga[col] === val;
    if (op === 'is') return val === null ? riga[col] == null : riga[col] === val;
    if (op === 'in') return (val as unknown[]).includes(riga[col]);
    return true;
  });
}

function lettura(risultato: () => unknown) {
  const b: Record<string, unknown> = {};
  for (const op of ['eq', 'is', 'in', 'gte', 'lt', 'lte', 'order', 'limit']) b[op] = () => b;
  b.single = () => Promise.resolve(risultato());
  b.maybeSingle = () => Promise.resolve(risultato());
  b.then = (r: (v: unknown) => unknown) => Promise.resolve(risultato()).then(r);
  return b;
}

/** Una UPDATE che, come il database, tocca la riga solo se soddisfa i filtri. */
function aggiornamento(valori: Riga) {
  const filtri: Array<[string, string, unknown]> = [];
  const b: Record<string, unknown> = {};
  for (const op of ['eq', 'is', 'in']) {
    b[op] = (col: string, val: unknown) => { filtri.push([op, col, val]); return b; };
  }
  b.select = () => b;
  b.then = (r: (v: unknown) => unknown) => {
    stato.scritture.push({ valori, filtri });
    const tocca = stato.ordine && soddisfa(stato.ordine, filtri);
    if (tocca) Object.assign(stato.ordine as Riga, valori);
    return Promise.resolve({ data: tocca ? [{ id: ID }] : [], error: null }).then(r);
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: () => ({ select: () => lettura(() => ({ data: null, error: null })) }) }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: (colonne: string) =>
            colonne.includes('cash_confirmed_at')
              ? lettura(() => ({ data: stato.ordine ? { ...stato.ordine } : null, error: null }))
              : lettura(() => ({ data: [], error: null })),
          update: (valori: Riga) => aggiornamento(valori),
        };
      }
      if (tabella === 'cod_reconciliations') return { upsert: () => Promise.resolve({ error: null }) };
      if (tabella === 'profiles') return { select: () => lettura(() => ({ data: [{ id: 'amministratore-1' }], error: null })) };
      if (tabella === 'notifications') {
        return { insert: (righe: Riga[]) => { stato.avvisi.push(...righe); return Promise.resolve({ error: null }); } };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  }),
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: { id: string }; req: unknown }) => unknown) =>
    (req: unknown) => h({ user: stato.utente, req }),
}));

vi.mock('@/lib/activity', () => ({
  recordActivity: async (voce: Riga) => { stato.attivita.push(voce); },
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

let Pannello: ComponentType<Record<string, unknown>>;
let POST: (r: Request) => Promise<Response>;

beforeAll(async () => {
  const modulo = await monta('components/rider/CashConfirmDialog.tsx');
  Pannello = modulo.default as ComponentType<Record<string, unknown>>;
  POST = (await import('@/app/api/rider/cash-confirm/route')).POST as unknown as (r: Request) => Promise<Response>;
}, 60000);

/** Ordine in contanti in strada, incasso non ancora dichiarato. */
function inStrada(totaleEuro: number): Riga {
  return {
    id: ID,
    rider_id: 'fattorino-1',
    total_price: totaleEuro,
    rider_fee_cents: 300,
    shipping_cost: 0,
    pickup_in_store: false,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'OUT_FOR_DELIVERY',
    cash_confirmed_at: null,
    delivered_at: null,
  };
}

beforeEach(() => {
  stato.utente = { id: 'fattorino-1' };
  stato.ordine = inStrada(10);
  stato.scritture = [];
  stato.avvisi = [];
  stato.attivita = [];
  stato.risposte = [];
  // La richiesta del pannello arriva alla rotta VERA, col corpo che il pannello ha scritto.
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    const richiesta = new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: init?.headers ?? { 'content-type': 'application/json' },
      body: init?.body,
    });
    const risposta = await POST(richiesta);
    const corpo = await risposta.clone().json();
    stato.risposte.push({ stato: risposta.status, corpo, inviato: JSON.parse(init?.body ?? '{}') });
    return risposta;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function pulsante(radice: HTMLElement, testo: string): HTMLButtonElement {
  const b = Array.from(radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === testo);
  if (!b) throw new Error(`pulsante «${testo}» non trovato. Testo a video: ${testoVisibile(radice)}`);
  return b as HTMLButtonElement;
}

/** Scrive in un campo controllato da React come farebbe una tastiera. */
function scrivi(campo: HTMLTextAreaElement | HTMLInputElement, testo: string) {
  const proto = campo instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(campo, testo);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Lascia arrivare la risposta della rotta e gli aggiornamenti del pannello che ne seguono. */
async function lasciaArrivare() {
  for (let i = 0; i < 20; i++) {
    await attendi();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('sotto i 50 euro: la foto e davvero facoltativa', () => {
  it('Conferma senza foto registra l incasso e apre la strada al codice', async () => {
    let confermato = false;
    const s = accendi(Pannello, {
      orderId: ID,
      expectedCents: 700,
      compensoTenutoCents: 300,
      aperto: true,
      onChiudi: () => {},
      onConfirmed: () => { confermato = true; },
    });

    s.agisci(() => clicca(pulsante(s.radice, 'Conferma')));
    await lasciaArrivare();

    expect(stato.risposte, 'il pannello non ha mandato nessuna richiesta').toHaveLength(1);
    const [r] = stato.risposte;
    expect(
      r.stato,
      `senza foto la rotta risponde ${r.stato} ${JSON.stringify(r.corpo)} al corpo che il pannello manda davvero (${JSON.stringify(r.inviato)}): la consegna non si chiude piu`,
    ).toBe(200);
    expect(stato.ordine?.cash_confirmed_at, 'l incasso non e stato scritto sull ordine').toBeTruthy();
    expect(stato.ordine?.cash_collected_cents).toBe(700);
    expect(confermato, 'il pannello non ha detto alla pagina di passare al codice del cliente').toBe(true);
    s.smonta();
  });

  it('anche un app vecchia che manda ancora photoUrl null passa', async () => {
    const res = await POST(new Request('http://localhost/api/rider/cash-confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: ID, cashCollectedCents: 700, photoUrl: null, signatureUrl: null, deliveryPhotoUrl: null }),
    }));
    expect(res.status, 'il corpo delle versioni gia nei telefoni viene rifiutato con «Dati non validi»').toBe(200);
  });
});

describe('da 50 euro in su: la foto, oppure il perche non c e', () => {
  it('senza foto e senza nota non parte niente e il fattorino legge cosa fare', async () => {
    stato.ordine = inStrada(65);
    const s = accendi(Pannello, { orderId: ID, expectedCents: 6200, compensoTenutoCents: 300, aperto: true, onChiudi: () => {} });

    expect(
      testoVisibile(s.radice),
      'il pannello dice che le foto sono facoltative anche quando la rotta le pretende',
    ).not.toMatch(/sono\s+facoltative/);
    expect(
      testoVisibile(s.radice),
      'il pannello non dice al fattorino senza fotocamera che puo scrivere il perche',
    ).toMatch(/nota/i);

    s.agisci(() => clicca(pulsante(s.radice, 'Conferma')));
    await lasciaArrivare();
    // O non parte niente, o la rotta lo ferma: in ogni caso l'incasso non e' scritto.
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
    s.smonta();
  });

  it('con la fotocamera rotta basta scrivere il perche: la consegna si chiude e gli amministratori lo sanno', async () => {
    stato.ordine = inStrada(65);
    let confermato = false;
    const s = accendi(Pannello, {
      orderId: ID, expectedCents: 6200, compensoTenutoCents: 300, aperto: true, onChiudi: () => {},
      onConfirmed: () => { confermato = true; },
    });

    const nota = s.radice.querySelector('textarea');
    expect(nota, 'il pannello non offre una strada a chi non puo fare la foto').not.toBeNull();
    s.agisci(() => scrivi(nota!, 'Fotocamera rotta, pagato con tre banconote da 20'));
    s.agisci(() => clicca(pulsante(s.radice, 'Conferma')));
    await lasciaArrivare();

    const ultima = stato.risposte.at(-1);
    expect(ultima?.stato, `la rotta rifiuta l incasso senza foto anche con la nota: ${JSON.stringify(ultima?.corpo)}`).toBe(200);
    expect(ultima?.inviato).not.toHaveProperty('photoUrl');
    expect(stato.ordine?.cash_confirmed_at).toBeTruthy();
    expect(confermato).toBe(true);

    const avviso = stato.avvisi.find((a) => String(a.title).toLowerCase().includes('senza foto'));
    expect(avviso, 'un incasso da 62 euro senza foto passa in silenzio').toBeTruthy();
    expect(avviso?.category, 'l avviso sui soldi deve stare fra quelli che non si spengono').toBe('system');
    expect(String(avviso?.body)).toContain('Fotocamera rotta');
    expect(
      stato.attivita.find((a) => a.eventType === 'order.cash_without_photo')?.metadata,
      'la nota resta solo nella notifica: nessuna traccia sull ordine',
    ).toMatchObject({ nota: 'Fotocamera rotta, pagato con tre banconote da 20' });
    s.smonta();
  });

  it('con la foto non serve la nota e non parte nessun avviso', async () => {
    stato.ordine = inStrada(65);
    const res = await POST(new Request('http://localhost/api/rider/cash-confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: ID, cashCollectedCents: 6200, photoUrl: 'fattorino-1/ordine/cash-1.jpg' }),
    }));
    expect(res.status).toBe(200);
    expect(stato.avvisi.filter((a) => String(a.title).toLowerCase().includes('senza foto'))).toHaveLength(0);
  });

  it('una nota di due lettere non basta: la rotta lo ferma anche se il pannello venisse saltato', async () => {
    stato.ordine = inStrada(65);
    const res = await POST(new Request('http://localhost/api/rider/cash-confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: ID, cashCollectedCents: 6200, nota: 'ok' }),
    }));
    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.error?.message ?? '').toMatch(/foto/);
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
  });
});

describe('la riga del compenso nel pannello', () => {
  it('col credito che copre quasi tutto dice il compenso tenuto davvero e il resto che arriva', () => {
    const s = accendi(Pannello, {
      orderId: ID, expectedCents: 0, compensoTenutoCents: 200, residuoDovutoCents: 100, aperto: true, onChiudi: () => {},
    });
    const testo = testoVisibile(s.radice).replace(/\u00a0/g, ' ');
    expect(testo).toContain('hai già trattenuto 2,00 € di compenso');
    expect(testo, 'il resto del compenso, che arriva sull IBAN, non e spiegato').toContain('Il resto del compenso, 1,00 €, ti arriva sul tuo IBAN.');
    s.smonta();
  });
});
