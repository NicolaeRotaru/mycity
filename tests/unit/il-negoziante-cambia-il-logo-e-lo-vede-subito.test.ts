import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys, invalidaProfiloDiChiEntrato } from '@/lib/queries/keys';

/**
 * 27/8/2026 (R002) — SI SVUOTAVA UNA CASELLA IN CUI NON C'ERA NIENTE.
 *
 * Il negoziante cambiava il nome o il logo del negozio, la pagina diceva
 * «aggiornato», e in alto restava il vecchio per tutta la sessione. Chi mandava
 * la richiesta per diventare venditore continuava a vedere il sito da cliente.
 *
 * Il perché: la testata legge il profilo da `['auth-profile', <id>]`, mentre le
 * quattro pagine che lo modificano svuotavano `['profile','auth']`. Due chiavi
 * senza nessuna radice in comune: react-query non le collega, quindi quelle
 * quattro chiamate non toccavano niente — e siccome il sito non ricontrolla
 * nemmeno quando si torna sulla scheda, il dato vecchio restava lì fino a un
 * ricaricamento della pagina.
 *
 * Non era un capriccio del sito: era una casella svuotata a vuoto. Adesso la
 * chiave della testata sta sotto `['profile']`, e chi modifica il profilo
 * svuota tutto il ramo con `invalidaProfiloDiChiEntrato`.
 */

describe('il profilo di chi ha fatto accesso si aggiorna appena lo si cambia', () => {
  it('svuotare il profilo tocca davvero il dato che legge la testata', () => {
    const qc = new QueryClient();
    // Questa è la stessa chiave a cui si iscrive useProfile (la testata).
    qc.setQueryData(queryKeys.profile.authByUser('negoziante-1'), { store_name: 'Nome vecchio' });

    invalidaProfiloDiChiEntrato(qc);

    const stato = qc.getQueryState(queryKeys.profile.authByUser('negoziante-1'));
    expect(
      stato?.isInvalidated,
      'la testata continua a mostrare il nome vecchio: quello che le pagine svuotano non è quello che la testata legge',
    ).toBe(true);
  });

  it('svuotare il profilo non tocca la cache di un altro dominio', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.seller.products, [{ id: 'p1' }]);

    invalidaProfiloDiChiEntrato(qc);

    expect(
      qc.getQueryState(queryKeys.seller.products)?.isInvalidated,
      'svuotare il profilo ributta giù anche il catalogo: una modifica al nome del negozio ricarica mezzo pannello',
    ).toBe(false);
  });

  it('anche le altre caselle del profilo si svuotano insieme', () => {
    // `profile.me` (la pagina /sell) e `profile.mine` (la pagina /profile) sono
    // due letture vere: devono cadere anche loro, altrimenti chi ha appena
    // mandato la richiesta da venditore vede ancora la schermata di prima.
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.profile.me, { role: 'buyer' });
    qc.setQueryData(queryKeys.profile.mine, { role: 'buyer' });

    invalidaProfiloDiChiEntrato(qc);

    expect(qc.getQueryState(queryKeys.profile.me)?.isInvalidated, '/sell resta indietro').toBe(true);
    expect(qc.getQueryState(queryKeys.profile.mine)?.isInvalidated, '/profile resta indietro').toBe(true);
  });
});

/**
 * Il freno strutturale: se una delle quattro pagine torna a svuotare una chiave
 * per conto suo, la divergenza ricomincia da capo. È la divergenza il difetto,
 * non la singola riga.
 */
describe('chi modifica il profilo passa tutto dalla stessa funzione', () => {
  const pagine = [
    'app/sell/page.tsx',
    'app/seller/profile/page.tsx',
    'app/rider/profile/page.tsx',
    'components/seller/site/StoreDetailsEditor.tsx',
  ];

  it('tutte e quattro chiamano invalidaProfiloDiChiEntrato', () => {
    for (const p of pagine) {
      const testo = readFileSync(p, 'utf8');
      expect(testo.includes('invalidaProfiloDiChiEntrato('), `${p} non svuota il profilo dal posto giusto`).toBe(true);
    }
  });

  it('nessuna si svuota più la chiave orfana del profilo', () => {
    for (const p of pagine) {
      const testo = readFileSync(p, 'utf8');
      expect(testo.includes('queryKeys.profile.auth'), `${p} svuota ancora una casella che non legge nessuno`).toBe(false);
    }
  });
});
