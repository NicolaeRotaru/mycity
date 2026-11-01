import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeHomeSite, type HomeSection } from '@/lib/home-site';
import { logger } from '@/lib/logger';

/**
 * 01/11/2026 — L'eroe della home salvato il 24/6 in site_settings.home_site vince sul codice e
 * dice «abbigliamento… arriva a casa in 30-60 min». Qui si salva quella riga e si guarda cosa
 * esce: le promesse superate non passano (il renderer usa il testo del codice), e lo si dice nei log.
 */
const SALVATO_24_6 =
  'Alimentari, abbigliamento, casa, elettronica: ordini dai commercianti del tuo quartiere in pochi tap, arriva a casa in 30-60 min e paghi alla consegna.';

function eroe(config: Record<string, unknown>) {
  const site = normalizeHomeSite({
    version: 1,
    sections: [
      { id: 'hero', type: 'hero', enabled: true, config },
      { id: 'categories', type: 'categories', enabled: true, config: {} },
    ],
  });
  const h = site.sections.find((s: HomeSection) => s.type === 'hero');
  return { site, config: (h?.config ?? {}) as Record<string, unknown> };
}

describe("l'eroe salvato della home non ripubblica promesse superate", () => {
  afterEach(() => vi.restoreAllMocks());

  it('scarta il sottotitolo salvato il 24/6 e lo scrive nei log', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { site, config } = eroe({ headline: 'I negozi di Piacenza', subhead: SALVATO_24_6 });
    expect(config.subhead ?? '').toBe('');
    expect(config.headline).toBe('I negozi di Piacenza');
    expect(site.sections.map((s) => s.type)).toEqual(['hero', 'categories']);
    expect(warn).toHaveBeenCalled();
  });

  it('scarta anche titolo e occhiello con «30-60 min» certi o «abbigliamento»', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { config } = eroe({ eyebrow: 'Spesa, abbigliamento e casa', headline: 'A casa in 30–60 min' });
    expect(config.eyebrow ?? '').toBe('');
    expect(config.headline ?? '').toBe('');
  });

  it('le frasi giuste restano: il freno non scarta la veloce detta come veloce', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const sub = 'Consegna all\'ora che scegli, oppure la veloce in 30-60 min.';
    const { config } = eroe({ subhead: sub });
    expect(config.subhead).toBe(sub);
    expect(warn).not.toHaveBeenCalled();
  });
});
