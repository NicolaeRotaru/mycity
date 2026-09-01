/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 27/8/2026 (R103) — LA DICHIARAZIONE PUBBLICA PROMETTEVA COSE CHE IL CODICE
 * SMENTIVA, E SI SMENTIVA DA SOLA.
 *
 * La Dichiarazione di accessibilità non è una pagina di marketing: è un
 * documento che la legge (European Accessibility Act) obbliga a pubblicare, e
 * su cui una persona con disabilità decide se questo sito fa per lei. Se dice
 * il falso, quella persona ci prova, non riesce, e ha perso tempo per colpa
 * nostra. Ed è anche un rischio legale.
 *
 * Cosa diceva di sbagliato, verificato riga per riga:
 *  ① in fondo prometteva la compatibilità con NVDA, JAWS, VoiceOver e TalkBack,
 *    mentre trenta righe sopra ammetteva, giustamente, di non aver mai fatto una
 *    prova con un lettore di schermo vero. Il documento si contraddiceva da solo;
 *  ② diceva che il controllo automatico copre «home, catalogo, scheda prodotto,
 *    carrello», mentre il controllo vero gira su home, ricerca, carrello ed
 *    elenco negozi: la scheda prodotto — la pagina dove si decide se comprare —
 *    non è coperta, e il checkout nemmeno;
 *  ③ prometteva «nessuna violazione di livello A o AA», mentre il controllo vero
 *    ferma soltanto le violazioni gravi e lascia passare quelle medie, che sono
 *    comunque violazioni di livello A e AA;
 *  ④ dichiarava di essere costruito su Next.js 14, mentre il sito monta la 15.
 *
 * Questa prova monta la pagina vera e confronta quello che dice con le altre due
 * sorgenti che dicono la verità: il controllo automatico (`tests/e2e/`) e
 * l'elenco delle dipendenze (`package.json`). Se una delle due cambia e la
 * dichiarazione resta indietro, qui diventa rosso.
 */

const RADICE = path.resolve(__dirname, '../..');
const LETTORI = ['NVDA', 'JAWS', 'VoiceOver', 'TalkBack'];

function ilControlloAutomatico() {
  const sorgente = readFileSync(
    path.join(RADICE, 'tests/e2e/11-a11y-percorso-acquisto.spec.ts'),
    'utf8',
  );
  const pagine = [...sorgente.matchAll(/nome:\s*'([^']+)'/g)].map((m) => m[1]);
  const fermaSoloLeGravi =
    sorgente.includes("v.impact === 'critical'") && sorgente.includes("v.impact === 'serious'");
  return { pagine, fermaSoloLeGravi };
}

async function laDichiarazione() {
  const mod = await monta('app/accessibility/page.tsx');
  const s = accendi(mod.default, {});
  const voci = Array.from(s.radice.querySelectorAll('li')).map((l) => testoVisibile(l));
  return { testo: testoVisibile(s.radice), voci, smonta: s.smonta };
}

describe('la dichiarazione di accessibilità', () => {
  it('non promette lettori di schermo che ammette di non aver mai provato', async () => {
    const { testo, voci, smonta } = await laDichiarazione();

    const ammissione = testo.match(/non.{0,120}prove con lettori di schermo[^.]*/i)?.[0] ?? '';
    const nonProvati = LETTORI.filter((l) => ammissione.includes(l));
    expect(
      nonProvati.length,
      'La dichiarazione non ammette più di non aver provato con lettori di schermo veri: se le prove sono state fatte, va riscritta anche questa prova',
    ).toBeGreaterThan(0);

    const promesse = voci.filter((v) => /compatibilit/i.test(v) && LETTORI.some((l) => v.includes(l)));
    const contraddizioni = promesse.filter((v) => nonProvati.some((l) => v.includes(l)));
    expect(
      contraddizioni,
      `Il documento si contraddice: promette la compatibilità con ${nonProvati.join(', ')} e trenta righe sopra dice di non averli mai provati`,
    ).toEqual([]);
    smonta();
  }, 60000);

  it('elenca le pagine che il controllo automatico guarda davvero', async () => {
    const { pagine } = ilControlloAutomatico();
    expect(pagine.length, 'Non riesco più a leggere quali pagine controlla la prova automatica').toBe(4);

    const { voci, smonta } = await laDichiarazione();
    const vocePagine = voci.find((v) => v.includes('axe-core'))!;
    expect(vocePagine, 'La dichiarazione non parla più del controllo automatico').toBeTruthy();

    const elenco = (vocePagine.match(/\(([^)]*)\)/)?.[1] ?? '').toLowerCase();
    for (const pagina of pagine) {
      expect(
        elenco,
        `Il controllo automatico gira su «${pagina}», ma la dichiarazione elenca «${elenco}»`,
      ).toContain(pagina);
    }
    for (const scoperta of ['scheda prodotto', 'checkout', 'pagamento']) {
      expect(
        elenco,
        `La dichiarazione dice che «${scoperta}» è controllata automaticamente, ma il controllo non ci passa: è la pagina dove si decide se comprare`,
      ).not.toContain(scoperta);
    }
    smonta();
  }, 60000);

  it('non promette zero violazioni quando il controllo ferma solo quelle gravi', async () => {
    const { fermaSoloLeGravi } = ilControlloAutomatico();
    expect(fermaSoloLeGravi, 'Il controllo automatico non filtra più per gravità: rivedere questa prova').toBe(true);

    const { testo, smonta } = await laDichiarazione();
    expect(
      /nessuna violazione di livello a o aa/i.test(testo),
      'Il controllo lascia passare le violazioni di gravità media, che sono comunque violazioni di livello A e AA: la dichiarazione non può prometterne zero',
    ).toBe(false);
    smonta();
  }, 60000);

  it('dichiara la versione del sito che il sito monta davvero', async () => {
    const pkg = JSON.parse(readFileSync(path.join(RADICE, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const versioneVera = pkg.dependencies.next.replace(/[^0-9.]/g, '').split('.')[0];

    const { testo, smonta } = await laDichiarazione();
    const dichiarata = testo.match(/Next\.js\s*(\d+)/)?.[1];
    expect(dichiarata, 'La dichiarazione non dice più su cosa è costruito il sito').toBeTruthy();
    expect(
      dichiarata,
      `La dichiarazione dice Next.js ${dichiarata}, il sito monta la ${versioneVera}`,
    ).toBe(versioneVera);
    smonta();
  }, 60000);
});
