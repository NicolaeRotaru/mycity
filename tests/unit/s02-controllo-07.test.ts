import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { testoSenzaIndirizzi, testoSenzaRecapiti, testoSenzaEmail } from '@/lib/analytics/filmato-senza-dati-personali';
import { indirizzoSenzaDatiPersonali, VALORE_NASCOSTO } from '@/lib/analytics/indirizzo-senza-dati-personali';
import { messaggioSenzaDatiPersonali } from '@/lib/analytics/events';
import { pezziDelMotivo } from '@/lib/testo/pezzi-del-motivo';
import { pezziFuoriDalPercorso } from '@/lib/privacy/avvisi-a-chi-aspetta';
import { trovaTutti } from '@/lib/testo/scansioni-lineari';

/**
 * Le espressioni sui testi che arrivano da fuori: stessi risultati delle regole di prima, tempo che
 * cresce con la lunghezza del testo e non col suo quadrato, e nessun lookbehind nel codice (Safari
 * prima della 16.4 non lo legge e il file che lo contiene non si carica).
 */

// ── Le regole com'erano, per il confronto ──────────────────────────────────────────────────────
const PRIMA = {
  telefono: /(?:(?<![\w\-/])|(?<=%20))(?:(?:\+|00)39[\s.-]?)?\(?(?:3\d{2}|0\d{1,3})\)?(?:[\s.\-/]?\d){5,8}(?![\w\-/])/g,
  indirizzo: /https?:\/\/[^\s"<>\\]+|\/[^\s"<>\\]*\?[^\s"<>\\]*/g,
  motivo: /((?<![\w/.:])\/contact(?![\w/-])|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
  percorso: /(?<![\w/.:])\/contact(?![\w/-])/,
};
const SEMBRA_UNA_DATA_O_UN_DECIMALE = /^(?:\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d+\.\d+)$/;
const recapitiDiPrima = (t: string) =>
  t ? testoSenzaEmail(t).replace(PRIMA.telefono, (x) => (SEMBRA_UNA_DATA_O_UN_DECIMALE.test(x) ? x : VALORE_NASCOSTO)) : t;
const indirizziDiPrima = (t: string) => {
  if (!t || t.length > 50_000) return testoSenzaIndirizzi(t);
  const s = t.includes('/') ? t.replace(PRIMA.indirizzo, (x) => indirizzoSenzaDatiPersonali(x) ?? VALORE_NASCOSTO) : t;
  return recapitiDiPrima(s);
};
const messaggioDiPrima = (m: string) =>
  (m || '')
    .replace(/Key\s*\([^)]*\)\s*=\s*\([^)]*\)/gi, 'Key (…)=(…)')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\+?\d[\d\s.\-/]{6,}\d/g, '<numero>')
    .replace(/\b\d{6,}\b/g, '<numero>')
    .trim()
    .slice(0, 40);

// ── Testi a caso, sempre gli stessi (generatore con seme) ──────────────────────────────────────
function generatore(seme: number) {
  let x = seme >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
function testiACaso(pezzi: string[], quanti: number, seme: number, lunghezzaMassima = 14): string[] {
  const caso = generatore(seme);
  const fuori: string[] = [];
  for (let k = 0; k < quanti; k++) {
    let t = '';
    const n = 1 + Math.floor(caso() * lunghezzaMassima);
    for (let j = 0; j < n; j++) t += pezzi[Math.floor(caso() * pezzi.length)];
    fuori.push(t);
  }
  return fuori;
}

const PEZZI_TELEFONO = ['3', '0', '9', '1', '33', '+39', '0039', '+', ' ', '.', '-', '/', '(', ')', 'a', '_', '%20', '%2', '05.11.2026', '333 123 4567', '0523/123456'];
const PEZZI_INDIRIZZO = ['http://', 'https://', 'http:/', 'http', '/', '?', 'a', 'q=', '=', '&', '#', ' ', '"', '<', '>', '\\', '%20', 'mario', '/search', '.it', ':', '\n', ' '];
const PEZZI_MOTIVO = ['/contact', '/contacts', '/contact-', 'x', '/', '.', ':', ' ', '@', 'mario', 'it', 'a.b', '_', '%', '+', '-', 'pagina ', '(', ')', 'Z'];
const PEZZI_MESSAGGIO = ['Key', 'key', 'KEY', ' ', '(', ')', '=', '(email)', 'mario', '@', 'rossi', '.', 'it', '+', '-', '_', '1', '2', '3333', '0b4f1c1e-1111-4222-8333-944455556666', '\t'];

describe('stessi risultati delle regole di prima', () => {
  it('il telefono nel testo del filmato', () => {
    for (const t of testiACaso(PEZZI_TELEFONO, 4000, 7)) expect(testoSenzaRecapiti(t), JSON.stringify(t)).toBe(recapitiDiPrima(t));
  });

  it('gli indirizzi nel testo del filmato', () => {
    for (const t of testiACaso(PEZZI_INDIRIZZO, 4000, 11)) expect(testoSenzaIndirizzi(t), JSON.stringify(t)).toBe(indirizziDiPrima(t));
  });

  it('il motivo nelle impostazioni (pagina dei contatti ed email)', () => {
    for (const t of testiACaso(PEZZI_MOTIVO, 4000, 13)) expect(pezziDelMotivo(t), JSON.stringify(t)).toEqual(t.split(PRIMA.motivo));
  });

  it('la pagina dei contatti nell\'email dell\'avviso', () => {
    for (const t of testiACaso(PEZZI_MOTIVO, 4000, 17)) expect(pezziFuoriDalPercorso(t), JSON.stringify(t)).toEqual(t.split(PRIMA.percorso));
  });

  it('il messaggio d\'errore verso le analisi', () => {
    for (const t of testiACaso(PEZZI_MESSAGGIO, 4000, 19, 18)) expect(messaggioSenzaDatiPersonali(t), JSON.stringify(t)).toBe(messaggioDiPrima(t));
  });

  it('controprova: i casi scritti a mano', () => {
    expect(testoSenzaRecapiti('chiama Mario%203331234567 domani')).toBe(`chiama Mario%20${VALORE_NASCOSTO} domani`);
    expect(testoSenzaRecapiti('/negozio/3331234567')).toBe('/negozio/3331234567');
    expect(testoSenzaRecapiti('il 05.11.2026')).toBe('il 05.11.2026');
    expect(pezziDelMotivo('scrivi a privacy@mycity.it (pagina /contact).')).toEqual(['scrivi a ', 'privacy@mycity.it', ' (pagina ', '/contact', ').']);
    expect(pezziDelMotivo('https://sito.it/contact')).toEqual(['https://sito.it/contact']);
    expect(messaggioSenzaDatiPersonali('Key (email)=(mario@rossi.it) already exists')).toBe('Key (…)=(…) already exists');
  });
});

describe('il tempo cresce con la lunghezza, non col quadrato', () => {
  const PRESTO_MS = 400;
  const misura = (fai: () => unknown) => {
    const da = performance.now();
    fai();
    return performance.now() - da;
  };

  it('una sequenza lunga senza chiocciola nel messaggio d\'errore', () => {
    expect(misura(() => messaggioSenzaDatiPersonali('a'.repeat(60_000)))).toBeLessThan(PRESTO_MS);
  });

  it('tante «Key(» senza chiusura nel messaggio d\'errore', () => {
    expect(misura(() => messaggioSenzaDatiPersonali(`${'Key('.repeat(15_000)})`))).toBeLessThan(PRESTO_MS);
  });

  it('un percorso lunghissimo senza «?» nel testo del filmato', () => {
    expect(misura(() => testoSenzaIndirizzi('/a'.repeat(24_000)))).toBeLessThan(PRESTO_MS);
  });

  it('una sequenza lunga senza chiocciola nel motivo delle impostazioni', () => {
    expect(misura(() => pezziDelMotivo('a'.repeat(60_000)))).toBeLessThan(PRESTO_MS);
  });

  it('controprova: trovaTutti vuole la bandiera y', () => {
    expect(() => trovaTutti('abc', /b/g, () => true)).toThrow();
  });
});

describe('nessun lookbehind nel codice del sito', () => {
  function file(dir: string): string[] {
    return readdirSync(dir).flatMap((nome) => {
      const pieno = join(dir, nome);
      if (statSync(pieno).isDirectory()) return nome === 'node_modules' ? [] : file(pieno);
      return /\.(ts|tsx|js|mjs)$/.test(nome) && !/\.test\./.test(nome) ? [pieno] : [];
    });
  }

  it('app, components e lib non scrivono (?<= né (?<! fuori dai commenti', () => {
    const radice = join(__dirname, '..', '..');
    const trovati: string[] = [];
    for (const dir of ['app', 'components', 'lib']) {
      for (const f of file(join(radice, dir))) {
        readFileSync(f, 'utf8').split('\n').forEach((riga, n) => {
          const t = riga.trim();
          if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
          if (/\(\?<[=!]/.test(riga)) trovati.push(`${f.slice(radice.length + 1)}:${n + 1}`);
        });
      }
    }
    expect(trovati).toEqual([]);
  });
});
