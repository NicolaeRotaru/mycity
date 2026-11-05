/**
 * @vitest-environment jsdom
 */
/**
 * Sessione S02 (5/11/2026) — la rotta dei contanti del fattorino (banco copiato da
 * la-consegna-in-contanti-si-chiude-anche-senza-foto).
 *  · 1649: sopra i 50 € vale come foto solo un file nella cartella <fattorino>/<ordine>/ che il
 *          magazzino conferma; un percorso inventato vale «senza foto» (serve la nota, parte l'avviso);
 *  · 149:  su un ordine annullato il no dice «annullato», non «incasso già confermato»;
 *  · 348:  il pannello chiede il contante da rimettere, non «l'importo ricevuto»;
 *  · 1647: «Conferma» spento mentre la foto si carica; 1646: anteprima dal file, non dal percorso privato.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

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
const magazzino = vi.hoisted(() => ({ file: [] as string[], guasto: false }));

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
    storage: {
      from: () => ({
        list: async (cartella: string, o?: { search?: string }) =>
          magazzino.guasto
            ? { data: null, error: { message: 'giù' } }
            : { data: magazzino.file.filter((f) => f.startsWith(`${cartella}/`) && f.endsWith(`/${o?.search ?? ''}`)).map((f) => ({ name: f.split('/').pop() })), error: null },
      }),
    },
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

const conferma = (corpo: Record<string, unknown>) =>
  POST(new Request('http://localhost/api/rider/cash-confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: ID, ...corpo }),
  }));

describe('1649 · la foto dei contanti deve essere di questo ordine ed esistere', () => {
  beforeEach(() => {
    stato.ordine = inStrada(65);
    stato.avvisi = [];
    stato.scritture = [];
    magazzino.file = [`fattorino-1/${ID}/cash-1.jpg`];
    magazzino.guasto = false;
  });

  it('la foto di un altro ordine non vale: senza nota la rotta chiede la foto e non registra niente', async () => {
    const res = await conferma({ cashCollectedCents: 6200, photoUrl: 'fattorino-2/ordine-vecchio/cash.jpg' });
    expect(res.status).toBe(400);
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
  });

  it('un file mai caricato nella cartella giusta vale «senza foto»: con la nota passa ma parte l avviso', async () => {
    const res = await conferma({ cashCollectedCents: 6200, photoUrl: `fattorino-1/${ID}/inventata.jpg`, nota: 'Fotocamera rotta, tre banconote da 20' });
    expect(res.status).toBe(200);
    expect(stato.avvisi.some((a) => String(a.title).includes('senza foto'))).toBe(true);
    expect(stato.ordine?.cash_photo_url ?? null).toBeNull();
  });

  it('la foto vera nella cartella giusta passa senza avviso', async () => {
    const res = await conferma({ cashCollectedCents: 6200, photoUrl: `fattorino-1/${ID}/cash-1.jpg` });
    expect(res.status).toBe(200);
    expect(stato.avvisi.some((a) => String(a.title).includes('senza foto'))).toBe(false);
  });

  it('se il magazzino non risponde la foto nella cartella giusta si tiene (niente vicolo cieco alla porta)', async () => {
    magazzino.guasto = true;
    const res = await conferma({ cashCollectedCents: 6200, photoUrl: `fattorino-1/${ID}/cash-1.jpg` });
    expect(res.status).toBe(200);
  });
});

describe('149 · ordine annullato mentre il fattorino era in strada', () => {
  it('il no dice «annullato», non «incasso già confermato»', async () => {
    stato.ordine = { ...inStrada(25), delivery_status: 'CANCELED' };
    magazzino.file = [];
    const res = await conferma({ cashCollectedCents: 2200 });
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.error?.message ?? '').toContain('annullato');
    expect(corpo.error?.message ?? '').not.toContain('gia');
  });
});

describe('il pannello dei contanti', () => {
  it('348 · chiede quanti contanti rimetti in cassa, non «l importo ricevuto»', () => {
    const s = accendi(Pannello, { orderId: ID, expectedCents: 2200, compensoTenutoCents: 300, aperto: true, onChiudi: () => {} });
    const t = testoVisibile(s.radice);
    expect(t).toContain('quanti contanti rimetti in cassa');
    expect(t).not.toContain('importo ricevuto');
    s.smonta();
  });

  it('1647 · 1646 · «Conferma» spento durante il caricamento; anteprima da URL.createObjectURL', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/rider/CashConfirmDialog.tsx', 'utf8');
    expect(src).toContain('disabled={submitting || uploading !== null}');
    expect(src).toContain('if (uploading !== null) return;');
    expect(src).toContain('URL.createObjectURL(f)');
    expect(src).not.toContain('sizedImage(url, 400)');
  });
});

describe('revisione · ordine ancora «ritirato» (PICKED_UP) alla porta', () => {
  it('il no dice di premere «Sto andando dal cliente», non «scrivi all assistenza»', async () => {
    stato.ordine = { ...inStrada(25), delivery_status: 'PICKED_UP' };
    magazzino.file = [];
    const res = await conferma({ cashCollectedCents: 2200 });
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.error?.message ?? '').toContain('Sto andando dal cliente');
    expect(stato.ordine?.cash_confirmed_at).toBeNull();
  });
});
