/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 (sesta ondata del sito, dopo il collaudo) — PRIMA DELLA 180 LA SPUNTA DEL RECESSO
 * NON FERMA IL PRODOTTO NUOVO.
 *
 * Il primo giro aveva messo la spunta «escluso dal recesso» nel modulo sempre. Ma la colonna
 * products.non_recedibile nasce con la migrazione 180, che si applica a mano: se il sito va in
 * produzione prima, il forno spunta la torta, preme «Pubblica» e PostgREST rifiuta la colonna
 * (PGRST204): il prodotto non si salva. Ora «Nuovo prodotto» guarda una riga di products letta
 * con `*`: la spunta compare solo se la colonna c'e'.
 *
 * La pagina e' quella VERA, compilata e montata; le domande alla banca dati rispondono dalla prova.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { colonnaDelRecessoPresente } from '@/lib/ordini/recesso';

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__']) globali[k] = undefined;
});

async function nuovoProdotto(colonnaPresente: boolean) {
  globali.__UTENTE__ = { id: 'seller-1' };
  globali.__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) =>
    o.queryKey?.[1] === 'colonna-del-recesso' ? colonnaPresente : undefined;
  const mod = await monta('app/seller/products/new/page.tsx');
  const s = accendi(mod.default, {});
  await attendi();
  await attendi();
  const spunta =
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) =>
      /escluso dal recesso/i.test(nomeAccessibile(i)),
    ) ?? null;
  return { s, spunta };
}

describe('«Nuovo prodotto» e la colonna del recesso', () => {
  it('IL CASO CHE ROMPEVA — senza la migrazione 180 la spunta non compare (e il prodotto si salva)', async () => {
    const { s, spunta } = await nuovoProdotto(false);
    expect((s.radice.textContent ?? '').length, 'controprova: la pagina si deve vedere').toBeGreaterThan(0);
    expect(spunta, 'la spunta compare anche se la banca dati non ha la colonna: «Pubblica» fallisce').toBeNull();
    s.smonta();
  }, 60000);

  it('controprova: con la migrazione 180 la spunta compare', async () => {
    const { s, spunta } = await nuovoProdotto(true);
    expect(spunta, 'con la colonna presente il forno deve poter segnare la torta').not.toBeNull();
    s.smonta();
  }, 60000);

  it('la riga letta con `*` dice se la colonna c\'e\'', () => {
    expect(colonnaDelRecessoPresente({ id: 'torta', non_recedibile: false })).toBe(true);
    expect(colonnaDelRecessoPresente({ id: 'torta', name: 'Torta' })).toBe(false);
    expect(colonnaDelRecessoPresente(null)).toBe(false);
  });
});
