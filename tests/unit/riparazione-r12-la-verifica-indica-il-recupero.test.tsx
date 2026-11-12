/**
 * @vitest-environment jsdom
 */
/**
 * R12-011 — Chi si registrava con un'email che ha già un account leggeva «Ti
 * abbiamo inviato un link di conferma» (Supabase risponde «ok» per non
 * rivelare chi è iscritto, ma nessuna email parte), e nessuno gli indicava il
 * recupero della password. E il tetto email del progetto gli parlava di
 * «troppe email a questo indirizzo».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: null } }), resend: async () => ({ error: null }) } },
  auth: { signOut: async () => {} },
}));

import { ricordaEmailDaConfermare, memoriaDellaScheda } from '@/lib/auth/conferma-email';
import { traduciErroreAuth } from '@/lib/errors';
import VerifyEmailPage from '@/app/auth/verify-email/page';

let radice: Root;
let c: HTMLDivElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  ricordaEmailDaConfermare(memoriaDellaScheda(), 'cliente.uno@esempio.it');
  c = document.createElement('div');
  document.body.appendChild(c);
  radice = createRoot(c);
  await act(async () => { radice.render(createElement(VerifyEmailPage)); });
});
afterEach(() => {
  act(() => radice.unmount());
  c.remove();
});

describe('R12-011 chi ha già un account trova la sua strada', () => {
  it('la pagina non afferma di aver mandato un link a chi potrebbe già essere iscritto', () => {
    expect(c.textContent).not.toMatch(/Ti abbiamo inviato un link di conferma a/);
    expect(c.textContent).toMatch(/già un account/);
  });

  it('c è il recupero della password, e l accesso', () => {
    expect(c.querySelector('a[href^="/reset-password"]')).not.toBeNull();
    expect(c.querySelector('a[href^="/sign-in"]')).not.toBeNull();
  });

  it('il tetto email del progetto non parla di «questo indirizzo»', () => {
    expect(traduciErroreAuth('email rate limit exceeded')).not.toMatch(/questo indirizzo/);
  });
});
