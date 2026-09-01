import { describe, it, expect } from 'vitest';
import {
  SECCHI_CON_FILE_PERSONALI,
  cancellaFilePersonali,
  anonimizzaTestoLibero,
  cancellaProveDiConsegna,
} from '@/lib/account/cancellazione';

/**
 * 27/8/2026 (R057) — «CANCELLA ACCOUNT» LASCIAVA ONLINE LE FOTO.
 *
 * La promessa scritta nelle impostazioni è netta: i dati vengono rimossi in
 * modo irreversibile. Ma la pipeline di cancellazione ripuliva due soli secchi
 * dello storage — i documenti d'identità e le prove di consegna — e azzerava
 * il testo delle recensioni lasciando intatta la colonna con le foto.
 *
 * Il secchio delle recensioni è PUBBLICO (migrations/039): la foto è
 * raggiungibile da chiunque conosca l'indirizzo, per sempre. Cancellato
 * l'account, il commento spariva e la fotografia restava online: è l'unico
 * dato che un estraneo poteva ancora vedere dopo la cancellazione, ed era
 * proprio quello che sopravviveva.
 *
 * Queste prove diventano rosse se il secchio esce dall'elenco o se la colonna
 * delle foto torna a non essere azzerata.
 */

type Voce = { name: string; id: string | null };

/** Un finto storage che ricorda cosa gli è stato chiesto di cancellare. */
function finlestorage(contenuto: Record<string, Record<string, string[]>>) {
  const rimossi: Array<{ secchio: string; percorsi: string[] }> = [];
  const storage = {
    from(secchio: string) {
      return {
        async list(prefisso: string): Promise<{ data: Voce[] | null; error: null }> {
          const cartelle = contenuto[secchio];
          if (!cartelle) return { data: [], error: null };
          const pezzi = prefisso.split('/');
          if (pezzi.length === 1) {
            // Primo livello: le sottocartelle dell'utente (id null = cartella).
            const dentro = Object.keys(cartelle).filter((k) => k.startsWith(`${prefisso}/`));
            const nomi = new Set(dentro.map((k) => k.split('/')[1]));
            return { data: [...nomi].map((n) => ({ name: n, id: null })), error: null };
          }
          const file = cartelle[prefisso] ?? [];
          return { data: file.map((f) => ({ name: f, id: `id-${f}` })), error: null };
        },
        async remove(percorsi: string[]): Promise<{ error: null }> {
          rimossi.push({ secchio, percorsi });
          return { error: null };
        },
      };
    },
  };
  return { storage, rimossi };
}

/** Un finto database che ricorda gli aggiornamenti tabella per tabella. */
function finteTabelle() {
  const aggiornamenti: Array<{ tabella: string; valori: Record<string, unknown> }> = [];
  const from = (tabella: string) => ({
    update(valori: Record<string, unknown>) {
      aggiornamenti.push({ tabella, valori });
      return { eq: async () => ({ error: null }) };
    },
  });
  return { from, aggiornamenti };
}

describe('le foto delle recensioni quando si cancella un account', () => {
  it('il secchio delle recensioni è fra quelli da svuotare', () => {
    expect(
      SECCHI_CON_FILE_PERSONALI as readonly string[],
      'se «reviews» non è in questo elenco, le foto delle recensioni restano online per sempre',
    ).toContain('reviews');
  });

  it('la foto caricata con la recensione viene tolta dallo storage', async () => {
    const { storage, rimossi } = finlestorage({
      reviews: { 'utente-1/prodotto-9': ['foto.jpg'] },
    });
    const esito = await cancellaFilePersonali(
      { storage } as never,
      'utente-1',
    );

    const dalleRecensioni = rimossi.find((r) => r.secchio === 'reviews');
    expect(
      dalleRecensioni?.percorsi,
      'la foto della recensione non è stata cancellata: chi ha salvato il suo indirizzo continua a vederla',
    ).toEqual(['utente-1/prodotto-9/foto.jpg']);
    expect(esito.rimossi).toBeGreaterThan(0);
  });

  it('la colonna con le foto viene svuotata insieme al commento', async () => {
    const { from, aggiornamenti } = finteTabelle();
    await anonimizzaTestoLibero({ from } as never, 'utente-1');

    // Solo queste due tabelle hanno la colonna delle foto (migrazioni 030 e
    // 101). Le recensioni al fattorino non ne hanno una: chiedere di azzerarla
    // farebbe respingere l'intero aggiornamento e resterebbe anche il commento.
    for (const tabella of ['reviews', 'store_reviews']) {
      const riga = aggiornamenti.find((a) => a.tabella === tabella);
      expect(riga, `nessun aggiornamento su ${tabella}`).toBeTruthy();
      expect(
        riga?.valori,
        `su ${tabella} il commento sparisce ma la foto resta agganciata alla recensione`,
      ).toHaveProperty('photo_urls');
      expect(riga?.valori.photo_urls).toEqual([]);
      expect(riga?.valori.comment).toBeNull();
    }
  });

  it('la recensione al fattorino perde il commento e nessuna colonna inventata', () => {
    const { from, aggiornamenti } = finteTabelle();
    void anonimizzaTestoLibero({ from } as never, 'utente-1');
    const riga = aggiornamenti.find((a) => a.tabella === 'rider_reviews');
    expect(riga?.valori).toEqual({ comment: null });
  });
});

/**
 * 27/8/2026 (R058) — LA FOTO DELLA PORTA DI CASA STAVA NELLA CARTELLA DI UN ALTRO.
 *
 * Alla consegna in contanti il fattorino fotografa i contanti e «il pacco
 * lasciato» — che nella pratica è l'ingresso dell'abitazione del cliente. Quei
 * file finiscono nel secchio `cod-proof`, nella cartella del FATTORINO.
 *
 * Da qui il difetto: la pulizia dei file di una persona elenca la SUA cartella.
 * Quando il cliente cancellava l'account, in `cod-proof/<cliente>` non c'era
 * niente — e la fotografia di casa sua restava, per sempre, nella cartella di
 * qualcun altro. Nessuno la cercava perché nessuno sapeva dove fosse.
 *
 * Adesso si parte dai suoi ordini: da lì si arriva ai file, ovunque siano.
 */
describe('le prove di consegna quando il cliente cancella l account', () => {
  function fintoMondo(ordini: Array<Record<string, unknown>>) {
    const rimossi: Array<{ secchio: string; percorsi: string[] }> = [];
    const aggiornati: Array<{ valori: Record<string, unknown>; id: unknown }> = [];
    const admin = {
      from(tabella: string) {
        if (tabella !== 'orders') throw new Error(`tabella inattesa: ${tabella}`);
        return {
          select: () => ({
            eq: async () => ({ data: ordini, error: null }),
          }),
          update: (valori: Record<string, unknown>) => ({
            eq: async (_c: string, id: unknown) => {
              aggiornati.push({ valori, id });
              return { error: null };
            },
          }),
        };
      },
      storage: {
        from(secchio: string) {
          return {
            async remove(percorsi: string[]) {
              rimossi.push({ secchio, percorsi });
              return { error: null };
            },
          };
        },
      },
    };
    return { admin, rimossi, aggiornati };
  }

  it('la foto della porta di casa viene tolta anche se sta nella cartella del fattorino', async () => {
    const { admin, rimossi } = fintoMondo([
      {
        id: 'ordine-1',
        cash_photo_url: 'fattorino-9/ordine-1/cash.jpg',
        delivery_photo_url: 'fattorino-9/ordine-1/delivery.jpg',
        cash_signature_url: null,
      },
    ]);
    const esito = await cancellaProveDiConsegna(admin as never, 'cliente-1');
    expect(
      rimossi,
      'la fotografia dell’ingresso di casa resta online nella cartella di un altro utente',
    ).toEqual([
      {
        secchio: 'cod-proof',
        percorsi: ['fattorino-9/ordine-1/cash.jpg', 'fattorino-9/ordine-1/delivery.jpg'],
      },
    ]);
    expect(esito.rimossi).toBe(2);
  });

  it('sull ordine non resta il riferimento a una foto che non esiste piu', async () => {
    const { admin, aggiornati } = fintoMondo([
      { id: 'ordine-1', cash_photo_url: 'r/o/c.jpg', delivery_photo_url: null, cash_signature_url: null },
    ]);
    await cancellaProveDiConsegna(admin as never, 'cliente-1');
    expect(aggiornati).toEqual([
      {
        id: 'ordine-1',
        valori: { cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null },
      },
    ]);
  });

  it('un ordine senza foto non fa chiedere allo storage di cancellare il vuoto', async () => {
    const { admin, rimossi, aggiornati } = fintoMondo([
      { id: 'ordine-2', cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null },
    ]);
    await cancellaProveDiConsegna(admin as never, 'cliente-1');
    expect(rimossi).toEqual([]);
    expect(aggiornati).toEqual([]);
  });
});
