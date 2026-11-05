import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** S08 (5/11/2026) — Il piè di pagina pubblico (schede 1827, 333, 439). */

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

async function piede() {
  const { default: Footer } = await import('@/components/Footer');
  return renderToStaticMarkup(createElement(Footer));
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPPORT_PHONE;
});

describe('il piè di pagina', () => {
  it('scheda 1827 — con la newsletter spenta non resta la fascia crema vuota', async () => {
    const { NEWSLETTER_ACCESA } = await import('@/lib/funzioni-al-lancio');
    const html = await piede();
    if (!NEWSLETTER_ACCESA) expect(html).not.toContain('border-t border-cream-300 bg-cream-100');
  });

  it('scheda 333 — senza un numero pubblico non c è il simbolo del telefono con gli orari', async () => {
    const html = await piede();
    expect(html).not.toContain('Lun-Ven 9-18');
    expect(html).not.toContain('href="tel:');
  });

  it('scheda 333 — col numero impostato la voce c è, ed è un link tel:', async () => {
    process.env.NEXT_PUBLIC_SUPPORT_PHONE = '+39 0523 123456';
    const html = await piede();
    expect(html).toContain('href="tel:+390523123456"');
  });

  it('scheda 439 — niente link a negozio del mese, eventi e liste vuote', async () => {
    const html = await piede();
    for (const via of ['/shop-of-month', '/events', '/lists']) expect(html).not.toContain(`href="${via}"`);
  });
});
