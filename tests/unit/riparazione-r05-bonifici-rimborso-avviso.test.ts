import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { avvisoDelBonificoDaFare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * R05 (26/11/2026) — L'AVVISO DEL BONIFICO DI RIMBORSO MANDA DOVE SI SEGNA «FATTO», E DICE IL TERMINE.
 *
 * Prima l'avviso finiva con «prima di pagare cerca questa causale nei movimenti del conto. Se c'è,
 * è già pagato», e il link portava alla pagina degli ordini. Ma un bonifico respinto dalla banca
 * lascia la causale fra i movimenti: con quella regola risultava pagato, e il cliente restava senza
 * soldi. E sui reclami, senza il giorno di partenza, l'avviso diceva solo «Va pagato presto».
 *
 * Il registro dei fatti di Nicola (29/10): il bonifico lo fa Nicola dall'app della banca, «poi tocca
 * "fatto"». Adesso l'avviso porta alla pagina dei bonifici, dove «Fatto» si segna una volta sola e
 * «Respinto dalla banca» lo rimette da fare.
 */

const ORDINE = 'a1b2c3d4-0000-0000-0000-000000000001';

function paginaDi(link: string): string {
  return path.join(process.cwd(), 'app', link.split('?')[0], 'page.tsx');
}

describe('R05 — l avviso del bonifico di rimborso', () => {
  const reso = avvisoDelBonificoDaFare({
    ordineId: ORDINE,
    bonificoCents: 3000,
    creditoCents: 0,
    emailCliente: 'giulia@esempio.it',
    chiave: 'return_f00dcafe-1',
    resoChiestoIl: '2026-11-02T10:00:00Z',
    casella: 'info@esempio.it',
  });
  const reclamo = avvisoDelBonificoDaFare({
    ordineId: ORDINE,
    bonificoCents: 2400,
    creditoCents: 0,
    emailCliente: 'giulia@esempio.it',
    chiave: 'dispute_d1',
    casella: 'info@esempio.it',
  });

  it('la pagina dei bonifici di rimborso esiste', () => {
    expect(existsSync(paginaDi('/admin/bonifici-rimborso')), 'la pagina /admin/bonifici-rimborso non esiste').toBe(true);
  });

  it('dice di premere «Fatto» nella pagina dei bonifici, e «Respinto dalla banca» se torna indietro', () => {
    for (const avviso of [reso, reclamo]) {
      expect(avviso.testo).toContain('Quando hai fatto il bonifico, premi «Fatto» nella pagina «Bonifici di rimborso»');
      expect(avviso.testo).toContain('se un altro l\'ha già fatto la pagina dice chi e quando');
      expect(avviso.testo).toContain('Se la banca lo respinge, premi «Respinto dalla banca»: torna fra quelli da fare.');
      // La causale resta: serve a chi paga e a chi controlla il conto.
      expect(avviso.testo).toContain('«Rimborso MyCity ordine #A1B2C3');
    }
  });

  it('il reso dice ancora il giorno della richiesta e il termine dei 14 giorni', () => {
    expect(reso.testo).toContain('Il reso è stato chiesto il 2 novembre 2026');
    expect(reso.testo).toContain('il termine è il 16 novembre 2026');
  });

  it('un reclamo senza giorno di partenza dice che il termine non si sa, non «Va pagato presto»', () => {
    expect(reclamo.testo).not.toContain('Va pagato presto');
    expect(reclamo.testo).toContain('Il termine non lo sappiamo: manca il giorno da cui contare i 14 giorni.');
  });

  it('un reclamo col giorno di apertura dice il termine, e lo chiama reclamo, non reso', () => {
    const conData = avvisoDelBonificoDaFare({
      ordineId: ORDINE,
      bonificoCents: 2400,
      creditoCents: 0,
      emailCliente: null,
      chiave: 'dispute_d1',
      resoChiestoIl: '2026-11-20T09:00:00Z',
    });
    expect(conData.testo).toContain('Il reclamo è stato aperto il 20 novembre 2026');
    expect(conData.testo).toContain('il termine è il 4 dicembre 2026');
    expect(conData.testo).not.toContain('Il reso è stato chiesto');
  });
});
