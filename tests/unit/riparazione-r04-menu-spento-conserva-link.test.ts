import { describe, it, expect } from 'vitest';
import { storeSiteSchema, defaultSite, normalizeSite, resolveMenu } from '@/lib/store-site';

/**
 * R04 — A menu spento, un link lasciato a metà spariva al salvataggio senza avviso. A menu acceso
 * lo stesso link non sparisce: resta nell'editor e il salvataggio lo rifiuta dicendo quale link
 * completare. Allineato: a menu spento il link a metà si conserva com'è (il salvataggio non si
 * blocca, come voleva R20-005), e quando il menu si riaccende vale il controllo di sempre.
 */

const senzaNome = { id: 'l1', label: '', target: { kind: 'home' } };
const paginaNonScelta = { id: 'l2', label: 'Chi siamo', target: { kind: 'page', pageId: '' } };
const indirizzoAMeta = { id: 'l3', label: 'Blog', target: { kind: 'external', url: 'https://' } };
const completo = { id: 'l4', label: 'Home', target: { kind: 'home' } };

function sito(enabled: boolean, links: unknown[]) {
  return { ...defaultSite(), menu: { enabled, links } };
}

describe('R04 — a menu spento un link a metà non sparisce al salvataggio', () => {
  it('il salvataggio passa e i link a metà restano, com\'erano, insieme ai completi', () => {
    const r = storeSiteSchema.safeParse(sito(false, [senzaNome, paginaNonScelta, indirizzoAMeta, completo]));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.menu.links).toEqual([senzaNome, paginaNonScelta, indirizzoAMeta, completo]);
  });

  it('riletto dal database, il link a metà c\'è ancora (e il sito non torna quello di default)', () => {
    const salvato = storeSiteSchema.parse(sito(false, [senzaNome, completo]));
    const riletto = normalizeSite(JSON.parse(JSON.stringify(salvato)));
    expect(riletto.menu.links.map((l) => l.id)).toEqual(['l1', 'l4']);
  });

  it('a menu spento il sito pubblico non mostra link', () => {
    expect(resolveMenu(storeSiteSchema.parse(sito(false, [senzaNome, completo])), 's1')).toEqual([]);
  });

  it('riacceso il menu, il link a metà si rifiuta come sempre, col percorso che dice quale link completare', () => {
    const r = storeSiteSchema.safeParse(sito(true, [completo, senzaNome]));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['menu', 'links', 1, 'label']);
  });
});
