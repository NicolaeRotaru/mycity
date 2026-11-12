/**
 * @vitest-environment jsdom
 */
/**
 * R10-004 — Nel «Nuovo prodotto» la spunta «escluso dal recesso» compare solo
 * se la banca dati ha la colonna. Una lettura caduta valeva «no» e, con
 * `staleTime: Infinity`, quel «no» restava in memoria per tutta la sessione:
 * il negozio non poteva più segnare un prodotto fino al ricaricamento.
 *
 * Qui si monta la pagina VERA, si prende la domanda della colonna e la si fa
 * girare contro una banca dati che risponde con un errore.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
type Opzioni = { queryKey?: readonly unknown[]; queryFn?: () => Promise<unknown>; staleTime?: number };

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__OPZIONI_QUERY__', '__RISPOSTA_SUPABASE__']) globali[k] = undefined;
});

async function domandaDelRecesso(): Promise<Opzioni> {
  globali.__UTENTE__ = { id: 'seller-1' };
  globali.__OPZIONI_QUERY__ = [];
  const mod = await monta('app/seller/products/new/page.tsx');
  const s = accendi(mod.default, {});
  await attendi();
  const tutte = globali.__OPZIONI_QUERY__ as Opzioni[];
  s.smonta();
  const d = tutte.find((o) => o.queryKey?.[1] === 'colonna-del-recesso');
  expect(d, 'la pagina non chiede più se la colonna c’è').toBeTruthy();
  return d!;
}

describe('R10-004 — una lettura caduta non spegne la spunta per tutta la sessione', () => {
  it('la lettura caduta è un errore (si riprova), non un «no»', async () => {
    const d = await domandaDelRecesso();
    globali.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'timeout', code: '57014' } };
    await expect(d.queryFn!(), 'la lettura caduta vale «no»: la spunta sparisce').rejects.toBeTruthy();
  }, 60000);

  it('la risposta non resta in memoria per sempre', async () => {
    const d = await domandaDelRecesso();
    expect(d.staleTime === Infinity, 'staleTime: Infinity tiene la risposta per tutta la sessione').toBe(false);
  }, 60000);

  it('controprova: con la colonna presente la risposta è «sì»', async () => {
    const d = await domandaDelRecesso();
    globali.__RISPOSTA_SUPABASE__ = { data: [{ id: 'p1', non_recedibile: false }], error: null };
    await expect(d.queryFn!()).resolves.toBe(true);
  }, 60000);
});
