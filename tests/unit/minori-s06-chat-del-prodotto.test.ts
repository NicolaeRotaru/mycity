import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { messaggioDellaChatDopoIlPatch } from '@/lib/products/aiPatch';

/**
 * S06 · 1676 — Nella chat del prodotto il «Fatto!» del modello non si mostra
 * quando nella scheda non è entrato niente e non c'è niente da controllare.
 */
describe('1676 — proposta scartata in silenzio', () => {
  it('«Fatto! Ho impostato la taglia M» diventa «non è cambiato niente»', () => {
    const m = messaggioDellaChatDopoIlPatch('Fatto! Ho impostato la taglia M.', { cambiati: [], daControllare: [] }, true);
    expect(m.testo).not.toContain('Fatto');
    expect(m.testo).toContain('Nella scheda non è cambiato niente');
    expect(m.aggiornato).toBe(false);
  });
  it('senza proposta resta la risposta del modello (una domanda, un consiglio)', () => {
    expect(messaggioDellaChatDopoIlPatch('Ti consiglio foto più luminose.', { cambiati: [], daControllare: [] }).testo)
      .toBe('Ti consiglio foto più luminose.');
  });
  it('la chat dice se la proposta conteneva qualcosa', () => {
    expect(readFileSync('components/seller/ProductChatAssistant.tsx', 'utf8'))
      .toContain("messaggioDellaChatDopoIlPatch(json.reply ?? 'Fatto.', esito, Object.keys(patch).length > 0)");
  });
});
