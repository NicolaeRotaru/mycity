/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 5/11/2026 (S04) — Il pannello «Aggiungi a lista» della scheda prodotto:
 *  - a chi non ha fatto l'accesso faceva scrivere il nome della lista e poi rispondeva solo
 *    «Accedi», senza strada per farlo (179);
 *  - non diceva al lettore di schermo in quali liste il prodotto c'è già (230).
 */
/** Quello che la lettura restituisce a chi non ha fatto l'accesso. */
const OSPITE: unknown = null;
const g = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: unknown[]; queryFn: () => Promise<unknown> };

afterEach(() => {
  for (const k of ['__DATI_QUERY__', '__OPZIONI_QUERY__', '__UTENTE__', '__ESITO_QUERY__', '__RISPOSTA_SUPABASE__']) delete g[k];
  document.body.innerHTML = '';
});

async function apri() {
  const mod = await monta('components/AddToListButton.tsx');
  const s = accendi(mod.default, { productId: 'p-focaccia' });
  await attendi();
  const avvio = [...s.radice.querySelectorAll('button')].find((b) => /Aggiungi a lista/.test(b.textContent ?? ''))!;
  s.agisci(() => clicca(avvio));
  await attendi();
  return s;
}

describe('Aggiungi a lista', () => {
  it('chi non ha fatto l’accesso non scrive un nome a vuoto: trova la strada per accedere (179)', async () => {
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    g.__DATI_QUERY__ = (o: Opzioni) => (o.queryKey.includes('containing') ? [] : undefined);
    await apri();
    const mie = opzioni.find((o) => !o.queryKey.includes('containing'))!;
    expect(await mie.queryFn()).toBeNull();

    document.body.innerHTML = '';
    g.__DATI_QUERY__ = (o: Opzioni): unknown => (o.queryKey.includes('containing') ? [] : OSPITE);
    const s = await apri();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Non hai ancora liste/);
    expect(s.radice.querySelector('input')).toBeNull();
    const link = s.radice.querySelector('a[href^="/sign-in"]');
    expect(link?.getAttribute('href')).toBe('/sign-in?returnTo=%2Fproduct%2Fp-focaccia');
  });

  it('ogni lista dice se il prodotto c’è già (aria-pressed) (230)', async () => {
    g.__UTENTE__ = { id: 'u-maria' };
    g.__DATI_QUERY__ = (o: Opzioni) =>
      o.queryKey.includes('containing')
        ? ['L1']
        : [{ id: 'L1', title: 'Colazione', cover_emoji: null }, { id: 'L2', title: 'Regali', cover_emoji: null }];
    const s = await apri();
    const voce = (t: string) => [...s.radice.querySelectorAll('li button')].find((b) => (b.textContent ?? '').includes(t))!;
    expect(voce('Colazione').getAttribute('aria-pressed')).toBe('true');
    expect(voce('Regali').getAttribute('aria-pressed')).toBe('false');
  });

  it('con la lettura delle liste caduta non dice «non hai liste» e non lascia toccare a caso', async () => {
    g.__UTENTE__ = { id: 'u-maria' };
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    g.__ESITO_QUERY__ = { data: undefined, isError: true, isSuccess: false };
    const s = await apri();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Non hai ancora liste/);
    expect(testo).toMatch(/Non riesco a leggere le tue liste/);
    expect(s.radice.querySelector('li button')).toBeNull();
    delete g.__ESITO_QUERY__;
    g.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'rete caduta' } };
    for (const o of opzioni) await expect(o.queryFn()).rejects.toBeTruthy();
    delete g.__RISPOSTA_SUPABASE__;
  });
});
