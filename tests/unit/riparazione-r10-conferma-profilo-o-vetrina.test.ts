/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clicDaFermare } from '@/components/seller/site/dove-e-l-errore';

/** R10-007 — Il conferma delle modifiche non salvate nomina la cosa giusta: profilo o vetrina. */
const link = (href: string) => {
  const a = document.createElement('a');
  a.href = href;
  document.body.appendChild(a);
  return a;
};
const evento = (target: Element) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target });

describe('R10-007 — il conferma dice di cosa si tratta', () => {
  it('sulla vetrina dice «alla vetrina»', () => {
    const conferma = vi.fn(() => false);
    clicDaFermare(evento(link('/seller/orders')), true, '/seller/site', conferma);
    expect(conferma.mock.calls[0]?.[0]).toContain('modifiche alla vetrina non salvate');
  });
  it('sul profilo dice «al profilo», non «la vetrina»', () => {
    const conferma = vi.fn(() => false);
    clicDaFermare(evento(link('/seller/orders')), true, '/seller/profile', conferma, 'al profilo');
    const msg = String(conferma.mock.calls[0]?.[0]);
    expect(msg).toContain('modifiche al profilo non salvate');
    expect(msg).not.toContain('vetrina');
  });
  it('il modulo del profilo del negozio chiede «al profilo»', () => {
    expect(readFileSync('components/VendorForm.tsx', 'utf8')).toContain("'al profilo')");
  });
});
