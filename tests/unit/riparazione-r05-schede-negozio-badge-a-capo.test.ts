import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Col testo al 200% le schede negozio (due per riga sul telefono) tagliavano «Nuovo negozio» e «Chiuso ora»:
 * il segnalino non poteva andare a capo e la scheda (overflow-hidden) lo tagliava. Adesso i segnalini
 * hanno max-w-full e [overflow-wrap:anywhere], senza whitespace-nowrap né truncate.
 */
const classiDel = (src: string, testo: RegExp) => {
  const m = src.match(testo);
  if (!m) throw new Error(`segnalino non trovato: ${testo}`);
  return m[1];
};

describe('i segnalini delle schede negozio vanno a capo invece di essere tagliati', () => {
  const card = readFileSync('components/StorePreviewCard.tsx', 'utf8');
  const riga = readFileSync('components/StoreListRow.tsx', 'utf8');

  it('StorePreviewCard: «Chiuso ora / Aperto ora» e «Nuovo negozio»', () => {
    const stato = classiDel(card, /<span className=\{`(mt-2 inline-flex[^`]*)\$\{open/);
    expect(stato).toContain('max-w-full');
    expect(stato).toContain('[overflow-wrap:anywhere]');
    expect(stato).not.toMatch(/whitespace-nowrap|truncate/);
    expect(classiDel(card, /<span className="([^"]*)">Nuovo negozio<\/span>/)).toContain('[overflow-wrap:anywhere]');
  });

  it('StoreListRow: «Nuovo» e lo stato aperto/chiuso', () => {
    const stato = classiDel(riga, /<span className=\{`(inline-flex[^`]*)\$\{open/);
    expect(stato).toContain('max-w-full');
    expect(stato).toContain('[overflow-wrap:anywhere]');
    expect(stato).not.toMatch(/whitespace-nowrap|truncate/);
    expect(classiDel(riga, /<span className="([^"]*)">Nuovo<\/span>/)).toContain('[overflow-wrap:anywhere]');
  });
});
