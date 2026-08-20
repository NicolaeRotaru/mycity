import { describe, it, expect } from 'vitest';
import { inBlocchi, leggiInBlocchi } from '@/lib/supabase/blocchi';

/**
 * `.in('id', elenco)` non manda l'elenco nel corpo della richiesta: lo scrive
 * nell'indirizzo, ~37 caratteri per identificativo. Con duemila negozi sono
 * settantaquattromila caratteri contro un limite pratico fra otto e sedicimila.
 *
 * Il modo in cui si rompe è la parte peggiore: non un errore visibile, ma un
 * 414 che il codice legge come «nessun risultato». La sitemap continuerebbe a
 * rispondere, vuota, e Google smetterebbe di indicizzare il catalogo.
 */

const identificativi = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe('spezzare in blocchi', () => {
  it('duecentocinquanta identificativi diventano tre blocchi', () => {
    const b = inBlocchi(identificativi(250));
    expect(b.map((x) => x.length)).toEqual([100, 100, 50]);
  });

  it('una lista vuota non fa nessun blocco', () => {
    expect(inBlocchi([])).toEqual([]);
  });
});

describe('la lettura a blocchi', () => {
  it('interroga una volta per blocco e riunisce le righe', async () => {
    const visti: number[] = [];
    const { data, error } = await leggiInBlocchi<{ id: string }>(identificativi(250), (blocco) => {
      visti.push(blocco.length);
      return Promise.resolve({ data: blocco.map((id) => ({ id })), error: null });
    });
    expect(visti).toEqual([100, 100, 50]);
    expect(data).toHaveLength(250);
    expect(error).toBeNull();
  });

  it('con la lista vuota non interroga affatto', async () => {
    let chiamate = 0;
    await leggiInBlocchi([], () => { chiamate += 1; return Promise.resolve({ data: [], error: null }); });
    expect(chiamate).toBe(0);
  });

  it("l'errore di un blocco risale: meglio una pagina in errore che una pagina che mente", async () => {
    const { error } = await leggiInBlocchi<{ id: string }>(identificativi(150), (blocco) =>
      Promise.resolve(
        blocco[0] === 'id-100'
          ? { data: null, error: { message: 'URI too long' } }
          : { data: blocco.map((id) => ({ id })), error: null },
      ),
    );
    expect(error?.message).toBe('URI too long');
  });
});
