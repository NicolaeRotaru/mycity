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
