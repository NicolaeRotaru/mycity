import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R01-001 (17/11/2026) — nell'elenco conversazioni dell'assistenza il lettore di
 * schermo diceva solo «3» accanto al nome, senza sapere che erano messaggi da
 * leggere. Prova leggera sul testo della pagina: il numero è muto e accanto c'è
 * la frase in sr-only (stesso schema di R07-007 per la chat).
 */
const pagina = readFileSync('app/admin/support-chat/page.tsx', 'utf8');

describe("R01-001 · i non letti dell'assistenza si dicono a parole", () => {
  it('il numero è aria-hidden e la frase «messaggi non letti» sta in sr-only', () => {
    const i = pagina.indexOf('{unread && (');
    expect(i).toBeGreaterThan(-1);
    const pallino = pagina.slice(i, pagina.indexOf('</div>', i));
    expect(pallino).toMatch(/<span aria-hidden="true">\{c\.seller_unread_count\}<\/span>/);
    expect(pallino).toMatch(/<span className="sr-only">.*1 messaggio non letto.*messaggi non letti/);
  });

  it('il numero non resta più nudo dentro il pallino', () => {
    expect(pagina).not.toMatch(/py-0\.5">\{c\.seller_unread_count\}<\/span>/);
  });
});
