/**
 * @vitest-environment jsdom
 *
 * L'aiutante `accendi` montava la pagina senza un Suspense: dopo un invio una pagina che legge
 * i parametri con `use(params)` non si rimontava, e la seconda prova della stessa pagina restava
 * vuota. Una pagina finta con `use(params)` si monta due volte di seguito, con un invio in mezzo.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, useState } from 'react';
import { use } from './aiuti/finti/react-con-use.mjs';
import { accendi, attendi, clicca } from './aiuti/schermo';

function PaginaFinta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params) as { id: string };
  const [inviato, setInviato] = useState(false);
  return createElement(
    'form',
    { onSubmit: (e: { preventDefault: () => void }) => { e.preventDefault(); setInviato(true); } },
    createElement('p', null, inviato ? `inviato ${id}` : `modulo ${id}`),
    createElement('button', { type: 'submit' }, 'Invia'),
  );
}

afterEach(() => { document.body.innerHTML = ''; });

async function giraAttesa() {
  for (let i = 0; i < 10; i++) await attendi();
}

describe('accendi monta due volte di seguito una pagina con use(params) dopo un invio', () => {
  it('la seconda montatura mostra la pagina, come la prima', async () => {
    const primo = accendi(PaginaFinta, { params: Promise.resolve({ id: 'a' }) });
    await giraAttesa();
    expect(document.body.textContent).toContain('modulo a');
    primo.agisci(() => clicca(document.querySelector('button')!));
    await giraAttesa();
    expect(document.body.textContent).toContain('inviato a');
    primo.smonta();

    let errore: unknown;
    let secondo: ReturnType<typeof accendi> | undefined;
    try {
      secondo = accendi(PaginaFinta, { params: Promise.resolve({ id: 'b' }) });
    } catch (e) {
      errore = e;
    }
    expect(errore, 'la seconda montatura lancia invece di aspettare i parametri').toBeUndefined();
    await giraAttesa();
    expect(document.body.textContent, 'la seconda montatura è vuota').toContain('modulo b');
    secondo!.smonta();
  });
});
