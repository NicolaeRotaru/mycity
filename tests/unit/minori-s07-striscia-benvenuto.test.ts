import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('S07 · la striscia del benvenuto non promette una scadenza che non c’è', () => {
  it('non scrive «scade tra N giorni»', () => {
    const src = readFileSync('components/WelcomeCreditBanner.tsx', 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/scade tra/);
    expect(src).not.toMatch(/daysLeft/);
  });
});
