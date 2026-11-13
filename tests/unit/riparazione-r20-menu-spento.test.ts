import { describe, it, expect } from 'vitest';
import { storeSiteSchema, defaultSite, resolveMenu } from '@/lib/store-site';

const bozza = { id: 'l1', label: '', target: { kind: 'home' } };
const buono = { id: 'l2', label: 'Home', target: { kind: 'home' } };

function sito(enabled: boolean, links: unknown[]) {
  return { ...defaultSite(), menu: { enabled, links } };
}

describe('R20-005 menu spento con link a metà', () => {
  it('con il menu spento un link col nome vuoto non blocca il salvataggio', () => {
    const r = storeSiteSchema.safeParse(sito(false, [bozza, buono]));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.menu.links.map((l) => l.id)).toEqual(['l2']);
  });

  it('con il menu acceso il link vuoto è ancora rifiutato', () => {
    const r = storeSiteSchema.safeParse(sito(true, [bozza]));
    expect(r.success).toBe(false);
  });

  it('il sito pubblico con menu spento non mostra link', () => {
    const r = storeSiteSchema.parse(sito(false, [bozza, buono]));
    expect(resolveMenu(r, 's1')).toEqual([]);
  });
});
