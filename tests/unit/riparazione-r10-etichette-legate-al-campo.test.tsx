/**
 * @vitest-environment jsdom
 */
/**
 * R10-012 — Ogni etichetta del modulo negozio e del profilo è legata al suo campo: o è `label` con
 * `htmlFor` che punta a un campo che esiste, o è il titolo di un gruppo (`aria-labelledby`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: (p?: Record<string, unknown>) => ({ type: 'file', ...(p ?? {}) }), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => '' }));
vi.mock('@/components/seller/AccentPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/CoverPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/AnnouncementEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/BadgePicker', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/FeaturedProductsPicker', () => ({ default: () => null }));

import VendorForm from '@/components/VendorForm';
import { readFileSync } from 'node:fs';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(VendorForm, { onSubmit: vi.fn(), mode: 'branding', defaultValues: { storeName: 'Pane Quotidiano' } }));
  });
  return radice;
}

describe('R10-012 — etichette legate al loro campo', () => {
  it('nel modulo negozio nessuna label resta senza campo', async () => {
    const v = await monta();
    const orfane = Array.from(v.querySelectorAll('label')).filter((l) => !l.control).map((l) => l.textContent?.trim());
    expect(orfane).toEqual([]);
  });

  it('«Logo del negozio» punta al campo del logo', async () => {
    const v = await monta();
    const l = Array.from(v.querySelectorAll('label')).find((x) => /Logo del negozio/.test(x.textContent ?? ''));
    expect(l, 'etichetta del logo').toBeTruthy();
    expect(l?.control?.getAttribute('type')).toBe('file');
  });

  it('«Prodotti in evidenza» e «Banner annuncio» titolano il loro gruppo', async () => {
    const v = await monta();
    for (const titolo of ['Prodotti in evidenza', 'Banner annuncio']) {
      const gruppo = Array.from(v.querySelectorAll('[role="group"][aria-labelledby]')).find((g) => {
        const t = document.getElementById(g.getAttribute('aria-labelledby') ?? '');
        return t?.textContent?.trim() === titolo;
      });
      expect(gruppo, titolo).toBeTruthy();
    }
  });

  it('nel profilo l\'etichetta di «consegna Express» ha htmlFor e il campo ha lo stesso id', () => {
    const src = readFileSync('app/seller/profile/page.tsx', 'utf8');
    const per = src.match(/<label htmlFor="([^"]+)"/)?.[1];
    expect(per, 'htmlFor sulla label').toBeTruthy();
    expect(src).toContain(`id="${per}"`);
  });

  it('la regola jsx-a11y/label-has-associated-control non dà più avvisi sul profilo (la regola resta accesa)', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint();
    const [r] = await eslint.lintFiles(['app/seller/profile/page.tsx']);
    const avvisi = r.messages.filter((m) => m.ruleId === 'jsx-a11y/label-has-associated-control');
    expect(avvisi).toEqual([]);
    const cfg = await eslint.calculateConfigForFile('app/seller/profile/page.tsx');
    expect(cfg.rules?.['jsx-a11y/label-has-associated-control']?.[0]).not.toBe(0);
    expect(cfg.rules?.['jsx-a11y/label-has-associated-control']?.[0]).not.toBe('off');
    expect(readFileSync('app/seller/profile/page.tsx', 'utf8')).not.toContain('eslint-disable');
  }, 60000);

  it('nel profilo il testo di «consegna Express» sta dentro la label legata al checkbox', () => {
    const src = readFileSync('app/seller/profile/page.tsx', 'utf8');
    expect(src).toMatch(/<label htmlFor="profilo-consegna-express"[^>]*>[^<]*<Zap[^>]*\/>\s*Offro consegna Express\s*<\/label>/);
  });
});
