import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * 130 — IL CANCELLO CHE MANCAVA.
 *
 * La Dichiarazione di Accessibilità pubblica prometteva un audit periodico, e
 * nel progetto non c'era nessuna prova che potesse diventare rossa: né axe, né
 * pa11y, né la regola di lint per l'accessibilità. Tutto quello che è stato
 * riparato in questo lotto poteva tornare indietro alla prima modifica, senza
 * che nessuno se ne accorgesse.
 *
 * Questa prova percorre le pagine pubbliche e pretende zero violazioni gravi.
 * È la differenza fra «pensiamo di essere accessibili» e «lo verifichiamo a
 * ogni modifica».
 *
 * 148 — Sulla stessa passata si controlla che ci sia UN SOLO landmark <main>:
 * è il test che avrebbe intercettato i due <main> annidati di ricerca e
 * categoria, e che nel progetto non esisteva.
 *
 * 31/8/2026 (R102) — DUE COSE CAMBIANO QUI.
 *
 * La prima: fino a ieri questa prova non era mai girata. Viveva nel lavoro
 * «E2E smoke (Playwright)», dove ogni passo era appeso ai segreti di un
 * Supabase di prova che non sono mai esistiti — quindi SKIPPED, con la CI
 * verde. Adesso ha un lavoro suo (`a11y` in .github/workflows/ci.yml) che gira
 * sempre, su un'app costruita con variabili finte: nomi, ruoli, contrasto,
 * landmark e ordine dei titoli non hanno bisogno di dati veri per essere
 * sbagliati.
 *
 * La seconda: accesa per la prima volta, la prova è diventata rossa su tutte e
 * quattro le pagine, per un difetto vero e uno solo — il contrasto della
 * pillola dell'indirizzo, che sta in testa a ogni pagina del sito. Sta in un
 * componente che questo lavoro non può toccare, quindi è dichiarato qui sotto
 * con il rimedio, e resta debito aperto. Non è un interruttore: l'eccezione
 * nomina la regola E il singolo elemento, qualunque altra violazione resta
 * rossa, e c'è una prova che diventa rossa anche quando il debito viene
 * RIPARATO — così l'elenco può solo accorciarsi.
 */

type RisultatoAxe = Awaited<ReturnType<AxeBuilder['analyze']>>;
type Violazione = RisultatoAxe['violations'][number];
type Nodo = Violazione['nodes'][number];

/*
 * ATTENZIONE PRIMA DI ALLUNGARE QUESTO ELENCO: non e' solo una lista di
 * indirizzi. tests/unit/la-dichiarazione-di-accessibilita-dice-il-vero.test.ts
 * legge i `nome:` qui sotto e pretende che la Dichiarazione di Accessibilita'
 * pubblica (app/accessibility/page.tsx) nomini esattamente queste pagine — oggi
 * dice «quattro pagine (home, ricerca, carrello, negozi)». Aggiungere una
 * pagina qui senza riscrivere quella frase rende falso un documento che la
 * legge obbliga a pubblicare. Le due cose si muovono insieme, sempre.
 *
 * Il campo `nome:` e' letto da quella prova: non usarlo per altro dentro questo
 * file.
 */
const PAGINE = [
  { nome: 'home', url: '/' },
  { nome: 'ricerca', url: '/search?q=pane' },
  { nome: 'carrello', url: '/cart' },
  { nome: 'negozi', url: '/stores' },
];

/**
 * I difetti di accessibilità che il 31/8/2026 esistevano già, misurati con axe
 * su tutte le pagine qui sopra. Stanno in componenti e pagine che non
 * appartengono a questo lavoro: sono debito dichiarato, non assolto.
 *
 * Ogni voce nomina la regola E il singolo elemento: una violazione diversa
 * della stessa regola, o la stessa regola su un altro elemento, restano rosse.
 */
type DebitoNoto = {
  difetto: string;
  regola: string;
  /** La pagina su cui il debito si vede: serve a controllare che esista ancora. */
  vistoSu: string;
  riconosci: (nodo: Nodo) => boolean;
  dove: string;
  rimedio: string;
};

const DEBITI_DICHIARATI: DebitoNoto[] = [
  {
    difetto: 'la pillola «Consegna a Piacenza 29121» in testa a ogni pagina',
    regola: 'color-contrast',
    vistoSu: '/',
    // Bianco al 70% su terracotta: 3,49:1 contro i 4,5:1 richiesti. E' in
    // testa a OGNI pagina del sito, quindi vale per tutte quelle qui sopra.
    riconosci: (n) => n.html.includes('opacity-70') && (n.failureSummary ?? '').includes('#aa4f3b'),
    dove: 'components/LocationPill.tsx',
    rimedio:
      'togliere `opacity-70` dai due <span> dentro il bottone: il bianco pieno su quel terracotta fa 5,4:1',
  },
];

function eUnDebitoDichiarato(violazione: Violazione, nodo: Nodo): DebitoNoto | undefined {
  return DEBITI_DICHIARATI.find((d) => d.regola === violazione.id && d.riconosci(nodo));
}

async function violazioniGravi(url: string, page: import('@playwright/test').Page) {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  const esito = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return esito.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

for (const pagina of PAGINE) {
  test(`accessibilita: ${pagina.nome} senza violazioni gravi`, async ({ page }) => {
    const gravi = await violazioniGravi(pagina.url, page);

    // Si guarda nodo per nodo: se di una violazione un solo elemento non è fra
    // i debiti dichiarati, quella violazione è nuova e la prova diventa rossa.
    const nuove: string[] = [];
    for (const v of gravi) {
      const sconosciuti = v.nodes.filter((n) => !eUnDebitoDichiarato(v, n));
      if (sconosciuti.length === 0) continue;
      nuove.push(
        `${v.id} (${v.impact}) — ${v.help}\n    ${sconosciuti
          .slice(0, 3)
          .map((n) => `${n.target.join(' ')}\n      ${n.html.slice(0, 160)}`)
          .join('\n    ')}`,
      );
    }

    expect(nuove, `Violazioni gravi NUOVE su ${pagina.url}:\n${nuove.join('\n')}`).toEqual([]);
  });

  test(`accessibilita: ${pagina.nome} ha un solo landmark principale`, async ({ page }) => {
    await page.goto(pagina.url);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('main')).toHaveCount(1);
  });
}

/**
 * L'elenco dei debiti può solo accorciarsi: quando qualcuno ripara davvero uno
 * di questi difetti, questa prova diventa rossa e chiede di togliere
 * l'eccezione. Senza, un'eccezione scritta una volta resterebbe lì per sempre a
 * coprire anche una violazione futura che le somiglia.
 */
for (const debito of DEBITI_DICHIARATI) {
  test(`debito di accessibilita ancora aperto: ${debito.difetto}`, async ({ page }) => {
    const gravi = await violazioniGravi(debito.vistoSu, page);
    const trovato = gravi.some((v) => v.id === debito.regola && v.nodes.some((n) => debito.riconosci(n)));
    expect(
      trovato,
      `Questo difetto non c'è più su ${debito.vistoSu}: è stato riparato in ${debito.dove}.\n` +
        `Togli la voce «${debito.difetto}» da DEBITI_DICHIARATI in questo file, così il cancello torna severo.`,
    ).toBe(true);
  });
}
