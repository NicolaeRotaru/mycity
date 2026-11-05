/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 5/11/2026 (S04) — La pagina /shop-of-month, montata:
 *  - con la classifica che non si legge diceva «Nessun negozio in classifica per ora» (422, 1834);
 *  - chi non ha fatto l'accesso e preme «Vota» riceveva un avviso senza strada per accedere (1834);
 *  - il codice sconto del negozio del mese, tolto dalla pagina, poteva tornare senza che nessuna
 *    prova lo vedesse: la prova di prima montava solo il riquadro della home (1769).
 */

type Avviso = { testo: string; opzioni?: { action?: { label: string; onClick: () => void } } };
const avvisi = vi.hoisted(() => ({ ko: [] as Avviso[] }));
vi.mock('sonner', () => ({
  toast: {
    success: () => {},
    error: (testo: string, opzioni?: Avviso['opzioni']) => avvisi.ko.push({ testo, opzioni }),
  },
}));

const g = globalThis as Record<string, unknown>;

const SCELTA = {
  id: 'p1', cover_image_url: null, headline: 'Il forno del mese', story: 'Pane vero',
  discount_code: 'FORNO15', discount_percent: 15, month: '2026-11-01',
  seller: { id: 'n-pane', store_name: 'Pane Quotidiano', store_logo: null },
};
const CLASSIFICA = [{ seller_id: 'n-pane', store_name: 'Pane Quotidiano', store_logo: null, vote_count: 3 }];

function dati(classifica: unknown) {
  g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey.includes('leaderboard') ? classifica : SCELTA);
}

async function pagina() {
  const mod = await monta('app/shop-of-month/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  return s;
}

afterEach(() => {
  for (const k of ['__DATI_QUERY__', '__ESITO_QUERY__', '__OPZIONI_QUERY__', '__RISPOSTA_SUPABASE__', '__NAVIGAZIONI__', '__UTENTE__']) delete g[k];
  avvisi.ko.length = 0;
  document.body.innerHTML = '';
});

describe('Negozio del mese', () => {
  it('con la classifica che non si legge non dice «nessun negozio», offre Riprova (422, 1834)', async () => {
    dati([]);
    g.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      o.queryKey.includes('leaderboard') ? { data: undefined, isError: true, isSuccess: false } : undefined;
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Nessun negozio in classifica/);
    expect(testo).toMatch(/Non riesco a leggere la classifica/);
    expect([...s.radice.querySelectorAll('button')].some((b) => /Riprova/.test(b.textContent ?? ''))).toBe(true);
  });

  it('la lettura della classifica che cade fa cadere la query (422)', async () => {
    const opzioni: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    g.__OPZIONI_QUERY__ = opzioni;
    dati(CLASSIFICA);
    await pagina();
    g.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'rete caduta' } };
    await expect(opzioni.find((o) => o.queryKey.includes('leaderboard'))!.queryFn()).rejects.toBeTruthy();
  });

  it('chi non ha fatto l’accesso e preme «Vota» riceve un avviso che porta all’accesso (1834)', async () => {
    dati(CLASSIFICA);
    const nav: Array<{ dove: string }> = [];
    g.__NAVIGAZIONI__ = nav;
    const s = await pagina();
    const vota = [...s.radice.querySelectorAll('button')].find((b) => /^Vota/.test(b.getAttribute('aria-label') ?? ''))!;
    s.agisci(() => clicca(vota));
    expect(avvisi.ko).toHaveLength(1);
    const azione = avvisi.ko[0].opzioni?.action;
    expect(azione?.label).toMatch(/Accedi/);
    azione!.onClick();
    expect(nav[0]?.dove).toMatch(/^\/sign-in\?returnTo=\/shop-of-month/);
  });

  it('il codice sconto del negozio del mese non compare sulla pagina (1769)', async () => {
    dati(CLASSIFICA);
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    // La scelta del mese è a schermo…
    expect(testo).toContain('Il forno del mese');
    // …ma il codice sconto no: i codici sono spenti al lancio.
    expect(testo).not.toContain('FORNO15');
    expect(testo).not.toMatch(/-15\s*%/);
  });
});
