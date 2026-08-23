import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statoDellaVista } from '@/lib/stato-vista';

/**
 * SETTE PUNTI DEL SITO DISEGNAVANO L'ASSENZA DI DATI COME SE FOSSE UN DATO.
 *
 * Il caso che costa di più è il carrello. `useState<CartItem[]>([])` parte vuoto, il carrello vero
 * si legge dentro un `useEffect` che React esegue DOPO il primo disegno, e il primo controllo del
 * render è `if (items.length === 0)`. Risultato: **l'HTML che parte dal server contiene «Il tuo
 * carrello è vuoto»**, col pulsante «Esplora i prodotti», a un cliente che il carrello ce l'ha
 * pieno. Al checkout lo stesso ramo precedeva perfino il controllo di caricamento.
 *
 * Gli altri sei hanno la stessa forma: la home che mentre carica mostra un negozio inventato con
 * sei prezzi scritti a mano; le categorie che restano un vuoto sotto il loro titolo, per sempre se
 * la lettura fallisce; «Vicino a te» che su una lettura fallita scrive che a Piacenza non c'è
 * nessun negozio; le notifiche che a un errore di rete buttano la persona sulla pagina di accesso.
 *
 * ── Cosa prova questo file ───────────────────────────────────────────────────────────────────
 * L'invariante che non deve mai rompersi: **«vuoto» non esce senza `letto`**. Non è che diventa
 * improbabile — è irraggiungibile, perché la funzione lo pretende. Sotto c'è una griglia di tutte
 * le combinazioni, e poi i sette punti veri controllati uno per uno.
 */

describe("«vuoto» è un'affermazione sul mondo, e non si fa prima di aver guardato", () => {
  it('il caso del carrello: non letto, zero elementi → carico, mai vuoto', () => {
    const v = statoDellaVista({ letto: false, quanti: 0 });
    expect(v.stato).toBe('carico');
    expect(v.mostraVuoto, 'è il render che stampava «Il tuo carrello è vuoto» a chi ce l\'ha pieno').toBe(false);
    expect(v.mostraScheletro).toBe(true);
  });

  it('letto, zero elementi → adesso «vuoto» si può dire', () => {
    const v = statoDellaVista({ letto: true, quanti: 0 });
    expect(v.stato).toBe('vuoto');
    expect(v.mostraVuoto).toBe(true);
  });

  it('un errore batte tutto: non si dice «vuoto» su una lettura rotta', () => {
    const v = statoDellaVista({ letto: true, quanti: 0, errore: new Error('rete') });
    expect(v.stato, 'è «0 negozi a Piacenza» su una lettura fallita').toBe('rotto');
    expect(v.mostraVuoto).toBe(false);
    expect(v.mostraErrore).toBe(true);
  });

  it('caricando batte «letto»: una rilettura in corso non è un elenco vuoto', () => {
    const v = statoDellaVista({ letto: true, caricando: true, quanti: 0 });
    expect(v.stato).toBe('carico');
  });

  it('con elementi è pieno, e nessuno degli stati speciali si accende', () => {
    const v = statoDellaVista({ letto: true, quanti: 3 });
    expect(v.stato).toBe('pieno');
    expect(v.mostraScheletro).toBe(false);
    expect(v.mostraVuoto).toBe(false);
    expect(v.mostraErrore).toBe(false);
  });

  it('LA GRIGLIA: «vuoto» non esce MAI senza letto, in nessuna combinazione', () => {
    const bugie: string[] = [];
    for (const letto of [true, false]) {
      for (const caricando of [true, false, undefined]) {
        for (const errore of [undefined, null, false, new Error('x')]) {
          for (const quanti of [undefined, 0, 1, 7]) {
            const v = statoDellaVista({ letto, caricando, errore, quanti });
            if (v.stato === 'vuoto' && !letto) bugie.push(JSON.stringify({ letto, caricando, quanti }));
            if (v.stato === 'vuoto' && caricando) bugie.push(`caricando: ${JSON.stringify({ letto, quanti })}`);
            if (v.stato === 'vuoto' && errore instanceof Error) bugie.push(`errore: ${JSON.stringify({ letto, quanti })}`);
            // Ogni verdetto accende al massimo una scorciatoia: due sarebbero due render insieme.
            const accese = [v.mostraScheletro, v.mostraVuoto, v.mostraErrore].filter(Boolean).length;
            expect(accese, `${v.stato} accende ${accese} scorciatoie`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    expect(bugie, 'combinazioni in cui il sito direbbe «vuoto» senza poterlo sostenere').toEqual([]);
  });

  it('un numero storto non diventa «pieno» per sbaglio', () => {
    expect(statoDellaVista({ letto: true, quanti: Number.NaN }).stato).toBe('vuoto');
    expect(statoDellaVista({ letto: true, quanti: -3 }).stato).toBe('vuoto');
  });

  it('il motivo esce sempre, e dice quale delle tre cose è successa', () => {
    expect(statoDellaVista({ letto: false }).perche).toMatch(/nessuno ha ancora letto/);
    expect(statoDellaVista({ letto: true, quanti: 0 }).perche).toMatch(/non c'è niente/);
    expect(statoDellaVista({ letto: true, errore: 'x' }).perche).toMatch(/fallita/);
  });
});

/**
 * ── I SETTE PUNTI VERI ───────────────────────────────────────────────────────────────────────
 * La funzione può essere giusta e non essere chiamata da nessuno: è il modo in cui questo difetto
 * è nato la prima volta. Qui si guarda che ogni punto ci passi, e che le frasi del difetto non
 * siano rimaste nel codice che il cliente vede.
 */
describe('i punti che disegnavano il vuoto ci passano davvero', () => {
  const RADICE = process.cwd();
  const leggi = (p: string) => readFileSync(join(RADICE, p), 'utf8');
  /**
   * Le righe di codice, senza commenti: la storia va potuta raccontare nel codice, e queste prove
   * cercano frasi che nei commenti compaiono apposta per spiegare perche' non ci sono piu'.
   *
   * Filtrare per prefisso di riga NON basta, e mi ha gia' dato un falso rosso: un commento JSX su
   * piu' righe (`{&#47;* … *&#47;}`) ha le righe di mezzo che non cominciano con nessun marcatore.
   * Qui i blocchi si tolgono per esteso, dall'apertura alla chiusura.
   */
  const vive = (p: string) =>
    leggi(p)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((r) => !/^\s*\/\//.test(r))
      .join('\n');

  const PUNTI = [
    'app/cart/page.tsx',
    'app/checkout/page.tsx',
    'components/home/HeroStoreCard.tsx',
    'components/CategoryShowcase.tsx',
  ];

  for (const punto of PUNTI) {
    it(`${punto} chiede il verdetto invece di guardare la lunghezza`, () => {
      expect(leggi(punto)).toContain('statoDellaVista(');
    });
  }

  it('il carrello non decide piu’ sul solo `items.length === 0`', () => {
    expect(vive('app/cart/page.tsx')).not.toMatch(/if \(items\.length === 0\)/);
  });

  it('il checkout non decide piu’ sul solo `cart.length === 0`', () => {
    expect(vive('app/checkout/page.tsx')).not.toMatch(/if \(cart\.length === 0\)/);
  });

  it('il negozio finto della home non esiste piu’ nel codice che il cliente vede', () => {
    const src = vive('components/home/HeroStoreCard.tsx');
    for (const bugia of ['Salumeria del Borgo', 'Via Calzolai', 'Coppa DOP', 'Bresaola', 'oggi, entro 18:00']) {
      expect(src, `«${bugia}» era un dato inventato mostrato come vero`).not.toContain(bugia);
    }
  });

  it('«Vicino a te» fa emergere l’errore invece di ingoiarlo', () => {
    const src = leggi('app/near/page.tsx');
    expect(src, "l'errore della lettura negozi va letto e lanciato").toMatch(/error: erroreNegozi/);
    expect(src).toMatch(/if \(erroreNegozi\) throw erroreNegozi/);
    expect(src, 'e la pagina deve saper disegnare il caso rotto').toMatch(/isError/);
  });

  it('le notifiche distinguono «non sei collegato» da «la rete è storta»', () => {
    const src = leggi('app/notifications/page.tsx');
    expect(src).toMatch(/AUTH_REQUIRED/);
    expect(src, 'un errore qualsiasi non deve piu’ buttare fuori la persona').toMatch(/error && !serveAccesso/);
    expect(src).toMatch(/ErrorState/);
  });

  it('la home non lascia piu’ il titolo delle categorie sopra un vuoto', () => {
    // Il titolo sta nel figlio, perche' e' l'unico che sa se c'e' qualcosa sotto: `MaybeSection`
    // decide guardando il testo, e un titolo statico nel renderer e' testo.
    expect(leggi('components/CategoryShowcase.tsx')).toMatch(/titolo\?: string/);
    expect(leggi('components/home-sections/HomeSectionRenderer.tsx')).toMatch(/<CategoryShowcase\s+titolo=/);
  });
});
