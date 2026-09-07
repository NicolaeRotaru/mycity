import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 6/9/2026 — SULLA PAGINA «SEI OFFLINE» IL PULSANTE «RIPROVA» NON FACEVA NIENTE.
 *
 * In parole semplici. Quando la rete cade, il sito mostra una pagina di scorta
 * (`public/offline.html`) con un solo pulsante: «Riprova». Quel pulsante era
 * scritto così: `<button onclick="location.reload()">`, cioè col codice dentro
 * l'attributo. Il portiere del sito (`middleware.ts`) mette su ogni risposta una
 * regola di sicurezza che in produzione vale `script-src 'self' 'nonce-…'
 * 'strict-dynamic'`: niente `unsafe-inline`, niente `unsafe-hashes`. Con quella
 * regola il browser **rifiuta per definizione** il codice scritto negli
 * attributi. Risultato: la persona è già senza rete, tocca l'unico pulsante
 * disponibile e non succede nulla.
 *
 * Perché nessuno se n'era accorto: i file dentro `public/` non passano dai test
 * delle pagine, perché non sono pagine di Next.
 *
 * COSA SORVEGLIA QUESTA PROVA. Le due cose che devono restare d'accordo:
 *   ① la regola di sicurezza vera, presa chiamando il portiere vero;
 *   ② le pagine statiche di `public/`, lette dal disco.
 * Se qualcuno rimette un gestore in linea (`onclick=…`) o uno `<script>` senza
 * parola d'ordine dentro una pagina statica, questa prova diventa rossa. Se
 * invece qualcuno ammorbidisce la regola per farli funzionare, la prova lo
 * dice: la sicurezza non si abbassa per far tornare un pulsante.
 */

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

const PUBBLICA = join(__dirname, '..', '..', 'public');

/** La direttiva `script-src` che il sito manda davvero in produzione. */
async function direttivaScriptDiProduzione(percorso: string): Promise<string> {
  vi.stubEnv('NODE_ENV', 'production');
  const res = await middleware(new NextRequest(new URL(`https://mycity.test${percorso}`)));
  const regola = res.headers.get('content-security-policy') ?? '';
  return regola.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
}

/** Il browser eseguirebbe un gestore scritto in un attributo (`onclick=…`)? */
function ammetteGestoriInLinea(direttiva: string): boolean {
  return direttiva.includes("'unsafe-hashes'") || direttiva.includes("'unsafe-inline'");
}

function gestoriInLinea(documento: string): string[] {
  return [...documento.matchAll(/\son[a-z]+\s*=\s*"[^"]*"/gi)].map((m) => m[0].trim());
}

function scriptSenzaIndirizzo(documento: string): string[] {
  return [...documento.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/gi)].map((m) => m[0]);
}

const pagineStatiche = readdirSync(PUBBLICA)
  .filter((f) => f.endsWith('.html'))
  .map((f) => ({ nome: f, testo: readFileSync(join(PUBBLICA, f), 'utf8') }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('le pagine statiche di public/ funzionano sotto la regola di sicurezza vera', () => {
  it('in produzione la regola non ammette il codice scritto negli attributi', async () => {
    const direttiva = await direttivaScriptDiProduzione('/offline.html');
    expect(direttiva).not.toBe('');
    expect(ammetteGestoriInLinea(direttiva)).toBe(false);
  });

  it('nessuna pagina statica dipende da codice che il browser rifiuterebbe', async () => {
    const direttiva = await direttivaScriptDiProduzione('/offline.html');
    if (ammetteGestoriInLinea(direttiva)) return; // regola cambiata: qui non c'è più difetto

    for (const { nome, testo } of pagineStatiche) {
      expect(gestoriInLinea(testo), `${nome}: gestore in linea rifiutato dalla regola`).toEqual([]);
      expect(scriptSenzaIndirizzo(testo), `${nome}: script in linea senza parola d'ordine`).toEqual([]);
    }
  });

  it('la pagina «Sei offline» offre un modo di riprovare che non ha bisogno di JavaScript', () => {
    const offline = pagineStatiche.find((p) => p.nome === 'offline.html');
    expect(offline, 'public/offline.html non trovata').toBeTruthy();
    const link = [...offline!.testo.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
    expect(link.length, 'nessun link: senza JavaScript la pagina non ha vie d\'uscita').toBeGreaterThan(0);
    expect(link.some(([, , testo]) => /riprova/i.test(testo))).toBe(true);
  });
});
