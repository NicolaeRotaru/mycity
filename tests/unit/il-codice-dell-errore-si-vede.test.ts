/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * 31/8/2026 (R194) — IL NEGOZIANTE DICE «NON FUNZIONA» E NON HA NIENTE DA DARCI.
 *
 * Le due schermate d'errore ricevono `error.digest`: è l'identificativo che
 * Next scrive anche nei log del server, quindi è l'unica cosa che lega una
 * telefonata all'errore vero. Lo passavano a Sentry e non lo mostravano mai a
 * video: chi ci scriveva poteva dirci solo «verso le tre», e la caccia nei log
 * partiva dall'ora approssimativa invece che dal codice esatto.
 *
 * Il codice deve comparire sotto il messaggio, con la frase che dice di
 * riportarlo. E quando il codice non c'è — errori che Next non digerisce, o
 * sviluppo in locale — non deve restare una riga vuota o, peggio, la parola
 * «undefined» sotto il messaggio di scuse.
 */

const CODICE = '9f3a7c21b84e';

function erroreCon(digest?: string): Error & { digest?: string } {
  const e = new Error('boom') as Error & { digest?: string };
  if (digest !== undefined) e.digest = digest;
  return e;
}

describe('la schermata d\'errore di una pagina', () => {
  it('fa vedere il codice dell\'errore e dice di riportarlo', async () => {
    const mod = await monta('app/error.tsx');
    const s = accendi(mod.default, { error: erroreCon(CODICE), reset: () => {} });

    const testo = testoVisibile(s.radice);
    expect(
      testo,
      `Il codice ${CODICE} non si vede: chi ci scrive «non funziona» non ha niente da darci e i log si cercano a tentoni. Testo mostrato: ${JSON.stringify(testo)}`,
    ).toContain(CODICE);
    expect(
      testo.toLowerCase(),
      'Il codice c\'è ma nessuno dice al negoziante di riportarcelo: senza la frase resta una sigla misteriosa che nessuno copia',
    ).toContain('riportalo');

    s.smonta();
  }, 60000);

  it('quando il codice non c\'è non lascia una riga vuota né la parola undefined', async () => {
    const mod = await monta('app/error.tsx');
    const s = accendi(mod.default, { error: erroreCon(undefined), reset: () => {} });

    const testo = testoVisibile(s.radice);
    expect(
      testo.toLowerCase(),
      `Sotto il messaggio di scuse è comparsa la parola «undefined»: sembra un secondo errore. Testo mostrato: ${JSON.stringify(testo)}`,
    ).not.toContain('undefined');
    expect(
      testo.toLowerCase(),
      `Senza codice l'etichetta «Codice errore» resta lì da sola, e chi legge cerca un numero che non c'è. Testo mostrato: ${JSON.stringify(testo)}`,
    ).not.toContain('codice errore');

    s.smonta();
  }, 60000);

  it('il codice si può selezionare col dito e non sfonda lo schermo del telefono', async () => {
    const mod = await monta('app/error.tsx');
    const s = accendi(mod.default, { error: erroreCon(CODICE), reset: () => {} });

    const codice = Array.from(s.radice.querySelectorAll('code')).find((el) =>
      (el.textContent ?? '').includes(CODICE),
    );
    expect(
      codice,
      'Il codice non è dentro un <code>: al telefono si seleziona a fatica e chi lo detta al telefono non capisce dove inizia e dove finisce',
    ).toBeTruthy();
    const classi = codice!.getAttribute('class') ?? '';
    expect(
      classi,
      `Un tocco lungo deve prendere tutto il codice, non mezza parola. Classi trovate: ${JSON.stringify(classi)}`,
    ).toContain('select-all');
    expect(
      classi,
      `Un codice lungo senza punto di rottura allarga la pagina e sul telefono compare la barra che scorre di lato. Classi trovate: ${JSON.stringify(classi)}`,
    ).toContain('break-all');

    s.smonta();
  }, 60000);
});

describe('la schermata d\'errore che sostituisce tutto il sito', () => {
  it('fa vedere il codice dell\'errore e dice di riportarlo', async () => {
    const mod = await monta('app/global-error.tsx');
    const s = accendi(mod.default, { error: erroreCon(CODICE), reset: () => {} });

    const testo = testoVisibile(s.radice);
    expect(
      testo,
      `Il codice ${CODICE} non si vede: qui è ancora più grave, perché è la schermata che compare quando cade tutto il sito. Testo mostrato: ${JSON.stringify(testo)}`,
    ).toContain(CODICE);
    expect(
      testo.toLowerCase(),
      'Il codice c\'è ma nessuno dice di riportarcelo',
    ).toContain('riportalo');

    s.smonta();
  }, 60000);

  it('quando il codice non c\'è non lascia una riga vuota né la parola undefined', async () => {
    const mod = await monta('app/global-error.tsx');
    const s = accendi(mod.default, { error: erroreCon(undefined), reset: () => {} });

    const testo = testoVisibile(s.radice);
    expect(
      testo.toLowerCase(),
      `Sotto il messaggio di scuse è comparsa la parola «undefined». Testo mostrato: ${JSON.stringify(testo)}`,
    ).not.toContain('undefined');
    expect(
      testo.toLowerCase(),
      `Senza codice l'etichetta «Codice errore» resta lì da sola. Testo mostrato: ${JSON.stringify(testo)}`,
    ).not.toContain('codice errore');

    s.smonta();
  }, 60000);

  it('il codice si può selezionare col dito e non sfonda lo schermo del telefono', async () => {
    const mod = await monta('app/global-error.tsx');
    const s = accendi(mod.default, { error: erroreCon(CODICE), reset: () => {} });

    const codice = Array.from(s.radice.querySelectorAll('code')).find((el) =>
      (el.textContent ?? '').includes(CODICE),
    );
    expect(
      codice,
      'Il codice non è dentro un <code>: al telefono si seleziona a fatica',
    ).toBeTruthy();
    // Qui il foglio di stile non c'è (è la schermata che sostituisce il layout
    // rotto), quindi le regole devono stare attaccate all'elemento.
    expect(
      (codice as HTMLElement).style.userSelect,
      'Un tocco lungo deve prendere tutto il codice, non mezza parola',
    ).toBe('all');
    expect(
      (codice as HTMLElement).style.wordBreak,
      'Un codice lungo senza punto di rottura allarga la pagina e sul telefono compare la barra che scorre di lato',
    ).toBe('break-all');

    s.smonta();
  }, 60000);
});

/**
 * 31/8/2026 (R194, seconda metà) — LE SETTE SCHERMATE CHE OSCURANO QUELLA GENERALE.
 *
 * In Next una `error.tsx` dentro una cartella VINCE su quella alla radice: per
 * chi sta in /seller, /checkout, /rider… la schermata che compare non è
 * app/error.tsx ma la loro. Sistemare solo quella generale lasciava fuori
 * proprio il negoziante, che è la persona di cui parla questo difetto: va in
 * errore dentro /seller e continua a non avere nessun codice da darci.
 *
 * Il codice deve stare DENTRO il riquadro annunciato (`role="alert"`), non
 * sotto: chi usa un lettore di schermo sente l'errore e deve sentire anche il
 * codice, senza doversi mettere a scorrere la pagina per cercarlo.
 */

const SCHERMATE = [
  ['app/error.tsx', 'una pagina qualunque'],
  ['app/seller/error.tsx', "l'area del negoziante"],
  ['app/admin/error.tsx', "l'area di chi amministra"],
  ['app/checkout/error.tsx', 'la cassa'],
  ['app/rider/error.tsx', "l'area del fattorino"],
  ['app/product/[id]/error.tsx', 'la scheda prodotto'],
  ['app/store/[id]/error.tsx', 'la vetrina del negozio'],
  ['app/orders/[id]/error.tsx', 'il dettaglio di un ordine'],
] as const;

describe('ogni schermata d\'errore, non solo quella generale', () => {
  for (const [percorso, dove] of SCHERMATE) {
    it(`${dove} dà il codice da riportare`, async () => {
      const mod = await monta(percorso);
      const s = accendi(mod.default, { error: erroreCon(CODICE), reset: () => {} });

      const testo = testoVisibile(s.radice);
      expect(
        testo,
        `Chi va in errore su ${dove} non ha nessun codice da darci: la sua segnalazione resta scollegata dai log. Testo mostrato: ${JSON.stringify(testo)}`,
      ).toContain(CODICE);

      s.smonta();
    }, 60000);

    it(`${dove} annuncia il codice insieme all'errore, non dopo`, async () => {
      const mod = await monta(percorso);
      const s = accendi(mod.default, { error: erroreCon(CODICE), reset: () => {} });

      const annuncio = s.radice.querySelector('[role="alert"]');
      expect(
        annuncio?.textContent ?? '',
        `Su ${dove} il codice sta fuori dal riquadro annunciato: chi usa un lettore di schermo sente l'errore ma non il codice, e deve mettersi a cercarlo scorrendo la pagina`,
      ).toContain(CODICE);

      s.smonta();
    }, 60000);
  }

  for (const [percorso, dove] of SCHERMATE) {
    it(`${dove} senza codice non mostra «undefined»`, async () => {
      const mod = await monta(percorso);
      const s = accendi(mod.default, { error: erroreCon(undefined), reset: () => {} });

      const testo = testoVisibile(s.radice).toLowerCase();
      expect(
        testo,
        `Su ${dove} manca il codice ma compare comunque qualcosa: sotto le scuse sembra un secondo errore`,
      ).not.toContain('undefined');
      expect(testo, `Su ${dove} resta l'etichetta spaiata senza il codice`).not.toContain(
        'codice errore:',
      );

      s.smonta();
    }, 60000);
  }
});
