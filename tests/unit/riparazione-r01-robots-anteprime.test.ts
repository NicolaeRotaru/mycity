import { describe, it, expect, afterEach, vi } from 'vitest';
import robots from '@/app/robots';

/**
 * R01-017 — Sulle anteprime di Vercel il file per i motori di ricerca apriva tutto il sito
 * (`allow: '/'`, come in produzione) invece di chiuderlo.
 */
afterEach(() => { vi.unstubAllEnvs(); });

const regole = () => {
  const r = robots().rules;
  return Array.isArray(r) ? r : [r];
};

describe('R01-017 · robots.txt chiude le anteprime e apre solo la produzione', () => {
  it('su un\'anteprima chiude tutto il sito', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://anteprima.example');
    const r = regole();
    expect(r.some((x) => x.allow === '/' || (Array.isArray(x.allow) && x.allow.includes('/')))).toBe(false);
    expect(r.some((x) => x.disallow === '/' || (Array.isArray(x.disallow) && x.disallow.includes('/')))).toBe(true);
  });

  it('in produzione resta aperto, con le aree private chiuse', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity-marketplace.com');
    const r = regole();
    expect(r[0].allow).toBe('/');
    expect(r[0].disallow).toContain('/admin/');
  });
});
