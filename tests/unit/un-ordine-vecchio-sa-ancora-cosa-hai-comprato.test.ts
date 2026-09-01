import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nomeDellaRigaOrdine, fotoDellaRigaOrdine, NOME_PRODOTTO_PERSO } from '@/lib/ordini/riga-ordine';
import { nascondiProdotto, STATO_NASCOSTO } from '@/lib/products/nascondi';

/**
 * 27/8/2026 (R029) — SE IL NEGOZIO CANCELLAVA UN PRODOTTO, NELLO STORICO DEL
 * CLIENTE RESTAVA UNA RIGA SENZA NOME.
 *
 * La riga d'ordine non teneva nessuna copia del nome: le pagine dell'ordine lo
 * leggevano per aggancio (`order_items ( ..., products ( name, images ) )`).
 * Cancellato il prodotto, l'aggancio diventava NULL e il cliente che riapriva
 * un ordine di sei mesi prima trovava «Prodotto» e un quadrato grigio: non
 * sapeva più cosa aveva comprato, e non poteva nemmeno recensirlo.
 *
 * Adesso il nome e la foto sono scritti sulla riga d'ordine nel momento in cui
 * l'ordine nasce (lo fa il database, migrazione 140), e le pagine leggono la
 * copia. Se il negozio cambia il nome del prodotto, l'ordine continua a dire
 * quello che il cliente ha comprato: la copia non è un doppione, è la memoria
 * di quel giorno.
 */

describe('il nome che si legge sulla riga di un ordine', () => {
  it('e quello del giorno dell ordine, anche se il prodotto oggi si chiama diversamente', () => {
    const nome = nomeDellaRigaOrdine({
      product_name: 'Focaccia di Recco',
      products: { name: 'Focaccia di Recco ALLE OLIVE', images: null },
    });
    expect(
      nome,
      'la ricevuta cambia da sola quando il negozio ritocca il nome: il cliente legge una cosa che non ha comprato',
    ).toBe('Focaccia di Recco');
  });

  it('resta leggibile anche se il prodotto non esiste piu', () => {
    const nome = nomeDellaRigaOrdine({ product_name: 'Focaccia di Recco', products: null });
    expect(nome, 'nello storico resta una riga senza nome: il cliente non sa piu cosa ha comprato').toBe(
      'Focaccia di Recco',
    );
  });

  it('sugli ordini vecchi, senza copia, si legge ancora il prodotto agganciato', () => {
    // Le righe scritte prima della migrazione: la copia non ce l'hanno, ma
    // finche' il prodotto c'e' il nome si legge da li'.
    const nome = nomeDellaRigaOrdine({ products: { name: 'Focaccia di Recco', images: [] } });
    expect(nome).toBe('Focaccia di Recco');
  });

  it('quando non c e proprio piu niente, lo dice invece di far finta', () => {
    const nome = nomeDellaRigaOrdine({ products: null });
    expect(nome).toBe(NOME_PRODOTTO_PERSO);
    expect(nome, 'una riga chiamata «Prodotto» sembra un difetto grafico, non una cosa sparita').not.toBe('Prodotto');
  });

  it('la foto segue la stessa regola del nome', () => {
    expect(fotoDellaRigaOrdine({ product_image: 'scatto.jpg', products: { name: 'x', images: ['nuova.jpg'] } }))
      .toBe('scatto.jpg');
    expect(fotoDellaRigaOrdine({ products: { name: 'x', images: ['nuova.jpg'] } })).toBe('nuova.jpg');
    expect(fotoDellaRigaOrdine({ products: null })).toBeUndefined();
  });
});

/**
 * L'altra metà: il pulsante del pannello venditore. Cancellare voleva dire
 * cancellare — e col prodotto se ne andavano le recensioni negative. Adesso
 * nasconde, e il database rifiuta comunque la cancellazione di un prodotto
 * venduto o recensito (la prova che lo esegue è
 * tests/sql/rls/21-un-prodotto-venduto-non-si-cancella.test.sql).
 */
function clienteFinto() {
  const chiamate: { tabella: string; azione: string; valori?: unknown; filtri: [string, string][] }[] = [];
  const costruisci = (tabella: string, azione: string, valori?: unknown) => {
    const registro = { tabella, azione, valori, filtri: [] as [string, string][] };
    chiamate.push(registro);
    const catena: any = {
      eq(colonna: string, valore: string) {
        registro.filtri.push([colonna, valore]);
        return catena;
      },
      then(risolvi: (r: { error: null }) => unknown) {
        return Promise.resolve({ error: null }).then(risolvi);
      },
    };
    return catena;
  };
  return {
    chiamate,
    from: (tabella: string) => ({
      update: (valori: Record<string, unknown>) => costruisci(tabella, 'update', valori),
      delete: () => costruisci(tabella, 'delete'),
    }),
  };
}

describe('il pulsante del pannello venditore', () => {
  it('mette il prodotto in bozza invece di cancellarlo', async () => {
    const client = clienteFinto();
    await nascondiProdotto(client, { id: 'prod-1', sellerId: 'negozio-1' });

    expect(client.chiamate.length).toBe(1);
    expect(
      client.chiamate[0].azione,
      'il prodotto viene ancora cancellato: con lui se ne vanno le recensioni negative',
    ).toBe('update');
    expect(client.chiamate[0].valori).toEqual({ status: STATO_NASCOSTO });
  });

  it('tocca solo il prodotto di quel negozio', async () => {
    const client = clienteFinto();
    await nascondiProdotto(client, { id: 'prod-1', sellerId: 'negozio-1' });
    expect(client.chiamate[0].filtri).toEqual([
      ['id', 'prod-1'],
      ['seller_id', 'negozio-1'],
    ]);
  });

  it('se il database rifiuta, l errore risale invece di sparire', async () => {
    const client = {
      from: () => ({
        update: () => ({
          eq() { return this; },
          then: (risolvi: (r: { error: { message: string } }) => unknown) =>
            Promise.resolve({ error: { message: 'niente permessi' } }).then(risolvi),
        }),
      }),
    };
    await expect(nascondiProdotto(client as never, { id: 'prod-1' })).rejects.toBeTruthy();
  });
});

/** Il freno strutturale: le pagine del venditore non cancellano più prodotti. */
describe('nel pannello venditore non si cancella piu un prodotto', () => {
  const pagine = ['app/seller/products/page.tsx', 'app/seller/products/[id]/edit/page.tsx'];

  it('nessuna delle due chiama la cancellazione del catalogo', () => {
    for (const p of pagine) {
      const testo = readFileSync(p, 'utf8');
      expect(
        /from\('products'\)\s*\.?\s*\n?\s*\.delete\(\)/.test(testo.replace(/\s+/g, ' ')),
        `${p} cancella ancora davvero il prodotto`,
      ).toBe(false);
      expect(testo.includes('nascondiProdotto('), `${p} non passa dal «nascondi» condiviso`).toBe(true);
    }
  });

  it('le due pagine dell ordine leggono la copia del nome, non solo l aggancio', () => {
    for (const p of ['app/orders/[id]/page.tsx', 'app/seller/orders/[id]/page.tsx']) {
      const testo = readFileSync(p, 'utf8');
      expect(testo.includes('product_name'), `${p} legge il nome solo per aggancio`).toBe(true);
      expect(testo.includes('nomeDellaRigaOrdine('), `${p} non usa la lettura condivisa del nome`).toBe(true);
    }
  });
});
