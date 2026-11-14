/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R21-019 — La pagina del negozio del mese: se la redazione non ha ancora scelto lo
 * dice (col mese di Piacenza), e una lettura fallita non sembra la stessa cosa.
 */

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
const g = globalThis as Record<string, unknown>;

const SCELTA = {
  id: 'p1', cover_image_url: null, headline: 'Il forno del mese', story: 'Pane vero',
  discount_code: null, discount_percent: null, month: '2026-11-01',
  seller: { id: 'n-pane', store_name: 'Pane Quotidiano', store_logo: null },
};

function dati(scelta: unknown) {
  g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey.includes('leaderboard') ? [] : scelta);
}
async function pagina() {
  const mod = await monta('app/shop-of-month/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  return s;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T10:00:00Z')); });
afterEach(() => {
  vi.useRealTimers();
  for (const k of ['__DATI_QUERY__', '__ESITO_QUERY__', '__OPZIONI_QUERY__', '__RISPOSTA_SUPABASE__']) delete g[k];
  document.body.innerHTML = '';
});

describe('R21-019 · la scelta della redazione che non c\'è, o non si legge', () => {
  it('letta e vuota: dice che la scelta del mese arriva presto', async () => {
    dati(null);
    const testo = testoVisibile((await pagina()).radice);
    expect(testo).toMatch(/La scelta di novembre arriva presto/);
    expect(testo).not.toMatch(/Non riesco a leggere la scelta/);
  });

  it('lettura caduta: non dice «arriva presto» e offre Riprova', async () => {
    dati(undefined);
    g.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      o.queryKey.includes('leaderboard') ? undefined : { data: undefined, isError: true, isSuccess: false };
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).toMatch(/Non riesco a leggere la scelta della redazione/);
    expect(testo).not.toMatch(/arriva presto/);
    expect([...s.radice.querySelectorAll('button')].some((b) => /Riprova/.test(b.textContent ?? ''))).toBe(true);
  });

  it('con una scelta fatta compare il riquadro e non la frase', async () => {
    dati(SCELTA);
    const testo = testoVisibile((await pagina()).radice);
    expect(testo).toMatch(/Scelta della redazione/);
    expect(testo).not.toMatch(/arriva presto/);
  });

  it('la lettura che cade fa cadere la domanda: nessuna scelta e lettura fallita non sono la stessa cosa', async () => {
    const opzioni: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    g.__OPZIONI_QUERY__ = opzioni;
    dati(null);
    await pagina();
    g.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'rete caduta' } };
    const domanda = opzioni.find((o) => !o.queryKey.includes('leaderboard'))!;
    await expect(domanda.queryFn()).rejects.toBeTruthy();
    // una lettura riuscita ma vuota resta «nessuna scelta»
    g.__RISPOSTA_SUPABASE__ = { data: null, error: null };
    await expect(domanda.queryFn()).resolves.toBeNull();
  });
});
