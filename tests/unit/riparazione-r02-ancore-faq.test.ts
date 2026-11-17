/**
 * @vitest-environment jsdom
 */
/**
 * R02-007 — LE ANCORE DELLE FAQ SOMMAVANO IL LORO SCROLL-MT ALLO SCROLL-PADDING DA MD IN SU.
 *
 * Da md in su `html` ha già lo scroll-padding che tiene il titolo sotto la testata fissa
 * (app/globals.css). Le ancore riparate prima (components/ui/LegalLayout.tsx, /lavora-con-noi)
 * portano `scroll-mt-24 md:scroll-mt-0`: il margine serve solo sul telefono. Le sezioni di /faq
 * (`/faq#ordini` dal Centro assistenza) avevano solo `scroll-mt-24`, e da md in su si fermavano
 * 6rem più in basso del dovuto. Prova leggera: si monta la pagina vera e si guardano le sezioni.
 */
import { describe, it, expect } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

describe('R02-007 · le sezioni delle FAQ non sommano il margine allo scroll-padding', () => {
  it('ogni sezione con un id ha scroll-mt-24 sul telefono e md:scroll-mt-0 da md in su', async () => {
    const mod = await monta('app/faq/page.tsx');
    const s = accendi(mod.default, {});
    const sezioni = Array.from(s.radice.querySelectorAll('section[id]'));
    expect(sezioni.length, 'le FAQ non hanno più le sezioni con l ancora').toBeGreaterThan(3);
    for (const sezione of sezioni) {
      const classi = (sezione.getAttribute('class') ?? '').split(/\s+/);
      expect(classi, `#${sezione.id}`).toContain('scroll-mt-24');
      expect(classi, `#${sezione.id} da md in su si ferma più in basso del dovuto`).toContain('md:scroll-mt-0');
    }
    s.smonta();
  }, 60000);
});
