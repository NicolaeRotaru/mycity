/**
 * R06 — Se il fattorino sparisce senza dichiarare i contanti, l'ordine non resta
 * «in consegna» per sempre: l'amministratore lo chiude.
 *
 * Il caso: martedi' sera il fattorino consegna pane per 25 euro in contanti,
 * intasca i soldi e non riapre piu' l'app. Dalla migrazione 163 un ordine in
 * contanti non diventa DELIVERED senza l'incasso, e l'incasso dell'amministratore
 * vale solo a consegna chiusa: nessuna strada portava l'ordine a chiusura.
 *
 * La funzione del database che chiude incasso e consegna insieme c'e' (360,
 * provata in tests/sql/rls/riparazione-r12-chiudi-consegna.test.sql), ma il sito
 * non la chiamava da nessuna parte. Qui si prova la strada del sito: la chiama con
 * la sessione dell'amministratore (con il client di servizio is_admin() e' falso),
 * traduce i rifiuti, e riallinea la giornata di cassa della chiusura.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const stato = vi.hoisted(() => ({
  quadrature: [] as Array<{ riderId: string; giorno: string }>,
  quadraturaCade: false,
  errori: [] as unknown[][],
}));

vi.mock('@/lib/cassa/quadratura', () => ({
  aggiornaQuadratura: async (_admin: unknown, riderId: string, giorno: string) => {
    if (stato.quadraturaCade) throw new Error('quadratura: ordini non letti (rete)');
    stato.quadrature.push({ riderId, giorno });
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...a: unknown[]) => { stato.errori.push(a); },
    warn: vi.fn(),
    info: vi.fn(),
    spesa: vi.fn(),
  },
}));

vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn() }));

import { chiudiConsegnaDaAmministratore as chiudi } from '@/lib/cassa/registra-incasso';

const ORDINE = 'e1200000-0000-4000-8000-0000000000c1';

type Risposta = { data?: unknown; error?: { code?: string; message?: string } | null };

/** La sessione dell'amministratore: l'unica che puo' chiamare la funzione (is_admin() guarda auth.uid()). */
function sessioneCon(risposta: Risposta) {
  const chiamate: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      chiamate.push({ fn, args });
      return { data: risposta.data ?? null, error: risposta.error ?? null };
    },
  };
  return { client: client as unknown as SupabaseClient, chiamate };
}

/** Il client di servizio: niente rpc, cosi' una chiamata dal client sbagliato si vede. */
function servizioCon(riga: unknown) {
  const letture: unknown[][] = [];
  const catena = {
    select: (c: string) => { letture.push(['select', c]); return catena; },
    eq: (k: string, v: unknown) => { letture.push(['eq', k, v]); return catena; },
    maybeSingle: async () => ({ data: riga, error: null }),
  };
  const client = { from: (t: string) => { letture.push(['from', t]); return catena; } };
  return { client: client as unknown as SupabaseClient, letture };
}

// La chiusura e' alle 00:30 di Piacenza del 25/11 (23:30 UTC del 24): la giornata di cassa e' il 25.
const CHIUSO = { rider_id: 'fattorino-1', delivered_at: '2026-11-24T23:30:00Z' };

beforeEach(() => {
  stato.quadrature = [];
  stato.quadraturaCade = false;
  stato.errori = [];
});

describe('il fattorino e sparito con l ordine in strada', () => {
  it('l amministratore chiude la consegna con l incasso, dalla sua sessione, in un passo solo', async () => {
    const sessione = sessioneCon({ data: { ok: true, incasso_registrato: true } });
    const servizio = servizioCon(CHIUSO);

    const esito = await chiudi(sessione.client, servizio.client, {
      ordineId: ORDINE,
      incassatoCents: 2200,
      motivo: '  Fattorino irraggiungibile da tre giorni  ',
    });

    expect(esito, 'nessuna strada porta l ordine a chiusura: resta «in consegna» per sempre').toEqual({
      ok: true,
      incassoRegistrato: true,
    });
    expect(sessione.chiamate).toEqual([
      {
        fn: 'admin_chiudi_consegna',
        args: { p_order_id: ORDINE, p_incassato_cents: 2200, p_motivo: 'Fattorino irraggiungibile da tre giorni' },
      },
    ]);
  });

  it('la giornata di cassa riallineata e quella della chiusura, nel giorno di Piacenza', async () => {
    const servizio = servizioCon(CHIUSO);
    await chiudi(sessioneCon({ data: { ok: true, incasso_registrato: true } }).client, servizio.client, {
      ordineId: ORDINE,
      incassatoCents: 2200,
      motivo: 'Fattorino irraggiungibile da tre giorni',
    });
    expect(servizio.letture).toContainEqual(['eq', 'id', ORDINE]);
    expect(stato.quadrature, 'la rimessa di quel giorno non vede l ordine chiuso').toEqual([
      { riderId: 'fattorino-1', giorno: '2026-11-25' },
    ]);
  });

  it('se il fattorino aveva gia dichiarato i contanti chiude e basta, e lo dice', async () => {
    const esito = await chiudi(
      sessioneCon({ data: { ok: true, incasso_registrato: false } }).client,
      servizioCon(CHIUSO).client,
      { ordineId: ORDINE, incassatoCents: 9999, motivo: 'Fattorino irraggiungibile da tre giorni' },
    );
    expect(esito).toEqual({ ok: true, incassoRegistrato: false });
  });

  it('se il riallineamento della cassa cade la chiusura resta valida, e l errore si scrive', async () => {
    stato.quadraturaCade = true;
    const esito = await chiudi(
      sessioneCon({ data: { ok: true, incasso_registrato: true } }).client,
      servizioCon(CHIUSO).client,
      { ordineId: ORDINE, incassatoCents: 2200, motivo: 'Fattorino irraggiungibile da tre giorni' },
    );
    expect(esito).toMatchObject({ ok: true });
    expect(stato.errori).toHaveLength(1);
  });
});

describe('i paletti', () => {
  it('senza un motivo vero non si chiama nemmeno il database', async () => {
    const sessione = sessioneCon({ data: { ok: true, incasso_registrato: true } });
    const esito = await chiudi(sessione.client, servizioCon(CHIUSO).client, {
      ordineId: ORDINE,
      incassatoCents: 2200,
      motivo: '   corto   ',
    });
    expect(esito).toMatchObject({ ok: false, motivo: 'MOTIVO_MANCANTE', stato: 400 });
    expect(sessione.chiamate).toHaveLength(0);
    expect(stato.quadrature).toHaveLength(0);
  });

  it.each([
    ['NOT_ADMIN', undefined, 403, /amministratore/],
    ['INCASSO_MANCANTE', undefined, 400, /contanti/],
    ['IMPORTO_FUORI_MISURA', undefined, 400, /fuori misura/],
    ['ORDER_NOT_FOUND', undefined, 404, /non trovato/],
    ['NON_IN_CONTANTI', undefined, 409, /contanti/],
    ['RITIRO_IN_NEGOZIO', undefined, 409, /negozio/],
    ['SENZA_FATTORINO', undefined, 409, /fattorino/],
    ['WRONG_STATUS', 'PICKED_UP', 409, /si annulla/],
    ['WRONG_STATUS', 'DELIVERED', 409, /Rimesse COD/],
    ['WRONG_STATUS', 'ACCEPTED', 409, /in strada/],
  ])('il rifiuto %s (%s) diventa una risposta %d chiara', async (reason, status, codice, frase) => {
    const esito = await chiudi(
      sessioneCon({ data: { ok: false, reason, ...(status ? { status } : {}) } }).client,
      servizioCon(CHIUSO).client,
      { ordineId: ORDINE, incassatoCents: 2200, motivo: 'Fattorino irraggiungibile da tre giorni' },
    );
    expect(esito).toMatchObject({ ok: false, motivo: reason, stato: codice });
    expect(esito.ok ? '' : esito.messaggio).toMatch(frase);
    expect(stato.quadrature, 'un rifiuto non tocca la cassa').toHaveLength(0);
  });

  it('senza la migrazione 360 sul database lo dice, invece di un errore qualsiasi', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'Could not find the function public.admin_chiudi_consegna in the schema cache' },
      { code: '42883', message: 'function public.admin_chiudi_consegna(uuid, integer, text) does not exist' },
    ]) {
      const esito = await chiudi(sessioneCon({ error }).client, servizioCon(CHIUSO).client, {
        ordineId: ORDINE,
        incassatoCents: 2200,
        motivo: 'Fattorino irraggiungibile da tre giorni',
      });
      expect(esito).toMatchObject({ ok: false, motivo: 'FUNZIONE_ASSENTE', stato: 503 });
    }
  });

  it('un guasto o una risposta che non e della funzione vera non e una chiusura', async () => {
    for (const risposta of [
      { error: { code: '57014', message: 'canceling statement due to statement timeout' } },
      { data: null },
      { data: { ok: 'si' } },
      { data: { ok: false, reason: 'MOTIVO_INVENTATO' } },
      { data: { ok: false, reason: 'toString' } },
    ] as Risposta[]) {
      const esito = await chiudi(sessioneCon(risposta).client, servizioCon(CHIUSO).client, {
        ordineId: ORDINE,
        incassatoCents: 2200,
        motivo: 'Fattorino irraggiungibile da tre giorni',
      });
      expect(esito).toMatchObject({ ok: false, motivo: 'ERRORE', stato: 500 });
    }
    expect(stato.quadrature).toHaveLength(0);
  });
});
