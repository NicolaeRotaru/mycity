/**
 * R16-002 — misure del testo a mano (text-[Npx]) dove la scala di tailwind.config.ts ha un passo entro 1 px.
 * Prova leggera: nei file della sessione resta text-[Npx] solo dove non c'è un passo entro 1 px
 * (scala: 10 2xs, 12 xs, 14 sm, 16 base, 18 lg, 20 xl, 24 2xl, 30 3xl, 36 4xl, 48 5xl).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = [
  'components/seller/SellerShell.tsx', 'app/rider/earnings/page.tsx', 'app/search/page.tsx',
  'components/admin/AdminSidebar.tsx', 'components/ImageUrlField.tsx', 'app/returns/page.tsx', 'app/lavora-con-noi/page.tsx',
];
const SCALA = [10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60];

describe('R16-002 · scala tipografica', () => {
  it('nessun text-[Npx] con un passo entro 1 px', () => {
    for (const f of FILE) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      for (const m of src.matchAll(/text-\[(\d+)px\]/g)) {
        const n = Number(m[1]);
        expect(SCALA.some((p) => Math.abs(p - n) <= 1), `${f}: text-[${n}px]`).toBe(false);
      }
    }
  });
});
