import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/checkout/page.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const effetto = src.slice(src.indexOf('const haGruppi'), src.indexOf('const [useCredit'));

describe('S07 · la domanda sulla veloce in cassa', () => {
  it('un carrello senza negozio letto ha una risposta (no), non un’attesa senza fine', () => {
    expect(effetto).toMatch(/if \(!negoziDelCarrello\) \{\s*if \(haGruppi\) setEsitoVeloce\(\{ negozi: '', possibile: false \}\);\s*return;/);
  });
  it('la richiesta ha un tempo massimo: appesa diventa un no', () => {
    expect(effetto).toMatch(/AbortSignal\.timeout\(15_000\)/);
    expect(effetto).toMatch(/\.catch\(\(\) => \{\s*if \(vivo\) \{\s*setEsitoVeloce\(\{ negozi: negoziDelCarrello, possibile: false \}\)/);
  });
  it('dopo un no della rotta con «Adesso» si richiede subito, con i contanti e con la carta', () => {
    const richieste = src.match(/if \(deliverySlot === ETICHETTA_ADESSO\) setRichiediVeloce\(\(n\) => n \+ 1\);/g) ?? [];
    expect(richieste).toHaveLength(2);
    expect(effetto).toMatch(/\}, \[negoziDelCarrello, haGruppi, richiediVeloce\]\);/);
  });
  it('il riepilogo non ripete la frase del selettore, e dice che si può scegliere un’altra fascia', () => {
    expect(src).not.toMatch(/RIGA_VELOCE_IN_ATTESA/);
    expect(src).toMatch(/const MOTIVO_VELOCE_IN_ATTESA = '[^']*scegli Oggi o Domani\.'/);
  });
  it('senza bozza il giorno di partenza si sceglie con l’ora di Roma, non con quella del telefono', () => {
    expect(src).toMatch(/const oraDiApertura = romeNow\(\);\s*const \[slotDay, setSlotDay\] = useState\(\(\) => giornoDiPartenza\(oraDiApertura\)\)/);
  });
});
