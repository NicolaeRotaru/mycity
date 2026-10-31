/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 (sesta ondata del sito) — IL NEGOZIO SEGNA I PRODOTTI ESCLUSI DAL RECESSO.
 *
 * Pane, freschi e ordinazioni non si rendono per ripensamento (art. 59 lett. c-d Cod.
 * Cons.; scelta di Nicola del 31/10). Fin qui il modulo prodotto non aveva un modo per
 * dirlo: Pane Quotidiano non poteva segnare la torta, e la rotta dei resi la trattava
 * come un barattolo di miele. Ora il modulo ha la spunta, e la manda solo quando il
 * negoziante la cambia (un «no» mai toccato non riscrive la banca dati).
 *
 * Il modulo e' quello VERO, compilato e montato.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

type Riga = Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
});

const CATEGORIE = [{ id: 'cat-1', name: 'Forno', slug: 'forno-di-prova', parent_id: null }];

function torta(extra: Riga = {}): Riga {
  return {
    name: 'Torta di compleanno',
    description: 'Pan di spagna, crema e fragole fresche.',
    price: 24,
    stock: 3,
    category_id: 'cat-1',
    images: ['https://mycity.test/torta.jpg'],
    attributes: {},
    tags: [],
    status: 'available',
    ...extra,
  };
}

async function apri(initialValues: Riga, altro: Riga = { recessoSegnabile: true }) {
  const mod = await monta('components/seller/ProductForm.tsx');
  const inviati: Riga[] = [];
  const s = accendi(mod.default, {
    mode: 'edit',
    categories: CATEGORIE,
    initialValues,
    onSubmit: (payload: Riga) => inviati.push(payload),
    sellerOffersExpress: false,
    productId: 'p-1',
    ...altro,
  });
  await attendi();
  await attendi();
  const spunta = () =>
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) =>
      /escluso dal recesso/i.test(nomeAccessibile(i)),
    ) ?? null;
  const salva = async () => {
    const b = Array.from(s.radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('Salva modifiche'));
    if (!b) throw new Error('manca «Salva modifiche»');
    s.agisci(() => clicca(b));
    for (let i = 0; i < 15 && inviati.length === 0; i++) await attendi();
  };
  return { s, spunta, salva, inviati };
}

describe('la spunta «escluso dal recesso» nel modulo prodotto', () => {
  it('IL CASO CHE ROMPEVA — il forno spunta la torta e salva: il prodotto parte escluso dal recesso', async () => {
    const m = await apri(torta());
    const el = m.spunta();
    expect(el, 'il modulo non ha un modo per dire «escluso dal recesso»').not.toBeNull();
    expect(el!.checked).toBe(false);
    m.s.agisci(() => clicca(el!));
    expect(m.spunta()!.checked).toBe(true);
    await m.salva();
    expect(m.inviati, 'il modulo non ha salvato').toHaveLength(1);
    expect(m.inviati[0].non_recedibile).toBe(true);
    m.s.smonta();
  }, 60000);

  it('un prodotto gia\' segnato si apre spuntato, e un salvataggio che non lo tocca non lo riscrive', async () => {
    const m = await apri(torta({ nonRecedibile: true }));
    expect(m.spunta()?.checked).toBe(true);
    await m.salva();
    expect(m.inviati).toHaveLength(1);
    expect('non_recedibile' in m.inviati[0]).toBe(false);
    m.s.smonta();
  }, 60000);

  /**
   * 31/10/2026 (collaudo) — UNA SPUNTA CHE NON ARRIVA IN BANCA DATI NON SI MOSTRA.
   * In modifica la porta del venditore (colonneAmmesse) butta via non_recedibile, e
   * prima della migrazione 180 la creazione con la spunta falliva (PGRST204). La pagina
   * che non puo' salvarla non passa `recessoSegnabile`: il forno non vede una spunta
   * che dice «escluso» mentre il reso per ripensamento resta aperto.
   */
  it('IL CASO CHE ROMPEVA — senza una strada che la salvi, la spunta non compare e non parte', async () => {
    const m = await apri(torta({ nonRecedibile: true }), {});
    expect(m.spunta(), 'la spunta compare anche dove il salvataggio la butta via').toBeNull();
    await m.salva();
    expect(m.inviati).toHaveLength(1);
    expect('non_recedibile' in m.inviati[0]).toBe(false);
    m.s.smonta();
  }, 60000);
});
