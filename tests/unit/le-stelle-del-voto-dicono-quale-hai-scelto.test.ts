import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { contrasto } from './aiuti/contrasto';
import { colore } from './aiuti/tavolozza-del-sito';

/**
 * 3/9/2026 — LE STELLE DEL VOTO NON DICEVANO QUAL È QUELLA SCELTA.
 *
 * Nella pagina «Lascia una recensione» il voto si dà premendo una di cinque
 * stelle. I cinque pulsanti avevano solo l'etichetta — «3 stelle» — e nient'
 * altro: nessuno stato, nessun contenitore che dicesse «questo è un gruppo, il
 * tuo voto». Chi naviga con un lettore di schermo sentiva la stessa identica
 * cosa prima e dopo aver premuto, e non sapeva nemmeno che il modulo parte già
 * con cinque stelle selezionate. Poteva inviare cinque stelle credendo di non
 * aver ancora votato. È WCAG 4.1.2, Name-Role-Value, livello A.
 *
 * Lo stesso selettore nella scheda prodotto era già stato riparato mesi fa (il
 * commento #142 lo racconta): la correzione non era stata portata anche qui. È
 * il difetto che si moltiplica copiando — e per questo la rete qui sotto NON
 * guarda una pagina sola.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Cerca in tutto `app/` e `components/` OGNI pulsante che è una stella di un
 * selettore di voto (lo si riconosce dall'etichetta «n stelle»), e per ognuno
 * pretende due cose: che porti `aria-pressed` legato al voto, e che stia dentro
 * un contenitore con `role="group"` e un nome. Il prossimo selettore copiato
 * senza stato diventa rosso da solo.
 *
 * ⚪ Da qui non apro NVDA né VoiceOver: verifico che lo stato ci sia e a cosa è
 * legato, non come lo pronuncia una voce vera.
 */

const RADICE = process.cwd();

function sorgentiDi(cartella: string): string[] {
  const trovati: string[] = [];
  const cammina = (dir: string) => {
    for (const voce of readdirSync(dir)) {
      if (voce === 'node_modules' || voce.startsWith('.')) continue;
      const pieno = join(dir, voce);
      if (statSync(pieno).isDirectory()) cammina(pieno);
      else if (voce.endsWith('.tsx')) trovati.push(pieno);
    }
  };
  cammina(join(RADICE, cartella));
  return trovati;
}

type Stella = { file: string; tag: string; prima: string };

/**
 * Dove finisce davvero il tag aperto in `inizio`.
 *
 * Non basta il primo `>`: dentro gli attributi ci sono le funzioni freccia
 * (`onClick={() => …}`), e fermarsi lì taglierebbe il tag a metà — che è
 * esattamente come una rete del genere finisce per non pescare niente.
 */
function fineDelTag(src: string, inizio: number): number {
  let graffe = 0;
  for (let i = inizio; i < src.length; i++) {
    const c = src[i];
    if (c === '{') graffe++;
    else if (c === '}') graffe--;
    else if (c === '>' && graffe === 0) return i;
  }
  return -1;
}

/**
 * Ogni `<button …>` la cui etichetta è «n stella/stelle»: è una pastiglia di un
 * selettore di voto, non una stella disegnata per far vedere una media.
 */
function stelleDiUnSelettore(sorgente: string, file: string): Stella[] {
  const trovate: Stella[] = [];
  for (const m of sorgente.matchAll(/<button\b/g)) {
    const inizio = m.index!;
    const fine = fineDelTag(sorgente, inizio);
    if (fine < 0) continue;
    const tag = sorgente.slice(inizio, fine + 1);
    const etichetta = tag.match(/aria-label=\{?`([^`]*)`/)?.[1] ?? tag.match(/aria-label="([^"]*)"/)?.[1] ?? '';
    // «${n} ${n === 1 ? 'stella' : 'stelle'}»: è una singola stella da premere.
    if (!/stell/i.test(etichetta) || /su 5/i.test(etichetta)) continue;
    trovate.push({ file, tag, prima: sorgente.slice(0, inizio) });
  }
  return trovate;
}

const STELLE: Stella[] = [...sorgentiDi('app'), ...sorgentiDi('components')].flatMap((f) =>
  stelleDiUnSelettore(readFileSync(f, 'utf8'), relative(RADICE, f)),
);

describe('ogni stella di un selettore di voto dice se è scelta', () => {
  it('i selettori nel sito sono più di uno: la rete guarda tutti', () => {
    // Ogni selettore è UN `<button>` scritto una volta e ripetuto cinque volte
    // da un `.map`. Se questo numero va a zero — rete rotta, oppure qualcuno ha
    // cambiato il modo di scrivere l'etichetta — tutto il resto diventerebbe
    // verde per finta, che è il modo in cui una prova smette di provare.
    expect(STELLE.length, 'la rete non pesca più nessuna stella').toBeGreaterThanOrEqual(2);
    const file = new Set(STELLE.map((s) => s.file));
    expect(file.size, 'un selettore solo: la rete non sta più guardando tutto il sito').toBeGreaterThanOrEqual(2);
    expect(
      file.has('app/orders/[id]/review/page.tsx'),
      'la pagina del voto sull’ordine è uscita dalla rete',
    ).toBe(true);
  });

  for (const file of new Set(STELLE.map((s) => s.file))) {
    it(`${file}: le stelle portano lo stato, non solo il nome`, () => {
      for (const stella of STELLE.filter((s) => s.file === file)) {
        const stato = stella.tag.match(/aria-pressed=\{([^}]*)\}/)?.[1];
        expect(
          stato,
          `una stella senza aria-pressed: si sente uguale prima e dopo averla premuta — ${stella.tag.replace(/\s+/g, ' ')}`,
        ).toBeTruthy();
        // Legato al voto, non inchiodato: `aria-pressed={true}` mentirebbe su
        // quattro stelle su cinque.
        expect(stato!.trim(), `${file}: lo stato della stella è fisso`).not.toMatch(/^(true|false)$/);
        expect(stato!, `${file}: lo stato non è confrontato con nessun voto`).toMatch(/<=|===|>=/);
      }
    });

    it(`${file}: le cinque stelle stanno in un gruppo che ha un nome`, () => {
      for (const stella of STELLE.filter((s) => s.file === file)) {
        // Il contenitore è l'ultimo `<div …>` aperto prima del pulsante.
        const apertura = stella.prima.lastIndexOf('<div');
        const contenitore = stella.prima.slice(apertura, stella.prima.indexOf('>', apertura) + 1);
        expect(
          contenitore,
          `le stelle di ${file} non stanno in un gruppo: si sentono come cinque pulsanti scollegati`,
        ).toMatch(/role="group"/);
        const nome = contenitore.match(/aria-label=(?:"([^"]*)"|\{([^}]*)\})/);
        expect(nome, `il gruppo delle stelle di ${file} non ha un nome`).toBeTruthy();
      }
    });
  }
});

describe('la stella non ancora scelta si distingue dal foglio bianco', () => {
  it('nella pagina della recensione il grigio spento è sopra 3 a 1', () => {
    // WCAG 1.4.11: una parte grafica che porta un'informazione ha bisogno di
    // 3:1. `text-ink-300` (#A8A29E) si fermava a 2,52.
    const pagina = readFileSync(join(RADICE, 'app/orders/[id]/review/page.tsx'), 'utf8');
    const spenta = pagina.match(/\?\s*'text-[\w-]+'\s*:\s*'text-(ink-\d+)'/)?.[1];
    expect(spenta, 'non trovo più il colore della stella non scelta').toBeTruthy();
    expect(
      contrasto(colore(spenta!), '#FFFFFF'),
      `la stella spenta è ${spenta} (${colore(spenta!)}): sul bianco non si distingue`,
    ).toBeGreaterThanOrEqual(3);
  });
});
