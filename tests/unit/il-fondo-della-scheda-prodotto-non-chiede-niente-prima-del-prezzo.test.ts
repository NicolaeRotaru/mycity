/**
 * 3/9/2026 — APRENDO UNA SCHEDA PRODOTTO PARTIVANO DIECI DOMANDE AL DATABASE INSIEME.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────
 * Tre nella pagina (prodotto, varianti, recensioni) e sette nei componenti. Quattro di quelle
 * sette riguardavano sezioni che stanno in fondo — «spesso comprati insieme», «domande e
 * risposte», «visti di recente», «prodotti simili» — e nessuna aspettava di essere raggiunta: le
 * uniche condizioni erano «esiste l'id del prodotto», «esiste l'id dell'utente». Su rete mobile
 * quelle quattro occupavano le connessioni nell'istante esatto in cui dovevano arrivare il prezzo
 * e la foto grande, cioè le due cose che decidono se uno resta.
 *
 * In tutto il progetto `IntersectionObserver` compariva in un file solo: non c'era una regola,
 * quindi ogni sezione nuova nasceva ansiosa.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Che sotto il riquadro d'acquisto NESSUN componente che interroga il database venga montato
 * subito. L'elenco dei componenti che interrogano NON è scritto qui: si legge nei loro file, uno
 * per uno, cercando le loro `useQuery`. Se domani qualcuno aggiunge in fondo alla scheda una
 * sezione nuova che chiede dati, questa prova la trova da sé e diventa rossa.
 *
 * ⚠️ Cosa NON prova: quante richieste partano davvero in un browser. Il conto «dieci» viene dalla
 * lettura del codice, non da una scheda di rete aperta su un telefono: quello resta da fare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const PAGINA = 'app/product/[id]/page.tsx';
const SORGENTE = readFileSync(PAGINA, 'utf8');

/**
 * Il confine: da qui in giù è «sotto la piega». Il riquadro d'acquisto è l'ultimo figlio della
 * griglia, quindi tutto quello che viene scritto dopo si legge scorrendo.
 */
const SOTTO_LA_PIEGA = (() => {
  const i = SORGENTE.indexOf('{/* CTA STICKY');
  expect(i, 'il riquadro d’acquisto non si trova più: la prova va riscritta').toBeGreaterThan(-1);
  return SORGENTE.slice(i);
})();

/** Il file di un componente, letto dalle righe di import della pagina. */
function fileDelComponente(nome: string): string | null {
  const m = SORGENTE.match(
    new RegExp(`import\\s+(?:\\{[^}]*\\b${nome}\\b[^}]*\\}|${nome})\\s+from\\s+'@/([^']+)'`),
  );
  if (!m) return null;
  for (const est of ['.tsx', '.ts']) if (existsSync(m[1] + est)) return m[1] + est;
  return null;
}

/** I componenti sotto la piega che vanno a chiedere dati per conto loro. */
const CHIEDONO_DATI = [...new Set([...SOTTO_LA_PIEGA.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))]
  .filter((nome) => {
    const file = fileDelComponente(nome);
    return !!file && /useQuery\(/.test(readFileSync(file, 'utf8'));
  });

describe('sotto il riquadro d’acquisto non si chiede niente prima del tempo', () => {
  it('i componenti che chiedono dati si trovano da sé (se no la prova non misura niente)', () => {
    expect(
      CHIEDONO_DATI.length,
      'nessun componente sotto la piega interroga il database: la prova va riscritta',
    ).toBeGreaterThanOrEqual(4);
  });

  it('ognuno è montato solo quando ci si arriva', () => {
    for (const nome of CHIEDONO_DATI) {
      // Il tag deve stare dentro un blocco `<QuandoSiVede> … </QuandoSiVede>`.
      const dentro = [...SOTTO_LA_PIEGA.matchAll(/<QuandoSiVede[\s\S]*?<\/QuandoSiVede>/g)].some((b) =>
        b[0].includes(`<${nome}`),
      );
      expect(
        dentro,
        `«${nome}» interroga il database e parte all'apertura della pagina, mentre devono ` +
          'arrivare il prezzo e la foto: va montato quando entra nello schermo',
      ).toBe(true);
    }
  });

  it('e quelli che NON chiedono dati restano dove sono: niente ritardi inutili', () => {
    // La barra d'acquisto e il conteggio delle visite devono esistere subito: la prima è il
    // pulsante per comprare, il secondo conta una visita che sta già avvenendo.
    for (const subito of ['StickyAddToCart', 'ProductViewTracker']) {
      const dentro = [...SOTTO_LA_PIEGA.matchAll(/<QuandoSiVede[\s\S]*?<\/QuandoSiVede>/g)].some((b) =>
        b[0].includes(`<${subito}`),
      );
      expect(dentro, `«${subito}» non deve aspettare: ritardarlo toglie qualcosa senza dare niente`).toBe(
        false,
      );
    }
  });
});

describe('la regola vale per come è scritta, non per come ce la si ricorda', () => {
  const REGOLA = readFileSync('components/QuandoSiVede.tsx', 'utf8');

  it('il figlio non esiste finché non si arriva: è tutto il punto', () => {
    // Se il figlio fosse sempre nell'albero e solo nascosto, le sue `useQuery` partirebbero lo
    // stesso e non sarebbe cambiato niente.
    expect(REGOLA).toMatch(/if \(arrivato\) return <>\{children\}<\/>;/);
    const segnaposto = REGOLA.slice(REGOLA.lastIndexOf('return <div ref='));
    expect(segnaposto, 'il segnaposto non si trova più: la prova va riscritta').toBeTruthy();
    expect(
      segnaposto,
      'il segnaposto non deve contenere il figlio, altrimenti le sue domande partono lo stesso',
    ).not.toContain('{children}');
  });

  it('monta con un po’ di anticipo, così non si vede il buco', () => {
    expect(REGOLA).toMatch(/rootMargin: margine/);
    expect(REGOLA.match(/margine = '(\d+)px'/)?.[1]).toBe('200');
  });

  it('tiene il posto: la pagina non salta sotto le dita mentre si scorre', () => {
    expect(REGOLA).toMatch(/minHeight: altezzaMinima/);
    const altezze = [...SORGENTE.matchAll(/<QuandoSiVede altezzaMinima=\{(\d+)\}/g)].map((m) => Number(m[1]));
    expect(altezze.length, 'nessuna sezione dichiara l’altezza da tenere').toBeGreaterThanOrEqual(4);
    for (const a of altezze) expect(a, 'un segnaposto troppo basso fa saltare la pagina').toBeGreaterThanOrEqual(200);
  });

  it('se il browser non sa osservare, il contenuto si vede lo stesso', () => {
    // Una sezione che non compare mai sarebbe molto peggio di una richiesta in più.
    expect(REGOLA).toMatch(/typeof IntersectionObserver === 'undefined'[\s\S]{0,80}setArrivato\(true\)/);
  });
});
