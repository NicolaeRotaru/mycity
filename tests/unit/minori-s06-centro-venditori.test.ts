import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOPICS } from '@/app/seller/help/domande';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';

/**
 * S06 — Il Centro venditori dice quello che il sito fa.
 * 275: AI solo se accesa, telefono del cliente detto com'è, niente gruppi
 *      d'acquisto, criteri di classifica dei Termini, nomi dei pulsanti veri.
 * 1829: niente invito alla newsletter spenta.
 */
const testo = TOPICS.flatMap((t) => t.items.map((i) => `${i.q} ${i.a}`)).join('\n');

describe('275 — risposte che il sito mantiene', () => {
  it('l\'AI non è promessa quando è spenta', () => {
    if (!AI_NEGOZI_ACCESA) expect(testo).not.toMatch(/assistente AI/);
  });
  it('non dice che il telefono resta privato', () => {
    expect(testo).not.toMatch(/Telefono ed email restano privati/);
  });
  it('niente gruppi d\'acquisto né «l\'algoritmo premia i negozi attivi»', () => {
    expect(testo).not.toMatch(/gruppi d'acquisto/);
    expect(testo).not.toMatch(/algoritmo premia/);
    expect(testo).toMatch(/distanza/);
  });
  it('i pulsanti si chiamano come nel pannello', () => {
    expect(testo).toContain('"Accetta ordine"');
    expect(testo).toContain('"Ordine ricevuto"');
    expect(testo).toContain('"Pronto per il rider"');
    expect(testo).not.toMatch(/Pronto per la consegna|I miei prodotti|"Nuovo"/);
  });
});

describe('1829 — la newsletter non c\'è', () => {
  it('la pagina d\'aiuto non invita a iscriversi', () => {
    expect(readFileSync('app/seller/help/page.tsx', 'utf8')).not.toMatch(/newsletter/i);
  });
});
