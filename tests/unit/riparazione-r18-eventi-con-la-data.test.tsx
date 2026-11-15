/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R18-018 (la parte della pagina) — /events diceva solo «tra 54 giorni» o «Inizia tra 7h»:
 * nessuna data, nessuna ora, e San Silvestro e Capodanno uscivano uguali. Un evento appena
 * finito restava «Termina tra 0 min» fino alla rilettura successiva.
 *
 * Orologio finto, e il fuso del processo NON è quello di Roma: la data scritta deve essere
 * quella di Piacenza comunque.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const g = globalThis as Record<string, unknown>;
const ADESSO = '2026-11-07T10:00:00Z';
const fusoDiPrima = process.env.TZ;

function evento(sopra: Record<string, unknown>) {
  return {
    id: 'ev', title: 'Evento', description: 'd', cover_image_url: null,
    starts_at: '2026-12-31T19:00:00Z', ends_at: '2026-12-31T23:30:00Z', discount_percent: null,
    cta_label: 'Partecipa', cta_url: null, status: 'scheduled', sponsor_seller_id: null, sponsor: null,
    ...sopra,
  };
}

async function pagina(eventi: unknown[]) {
  g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey[1] === 'public' ? eventi : {});
  const mod = await monta('app/events/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  return s;
}

beforeEach(() => {
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(ADESSO));
});

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = fusoDiPrima;
  delete g.__DATI_QUERY__;
  document.body.innerHTML = '';
});

describe('R18-018 · la pagina Eventi dice giorno e ora', () => {
  it('San Silvestro e Capodanno non escono più uguali: accanto a «tra N giorni» c’è la data di Piacenza', async () => {
    const s = await pagina([
      evento({ id: 'silvestro', title: 'Cenone di San Silvestro', starts_at: '2026-12-31T19:00:00Z', ends_at: '2026-12-31T22:59:00Z' }),
      evento({ id: 'capodanno', title: 'Brindisi di Capodanno', starts_at: '2027-01-01T11:00:00Z', ends_at: '2027-01-01T15:00:00Z' }),
    ]);
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('31 dic 2026, 20:00');
    expect(testo).toContain('1 gen 2027, 12:00');
    s.smonta();
  });

  it('un evento in corso dice anche quando finisce, nell’ora di Piacenza', async () => {
    const s = await pagina([
      evento({ id: 'live', title: 'Flash sale', status: 'live', starts_at: '2026-11-07T09:00:00Z', ends_at: '2026-11-07T17:00:00Z' }),
    ]);
    expect(testoVisibile(s.radice)).toMatch(/Termina tra 7h · 7 nov 2026, 18:00/);
    s.smonta();
  });

  it('nell’ultimo mezzo minuto non dice «tra 0 min», e appena finito sparisce senza aspettare la rilettura', async () => {
    const s = await pagina([
      evento({ id: 'quasi', title: 'Quasi finito', status: 'live', starts_at: '2026-11-07T08:00:00Z', ends_at: '2026-11-07T10:00:20Z' }),
    ]);
    const prima = testoVisibile(s.radice);
    expect(prima).toContain('Quasi finito');
    expect(prima).not.toMatch(/tra 0 min/);
    expect(prima).toMatch(/Termina tra meno di un minuto/);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(testoVisibile(s.radice)).not.toContain('Quasi finito');
    s.smonta();
  });
});
