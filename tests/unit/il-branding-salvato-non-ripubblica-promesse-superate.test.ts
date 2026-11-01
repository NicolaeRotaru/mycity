import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeBranding, promessaSuperata, defaultBranding, DEFAULT_FOOTER_TAGLINE, DESCRIZIONE_DEL_SITO,
} from '@/lib/site-branding';

/**
 * 01/11/2026 — Una frase salvata dall'amministratore prima delle ondate 13-14 vince sui testi del
 * codice e resta pubblicata. Qui si salva una riga vecchia nel branding (come l'eroe della home del
 * 24/6) e si guarda cosa esce: le promesse superate non passano, e lo si dice nei log.
 */
describe('il branding salvato non ripubblica promesse superate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('scarta la striscia salvata con «30-60 min» certi e «abbigliamento», e lo scrive nei log', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = normalizeBranding({
      announcement: {
        items: [
          { icon: 'zap', text: 'Arriva a casa in 30-60 min' },
          { icon: 'tag', text: 'Alimentari e abbigliamento' },
          { icon: 'store', text: 'Botteghe di Piacenza' },
        ],
      },
      footerTagline: 'Alimentari, abbigliamento, casa: arriva a casa in 30-60 min e paghi alla consegna.',
    });
    const testi = b.announcement.items.map((i) => i.text);
    expect(testi).toEqual(['Botteghe di Piacenza']);
    expect(b.footerTagline).toBe(DEFAULT_FOOTER_TAGLINE);
    expect(err).toHaveBeenCalled();
  });

  it('se tutte le voci salvate sono superate, torna alle frasi del codice', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = normalizeBranding({ announcement: { items: [{ icon: 'zap', text: 'Consegna in 30–60 min' }] } });
    expect(b.announcement.items).toEqual(defaultBranding().announcement.items);
  });

  it('la veloce detta come veloce resta ammessa, e i testi del codice sono puliti', () => {
    expect(promessaSuperata('Consegna all\'ora che scegli, oppure veloce in 30-60 minuti')).toBeNull();
    expect(promessaSuperata('Spedizione in 30-60 min garantita')).not.toBeNull();
    expect(promessaSuperata('Moda e abbigliamento')).not.toBeNull();
    for (const t of [DEFAULT_FOOTER_TAGLINE, DESCRIZIONE_DEL_SITO, ...defaultBranding().announcement.items.map((i) => i.text)]) {
      expect(promessaSuperata(t)).toBeNull();
    }
  });
});
