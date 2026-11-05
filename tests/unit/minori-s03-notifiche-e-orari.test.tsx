import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
import { perchéNonSiAttiva } from '@/components/PushNotificationOptIn';

/** S03 — notifiche, pagina Stato, .env.example (schede 359, 358, 410, 2157). */
describe('attivare e spegnere le notifiche', () => {
  it('359 — l errore del browser non esce in inglese', () => {
    const e = Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' });
    expect(perchéNonSiAttiva(e)).not.toMatch(/Registration|failed|push service/i);
    expect(perchéNonSiAttiva(e)).toMatch(/notifiche/);
    const generico = new Error('Registration failed - push service error');
    expect(perchéNonSiAttiva(generico)).not.toMatch(/Registration/);
    expect(perchéNonSiAttiva(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toMatch(/permesso/);
  });

  it('358 — lo stato è un testo e spegnere è un pulsante «Disattiva» con conferma', () => {
    const src = readFileSync('components/PushNotificationOptIn.tsx', 'utf8');
    expect(src).not.toMatch(/'Notifiche attive'\}/);
    expect(src).toMatch(/Notifiche attive su questo dispositivo/);
    expect(src).toMatch(/window\.confirm\([^)]*disattivare/);
    expect(src).toMatch(/'Disattiva'/);
  });
});

describe('ore e variabili', () => {
  it('410 — la pagina Stato e l etichetta scrivono l ora di Piacenza', () => {
    expect(readFileSync('app/status/page.tsx', 'utf8')).toMatch(/timeStyle: 'short', timeZone: 'Europe\/Rome'/);
    expect(readFileSync('lib/shipping-etichetta/label.ts', 'utf8')).toMatch(/toLocaleString\('it-IT', \{ timeZone: 'Europe\/Rome' \}\)/);
  });

  it('2157 — il telefono dell assistenza ha il suo nome in .env.example', () => {
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^NEXT_PUBLIC_SUPPORT_PHONE=/m);
  });
});
