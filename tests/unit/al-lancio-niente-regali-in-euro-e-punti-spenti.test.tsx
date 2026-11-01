/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';

/**
 * 31/10/2026 — AL LANCIO NIENTE REGALI IN EURO, E I PUNTI SONO SPENTI DAVVERO.
 *
 * Decisione del 6/7 (Punti e Buoni regalo «armati, non lanciati») e carta #209 del 26/10
 * («nessun regalo in euro al lancio»). Il database li teneva accesi per tutti:
 *  ① Luca si iscrive: riceve 100 punti e la notifica «€5 di sconto sul primo ordine, si
 *     applicano automaticamente al checkout quando spendi almeno €10». La cassa non li
 *     applica; se li converte diventano 5 € di credito senza soglia e senza limite al primo
 *     ordine: un ordine da 4 € in contrassegno lo paga MyCity per intero.
 *  ② Maria fa un ordine da 40 €: alla consegna 40 punti, e 100 punti = 5 € — il 5% di ogni
 *     ordine restituito, che nessuno ha approvato e nessun negozio paga.
 *
 * Le migrazioni le applica una persona, a mano: qui non c'è un Postgres da interrogare. Si
 * ricostruisce lo STATO FINALE leggendo i file in ordine, come li applicherebbe il database
 * (l'ultimo CREATE/DROP vince, l'ultima definizione di una funzione è quella che gira), e su
 * quello stato si fanno le domande. Poi si montano le pagine vere di Punti e Badge e si
 * guarda cosa legge Maria.
 */

const radice = process.cwd();
const CARTELLA = join(radice, 'migrations');
const migrazioni = readdirSync(CARTELLA)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
  .map((f) => ({ f, sql: readFileSync(join(CARTELLA, f), 'utf8').replace(/--[^\n]*/g, '') }));

/** L'ultima cosa che le migrazioni fanno al trigger: 'creato' o 'tolto'. */
function statoFinaleDelTrigger(nome: string): { stato: 'creato' | 'tolto' | 'mai'; dove: string } {
  let esito: { stato: 'creato' | 'tolto' | 'mai'; dove: string } = { stato: 'mai', dove: '' };
  const re = new RegExp(`\\b(CREATE(?:\\s+OR\\s+REPLACE)?|DROP)\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?${nome}\\b`, 'gi');
  for (const { f, sql } of migrazioni) {
    for (const m of sql.matchAll(re)) {
      esito = { stato: /^DROP/i.test(m[1]) ? 'tolto' : 'creato', dove: f };
    }
  }
  return esito;
}

/** Il corpo dell'ULTIMA definizione di una funzione: quello che il database esegue davvero. */
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

/** Dove sta, nel corpo, il primo punto che soddisfa `re` (−1 se non c'è). */
const posizione = (corpo: string, re: RegExp) => corpo.search(re);

describe('il database: nessun regalo in euro e nessun punto nuovo finché i punti sono spenti', () => {
  it('l’interruttore dei punti nel database dice la stessa cosa di quello del sito', () => {
    const { corpo, dove } = corpoFinale('punti_fedelta_accesi');
    expect(corpo, 'manca l’interruttore dei punti nel database').not.toBe('');
    const valore = /^\s*SELECT\s+(true|false)\s*;?\s*$/i.exec(corpo)?.[1]?.toLowerCase();
    expect(valore, `${dove}: l’interruttore deve essere un SELECT true/false`).toBeDefined();
    expect(valore === 'true', 'database e lib/funzioni-al-lancio.ts devono dire la stessa cosa').toBe(INVITI_E_PUNTI_ACCESI);
  });

  it('Luca si iscrive: il regalo di benvenuto (100 punti e la notifica dei «€5») non parte più', () => {
    expect(INVITI_E_PUNTI_ACCESI).toBe(false);
    const { stato, dove } = statoFinaleDelTrigger('trg_profile_welcome_bonus');
    expect(stato, `l’ultima migrazione che tocca il trigger del benvenuto (${dove}) lo lascia acceso`).toBe('tolto');
  });

  it('Maria riceve un ordine da 40 €: award_loyalty_points non accredita punti nuovi', () => {
    const { corpo, dove } = corpoFinale('award_loyalty_points');
    // Il freno: un punto in più esce subito se l'interruttore è spento…
    const freno = posizione(corpo, /IF\s+p_delta\s*>\s*0\s+AND\s+NOT\s+public\.punti_fedelta_accesi\(\)\s+THEN\s+RETURN\s*;/i);
    // …PRIMA di toccare il saldo: dopo sarebbe un freno che arriva a punti già scritti.
    const scrittura = posizione(corpo, /INSERT\s+INTO\s+public\.loyalty_accounts/i);
    expect(freno, `${dove}: award_loyalty_points accredita punti anche con i punti spenti`).toBeGreaterThanOrEqual(0);
    expect(scrittura).toBeGreaterThan(freno);
  });

  it('nessun’altra funzione scrive punti senza passare da award_loyalty_points', () => {
    // Se un domani una migrazione aggiungesse punti a mano, il freno qui sopra non la vedrebbe.
    const fuori = migrazioni
      .filter(({ sql }) => /points_balance\s*=\s*[^,;]*\+/i.test(sql) || /INSERT\s+INTO\s+public\.loyalty_transactions/i.test(sql))
      .map(({ f }) => f)
      .filter((f) => !/^(027|168)_/.test(f));
    expect(fuori).toEqual([]);
  });

  it('Luca prova a convertire i punti: convert_loyalty_to_credit non crea credito', () => {
    const { corpo, dove } = corpoFinale('convert_loyalty_to_credit');
    const freno = posizione(corpo, /IF\s+NOT\s+public\.punti_fedelta_accesi\(\)\s+THEN\s+RAISE\s+EXCEPTION/i);
    const credito = posizione(corpo, /wallet_credit\s*\(/i);
    expect(freno, `${dove}: la conversione crea 5 € di credito anche con i punti spenti`).toBeGreaterThanOrEqual(0);
    expect(credito).toBeGreaterThan(freno);
  });

  it('e non si toglie niente a nessuno: la 168 non cancella né azzera punti o credito', () => {
    const sql = migrazioni.find(({ f }) => f.startsWith('168_'))?.sql ?? '';
    expect(sql).not.toBe('');
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.(loyalty_accounts|profiles|notifications)\b/i);
  });
});

/* ------------------------------------------------------------------------------------------
 * Le pagine che Maria apre.
 * ---------------------------------------------------------------------------------------- */

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;
const EURO = /€\s*\d/;
let Punti: Pagina;
let Badge: Pagina;
const montate: Array<{ smonta: () => void; radice: Element }> = [];

beforeAll(async () => {
  Punti = (await monta('app/profile/loyalty/page.tsx')).default as Pagina;
  Badge = (await monta('app/profile/achievements/page.tsx')).default as Pagina;
}, 120000);

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

const chiave = (o: unknown) => JSON.stringify((o as { queryKey?: unknown })?.queryKey ?? []);

describe('la pagina dei punti con i punti spenti', () => {
  it('Maria ha 140 punti: nessuna cifra in euro, nessun «converti», nessun «+1 pt per ogni €1»', async () => {
    g.__UTENTE__ = { id: 'maria-1', email: 'maria@example.it' };
    g.__DATI_QUERY__ = (o: unknown) => {
      const k = chiave(o);
      if (k.includes('"account"')) {
        return { user_id: 'maria-1', points_balance: 140, lifetime_earned: 140, tier: 'bronze', streak_days: 2, last_visit_date: null, longest_streak: 3 };
      }
      if (k.includes('"wallet"')) return 0;
      return [];
    };
    const s = accendi(Punti);
    montate.push(s);
    await aspettaChe(() => /140/.test(testoVisibile(s.radice)));
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina dei punti non si è disegnata').toMatch(/140/);
    expect(testo).not.toMatch(EURO);
    expect(testo).not.toMatch(/punti\s*=\s*€|di sconto disponibili|per ogni €|accumulare bonus/i);
    const bottoni = Array.from(s.radice.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(bottoni.filter((t) => /convert/i.test(t))).toEqual([]);
    expect(testo).toMatch(/non sono ancora attivi|in pausa/i);
  });
});

describe('la pagina dei badge con i punti spenti', () => {
  it('Maria apre i badge: nessun «+50 pt», nessuna promessa di punti extra', async () => {
    g.__UTENTE__ = { id: 'maria-1', email: 'maria@example.it' };
    g.__DATI_QUERY__ = (o: unknown) => {
      const k = chiave(o);
      if (k.includes('achievements-all')) {
        return [
          { id: 'first_order', title: 'Primo ordine', description: 'Il tuo primo ordine consegnato', icon: '🛍️', points_reward: 50, tier: 'bronze', target_role: 'buyer', sort_order: 1 },
        ];
      }
      return new Set<string>(['first_order']);
    };
    const s = accendi(Badge);
    montate.push(s);
    await aspettaChe(() => /Primo ordine/.test(testoVisibile(s.radice)));
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina dei badge non si è disegnata').toMatch(/Primo ordine/);
    expect(testo).not.toMatch(/\+\s*50\s*pt/i);
    expect(testo).not.toMatch(/guadagnare punti/i);
  });
});
