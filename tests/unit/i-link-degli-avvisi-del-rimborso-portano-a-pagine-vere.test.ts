import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { avvisoDelBonificoDaFare, avvisoDelRimborsoNonRegistrato } from '@/lib/rimborsi/bonifici-da-fare';
import { linkAlControlloDelCredito } from '@/lib/rimborsi/credito-da-controllare';

/**
 * OGNI LINK DEGLI AVVISI DEL RIMBORSO PORTA A UNA PAGINA CHE ESISTE (17/10/2026).
 *
 * La pagina «Rimborsi da bonificare» non c'e' piu' (decisione di Nicola, «Semplifica»): un avviso che
 * ci portasse ancora finirebbe su una pagina vuota. Il link e' solo un punto di arrivo: quello che
 * serve per pagare sta nel testo dell'avviso (cifra, ordine, email, causale). Qui si guarda che la
 * pagina di ogni link ci sia davvero nel sito, come fa la prova del credito da controllare.
 */

function paginaDi(link: string): string {
  return path.join(process.cwd(), 'app', link.split('?')[0], 'page.tsx');
}

const avvisi = {
  'bonifico da fare': avvisoDelBonificoDaFare({ ordineId: 'a1b2c3d4', bonificoCents: 3000, creditoCents: 2000, emailCliente: 'g@esempio.it' }),
  'bonifico da fare, senza email': avvisoDelBonificoDaFare({ ordineId: 'a1b2c3d4', bonificoCents: 3000, creditoCents: 0, emailCliente: null }),
  'rimborso non registrato, col bonifico': avvisoDelRimborsoNonRegistrato({ resoId: 'r1', ordineId: 'a1b2c3d4', refundId: 'bonifico:3000:return_r1', bonificoCents: 3000 }),
  'rimborso non registrato, carta': avvisoDelRimborsoNonRegistrato({ resoId: 'r1', ordineId: 'a1b2c3d4', refundId: 're_1', bonificoCents: 0 }),
};

describe('i link degli avvisi del rimborso', () => {
  for (const [nome, avviso] of Object.entries(avvisi)) {
    it(`${nome}: la pagina c e, e non e la lista dei bonifici tolta`, () => {
      expect(avviso.link).not.toContain('rimborsi-da-bonificare');
      expect(existsSync(paginaDi(avviso.link)), `la pagina ${avviso.link} non esiste`).toBe(true);
    });
  }

  it('il controllo del credito porta alla sua pagina', () => {
    const link = linkAlControlloDelCredito('return_r1', 2000);
    expect(existsSync(paginaDi(link)), `la pagina ${link} non esiste`).toBe(true);
  });

  it('la pagina della lista dei bonifici non c e piu', () => {
    expect(existsSync(paginaDi('/admin/rimborsi-da-bonificare'))).toBe(false);
  });
});
