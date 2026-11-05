import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AttributesFields from '@/components/seller/AttributesFields';

/**
 * S06 — Le caratteristiche nel modulo prodotto.
 * 352:  con un campo obbligatorio la frase non dice «tutti opzionali», e il campo ha aria-required.
 * 2161: la casella vera del negoziante legge il sì/no con la regola unica (anche «sì», «true», 1).
 */
const OBBLIGATORI = [
  { key: 'allergeni', label: 'Allergeni', type: 'text', required: true },
  { key: 'peso', label: 'Peso', type: 'number' },
] as never;
const CASELLA = [{ key: 'bio', label: 'Biologico', type: 'checkbox' }] as never;
const disegna = (fields: never, values: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<AttributesFields fields={fields} values={values} onChange={() => {}} />);

describe('352 — campi obbligatori', () => {
  it('la frase dice quali sono obbligatori e il campo lo dichiara', () => {
    const html = disegna(OBBLIGATORI);
    expect(html).not.toContain('Tutti i campi sono opzionali');
    expect(html).toContain('I campi con * sono obbligatori per pubblicare');
    expect(html).toMatch(/id="attr-allergeni"[^>]*aria-required="true"|aria-required="true"[^>]*id="attr-allergeni"/);
    expect(html).not.toMatch(/id="attr-peso"[^>]*aria-required/);
  });
  it('senza obbligatori resta «Tutti i campi sono opzionali»', () => {
    expect(disegna(CASELLA)).toContain('Tutti i campi sono opzionali');
  });
});

describe('2161 — la casella vera del sì/no', () => {
  const spuntata = (v: unknown) => /<input[^>]*id="attr-bio"[^>]*checked=""/.test(disegna(CASELLA, { bio: v }));
  it.each([[true, true], ['true', true], ['sì', true], ['Si', true], [1, true], ['1', true],
           [false, false], ['false', false], ['no', false], ['0', false], [0, false], [undefined, false]])(
    'valore %j → spuntata %s', (v, atteso) => {
      expect(spuntata(v)).toBe(atteso);
    });
});
