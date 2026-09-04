/**
 * Ogni visita alla home ripartiva da capo a interrogare il database.
 *
 * IL CASO, come lo si vede in bolletta. Il precarico — fatto pochi giorni fa — ha tolto i viaggi di
 * rete del BROWSER: la pagina parte già piena invece di riempirsi dopo. Ma la lettura al database
 * c'è ancora: l'ha solo fatta il server al posto del telefono, e la rifaceva a OGNI visita. Due
 * domande per ogni persona che apre la home — com'è composta la pagina, quali sono le categorie — e
 * due risposte identiche per tutti.
 *
 * Cento persone nello stesso minuto erano duecento letture per ottenere due risultati. Il conto
 * cresce col numero di VISITATORI, non col numero di ordini: un articolo che finisce sui social e
 * porta diecimila curiosi in un pomeriggio costa come diecimila clienti, e non ne ha portato
 * nemmeno uno. Era la curva che nessuno spezzava, e la squadra della scheda prodotto l'aveva
 * lasciato scritto: il pezzo che pesa non è il precarico, è la cache.
 *
 * LA CURA, in un numero solo. Sessanta secondi, scritti in un posto solo, che valgono per due cose:
 * l'intestazione che le rotte pubbliche mandano al browser e alla rete di consegna, e la memoria
 * del server davanti alle letture della home. Se un domani si cambia idea, si cambia lì.
 *
 * ⚠️ LA RIGA CHE NON VA TOLTA. Questo vale SOLO su quello che è uguale per tutti. Una risposta che
 * dipende da chi la chiede — un carrello, un ordine, un profilo — dietro una cache condivisa
 * finisce in mano alla persona dopo. È già successo una volta in questa casa, col service worker.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CACHE_CONTROL_CATALOGO_PUBBLICO,
  SECONDI_CATALOGO_FRESCO,
  SECONDI_CATALOGO_RIPIEGO,
  intestazioniCatalogoPubblico,
  rispostaCatalogoNonRiuscita,
  rispostaCatalogoPubblico,
} from '@/lib/queries/cache-pubblica';

const RADICE = process.cwd();
const leggi = (p: string) => readFileSync(join(RADICE, p), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// ① La funzione che costruisce le intestazioni: eseguita, non cercata.
// ─────────────────────────────────────────────────────────────────────────────

describe("l'intestazione che dice per quanto vale una risposta", () => {
  it('dichiara i sessanta secondi, e li dichiara come pubblici', () => {
    const h = intestazioniCatalogoPubblico();
    // `public` è la parola che autorizza la rete di consegna a tenerne UNA copia per tutti.
    // Senza, la tiene solo il browser di chi ha chiesto: cioè la curva non si spezza.
    expect(h['Cache-Control']).toContain('public');
    expect(h['Cache-Control']).toContain(`s-maxage=${SECONDI_CATALOGO_FRESCO}`);
    expect(SECONDI_CATALOGO_FRESCO).toBe(60);
  });

  it('dice anche cosa fare quando i sessanta secondi sono passati', () => {
    // È il pezzo che nessuno guarda e che conta. Senza `stale-while-revalidate`, allo scadere del
    // minuto tutte le visite in corso si fermano insieme ad aspettare la stessa lettura: il picco
    // lo si crea invece di toglierlo.
    const h = intestazioniCatalogoPubblico();
    expect(h['Cache-Control']).toContain(`stale-while-revalidate=${SECONDI_CATALOGO_RIPIEGO}`);
    expect(SECONDI_CATALOGO_RIPIEGO).toBeGreaterThan(SECONDI_CATALOGO_FRESCO);
  });

  it('la risposta vera porta davvero quell intestazione, non solo l oggetto', () => {
    const r = rispostaCatalogoPubblico([{ id: 'x', name: 'Alimentari' }]);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(CACHE_CONTROL_CATALOGO_PUBBLICO);
    expect(r.headers.get('content-type')).toContain('application/json');
  });

  it('un guasto NON si mette in cache', () => {
    // Un errore tenuto per un minuto è un minuto di sito rotto per tutti, quando magari il guasto
    // è durato un istante.
    const r = rispostaCatalogoNonRiuscita();
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('cache-control')).not.toContain('s-maxage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② La rotta vera, eseguita: risponde con le categorie e con la scadenza giusta.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIE = [
  { id: '2', slug: 'casa', name: 'Casa', icon: null, sort_order: 2, featured: false },
  { id: '1', slug: 'alimentari', name: 'Alimentari', icon: null, sort_order: 1, featured: true },
];

const letture = vi.fn();

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: (tabella: string) => {
      letture(tabella);
      return { select: () => ({ is: () => Promise.resolve({ data: CATEGORIE, error: null }) }) };
    },
  }),
}));

describe('la rotta pubblica delle categorie', () => {
  beforeEach(() => letture.mockClear());

  it('risponde con le categorie e con la scadenza attaccata', async () => {
    const { GET } = await import('@/app/api/catalogo/categorie/route');
    const r = await GET();

    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control'), 'la rotta non dice per quanto vale la risposta')
      .toBe(CACHE_CONTROL_CATALOGO_PUBBLICO);

    // La forma della risposta è quella che la pagina si aspetta: ordinata come la ordina
    // `domandaCategorie` (prima le in evidenza), non come esce dal database.
    const corpo = await r.json();
    expect(corpo.map((c: { slug: string }) => c.slug)).toEqual(['alimentari', 'casa']);
    expect(letture).toHaveBeenCalledWith('categories');
  });

  it("non porta niente di personale: è la condizione per poterla dare a tutti", async () => {
    // Nessun cookie, nessuna sessione, nessun nome. Va riletto ogni volta che si aggiunge una
    // colonna a questa risposta: è la riga che separa «una copia per tutti» da «i dati di uno
    // in mano a un altro».
    const src = leggi('app/api/catalogo/categorie/route.ts');
    expect(src, 'la rotta legge i cookie: non può stare in una cache condivisa').not.toMatch(/\bcookies\b/);
    expect(src, 'la rotta usa il client con la sessione').not.toContain('getServerSupabase');
    expect(src).toContain('creaClientAnonimo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ La home non rilegge più il database a ogni visita.
// ─────────────────────────────────────────────────────────────────────────────

describe('le due letture della home stanno dietro lo stesso numero', () => {
  const HOME = leggi('app/page.tsx');

  it('sia la composizione della pagina sia il precarico hanno una memoria', () => {
    // Erano due letture per ogni visita. Adesso sono due letture ogni sessanta secondi, per tutti.
    expect(HOME, 'la home non tiene niente in memoria').toContain('unstable_cache');
    const quante = (HOME.match(/unstable_cache\(/g) || []).length;
    expect(quante, 'una delle due letture della home riparte ancora a ogni visita').toBe(2);
  });

  it('la durata è lo stesso numero delle rotte pubbliche, non una copia', () => {
    // Due numeri scritti a mano in due file diventano due numeri diversi al primo ripensamento,
    // e una cache che non funziona non da' nessun errore: semplicemente non fa niente.
    expect(HOME).toContain('SECONDI_CATALOGO_FRESCO');
    expect(HOME, 'la durata è scritta a mano invece di venire dal file unico')
      .not.toMatch(/revalidate:\s*\d+/);
  });

  it('la lettura tenuta in memoria non guarda i cookie di chi ha chiesto', () => {
    // È il modo in cui questa cura si rompe: una lettura fatta con la sessione di UNA persona,
    // tenuta per sessanta secondi, è la risposta di quella persona riusata per la successiva.
    // Next lo vieta e ferma la pagina — ed è giusto che la fermi.
    expect(HOME, 'la home usa ancora il client con i cookie').not.toContain('getServerSupabase');
    expect(HOME).toContain('creaClientAnonimo');
  });
});
