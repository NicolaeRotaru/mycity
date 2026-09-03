import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 3/9/2026 — LE PAGINE PREPARATE IN ANTICIPO ARRIVAVANO AL BROWSER SENZA
 * JAVASCRIPT.
 *
 * Cosa succedeva, in parole semplici. Il portiere del sito (`middleware.ts`)
 * mette su ogni risposta una regola di sicurezza che dice al browser quali
 * script può eseguire. La regola chiede una parola d'ordine — un `nonce` —
 * diversa a ogni richiesta, e con `strict-dynamic` quella parola d'ordine
 * diventa l'unico modo per passare: l'origine del sito non basta più.
 *
 * Next sa scrivere quella parola dentro i tag `<script>` solo mentre costruisce
 * la pagina per QUELLA richiesta. Una pagina preparata in anticipo è stata
 * scritta prima, quando la parola d'ordine non esisteva ancora. Quindi i suoi
 * script non ce l'hanno, il browser li rifiuta tutti, React non si attacca mai
 * e al cliente resta un guscio: niente accesso, niente carrello, niente cassa.
 *
 * Misurato il 3/9/2026 su una build di produzione vera: 95 pagine preparate in
 * anticipo su 95 arrivavano così — l'accesso, la registrazione, la ricerca, i
 * negozi, il carrello, la cassa, il pannello del negoziante, quello di chi
 * amministra, e la pagina 404. In sviluppo non si vedeva, perché lì la regola
 * ammette gli script in linea: per questo il difetto è vissuto tanto.
 *
 * COSA SORVEGLIA QUESTA PROVA. Non una parola scritta in un file: le due cose
 * che devono restare d'accordo.
 *   ① la regola di produzione, presa chiamando il portiere vero;
 *   ② il modo in cui il sito costruisce le pagine, letto dal riquadro
 *      principale (`app/layout.tsx`) e da chi potrebbe contraddirlo sotto.
 * Se qualcuno rimette le pagine «preparate in anticipo» lasciando la regola
 * com'è, questa prova diventa rossa. Se qualcuno ammorbidisce la regola per
 * far tornare il verde, diventa rossa lo stesso: la sicurezza non si abbassa
 * per far funzionare il sito.
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

const RADICE = join(__dirname, '..', '..');

/** I modi con cui Next costruisce la pagina al momento della richiesta. */
const RESA_AL_MOMENTO = ['force-dynamic'];

/**
 * La regola di sicurezza che il sito manda davvero in produzione: non una
 * copia scritta qui, ma quella che esce dal portiere vero.
 */
async function regolaDiProduzione(percorso = '/cart'): Promise<string> {
  vi.stubEnv('NODE_ENV', 'production');
  const res = await middleware(new NextRequest(new URL(`https://mycity.test${percorso}`)));
  const regola = res.headers.get('content-security-policy') ?? '';
  return regola;
}

function direttivaScript(regola: string): string {
  return regola.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
}

/** Un tag `<script>` che il browser eseguirebbe (non i dati tipo ld+json). */
function eEseguibile(tag: string): boolean {
  const tipo = /\btype="([^"]*)"/.exec(tag)?.[1]?.toLowerCase();
  if (!tipo) return true;
  return ['text/javascript', 'application/javascript', 'module'].includes(tipo);
}

/**
 * Decide come deciderebbe il browser: dato il pezzo `script-src` della regola e
 * un tag `<script>`, quel tag gira o viene rifiutato?
 *
 * Le due sottigliezze che contano, ed è dove il difetto si nascondeva:
 *  - con `strict-dynamic` il browser IGNORA `'self'` e la lista degli
 *    indirizzi: resta solo la parola d'ordine;
 *  - quando nella regola c'è una parola d'ordine, `'unsafe-inline'` viene
 *    ignorato (è solo un ripiego per i browser vecchi).
 */
function girerebbe(direttiva: string, tag: string): boolean {
  if (!eEseguibile(tag)) return false;
  const parolaDellaRegola = /'nonce-([^']+)'/.exec(direttiva)?.[1];
  const parolaDelTag = /\bnonce="([^"]*)"/.exec(tag)?.[1];
  if (parolaDellaRegola && parolaDelTag === parolaDellaRegola) return true;
  if (direttiva.includes("'strict-dynamic'")) return false;

  const indirizzo = /\bsrc="([^"]*)"/.exec(tag)?.[1];
  if (indirizzo !== undefined) {
    return direttiva.includes("'self'") && indirizzo.startsWith('/');
  }
  return direttiva.includes("'unsafe-inline'") && !parolaDellaRegola;
}

function tagScript(documento: string): string[] {
  return [...documento.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
}

/**
 * Com'è fatta davvero una pagina che Next prepara in anticipo: i pezzi di
 * codice vengono chiamati per indirizzo, e i dati della pagina arrivano in
 * blocchi scritti dentro il documento. Nessuno dei due porta una parola
 * d'ordine, perché quando la pagina è stata scritta non esisteva ancora.
 * (Campionato il 3/9/2026 da `.next/server/app/sign-in.html`: 36 tag con
 * indirizzo, 40 in linea, zero parole d'ordine.)
 */
const PAGINA_PREPARATA_IN_ANTICIPO = [
  '<script src="/_next/static/chunks/main-app-f43effa4c9faae07.js" async=""></script>',
  '<script src="/_next/static/chunks/8359-644485a9123e7217.js" async=""></script>',
  '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
  '<script>self.__next_f.push([1,"1:\\"$Sreact.fragment\\"\\n"])</script>',
].join('\n');

function file(percorso: string): string {
  return readFileSync(join(RADICE, percorso), 'utf8');
}

/** Il modo di resa dichiarato in un file, se ce n'è uno. */
function resaDichiarata(sorgente: string): string | undefined {
  return /^\s*export\s+const\s+dynamic\s*=\s*['"]([^'"]+)['"]/m.exec(sorgente)?.[1];
}

function fileDelSito(cartella: string, trovati: string[] = []): string[] {
  for (const voce of readdirSync(join(RADICE, cartella))) {
    const relativo = join(cartella, voce);
    if (statSync(join(RADICE, relativo)).isDirectory()) fileDelSito(relativo, trovati);
    else if (/^(page|layout)\.tsx$/.test(voce)) trovati.push(relativo);
  }
  return trovati;
}

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.unstubAllEnvs());

describe('nessuna pagina arriva al browser senza il suo javascript', () => {
  it('in produzione la regola lascia passare uno script SOLO con la parola d\'ordine della richiesta', async () => {
    const direttiva = direttivaScript(await regolaDiProduzione());

    expect(direttiva, 'la regola di produzione non dice niente sugli script').not.toBe('');
    expect(/'nonce-[^']+'/.test(direttiva), direttiva).toBe(true);
    expect(direttiva).toContain("'strict-dynamic'");

    // Il lato sicurezza: non si torna agli script in linea liberi per far
    // funzionare il sito. Se qualcuno ci prova, questa riga diventa rossa.
    expect(
      direttiva.includes("'unsafe-inline'"),
      'la regola di produzione si è ammorbidita: con unsafe-inline qualunque script iniettato nella pagina gira',
    ).toBe(false);
  });

  it('con quella regola, una pagina preparata in anticipo non esegue nemmeno uno script', async () => {
    const direttiva = direttivaScript(await regolaDiProduzione());
    const tag = tagScript(PAGINA_PREPARATA_IN_ANTICIPO);
    const vivi = tag.filter((t) => girerebbe(direttiva, t));

    expect(tag.length).toBeGreaterThan(0);
    expect(
      vivi,
      'se qui girasse qualcosa, il modello del browser sarebbe sbagliato e questa prova non proverebbe niente',
    ).toEqual([]);
  });

  it('per questo il riquadro principale dichiara che ogni pagina si costruisce al momento della richiesta', async () => {
    const direttiva = direttivaScript(await regolaDiProduzione());
    const serveLaParolaDordine =
      /'nonce-[^']+'/.test(direttiva) && direttiva.includes("'strict-dynamic'");
    if (!serveLaParolaDordine) return; // regola cambiata: il vincolo non c'è più

    const resa = resaDichiarata(file('app/layout.tsx'));
    expect(
      resa && RESA_AL_MOMENTO.includes(resa) ? resa : undefined,
      "app/layout.tsx non dichiara `export const dynamic = 'force-dynamic'`: le pagine tornano a essere " +
        'preparate in anticipo e arrivano al cliente senza javascript (accesso, carrello e cassa compresi)',
    ).toBeDefined();
  });

  it('e nessuna pagina sotto il riquadro principale torna a farsi preparare in anticipo', async () => {
    const direttiva = direttivaScript(await regolaDiProduzione());
    if (!/'nonce-[^']+'/.test(direttiva) || !direttiva.includes("'strict-dynamic'")) return;

    const ribelli = fileDelSito('app')
      .filter((f) => f !== join('app', 'layout.tsx'))
      .map((f) => ({ f, resa: resaDichiarata(file(f)) }))
      .filter((x) => x.resa !== undefined && !RESA_AL_MOMENTO.includes(x.resa))
      .map((x) => `${x.f} → ${x.resa}`);

    expect(
      ribelli,
      'queste pagine si fanno preparare in anticipo: i loro script non avranno la parola d\'ordine',
    ).toEqual([]);
  });

  it('nella build vera non resta nessuna pagina preparata in anticipo che arriverebbe senza script', async () => {
    const cartella = join(RADICE, '.next', 'server', 'app');
    if (!existsSync(cartella)) {
      // Nessuna build da guardare: lo diciamo invece di far finta di aver
      // controllato. Le prove qui sopra reggono da sole, senza build.
      console.warn(
        '[prova] nessuna build in .next: il controllo sull\'HTML vero non è stato fatto. Gira `npm run build` per averlo.',
      );
      return;
    }

    const morte: string[] = [];
    const cammina = (dir: string) => {
      for (const voce of readdirSync(dir)) {
        const p = join(dir, voce);
        if (statSync(p).isDirectory()) cammina(p);
        else if (voce.endsWith('.html')) {
          const tag = tagScript(readFileSync(p, 'utf8')).filter(eEseguibile);
          if (tag.length > 0 && !tag.some((t) => /\bnonce="/.test(t))) {
            morte.push(`${p.slice(cartella.length + 1)} (${tag.length} script, zero parole d'ordine)`);
          }
        }
      }
    };
    cammina(cartella);

    expect(
      morte,
      'queste pagine sono state scritte prima della richiesta: il browser rifiuterà tutti i loro script',
    ).toEqual([]);
  });
});
