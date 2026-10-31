import { describe, it, expect, vi, afterEach } from 'vitest';

// Gli interruttori del lancio fissati a «spento»: la prova non deve dipendere da come sono oggi.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  DROP_DEL_GIORNO_ACCESO: false,
  NEWSLETTER_ACCESA: false,
}));

import { normalizeHomeSite, leggiHomeSite, defaultHomeSite, homeEnabledSections } from '@/lib/home-site';
import { logger } from '@/lib/logger';

/**
 * 31/10/2026 — UNA SEZIONE ROTTA NON CANCELLA LA HOME COMPOSTA DAL PANNELLO.
 *
 * La home salvata si validava tutta insieme: un solo banner con la foto in `http://` bastava
 * perché la home intera tornasse alle 11 sezioni di partenza, senza un log. L'editor leggeva la
 * stessa cosa, e al primo salvataggio la home di partenza prendeva il posto di quella vera.
 */

const salvata = {
  version: 1,
  sections: [
    { id: 'hero', type: 'hero', enabled: true, config: { headline: 'Piacenza sotto casa' } },
    { id: 'b1', type: 'banner', enabled: true, config: { imageUrl: 'http://esempio.it/foto.jpg', heading: 'Saldi' } },
    { id: 't1', type: 'richText', enabled: true, config: { heading: 'Chi siamo', body: '<p>I negozi di Piacenza.</p>' } },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('la home salvata si legge sezione per sezione', () => {
  it('scarta solo il banner rotto: hero e testo restano, nell ordine dell admin', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const out = normalizeHomeSite(salvata);
    expect(out).not.toEqual(defaultHomeSite());
    expect(out.sections.map((s) => s.id)).toEqual(['hero', 't1']);
  });

  it('dice quale sezione ha lasciato fuori, e lo scrive nel log', () => {
    const avviso = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { scartate } = leggiHomeSite(salvata);
    expect(scartate).toHaveLength(1);
    expect(scartate[0]).toMatchObject({ posizione: 1, id: 'b1', type: 'banner' });
    normalizeHomeSite(salvata);
    expect(avviso).toHaveBeenCalledTimes(1);
  });

  it('newsletter e Drop salvati accesi non compaiono con gli interruttori spenti', () => {
    const conSpente = {
      version: 1,
      sections: [
        { id: 'hero', type: 'hero', enabled: true, config: {} },
        { id: 'n1', type: 'newsletter', enabled: true, config: {} },
        { id: 'd1', type: 'dropOfDay', enabled: true, config: {} },
        { id: 'b1', type: 'banner', enabled: true, config: { imageUrl: 'http://esempio.it/x.jpg' } },
      ],
    };
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const site = normalizeHomeSite(conSpente);
    expect(site.sections.map((s) => s.id)).toEqual(['hero', 'n1', 'd1']);
    expect(homeEnabledSections(site).map((s) => s.type)).toEqual(['hero']);
  });

  it('la home di partenza torna solo se non si salva nessuna sezione', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const tutteRotte = { version: 1, sections: [{ id: 'b1', type: 'banner', config: { imageUrl: 'http://x.it/a.jpg' } }] };
    expect(normalizeHomeSite(tutteRotte)).toEqual(defaultHomeSite());
    expect(normalizeHomeSite({})).toEqual(defaultHomeSite());
  });
});
