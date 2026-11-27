/**
 * @vitest-environment jsdom
 */
/**
 * R13-014 — Il modulo prodotto legge la spunta «escluso dal recesso» dell'apertura una volta sola.
 *
 * Il valore d'apertura si ricalcolava a ogni disegno. Se il padre rilegge il prodotto e passa
 * `initialValues` nuovi mentre il modulo è aperto (il modulo tiene i suoi valori), il salvataggio
 * confrontava la spunta (mai toccata) con il valore NUOVO e riscriveva `non_recedibile` in banca
 * dati senza che nessuno l'avesse toccata. Il modulo è quello vero, montato.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { attendi, clicca } from './aiuti/schermo';

type Riga = Record<string, unknown>;
const CATEGORIE = [{ id: 'cat-1', name: 'Forno', slug: 'forno-di-prova', parent_id: null }];
const torta = (extra: Riga = {}): Riga => ({
  name: 'Torta di compleanno', description: 'Pan di spagna, crema e fragole fresche.', price: 24, stock: 3,
  category_id: 'cat-1', images: ['https://mycity.test/torta.jpg'], attributes: {}, tags: [], status: 'available', ...extra,
});

let root: Root | null = null;
let radice: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  radice?.remove();
  root = null;
  document.body.innerHTML = '';
});

async function apri(iniziali: Riga) {
  const mod = await monta('components/seller/ProductForm.tsx');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const inviati: Riga[] = [];
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
  const disegna = (initialValues: Riga) =>
    act(() => {
      root!.render(createElement(Suspense, { fallback: null }, createElement(mod.default as never, {
        mode: 'edit', categories: CATEGORIE, initialValues, recessoSegnabile: true, productId: 'p-1',
        sellerOffersExpress: false, onSubmit: (p: Riga) => inviati.push(p),
      })));
    });
  await disegna(iniziali);
  await attendi();
  await attendi();
  const spunta = () =>
    Array.from(radice!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) =>
      /escluso dal recesso/i.test(nomeAccessibile(i)),
    )!;
  const salva = async () => {
    const b = Array.from(radice!.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('Salva modifiche'));
    if (!b) throw new Error('manca «Salva modifiche»');
    await act(() => clicca(b));
    for (let i = 0; i < 15 && inviati.length === 0; i++) await attendi();
  };
  return { disegna, spunta, salva, inviati };
}

describe('R13-014 — la spunta del recesso: valore d apertura letto una volta', () => {
  it('con initialValues cambiati dopo l apertura, una spunta mai toccata non riscrive il recesso', async () => {
    const m = await apri(torta({ nonRecedibile: false }));
    expect(m.spunta().checked).toBe(false);
    await m.disegna(torta({ nonRecedibile: true })); // il padre ha riletto il prodotto
    await attendi();
    expect(m.spunta().checked).toBe(false); // il modulo tiene i suoi valori
    await m.salva();
    expect(m.inviati).toHaveLength(1);
    expect('non_recedibile' in m.inviati[0]).toBe(false);
  }, 60000);

  it('toccata dall utente, la spunta parte lo stesso (comportamento visibile invariato)', async () => {
    const m = await apri(torta({ nonRecedibile: false }));
    await act(() => clicca(m.spunta()));
    await m.disegna(torta({ nonRecedibile: true }));
    await attendi();
    await m.salva();
    expect(m.inviati[0].non_recedibile).toBe(true);
  }, 60000);
});
