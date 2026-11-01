/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 (sesta ondata, secondo giro) — CONTROPROVA SULLA BASE: CON L'AI
 * SPENTA LA PAGINA «NUOVO PRODOTTO» NON OFFRE L'AI.
 *
 * Il difetto diceva: AI per i negozi spenta, ma «Nuovo prodotto» si apriva con
 * «Compila con una foto: l'AI compila…» e pulsanti che rispondevano «servizio
 * AI non configurato». La base ha gia' l'interruttore (carta #209): questa
 * prova monta la pagina vera col valore vero e lo dimostra. Il modulo da solo
 * lo prova gia' con-le-funzioni-spente-il-negozio-non-vede-ingressi….test.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import * as interruttori from '@/lib/funzioni-al-lancio';

afterEach(() => {
  document.body.innerHTML = '';
});

describe.skipIf(interruttori.AI_NEGOZI_ACCESA)('AI per i negozi spenta: la pagina «Nuovo prodotto»', () => {
  it('nessun «l\'AI compila», nessun pulsante AI, e il modulo resta', async () => {
    const mod = await monta('app/seller/products/new/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();
    await attendi();
    const etichette = Array.from(s.radice.querySelectorAll('[aria-label], [title]'))
      .map((n) => `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`)
      .join(' ');
    const testo = `${testoVisibile(s.radice)} ${etichette}`.replace(/\s+/g, ' ');
    expect(testo, 'controprova: la pagina si deve vedere').toMatch(/Nuovo prodotto/);
    expect(testo).not.toMatch(/Compila con una foto/);
    expect(testo.match(/[^.]{0,40}\b(AI|IA|Copilot)\b[^.]{0,40}/g) ?? [], 'la pagina offre funzioni AI spente').toEqual([]);
    s.smonta();
  }, 60000);
});
