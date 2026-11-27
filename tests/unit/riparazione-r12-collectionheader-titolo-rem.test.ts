import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('R12-007 — il titolo di CollectionHeader da 640 px in su usa rem, non pixel', () => {
  const src = readFileSync(join(process.cwd(), 'components', 'CollectionHeader.tsx'), 'utf8');
  const h1 = src.split('\n').find((r) => r.includes('<h1')) ?? '';
  it('la classe sm:text-[...] dell\'h1 è in rem', () => {
    const m = h1.match(/sm:text-\[([^\]]+)\]/);
    expect(m, 'manca la misura sm:text-[…] sull\'h1').not.toBeNull();
    expect(m![1]).toMatch(/rem$/);
    expect(h1).not.toMatch(/sm:text-\[\d+px\]/);
  });
});
