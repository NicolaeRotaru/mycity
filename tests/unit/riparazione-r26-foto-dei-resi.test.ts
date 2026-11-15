import { describe, it, expect, vi } from 'vitest';

/**
 * R26-001 (15/11/2026) — LE FOTO DEI RESI RESTAVANO ONLINE DOPO «CANCELLA ACCOUNT».
 *
 * Il cliente fotografa il pacco arrivato rotto (spesso con l'etichetta col suo
 * nome) e la allega al reso. La foto finiva nel secchio pubblico `products`, in
 * `<cliente>/returns/<ordine>/<foto>`. Alla cancellazione dell'account:
 *   · `products` non era in nessun elenco, e la foto restava raggiungibile;
 *   · la pulizia scendeva di un livello solo: una cartella più in basso finiva
 *     fra i «file» da togliere, il conto diceva «rimossi» e il file restava;
 *   · sulla riga del reso, che sopravvive, si azzeravano le note ma non le foto.
 *
 * La prova chiama la cancellazione vera su un magazzino finto che risponde
 * come lo storage: `list` dà solo i figli diretti (le cartelle con id nullo),
 * `remove` di una cartella non dà errore e non toglie niente.
 */

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { anonimizzaTestoLibero, cancellaFilePersonali } from '@/lib/account/cancellazione';

function magazzinoFinto(contenuto: Record<string, string[]>) {
  const file = new Map(Object.entries(contenuto).map(([s, l]) => [s, new Set(l)]));
  const chiesti: string[] = [];
  const admin = {
    storage: {
      from: (secchio: string) => ({
        list: async (prefisso: string, opzioni?: { limit?: number; offset?: number }) => {
          const p = `${prefisso.replace(/\/+$/, '')}/`;
          const figli = new Map<string, string | null>();
          for (const f of file.get(secchio) ?? []) {
            if (!f.startsWith(p)) continue;
            const [testa, ...resto] = f.slice(p.length).split('/');
            figli.set(testa, resto.length ? null : `id-${f}`);
          }
          const voci = [...figli].sort(([a], [b]) => a.localeCompare(b)).map(([name, id]) => ({ name, id }));
          const da = opzioni?.offset ?? 0;
          return { data: voci.slice(da, da + (opzioni?.limit ?? 100)), error: null };
        },
        remove: async (percorsi: string[]) => {
          for (const x of percorsi) {
            chiesti.push(`${secchio}:${x}`);
            file.get(secchio)?.delete(x);
          }
          return { data: [], error: null };
        },
      }),
    },
  };
  const restano = (secchio: string) => [...(file.get(secchio) ?? [])].sort();
  return { admin: admin as never, restano, chiesti };
}

describe('R26-001 · la cancellazione dell account toglie le foto dei resi', () => {
  it('IL CASO CHE ROMPEVA — la foto del pacco rotto nel secchio pubblico non resta online', async () => {
    const m = magazzinoFinto({
      products: [
        'u1/returns/o1/pacco-rotto.jpg',
        'u1/returns/o1/etichetta.jpg',
        'u1/returns/o2/rotto.heic',
        'u2/returns/o9/di-un-altro.jpg',
      ],
    });
    const esito = await cancellaFilePersonali(m.admin, 'u1');

    expect(esito.errori).toEqual([]);
    expect(
      m.restano('products'),
      'le foto del reso di chi ha cancellato l account sono ancora nel secchio pubblico',
    ).toEqual(['u2/returns/o9/di-un-altro.jpg']);
    expect(esito.rimossi, 'il conto deve dire quante foto sono state tolte davvero').toBe(3);
  });

  it('il conto non mente: una cartella non e un file, e si scende fino in fondo', async () => {
    const m = magazzinoFinto({
      reviews: ['u1/p9/a.jpg', 'u1/p9/extra/b.jpg', 'u1/p9/extra/ancora/c.jpg'],
    });
    const esito = await cancellaFilePersonali(m.admin, 'u1');

    expect(m.restano('reviews'), 'un file due livelli sotto la cartella della persona e rimasto').toEqual([]);
    expect(
      m.chiesti.filter((c) => !/\.[a-z]+$/.test(c)),
      'una cartella e finita fra i file da togliere: lo storage non dice niente e il file resta',
    ).toEqual([]);
    expect(esito.rimossi).toBe(3);
  });

  it('la riga del reso, che resta, perde le foto insieme alle note', async () => {
    const aggiornamenti: Array<{ tabella: string; valori: Record<string, unknown> }> = [];
    const from = (tabella: string) => ({
      update(valori: Record<string, unknown>) {
        aggiornamenti.push({ tabella, valori });
        return { eq: async () => ({ error: null }) };
      },
    });
    await anonimizzaTestoLibero({ from } as never, 'u1');

    const reso = aggiornamenti.find((a) => a.tabella === 'returns');
    expect(reso, 'nessun aggiornamento sulla riga del reso').toBeTruthy();
    expect(reso?.valori.notes).toBeNull();
    expect(
      reso?.valori.photo_urls,
      'il negozio continua a vedere la foto attaccata al reso ormai anonimo',
    ).toEqual([]);
  });
});
