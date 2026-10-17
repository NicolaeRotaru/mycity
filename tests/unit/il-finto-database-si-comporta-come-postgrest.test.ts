import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 15/10/2026 (collaudo, giro 2) — IL CONTRATTO DEL DATABASE FINTO.
 *
 * Le prove dei gestori di Stripe girano sopra `finto-database-dei-pagamenti.ts`.
 * Il collaudo ha trovato due punti in cui il finto era più gentile del vero, e
 * su tutti e due una prova verde copriva un difetto vero:
 *
 *   ① il finto restituiva la riga intera a qualunque `select`: la contestazione
 *     vinta usava un campo che non chiedeva, e in produzione lo trovava vuoto;
 *   ② il finto applicava l'«oppure» solo prima di scrivere: la presa del turno
 *     sugli avvisi di Stripe passava qui e falliva sempre su PostgREST.
 *
 * Questa prova fissa il comportamento che il finto deve avere, ed è lo stesso
 * misurato su PostgREST 12.2.3, 12.2.8, 13.0.5 e 14.0. Le domande sono scritte
 * una volta sola e girano su due banchi: il finto, sempre; e PostgREST vero,
 * quando ci sono `POSTGREST_VERO_URL` (l'indirizzo che supabase-js si aspetta,
 * cioè quello che risponde su `/rest/v1`) e `POSTGREST_VERO_CHIAVE` (una chiave
 * con ruolo service_role). Se un giorno PostgREST cambia comportamento, il
 * banco vero diventa rosso e il finto va aggiornato insieme.
 *
 * La rete nelle prove unitarie è chiusa (`_setup.ts`), e resta chiusa: il banco
 * vero parla solo con un PostgREST sulla stessa macchina (127.0.0.1), con un
 * suo `fetch` che rifiuta qualunque altro indirizzo, e solo se lo si accende.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { prendiIlTurno } from '@/lib/stripe/webhook/registro-eventi';
import type { getAdminSupabase } from '@/lib/supabase/server';

/** Lo stesso client che usano i gestori di Stripe. */
type Client = ReturnType<typeof getAdminSupabase>;
type Banco = {
  nome: string;
  client: () => Client;
  /** Mette nel registro una riga con questi valori. */
  semina: (riga: Riga) => Promise<void>;
  leggi: (eventId: string) => Promise<Riga | null>;
};

/** Una colonna che non esiste in nessuno dei due banchi. */
const COLONNA_ASSENTE = 'colonna_che_non_esiste';

let finto: FintoDatabase;
const bancoFinto: Banco = {
  nome: 'database finto delle prove',
  client: () => finto.client as unknown as Client,
  semina: async (riga) => {
    finto.tabelle.stripe_event_log.push({ type: 'prova', processed: false, claimed_at: null, ...riga });
  },
  leggi: async (eventId) => finto.tabelle.stripe_event_log.find((r) => r.event_id === eventId) ?? null,
};

/** Un `fetch` che parla solo con questa macchina: il banco vero non va in rete. */
const fetchSoloLocale = ((input: unknown, init?: RequestInit) =>
  new Promise<Response>((risolvi, rifiuta) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      rifiuta(new Error(`il banco vero parla solo con un PostgREST locale, non con ${url.hostname}`));
      return;
    }
    const richiesta = http.request(
      url,
      { method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()) },
      (risposta) => {
        const pezzi: Buffer[] = [];
        risposta.on('data', (p: Buffer) => pezzi.push(p));
        risposta.on('end', () => {
          const intestazioni = new Headers();
          for (const [k, v] of Object.entries(risposta.headers)) if (v !== undefined) intestazioni.set(k, String(v));
          const vuota = risposta.statusCode === 204 || risposta.statusCode === 304;
          risolvi(new Response(vuota ? null : Buffer.concat(pezzi), {
            status: risposta.statusCode, statusText: risposta.statusMessage, headers: intestazioni,
          }));
        });
      },
    );
    richiesta.on('error', rifiuta);
    if (typeof init?.body === 'string') richiesta.write(init.body);
    richiesta.end();
  })) as typeof fetch;

const URL_VERO = process.env.POSTGREST_VERO_URL;
const CHIAVE_VERA = process.env.POSTGREST_VERO_CHIAVE;
const vero = URL_VERO && CHIAVE_VERA ? createClient(URL_VERO, CHIAVE_VERA, { auth: { persistSession: false }, global: { fetch: fetchSoloLocale } }) : null;
const bancoVero: Banco | null = vero
  ? {
      nome: `PostgREST vero (${URL_VERO})`,
      client: () => vero as unknown as Client,
      semina: async (riga) => {
        const { error } = await vero.from('stripe_event_log').insert({ type: 'prova', processed: false, claimed_at: null, ...riga });
        if (error) throw new Error(`semina: ${error.message}`);
      },
      leggi: async (eventId) => {
        const { data, error } = await vero.from('stripe_event_log').select('*').eq('event_id', eventId).maybeSingle();
        if (error) throw new Error(`lettura: ${error.message}`);
        return (data as Riga | null) ?? null;
      },
    }
  : null;

const banchi: Banco[] = [bancoFinto, ...(bancoVero ? [bancoVero] : [])];

beforeEach(() => {
  finto = fintoDatabase({ stripe_event_log: [] });
  finto.colonneMancanti.stripe_event_log = [COLONNA_ASSENTE];
});

let progressivo = 0;
const nuovoId = () => `evt_contratto_${Date.now()}_${progressivo++}`;
const adesso = () => new Date().toISOString();
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe.each(banchi)('$nome', (banco) => {
  it('una select restituisce SOLO le colonne chieste', async () => {
    const id = nuovoId();
    await banco.semina({ event_id: id });
    const { data, error } = await banco.client().from('stripe_event_log').select('event_id, processed').eq('event_id', id);
    expect(error).toBeNull();
    expect(Object.keys((data as Riga[])[0]).sort()).toEqual(['event_id', 'processed']);
  });

  it('scrittura con un «oppure» e select di un altra colonna: 42703, e la riga NON viene scritta', async () => {
    const id = nuovoId();
    await banco.semina({ event_id: id });
    const { data, error } = await banco.client()
      .from('stripe_event_log')
      .update({ claimed_at: adesso() })
      .eq('event_id', id)
      .or(`claimed_at.is.null,claimed_at.lt.${minutiFa(5)}`)
      .select('event_id');
    expect(data).toBeNull();
    expect(error?.code).toBe('42703');
    expect((await banco.leggi(id))?.claimed_at).toBeNull();
  });

  it('scrittura con un «oppure» e select di tutto: la riga è scritta, ma non torna indietro', async () => {
    const id = nuovoId();
    await banco.semina({ event_id: id });
    const { data, error } = await banco.client()
      .from('stripe_event_log')
      .update({ claimed_at: adesso() })
      .eq('event_id', id)
      .or(`claimed_at.is.null,claimed_at.lt.${minutiFa(5)}`)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await banco.leggi(id))?.claimed_at).not.toBeNull();
  });

  it('i filtri semplici valgono solo per la scrittura: la riga torna anche se dopo non li soddisfa più', async () => {
    const libero = nuovoId();
    const scaduto = nuovoId();
    await banco.semina({ event_id: libero });
    await banco.semina({ event_id: scaduto, claimed_at: minutiFa(10) });
    const a = await banco.client().from('stripe_event_log').update({ claimed_at: adesso() })
      .eq('event_id', libero).is('claimed_at', null).select('event_id');
    const b = await banco.client().from('stripe_event_log').update({ claimed_at: adesso() })
      .eq('event_id', scaduto).lt('claimed_at', minutiFa(5)).select('event_id');
    expect(a).toMatchObject({ error: null, data: [{ event_id: libero }] });
    expect(b).toMatchObject({ error: null, data: [{ event_id: scaduto }] });
  });

  it('una colonna che non c è: PGRST204 sulla scrittura, 42703 sulla lettura', async () => {
    const id = nuovoId();
    await banco.semina({ event_id: id });
    const scrittura = await banco.client().from('stripe_event_log').update({ [COLONNA_ASSENTE]: 1 }).eq('event_id', id);
    const lettura = await banco.client().from('stripe_event_log').select(`event_id, ${COLONNA_ASSENTE}`).eq('event_id', id);
    expect(scrittura.error?.code).toBe('PGRST204');
    expect(lettura.error?.code).toBe('42703');
  });

  it('prendiIlTurno: libero, scaduto, appena preso, già lavorato', async () => {
    const [libero, scaduto, fresco, lavorato] = [nuovoId(), nuovoId(), nuovoId(), nuovoId()];
    await banco.semina({ event_id: libero });
    await banco.semina({ event_id: scaduto, claimed_at: minutiFa(10) });
    await banco.semina({ event_id: fresco, claimed_at: minutiFa(1) });
    await banco.semina({ event_id: lavorato, processed: true });
    const c = banco.client() as never;
    expect(await prendiIlTurno(c, libero)).toBe('preso');
    expect(await prendiIlTurno(c, libero), 'la seconda consegna in gara').toBe('occupato');
    expect(await prendiIlTurno(c, scaduto)).toBe('preso');
    expect(await prendiIlTurno(c, scaduto)).toBe('occupato');
    expect(await prendiIlTurno(c, fresco)).toBe('occupato');
    expect(await prendiIlTurno(c, lavorato)).toBe('occupato');
  });
});
