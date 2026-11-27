import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as storie from '@/stories/StoreAvatar.stories';

/**
 * 27/11/2026 — LE STORIE DI STOREAVATAR USAVANO ANCORA LOGHI DA PLACEHOLD.CO.
 *
 * Il sito non usa piu' placehold.co per i loghi; le storie di Storybook si', e dipendevano dalla rete
 * di un sito di terzi. Ora i loghi delle storie sono file nostri in public/ (Storybook la serve con
 * `staticDirs`). Prova leggera: legge gli argomenti veri di ogni storia.
 */

type ConArgs = { args?: { logoUrl?: string | null } };

const loghi = Object.entries(storie)
  .filter(([nome]) => nome !== 'default')
  .map(([nome, s]) => [nome, (s as ConArgs).args?.logoUrl] as const)
  .filter((x): x is readonly [string, string] => typeof x[1] === 'string' && x[1] !== '');

describe('le storie di StoreAvatar usano loghi nostri', () => {
  it('almeno una storia mostra un logo', () => {
    expect(loghi.length).toBeGreaterThanOrEqual(1);
  });

  for (const [nome, logo] of loghi) {
    it(`«${nome}»: il logo non viene da un sito esterno ed esiste in public/`, () => {
      expect(logo, `${nome} usa ${logo}`).not.toMatch(/^https?:\/\//);
      expect(logo).not.toContain('placehold.co');
      expect(logo.startsWith('/')).toBe(true);
      expect(existsSync(join(process.cwd(), 'public', logo)), `public${logo} non esiste`).toBe(true);
    });
  }
});
