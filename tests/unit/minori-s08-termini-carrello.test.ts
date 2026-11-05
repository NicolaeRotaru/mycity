import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  fattiDellaConsegna,
  fraseDelCaso,
  paragrafiConsegne,
  paragrafoDelRifiuto,
  ROTTA_CLIENTE_ASSENTE,
  siPuoPromettereLaTrattenuta,
} from '@/lib/legal/promessa-cliente-assente';

/** S08 (5/11/2026) — I paragrafi §4 e §6 dei Termini sul carrello con più negozi. */

const RADICE = path.resolve(__dirname, '../..');

describe('§6, il cliente non reperibile', () => {
  it('scheda 2288 — l esempio del §6 non parla del forno che rifiuta', () => {
    const s6 = paragrafiConsegne().join('\n');
    expect(s6).not.toMatch(/se il forno rifiuta/);
    expect(s6).toMatch(/non si può consegnare perché non sei reperibile/);
    // Il §4 invece parla proprio del forno che rifiuta.
    expect(paragrafoDelRifiuto()).toMatch(/se il forno rifiuta/);
  });

  it('scheda 2231 — il caso misto (uno consegnato, uno da consegnare) sta in una frase sola, quella del codice', () => {
    expect(fraseDelCaso('altri-gia-consegnati')).toMatch(/almeno uno degli altri ordini.*è già stato consegnato: ti torna tutto/);
    expect(fraseDelCaso('altri-da-consegnare')).toMatch(/nessuno è ancora stato consegnato/);
    // La regola del codice: basta un ordine consegnato nel carrello per rendere tutto.
    const annulla = readFileSync(path.join(RADICE, 'lib/ordini/annulla.ts'), 'utf8');
    // 5/11/2026 (unione) — S01 ha aggiunto all'eccezione anche l'ordine in contanti già incassato: la regola resta «basta un ordine consegnato».
    expect(annulla).toContain("!c.some((r) => r.delivery_status === 'DELIVERED'");
  });

  it('scheda 2503 — i fatti vedono la rotta «cliente assente», e la trattenuta resta esclusa', () => {
    expect(existsSync(path.join(RADICE, ROTTA_CLIENTE_ASSENTE)), 'la rotta non c è più: rivedere i fatti').toBe(true);
    const fatti = fattiDellaConsegna();
    expect(fatti.esitoDiMancataConsegna).toBe(true);
    expect(siPuoPromettereLaTrattenuta(fatti)).toBe(false);
  });
});
