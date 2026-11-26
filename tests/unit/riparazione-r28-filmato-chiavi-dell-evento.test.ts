import { describe, expect, it } from 'vitest';
import { filmatoSenzaDatiPersonali } from '@/lib/analytics/filmato-senza-dati-personali';

/**
 * IL CANCELLO DEL FILMATO GUARDA ANCHE LE CHIAVI DELL'EVENTO DIVERSE DA `data`.
 *
 * `{ ...valore, data: … }` puliva `data` e copiava tutto il resto così com'era: una chiave in più
 * accanto a `type`, `data` e `timestamp` usciva dal browser senza che nessuno la guardasse.
 * Oggi rrweb e PostHog non ne mettono altre, ma il cancello pulisce per contenuto proprio per
 * il canale che nessuno ha ancora scritto.
 */

const esce = (filmato: unknown) => JSON.stringify(filmatoSenzaDatiPersonali(filmato));

describe('le chiavi dell evento rrweb diverse da data', () => {
  it('una chiave in più sulla targa con un email non la fa uscire', () => {
    const uscita = esce([
      { type: 4, data: { href: 'https://mycity.test/search?q=pane', width: 390, height: 844 }, timestamp: 1700000000000, nota: 'scrivimi a mario.rossi@gmail.com' },
    ]);
    expect(uscita).not.toContain('mario.rossi');
    expect(uscita).toContain('"type":4');
    expect(uscita).toContain('"timestamp":1700000000000');
    expect(uscita).toContain('390');
  });

  it('una chiave in più, annidata, su un evento personalizzato: né email né telefono escono', () => {
    const uscita = esce({ type: 5, data: { tag: 'carrello' }, timestamp: 2, extra: { chi: 'giulia.bianchi@example.com', tel: '333 123 4567' } });
    expect(uscita).not.toContain('giulia.bianchi');
    expect(uscita).not.toContain('123 4567');
    expect(uscita).toContain('carrello');
  });

  it('sul DOM del filmato passa intero solo data: la chiave in più si pulisce', () => {
    const dom = { node: { type: 2, tagName: 'link', attributes: { href: 'https://mycity.test/_next/static/css/app.css?v=8f3a1c' } } };
    const pulito = filmatoSenzaDatiPersonali([{ type: 2, data: dom, timestamp: 3, origine: '/search?q=mario.rossi%40gmail.com' }]) as Array<Record<string, unknown>>;
    expect(JSON.stringify(pulito)).not.toContain('mario.rossi');
    expect(pulito[0].data, 'il DOM del filmato è stato riscritto').toBe(dom);
    expect(pulito[0].timestamp).toBe(3);
  });

  it('un fotogramma compresso di PostHog resta com è: cv, timestamp e DOM, stesso oggetto', () => {
    const fotogramma = { type: 2, data: 'H4sIAAAAAAAAA', cv: '2024-10', timestamp: 4 };
    const pulito = filmatoSenzaDatiPersonali([fotogramma]) as unknown[];
    expect(pulito[0]).toBe(fotogramma);
  });
});
