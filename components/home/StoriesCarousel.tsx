'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lettoreNegoziConMemoria } from '@/lib/queries/vetrina-con-memoria';
import { supabase } from '@/lib/supabase/client';
import { caricatoreLogoNegozio } from '@/components/StoreAvatar';
import { queryKeys } from '@/lib/queries/keys';
import { conNegozioApprovato } from '@/lib/queries/seller-public-profiles';
import { logger } from '@/lib/logger';
import StoryViewer from '@/components/StoryViewer';

/**
 * Carosello "Storie dei negozi" — Instagram-like, scade in 24h.
 *
 * Esperti senior consultati:
 * - Senior PM: "Stories = formato che gli utenti hanno già imparato (Instagram).
 *   Importarle nel marketplace = friction zero, retention engagement +30%."
 * - Behavioral Scientist: "24h expiration → FOMO. Scarcity rende il contenuto
 *   premium senza pagare."
 * - UX Designer: "Avatar circolari, ring colorato per 'non visto'. Tap =
 *   fullscreen overlay con auto-advance 5sec (vedi StoryViewer)."
 */

type Story = {
  id: string;
  seller_id: string;
  image_url: string;
  caption: string | null;
  link_url: string | null;
  view_count: number;
  expires_at: string;
  seller: {
    id: string;
    store_name: string | null;
    store_logo: string | null;
  } | null;
};

const STORIE_LETTE = 200;
const STORIE_MOSTRATE = 30;
/** Storie lette per ogni negozio dalla funzione 662: tanti quanti i posti del carosello. */
const STORIE_PER_NEGOZIO = STORIE_MOSTRATE;

/** Le storie raggruppate per negozio (nell'ordine in cui il negozio compare) e una bolla a testa. */
export function unaBollaPerNegozio<T extends { seller_id: string }>(storie: T[]): {
  inSequenza: T[];
  bolle: Array<{ storia: T; indice: number }>;
} {
  const perNegozio = new Map<string, T[]>();
  for (const s of storie) perNegozio.set(s.seller_id, [...(perNegozio.get(s.seller_id) ?? []), s]);
  const inSequenza: T[] = [];
  const bolle: Array<{ storia: T; indice: number }> = [];
  for (const gruppo of perNegozio.values()) {
    bolle.push({ storia: gruppo[0], indice: inSequenza.length });
    inSequenza.push(...gruppo);
  }
  return { inSequenza, bolle };
}

/**
 * R04-010 — Le storie a turno fra i negozi: la più recente di ogni negozio, poi la seconda di
 * ognuno, e così via (i negozi nell'ordine della loro storia più recente). Prima del taglio a 30
 * le storie stavano in fila per data, e un negozio con tante storie nelle 24 ore prendeva tutti i
 * posti. Nessun tetto nuovo per negozio: solo l'alternanza.
 */
function aTurnoFraINegozi<T extends { seller_id: string }>(storie: T[]): T[] {
  const perNegozio = new Map<string, T[]>();
  for (const s of storie) perNegozio.set(s.seller_id, [...(perNegozio.get(s.seller_id) ?? []), s]);
  const gruppi = [...perNegozio.values()];
  const aTurno: T[] = [];
  for (let giro = 0; aTurno.length < storie.length; giro += 1) {
    for (const gruppo of gruppi) if (giro < gruppo.length) aTurno.push(gruppo[giro]);
  }
  return aTurno;
}

/**
 * R04-010 — Una lettura tornata piena (tante righe quanto il suo tetto) può essere tutta di un
 * negozio solo: le storie degli altri restavano fuori prima ancora dell'alternanza. Allora si
 * rilegge senza i negozi già visti, finché arrivano negozi nuovi (al massimo due riletture, tre letture in tutto). Una rilettura caduta tiene quello che c'è.
 */
async function conGliAltriNegozi<T extends { seller_id: string }>(
  prime: T[],
  tetto: number,
  senzaQuesti: (esclusi: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  let righe = prime;
  let ultima = prime;
  const visti = new Set(prime.map((s) => s.seller_id));
  // Al massimo due riletture dopo la prima lettura: tre letture in tutto, anche con 30 negozi da 30 storie.
  for (let rilette = 0; rilette < 2 && ultima.length >= tetto && visti.size < STORIE_MOSTRATE; rilette += 1) {
    const { data, error } = await senzaQuesti(`(${[...visti].join(',')})`);
    if (error) {
      logger.warn('[storie] rilettura senza i negozi già visti non riuscita: restano le storie lette', { error });
      break;
    }
    ultima = (data ?? []) as T[];
    const primaDelGiro = visti.size;
    for (const s of ultima) visti.add(s.seller_id);
    if (visti.size === primaDelGiro) break;
    righe = [...righe, ...ultima];
  }
  return righe;
}

export default function StoriesCarousel() {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // R09-008 — I negozi passano dalla memoria condivisa con le altre sezioni della home
  // (lib/queries/vetrina-con-memoria.ts): chi arriva dopo non rifà il giro di rete.
  const leggiNegozi = lettoreNegoziConMemoria(useQueryClient(), supabase);
  const { data: stories = [] } = useQuery({
    queryKey: queryKeys.seller.storiesActive,
    queryFn: async (): Promise<Story[]> => {
      // 18/10/2026 — Il negozio della storia arriva dalla vista pubblica dei
      // negozi, non dalla tabella dei profili: dopo le migrazioni 110, 112 e 161
      // la tabella mostra a ognuno solo la propria riga, e ogni bolla sarebbe
      // rimasta senza logo e senza nome. La storia di un negozio che la vista
      // non restituisce (non approvato, sospeso, senza insegna) non si mostra:
      // prima compariva con «?» e «—» al posto del nome.
      //
      // 14/11/2026 (R16-019) — Il negozio si filtra DENTRO la domanda, prima del tetto. Prima si
      // leggevano le 200 storie più recenti e solo dopo si toglievano quelle dei negozi fuori
      // vetrina: 200 storie recenti di autori che non devono comparire (sospesi, senza insegna,
      // non-negozi, rimaste da prima della 404) occupavano tutti i posti e il carosello restava
      // vuoto per tutti. Ora la storia si aggancia con `!inner` alla vista pubblica dei negozi, la
      // stessa che il carosello legge già e che chi non ha l'account può leggere: la vista tiene
      // solo i negozi approvati, con insegna, di ruolo negozio. Postgres scarta le altre storie e
      // POI ordina e taglia a 30. Il filtro qui sotto resta come seconda cintura e dà nome e logo.
      const colonne = 'id, seller_id, image_url, caption, link_url, view_count, expires_at';
      const adesso = new Date().toISOString();
      // R04-010 (giro 3) — Prima scelta: la funzione 662 dà al massimo STORIE_PER_NEGOZIO storie PER
      // NEGOZIO (e al massimo STORIE_MOSTRATE negozi) in UNA lettura, con gli stessi filtri di sotto
      // (non scadute, negozio della vista in vetrina, dalla più recente). Ogni negozio con storie arriva
      // in pagina, qualunque sia il numero di storie degli altri. Se la funzione non c'è ancora (la
      // migrazione non è applicata) o la chiamata cade, si legge come prima (ripiego qui sotto: al
      // massimo tre letture delle storie, mai un ciclo senza tetto).
      let righe: Array<Omit<Story, 'seller'> & { negozio?: unknown; created_at?: string }> | null = null;
      try {
        const perNegozio = await supabase.rpc('storie_attive_per_negozio', {
          p_per_negozio: STORIE_PER_NEGOZIO,
          p_negozi: STORIE_MOSTRATE,
        });
        if (!perNegozio.error && Array.isArray(perNegozio.data)) righe = perNegozio.data;
      } catch (e) {
        logger.warn('[storie] funzione storie_attive_per_negozio non chiamabile: si legge come prima', { error: e });
      }
      if (righe === null) {
        const filtrate = await supabase
          .from('seller_stories')
          .select(`${colonne}, negozio:seller_public_profiles!inner(id)`)
          .gt('expires_at', adesso)
          .order('created_at', { ascending: false })
          .limit(STORIE_MOSTRATE);
        righe = filtrate.data as Array<Omit<Story, 'seller'> & { negozio?: unknown }> | null;
        // R04-010 — Le righe degli altri negozi, se la lettura torna piena (vedi `conGliAltriNegozi`).
        let tetto = STORIE_MOSTRATE;
        let senzaQuesti: (esclusi: string) => PromiseLike<{ data: unknown; error: unknown }> = (esclusi) => supabase
          .from('seller_stories')
          .select(`${colonne}, negozio:seller_public_profiles!inner(id)`)
          .gt('expires_at', adesso)
          .not('seller_id', 'in', esclusi)
          .order('created_at', { ascending: false })
          .limit(STORIE_MOSTRATE);
        const codice = (filtrate.error as { code?: string } | null)?.code;
        if (codice === 'PGRST200' || codice === 'PGRST201') {
          // Il servizio dati non conosce l'aggancio storia → vista: si legge come prima (200, poi il
          // filtro), che non mostra mai un negozio fuori vetrina, invece di spegnere il carosello.
          logger.warn('[storie] aggancio alla vista dei negozi non riconosciuto: filtro dopo il tetto', { codice });
          const vecchia = await supabase
            .from('seller_stories')
            .select(colonne)
            .gt('expires_at', adesso)
            .order('created_at', { ascending: false })
            .limit(STORIE_LETTE);
          righe = vecchia.data as Array<Omit<Story, 'seller'>> | null;
          tetto = STORIE_LETTE;
          senzaQuesti = (esclusi) => supabase
            .from('seller_stories')
            .select(colonne)
            .gt('expires_at', adesso)
            .not('seller_id', 'in', esclusi)
            .order('created_at', { ascending: false })
            .limit(STORIE_LETTE);
        }
        righe = await conGliAltriNegozi(righe ?? [], tetto, senzaQuesti);
      }
      // R04-010 — A turno fra i negozi PRIMA del taglio a 30: un negozio solo non riempie il carosello.
      const storie = aTurnoFraINegozi(
        (righe ?? []).map(({ negozio: _negozio, created_at: _creata, ...storia }) => storia),
      );
      const conNegozio = (await conNegozioApprovato(supabase, storie, 'id, store_name, store_logo', leggiNegozi)).slice(0, STORIE_MOSTRATE);
      return conNegozio.map(({ profiles, ...storia }) => ({
        ...storia,
        seller: { id: profiles.id, store_name: profiles.store_name, store_logo: profiles.store_logo ?? null },
      }));
    },
    refetchInterval: 5 * 60_000,
  });

  if (stories.length === 0) return null;

  // 5/11/2026 — Una bolla per NEGOZIO, non per storia: tre storie di Pane Quotidiano erano tre
  // cerchi uguali in fila. Le storie di uno stesso negozio si mettono una dopo l'altra, e la bolla
  // apre il visore sulla prima del suo negozio.
  const { inSequenza, bolle } = unaBollaPerNegozio(stories);

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {bolle.map(({ storia: s, indice: i }) => (
          <button
            key={s.seller_id}
            type="button"
            onClick={() => setViewerIndex(i)}
            className="flex flex-col items-center gap-1 flex-shrink-0"
          >
            <div className="p-0.5 rounded-full bg-gradient-to-tr from-primary-500 via-accent-500 to-secondary-500">
              <div className="bg-white p-0.5 rounded-full">
                {s.seller?.store_logo ? (
                  <Image
                    src={s.seller.store_logo}
                    alt=""
                    width={56}
                    height={56}
                    // 5/11/2026 — la misura la fa Supabase (solo larghezza), non anche Vercel.
                    loader={caricatoreLogoNegozio}
                    className="rounded-full object-contain w-14 h-14"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold">
                    {(s.seller?.store_name ?? '?')[0]}
                  </div>
                )}
              </div>
            </div>
            <span className="text-2xs text-ink-700 font-semibold max-w-[72px] truncate">{s.seller?.store_name ?? '—'}</span>
          </button>
        ))}
      </div>

      {viewerIndex !== null && (
        <StoryViewer stories={inSequenza} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </>
  );
}
