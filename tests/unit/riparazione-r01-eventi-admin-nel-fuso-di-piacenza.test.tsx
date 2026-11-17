// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna } from './aiuti/cabina-admin';

/**
 * R01-006 — Nell'amministrazione la tabella degli eventi (e le schede sul telefono) scriveva
 * inizio e fine con `toLocaleString('it-IT')`, cioè nel fuso del computer di chi guarda: un
 * amministratore in viaggio, o un browser col fuso di Greenwich, leggeva un altro giorno e un'altra
 * ora rispetto a Piacenza — mentre i campi del modulo, accanto, erano già nell'ora di Piacenza.
 *
 * Qui il computer è a New York (process.env.TZ) e l'orologio è finto: un evento che a Piacenza
 * comincia alle 00:30 dell'11 novembre deve dire l'11 alle 00:30, non il 10 alle 18:30.
 */
vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

const TZ_PRIMA = process.env.TZ;
let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.(); chiudi = null; fake.azzera();
  vi.useRealTimers();
  if (TZ_PRIMA === undefined) delete process.env.TZ; else process.env.TZ = TZ_PRIMA;
});

// 23:30 di Greenwich del 10 = 00:30 dell'11 a Piacenza (ora solare, +1); fine alle 02:15 di Piacenza.
const EVENTO = {
  id: 'e1', title: 'Mercatino di San Martino', description: 'In piazza Cavalli', cover_image_url: null,
  starts_at: '2026-11-10T23:30:00+00:00', ends_at: '2026-11-11T01:15:00+00:00',
  discount_percent: null, cta_label: 'Partecipa', cta_url: null, status: 'scheduled',
};

async function apriConIlComputerA(fuso: string) {
  process.env.TZ = fuso;
  // Controprova: il fuso del «computer» è davvero cambiato, altrimenti la prova non misura niente.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(fuso);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T22:00:00Z'));
  fake.rispondi = (q) => (q.tabella === 'marketplace_events' && q.op === 'select'
    ? { data: [EVENTO], error: null }
    : { data: null, error: null });
  const mod = (await import('@/app/admin/events/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R01-006 · le date degli eventi nell admin sono nell ora di Piacenza', () => {
  for (const fuso of ['America/New_York', 'UTC']) {
    it(`con il computer a ${fuso} la tabella dice inizio e fine di Piacenza`, async () => {
      const host = await apriConIlComputerA(fuso);
      const riga = [...host.querySelectorAll('tr')].find((tr) => (tr.textContent ?? '').includes('Mercatino di San Martino'));
      expect(riga, 'controprova: la riga dell\'evento deve essere a video').toBeTruthy();
      const celle = [...riga!.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim());
      // Il giorno e l'ora di Piacenza (11, 00:30 e 02:15), non quelli del computer (il 10, alle
      // 18:30 o alle 23:30 per l'inizio; alle 20:15 o all'01:15 per la fine).
      expect(celle[1]).toMatch(/\b11\b.*\b00:30\b/);
      expect(celle[1]).not.toMatch(/\b10\b|18:30|23:30/);
      expect(celle[2]).toMatch(/\b11\b.*\b02:15\b/);
      expect(celle[2]).not.toMatch(/20:15|01:15/);
    });

    it(`con il computer a ${fuso} anche la scheda del telefono dice le ore di Piacenza`, async () => {
      const host = await apriConIlComputerA(fuso);
      const scheda = [...host.querySelectorAll('h3')].find((h) => (h.textContent ?? '').includes('Mercatino di San Martino'))
        ?.closest('div.rounded-xl');
      expect(scheda, 'controprova: la scheda dell\'evento deve essere a video').toBeTruthy();
      const date = [...scheda!.querySelectorAll('p')].map((p) => p.textContent ?? '').find((t) => t.includes('→'));
      expect(date, 'controprova: la riga «inizio → fine» deve essere a video').toBeTruthy();
      expect(date).toMatch(/\b11\b.*\b00:30\b.*→.*\b11\b.*\b02:15\b/);
      expect(date).not.toMatch(/\b10\b|18:30|23:30|20:15|01:15/);
    });
  }
});
