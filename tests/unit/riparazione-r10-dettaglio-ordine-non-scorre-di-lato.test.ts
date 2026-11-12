import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R10-015 — Nel dettaglio ordine dell'amministrazione, sul telefono, un link
 * incollato dal cliente nelle note di consegna allargava la pagina (412 px su
 * uno schermo da 360): il <dd> della riga non aveva min-w-0 né il ritorno a capo
 * ovunque. Prova leggera di stile: il <dd> della riga deve averli.
 */
describe('R10-015 — una nota lunga va a capo', () => {
  it('il valore della riga può restringersi e andare a capo ovunque', () => {
    const src = readFileSync('app/admin/orders/[id]/page.tsx', 'utf8');
    const riga = src.slice(src.indexOf('function Riga('), src.indexOf('function Riga(') + 700);
    const dd = riga.match(/<dd className="([^"]*)"/)?.[1] ?? '';
    expect(dd, 'senza min-w-0 la cella non si restringe').toMatch(/(^|\s)min-w-0(\s|$)/);
    expect(dd, 'un link senza spazi non va a capo').toMatch(/\[overflow-wrap:anywhere\]/);
  });
});
