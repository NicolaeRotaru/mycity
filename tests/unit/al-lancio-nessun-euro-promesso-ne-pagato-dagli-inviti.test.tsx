/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';

/**
 * 31/10/2026 — DOPO LA 168, NESSUN «5 EURO» PROMESSO SUL SITO NÉ PAGATO DA UN INVITO.
 *
 * La migrazione 168 ha tolto il regalo di benvenuto e spento i punti (carta #209: nessun
 * regalo in euro al lancio). Il collaudo ha trovato tre punti dove i 5 euro restavano:
 *  ① Luca si iscrive e apre «I miei ordini», vuoto: il secondo invito diceva «€5 di benvenuto»;
 *  ② sopra a ogni pagina la striscia verde «Benvenuto! Hai €5 di sconto — usali al primo
 *     ordine», per chi il bonus l'aveva ricevuto prima: i punti non si convertono più, i 5 euro
 *     non arrivano;
 *  ③ Maria scrive a mano un invito per Luca (una riga in `referrals`): alla prima consegna di
 *     Luca il database le accreditava 5 € di credito vero, spendibile in cassa, anche con gli
 *     inviti spenti.
 *
 * Per ③ qui non c'è un Postgres da interrogare: le migrazioni le applica una persona, a mano.
 * Si ricostruisce lo stato finale leggendo i file nell'ordine in cui li applicherebbe il
 * database (l'ultima definizione di una funzione è quella che gira, l'ultimo CREATE/DROP di un
 * trigger vince) e si guarda cosa fa la consegna di Luca.
 */

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;
const CINQUE_EURO = /€\s*5/;

afterEach(() => {
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
  delete g.__PROFILO__;
  delete g.__RISPOSTA_SUPABASE__;
});

async function aspetta(fine: () => boolean, ms: number): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite && !fine()) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
}

describe('Luca si è appena iscritto, coi punti spenti: il sito non gli promette 5 euro', () => {
  it('«I miei ordini» vuoto non promette «€5 di benvenuto»', async () => {
    expect(INVITI_E_PUNTI_ACCESI).toBe(false);
    const Ordini = (await monta('app/orders/page.tsx')).default as Pagina;
    g.__UTENTE__ = { id: 'luca-1', email: 'luca@example.it' };
    g.__DATI_QUERY__ = () => [];
    const s = accendi(Ordini);
    await aspetta(() => /Non hai ancora ordini/.test(testoVisibile(s.radice)), 4000);
    const t = testoVisibile(s.radice);
    s.smonta();
    expect(t, 'la pagina vuota si deve disegnare').toMatch(/Non hai ancora ordini/);
    expect(t, 'la pagina ordini vuota promette ancora i 5 euro di benvenuto').not.toMatch(CINQUE_EURO);
  }, 120000);

  it('la striscia «Hai €5 di sconto» non compare a chi aveva già il bonus e non ha ordini', async () => {
    expect(INVITI_E_PUNTI_ACCESI).toBe(false);
    const Striscia = (await monta('components/WelcomeCreditBanner.tsx')).default as Pagina;
    // Luca è un cliente collegato, ha il bonus di iscrizione di ieri e nessun ordine:
    // esattamente chi, prima, vedeva la striscia.
    g.__PROFILO__ = { profile: { id: 'luca-1' }, isAuthenticated: true, isBuyer: true };
    const ieri = new Date(Date.now() - 86_400_000).toISOString();
    g.__RISPOSTA_SUPABASE__ = ({ tavola }: { tavola: string }) =>
      tavola === 'loyalty_transactions'
        ? { data: { id: 'bonus-1', created_at: ieri }, error: null }
        : { data: null, count: 0, error: null };
    const s = accendi(Striscia);
    await aspetta(() => CINQUE_EURO.test(testoVisibile(s.radice)), 1500);
    const t = testoVisibile(s.radice);
    s.smonta();
    expect(t, 'la striscia del benvenuto promette ancora 5 euro di sconto').not.toMatch(CINQUE_EURO);
  }, 120000);
});

/* ------------------------------------------------------------------------------------------
 * Il database: l'invito scritto a mano e la prima consegna.
 * ---------------------------------------------------------------------------------------- */

const CARTELLA = join(process.cwd(), 'migrations');
const migrazioni = readdirSync(CARTELLA)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
  .map((f) => ({ f, sql: readFileSync(join(CARTELLA, f), 'utf8').replace(/--[^\n]*/g, '') }));

function corpoFinale(funzione: string): { corpo: string; dove: string } {
  let esito = { corpo: '', dove: '' };
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${funzione}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1`,
    'gi',
  );
  for (const { f, sql } of migrazioni) {
    for (const m of sql.matchAll(re)) esito = { corpo: m[2], dove: f };
  }
  return esito;
}

function triggerFinale(nome: string): { stato: 'creato' | 'tolto' | 'mai'; funzione: string } {
  let esito: { stato: 'creato' | 'tolto' | 'mai'; funzione: string } = { stato: 'mai', funzione: '' };
  const re = new RegExp(
    `\\b(?:(DROP)\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?${nome}\\b|CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\s+${nome}\\b[\\s\\S]*?EXECUTE\\s+(?:FUNCTION|PROCEDURE)\\s+public\\.(\\w+))`,
    'gi',
  );
  for (const { sql } of migrazioni) {
    for (const m of sql.matchAll(re)) esito = m[1] ? { stato: 'tolto', funzione: '' } : { stato: 'creato', funzione: m[2] };
  }
  return esito;
}

describe('Maria invita Luca scrivendo a mano la riga dell’invito: alla prima consegna nessun credito', () => {
  it('il trigger della consegna non accredita i 5 € finché inviti e punti sono spenti', () => {
    expect(INVITI_E_PUNTI_ACCESI).toBe(false);
    const interruttore = corpoFinale('punti_fedelta_accesi').corpo;
    expect(interruttore, 'nel database manca l’interruttore dei punti').toMatch(/^\s*SELECT\s+false\s*;?\s*$/i);

    const trigger = triggerFinale('trg_reward_referrer_on_delivery');
    if (trigger.stato === 'tolto') return; // nessun trigger sulla consegna: nessun premio
    expect(trigger.stato).toBe('creato');

    const { corpo, dove } = corpoFinale(trigger.funzione);
    expect(corpo, `manca la definizione di ${trigger.funzione}`).not.toBe('');
    const freno = corpo.search(/IF\s+NOT\s+public\.punti_fedelta_accesi\(\)\s+THEN\s+RETURN\s+NEW\s*;/i);
    const credito = corpo.search(/wallet_credit\s*\(/i);
    const invitoConsumato = corpo.search(/UPDATE\s+public\.referrals/i);
    expect(freno, `${dove}: la prima consegna di Luca accredita ancora 5 € a Maria con gli inviti spenti`).toBeGreaterThanOrEqual(0);
    // Il freno deve arrivare PRIMA del credito e prima di segnare l'invito come pagato.
    expect(credito).toBeGreaterThan(freno);
    expect(invitoConsumato).toBeGreaterThan(freno);
  });

  it('e il credito già dato resta spendibile: la 168 non scala né azzera portafogli', () => {
    const sql = migrazioni.find(({ f }) => f.startsWith('168_'))?.sql ?? '';
    expect(sql).not.toBe('');
    expect(sql).not.toMatch(/wallet_debit\s*\(|wallet_balance_cents\s*=|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
});
