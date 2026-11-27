import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fermaInContanti, sbloccaInContanti, segnaLaSceltaSulPreventivo } from '@/lib/agenzia/abbonamento-contanti';

/**
 * L'ABBONAMENTO IN CONTANTI SBLOCCA LA PAGINA DEL NEGOZIO — 27/11/2026.
 *
 * Nicola, 27/11 02:26: l'agente sceglie l'abbonamento detto dal titolare e «in automatico deve sbloccarsi la
 * pagina del venditore in base all'abbonamento»; subito, fino alla disdetta. Queste prove dicono:
 *  · nasce UNA riga in contanti, attiva, col canone del listino; premere di nuovo non ne fa una seconda;
 *  · un'altra fascia aggiorna la riga che c'è; un abbonamento pagato online non si tocca e non si affianca;
 *  · due pressioni insieme (indice unico della 999) non sono un guasto;
 *  · fermare non cancella: la riga passa a `canceled`, e un abbonamento Stripe resta com'è.
 */

type Riga = Record<string, unknown>;
const db = { abbonamenti_servizi: [] as Riga[], site_settings: [] as Riga[], preventivi_con_codice: [] as Riga[] };
const guasti = { lettura: false, inserimento: null as null | { code: string; message: string }, primaDelRifiuto: null as null | (() => void) };

/** Un finto client Supabase in memoria: select/insert/update con eq, in, limit, maybeSingle. */
function finto(): SupabaseClient {
  return {
    from(tabella: keyof typeof db) {
      const filtri: ((r: Riga) => boolean)[] = [];
      let op: 'select' | 'update' | 'insert' = 'select';
      let valori: Riga = {};
      const righe = () => db[tabella].filter((r) => filtri.every((f) => f(r)));
      const esegui = () => {
        if (op === 'insert') {
          if (guasti.inserimento) { guasti.primaDelRifiuto?.(); return { data: null, error: guasti.inserimento }; }
          db[tabella].push({ id: `r${db[tabella].length + 1}`, ...valori });
          return { data: null, error: null };
        }
        if (op === 'update') {
          const prese = righe();
          prese.forEach((r) => Object.assign(r, valori));
          return { data: prese.map((r) => ({ id: r.id })), error: null };
        }
        if (guasti.lettura && tabella === 'abbonamenti_servizi') return { data: null, error: { message: 'tabella giù' } };
        return { data: righe(), error: null };
      };
      const q = {
        select: () => q,
        insert: (v: Riga) => { op = 'insert'; valori = v; return Promise.resolve(esegui()); },
        update: (v: Riga) => { op = 'update'; valori = v; return q; },
        eq: (k: string, v: unknown) => { filtri.push((r) => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { filtri.push((r) => v.includes(r[k])); return q; },
        limit: () => q,
        maybeSingle: async () => { const e = esegui(); return { data: (e.data as Riga[] | null)?.[0] ?? null, error: e.error }; },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const NEGOZIO = 'negozio-1';
const inCorso = () => db.abbonamenti_servizi.filter((r) => r.seller_id === NEGOZIO && ['active', 'past_due'].includes(String(r.stato)));

beforeEach(() => {
  db.abbonamenti_servizi = [];
  db.site_settings = [];
  db.preventivi_con_codice = [];
  guasti.lettura = false;
  guasti.inserimento = null;
  guasti.primaDelRifiuto = null;
});

describe('lo sblocco in contanti', () => {
  it('nasce una riga attiva, in contanti, col prezzo del listino; la seconda volta non se ne fa un altra', async () => {
    const admin = finto();
    expect(await sbloccaInContanti(admin, NEGOZIO, 'business')).toEqual({ esito: 'sbloccata', fascia: 'business' });
    expect(inCorso()).toHaveLength(1);
    expect(inCorso()[0]).toMatchObject({ fascia: 'business', canone_centesimi: 60_000, origine: 'contanti', stato: 'active', rinnovo_il: null });
    expect(inCorso()[0]).not.toHaveProperty('stripe_subscription_id');
    expect(await sbloccaInContanti(admin, NEGOZIO, 'business')).toEqual({ esito: 'gia-sbloccata', fascia: 'business' });
    expect(inCorso()).toHaveLength(1);
  });

  it('il prezzo cambiato da Nicola nelle impostazioni vale; «su richiesta» torna al suo prezzo', async () => {
    db.site_settings = [{ id: 1, agenzia: { abbonamenti: { base: 25_000, premium: null } } }];
    const admin = finto();
    await sbloccaInContanti(admin, NEGOZIO, 'base');
    expect(inCorso()[0].canone_centesimi).toBe(25_000);
    await sbloccaInContanti(admin, NEGOZIO, 'premium');
    expect(inCorso()[0].canone_centesimi).toBe(90_000);
  });

  it('un altra fascia aggiorna la riga che c è, senza farne una seconda', async () => {
    const admin = finto();
    await sbloccaInContanti(admin, NEGOZIO, 'base');
    expect(await sbloccaInContanti(admin, NEGOZIO, 'premium')).toEqual({ esito: 'cambiata', fascia: 'premium', da: 'base' });
    expect(inCorso()).toHaveLength(1);
    expect(inCorso()[0]).toMatchObject({ fascia: 'premium', canone_centesimi: 90_000 });
  });

  it('chi ha già un abbonamento pagato online lo tiene: niente riga in contanti accanto', async () => {
    db.abbonamenti_servizi = [{ id: 's1', seller_id: NEGOZIO, fascia: 'base', stato: 'active', origine: 'stripe', stripe_subscription_id: 'sub_1' }];
    expect(await sbloccaInContanti(finto(), NEGOZIO, 'premium')).toEqual({ esito: 'gia-online', fascia: 'base' });
    expect(db.abbonamenti_servizi).toHaveLength(1);
    expect(db.abbonamenti_servizi[0].fascia).toBe('base');
  });

  it('un abbonamento in contanti già fermato non conta: se ne apre uno nuovo', async () => {
    db.abbonamenti_servizi = [{ id: 'c0', seller_id: NEGOZIO, fascia: 'base', stato: 'canceled', origine: 'contanti' }];
    expect((await sbloccaInContanti(finto(), NEGOZIO, 'base')).esito).toBe('sbloccata');
    expect(db.abbonamenti_servizi).toHaveLength(2);
  });

  it('due pressioni insieme non sono un guasto; un guasto vero lo è', async () => {
    // L'altra pressione scrive la riga fra la lettura e l'inserimento: l'indice unico della 999 ferma questa.
    guasti.inserimento = { code: '23505', message: 'duplicate key' };
    guasti.primaDelRifiuto = () => { db.abbonamenti_servizi.push({ id: 'altra', seller_id: NEGOZIO, fascia: 'business', stato: 'active', origine: 'contanti' }); };
    expect(await sbloccaInContanti(finto(), NEGOZIO, 'business')).toEqual({ esito: 'gia-sbloccata', fascia: 'business' });
    expect(inCorso()).toHaveLength(1);
    guasti.primaDelRifiuto = null;
    guasti.inserimento = { code: '42501', message: 'permesso negato' };
    expect((await sbloccaInContanti(finto(), 'negozio-2', 'base')).esito).toBe('guasto');
    guasti.inserimento = null;
    guasti.lettura = true;
    expect((await sbloccaInContanti(finto(), 'negozio-3', 'base')).esito).toBe('guasto');
  });

  it('una fascia che non esiste non scrive niente', async () => {
    expect((await sbloccaInContanti(finto(), NEGOZIO, 'oro' as never)).esito).toBe('guasto');
    expect(db.abbonamenti_servizi).toHaveLength(0);
  });
});

describe('fermare e segnare la scelta', () => {
  it('fermare non cancella e non tocca Stripe', async () => {
    db.abbonamenti_servizi = [
      { id: 'c1', seller_id: NEGOZIO, fascia: 'business', stato: 'active', origine: 'contanti' },
      { id: 's1', seller_id: NEGOZIO, fascia: 'base', stato: 'active', origine: 'stripe', stripe_subscription_id: 'sub_1' },
    ];
    expect(await fermaInContanti(finto(), NEGOZIO)).toBe(1);
    expect(db.abbonamenti_servizi).toHaveLength(2);
    expect(db.abbonamenti_servizi.find((r) => r.id === 'c1')?.stato).toBe('canceled');
    expect(db.abbonamenti_servizi.find((r) => r.id === 's1')?.stato).toBe('active');
    expect(await fermaInContanti(finto(), NEGOZIO)).toBe(0);
  });

  it('la scelta va sul preventivo solo finché è aperto', async () => {
    db.preventivi_con_codice = [
      { seller_id: NEGOZIO, stato: 'aperto', fascia_scelta: null },
      { seller_id: 'accettato', stato: 'accettato', fascia_scelta: 'base' },
    ];
    expect(await segnaLaSceltaSulPreventivo(finto(), NEGOZIO, 'premium')).toBe(true);
    expect(await segnaLaSceltaSulPreventivo(finto(), 'accettato', 'premium')).toBe(true);
    expect(db.preventivi_con_codice[0].fascia_scelta).toBe('premium');
    expect(db.preventivi_con_codice[1].fascia_scelta).toBe('base');
  });
});
