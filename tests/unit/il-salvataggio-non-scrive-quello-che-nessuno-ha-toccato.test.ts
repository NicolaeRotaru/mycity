/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 6/9/2026 — UN SALVATAGGIO CHE SCRIVE PIÙ DI QUELLO CHE È STATO CHIESTO.
 *
 * Il negoziante apre la scheda di un prodotto per cambiare il prezzo. Le
 * impostazioni di consegna del suo negozio non si leggono (rete lenta, sessione
 * non ancora pronta): il modulo lo avvisa, ma lascia il pulsante Salva acceso e
 * il selettore del tempo di consegna spento su «Spedizione 2-3 giorni» — che
 * non è una scelta di nessuno, è un ripiego. Lui salva il prezzo, e si porta
 * via la consegna veloce di quel prodotto: `express_enabled` passa da NULL
 * («segui il negozio») a `false` («questo prodotto no, mai»). E resta così
 * anche quando la rete torna.
 *
 * QUESTA PROVA NON GUARDA LA CONSEGNA VELOCE: guarda la malattia. Confronta
 * quello che il salvataggio scriverà in banca dati con quello che in banca dati
 * c'era già, e pretende che la differenza sia esattamente quello che il
 * negoziante ha toccato con le sue mani. Nessun campo in più. Vale per
 * `express_enabled` di oggi e per qualunque campo che domani prenda l'abitudine
 * di viaggiare da solo.
 */

/** Le colonne del prodotto che questo modulo ha il compito di scrivere. */
const PRODOTTO_IN_BANCA_DATI: Record<string, unknown> = {
  name: 'Torta di compleanno',
  description: 'Pan di spagna, crema e fragole fresche di stagione.',
  price: 24,
  compare_at_price: null,
  unit: 'pezzo',
  condition: null,
  stock: 3,
  category_id: 'cat-1',
  images: ['https://mycity.test/torta.jpg'],
  attributes: {},
  tags: [],
  // NULL = «questo prodotto segue il negozio»: è il valore che si perde.
  express_enabled: null,
  status: 'available',
};

const CATEGORIE = [{ id: 'cat-1', name: 'Dolci', slug: 'dolci', parent_id: null }];

const VALORI_INIZIALI = {
  name: PRODOTTO_IN_BANCA_DATI.name,
  description: PRODOTTO_IN_BANCA_DATI.description,
  price: PRODOTTO_IN_BANCA_DATI.price,
  compareAtPrice: PRODOTTO_IN_BANCA_DATI.compare_at_price,
  unit: PRODOTTO_IN_BANCA_DATI.unit,
  condition: PRODOTTO_IN_BANCA_DATI.condition,
  stock: PRODOTTO_IN_BANCA_DATI.stock,
  category_id: PRODOTTO_IN_BANCA_DATI.category_id,
  images: PRODOTTO_IN_BANCA_DATI.images,
  attributes: PRODOTTO_IN_BANCA_DATI.attributes,
  tags: PRODOTTO_IN_BANCA_DATI.tags,
  expressEnabled: PRODOTTO_IN_BANCA_DATI.express_enabled,
  status: PRODOTTO_IN_BANCA_DATI.status,
  variants: [],
};

/**
 * Le colonne che questo salvataggio CAMBIA davvero in banca dati.
 *
 * Un campo che il modulo non manda non cambia niente: in banca dati resta
 * quello che c'era. Un campo mandato con un valore diverso, invece, riscrive —
 * e se il negoziante non l'ha toccato, riscrive a sua insaputa.
 */
function cosaCambiaInBancaDati(scritto: Record<string, unknown>): string[] {
  return Object.keys(scritto)
    .filter((c) => JSON.stringify(scritto[c]) !== JSON.stringify(PRODOTTO_IN_BANCA_DATI[c]))
    .sort();
}

/** Scrive in un campo come ci scrive una persona, e lo fa sapere a React. */
function scriviNelCampo(campo: HTMLInputElement, valore: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

type Schermo = ReturnType<typeof accendi>;

function campoPrezzo(s: Schermo): HTMLInputElement {
  const el = s.radice.querySelector('input[name="price"]');
  expect(el, 'il campo del prezzo non è a video: la prova girerebbe a vuoto').not.toBeNull();
  return el as HTMLInputElement;
}

function pulsante(s: Schermo, scritta: string): HTMLButtonElement {
  const b = Array.from(s.radice.querySelectorAll('button')).find((x) =>
    (x.textContent ?? '').includes(scritta),
  );
  expect(b, `il pulsante «${scritta}» non è a video: la prova girerebbe a vuoto`).toBeTruthy();
  return b as HTMLButtonElement;
}

/**
 * Monta il modulo come lo vede il negoziante che apre la modifica di un
 * prodotto mentre la lettura delle impostazioni del negozio è caduta: nessuna
 * risposta (`undefined`, che non è un «no») e il modulo che lo sa.
 */
async function moduloConLaLetturaCaduta(): Promise<{ s: Schermo; salvati: Record<string, unknown>[] }> {
  const salvati: Record<string, unknown>[] = [];
  const mod = await monta('components/seller/ProductForm.tsx');
  const s = accendi(mod.default, {
    mode: 'edit',
    categories: CATEGORIE,
    initialValues: VALORI_INIZIALI,
    onSubmit: (payload: Record<string, unknown>) => salvati.push(payload),
    sellerOffersExpress: undefined,
    consegnaDelNegozioNonLetta: true,
  });
  const testo = (s.radice.textContent ?? '').replace(/\s+/g, ' ');
  expect(testo, 'il modulo prodotto non è a video: gli assert sotto passerebbero a vuoto').toContain(
    'Tempo di consegna',
  );
  expect(testo).toContain('Non riesco a leggere le impostazioni di consegna');
  return { s, salvati };
}

async function premiSalva(s: Schermo): Promise<void> {
  s.agisci(() => clicca(pulsante(s, 'Salva modifiche')));
  await attendi();
  await attendi();
}

describe('il salvataggio di un prodotto scrive solo quello che il negoziante ha chiesto', () => {
  it('IL CASO CHE ROMPEVA — cambia solo il prezzo: in banca dati cambia solo il prezzo', async () => {
    const { s, salvati } = await moduloConLaLetturaCaduta();

    s.agisci(() => scriviNelCampo(campoPrezzo(s), '26'));
    await premiSalva(s);

    expect(salvati.length, 'il modulo non ha salvato niente: la prova girerebbe a vuoto').toBe(1);
    expect(
      cosaCambiaInBancaDati(salvati[0]),
      'il salvataggio riscrive campi che il negoziante non ha toccato: è entrato per il prezzo ed è uscito con dell altro cambiato sotto il naso',
    ).toEqual(['price']);
    expect(salvati[0].price).toBe(26);

    s.smonta();
  });

  it('non tocca niente e salva: in banca dati non cambia niente', async () => {
    const { s, salvati } = await moduloConLaLetturaCaduta();

    await premiSalva(s);

    expect(salvati.length, 'il modulo non ha salvato niente: la prova girerebbe a vuoto').toBe(1);
    expect(
      cosaCambiaInBancaDati(salvati[0]),
      'un salvataggio senza nessuna modifica ha cambiato qualcosa in banca dati',
    ).toEqual([]);

    s.smonta();
  });

  it('sceglie lui la spedizione mentre la lettura è caduta: quella scelta si scrive', async () => {
    const { s, salvati } = await moduloConLaLetturaCaduta();

    // Il negoziante tocca il selettore: è una scelta sua, e va rispettata.
    s.agisci(() => clicca(pulsante(s, 'Spedizione')));
    await premiSalva(s);

    expect(salvati.length, 'il modulo non ha salvato niente: la prova girerebbe a vuoto').toBe(1);
    expect(
      cosaCambiaInBancaDati(salvati[0]),
      'il negoziante ha scelto la spedizione e il modulo non l ha scritta: non scrivere niente non deve diventare non ascoltare',
    ).toEqual(['express_enabled']);
    expect(salvati[0].express_enabled).toBe(false);

    s.smonta();
  });
});
