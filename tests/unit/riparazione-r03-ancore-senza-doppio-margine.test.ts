import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R03-007 — Da md in su html ha già scroll-padding-top alto quanto la testata (app/globals.css).
 * Le ancore che avevano anche uno scroll-mt proprio si fermavano più in basso del dovuto: i due
 * margini si sommavano. Sotto md resta lo scroll-mt di prima, da md in su va a zero.
 */
const css = readFileSync('app/globals.css', 'utf8');
const classiDi = (src: string, id: string) => src.match(new RegExp(`id="${id}"[\\s\\S]{0,120}?className="([^"]*)"`))?.[1] ?? '';

describe('R03-007 · le ancore non sommano il loro margine allo scroll-padding', () => {
  it('lo scroll-padding da md in su c è (è lui a fare lo spazio)', () => {
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*html \{ scroll-padding-top: calc\(var\(--header-height\) \+ 0\.5rem\); \}/);
  });

  it('«Posizioni aperte» di lavora con noi: scroll-mt-24 sotto md, zero da md in su', () => {
    const classi = classiDi(readFileSync('app/lavora-con-noi/page.tsx', 'utf8'), 'posizioni').split(/\s+/);
    expect(classi).toContain('scroll-mt-24');
    expect(classi).toContain('md:scroll-mt-0');
  });

  it('«Recensioni» della scheda prodotto: scroll-mt-4 sotto md, zero da md in su', () => {
    const classi = classiDi(readFileSync('app/product/[id]/page.tsx', 'utf8'), 'recensioni').split(/\s+/);
    expect(classi).toContain('scroll-mt-4');
    expect(classi).toContain('md:scroll-mt-0');
    expect(classi.filter((c) => c.startsWith('md:scroll-mt-'))).toEqual(['md:scroll-mt-0']);
  });
});
