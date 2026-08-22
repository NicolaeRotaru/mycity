import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * IL FRENO CHE MANCAVA QUANDO IL SITO E' PASSATO DA RENDER A VERCEL.
 *
 * Su Render i lavori periodici li faceva partire un servizio esterno
 * (cron-job.org) con un POST, e l'elenco viveva in un file di documentazione
 * che nessun controllo leggeva. Su Vercel li fa partire Vercel: l'elenco sta in
 * `vercel.json`, e Vercel bussa **solo in GET**.
 *
 * Due modi di rompere tutto in silenzio, che nessuna prova vedeva:
 *
 *   ① una rotta sotto app/api/cron/ che esporta solo POST → Vercel si prende un
 *     «405 metodo non ammesso» a ogni giro. Il lavoro risulta partito, e non ha
 *     fatto niente. Cinque rotte su nove erano cosi'.
 *   ② una rotta nuova che nessuno aggiunge a vercel.json → non parte mai. Non
 *     c'e' errore da nessuna parte: semplicemente, quel pezzo di marketplace
 *     smette di funzionare e te ne accorgi dai soldi.
 *
 * Questa prova diventa rossa in tutti e due i casi. Non cerca parole in un
 * file: legge le rotte che esistono davvero sul disco e le confronta con quelle
 * che Vercel andra' a chiamare.
 */

const RADICE = process.cwd();
const CARTELLA_CRON = join(RADICE, 'app/api/cron');

type Cron = { path: string; schedule: string };

/**
 * Via i commenti prima di cercare l'export.
 *
 * Senza questo passaggio la prova si lasciava ingannare da una riga commentata:
 * `// export const GET = POST;` la faceva passare come se il GET ci fosse. Cioe'
 * proprio il modo piu' probabile in cui uno lo toglierebbe.
 */
function senzaCommenti(sorgente: string): string {
  return sorgente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function vercelJson(): { crons?: Cron[]; functions?: Record<string, { maxDuration?: number }> } {
  return JSON.parse(readFileSync(join(RADICE, 'vercel.json'), 'utf8'));
}

function rotteSulDisco(): string[] {
  return readdirSync(CARTELLA_CRON, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CARTELLA_CRON, d.name, 'route.ts')))
    .map((d) => d.name)
    .sort();
}

describe('lavori periodici: quello che c\'e\' sul disco e quello che Vercel chiama', () => {
  it('ogni rotta cron e\' elencata in vercel.json', () => {
    const attese = rotteSulDisco().map((n) => `/api/cron/${n}`);
    const dichiarate = (vercelJson().crons ?? []).map((c) => c.path).sort();
    expect(dichiarate).toEqual(attese.sort());
  });

  it('vercel.json non chiama rotte che non esistono', () => {
    const esistenti = new Set(rotteSulDisco());
    for (const c of vercelJson().crons ?? []) {
      const nome = c.path.replace('/api/cron/', '');
      expect(esistenti.has(nome), `vercel.json chiama /api/cron/${nome}, che sul disco non c'e'`).toBe(true);
    }
  });

  it('ogni rotta cron risponde al GET: e\' l\'unico verso in cui Vercel bussa', () => {
    for (const nome of rotteSulDisco()) {
      const sorgente = senzaCommenti(readFileSync(join(CARTELLA_CRON, nome, 'route.ts'), 'utf8'));
      const haGet = /export\s+(const|async\s+function)\s+GET\b/.test(sorgente);
      expect(haGet, `app/api/cron/${nome}/route.ts non esporta GET: Vercel prenderebbe 405 a ogni giro`).toBe(true);
    }
  });

  it('le cadenze sono espressioni cron a cinque campi', () => {
    for (const c of vercelJson().crons ?? []) {
      const campi = c.schedule.trim().split(/\s+/);
      expect(campi, `cadenza malformata per ${c.path}: "${c.schedule}"`).toHaveLength(5);
    }
  });

  it('i lavori periodici hanno un tetto di durata dichiarato', () => {
    // Senza, valgono il tetto predefinito del piano: un giro lungo — la coda
    // email piena dopo un guasto, i payout di un weekend — viene troncato a
    // meta' senza che nessuno lo dica.
    const funzioni = vercelJson().functions ?? {};
    const tetto = funzioni['app/api/cron/**/route.ts']?.maxDuration;
    expect(tetto, 'manca maxDuration per app/api/cron/**/route.ts in vercel.json').toBeGreaterThan(0);
  });

  it('la regione delle funzioni sta vicino al database (Supabase e\' a Parigi, eu-west-3)', () => {
    // Il 22/8/2026 l'intestazione x-vercel-id della produzione diceva `iad1`:
    // Washington. Ogni pagina del sito attraversava l'Atlantico per parlare col
    // database, due volte, a ogni query.
    const regioni: string[] = (vercelJson() as { regions?: string[] }).regions ?? [];
    expect(regioni).toContain('cdg1');
  });
});
