'use client';

// LA SCHEDA GOOGLE IN DIRETTA, DENTRO LA SCHEDA DEL VENDITORE — 28/11/2026.
//
// Il 28/11 la prova sulle 10 attività della mappa dei venditori: 3 su 10 erano chiuse o spostate, e la scheda
// consigliava lo stesso un abbonamento. Che un negozio sia chiuso, il voto, gli orari e il telefono li sa solo
// Google. Il parere legale del 26/11 dice come mostrarli: col riquadro ufficiale di Google, caricato in diretta
// nel browser, senza salvare niente (components/seller/SchedaGoogleUfficiale.tsx, lo stesso del rapporto).
//
// Qui il `place_id` non c'è: il link del venditore dà nome e indirizzo. Lo si chiede a Google dal browser con una
// ricerca che restituisce solo l'identificativo (Place.searchByText, campo `id`), e non si salva da nessuna parte.
// Spento finché non c'è la chiave del browser (`NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE`): allora non disegna niente.

import { useEffect, useState } from 'react';
import SchedaGoogleUfficiale, { caricaPlaces, schedaGoogleCollegata } from '@/components/seller/SchedaGoogleUfficiale';

type Luogo = { id?: string };
type CercaTesto = (req: { textQuery: string; fields: string[]; maxResultCount?: number; language?: string; region?: string }) => Promise<{ places?: Luogo[] }>;

/** La domanda per Google: nome e indirizzo letti dal link, con la città se manca. */
export function domandaPerGoogle(nome: string | null, indirizzo: string | null, citta: string | null): string | null {
  const n = String(nome ?? '').trim();
  if (!n) return null;
  const dove = String(indirizzo ?? '').trim() || String(citta ?? '').trim();
  return dove ? `${n}, ${dove}` : n;
}

export default function GoogleInDiretta({ nome, indirizzo, citta }: { nome: string | null; indirizzo: string | null; citta: string | null }) {
  const domanda = domandaPerGoogle(nome, indirizzo, citta);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [esito, setEsito] = useState<'cerca' | 'trovato' | 'niente'>('cerca');

  useEffect(() => {
    if (!schedaGoogleCollegata() || !domanda) return;
    let vivo = true;
    (async () => {
      const chiave = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CHIAVE?.trim() ?? '';
      if (!(await caricaPlaces(chiave))) return vivo && setEsito('niente');
      const cerca = (window as unknown as { google?: { maps?: { places?: { Place?: { searchByText?: CercaTesto } } } } })
        .google?.maps?.places?.Place?.searchByText;
      if (!cerca) return vivo && setEsito('niente');
      try {
        const r = await cerca({ textQuery: domanda, fields: ['id'], maxResultCount: 1, language: 'it', region: 'it' });
        const id = r.places?.[0]?.id ?? null;
        if (!vivo) return;
        setPlaceId(id);
        setEsito(id ? 'trovato' : 'niente');
      } catch {
        if (vivo) setEsito('niente');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [domanda]);

  if (!schedaGoogleCollegata() || !domanda) return null;
  return (
    <section aria-labelledby="google-diretta" data-testid="google-in-diretta">
      <h2 id="google-diretta">Google, in diretta</h2>
      <p>Guarda prima di entrare se è chiuso o si è spostato, gli orari, il voto e le foto. Lo mostra Google: non lo salviamo.</p>
      {esito === 'cerca' && <p>Cerco l’attività su Google…</p>}
      {esito === 'niente' && <p>Google non la trova con questo nome e indirizzo: aprila dal tuo link.</p>}
      {esito === 'trovato' && <SchedaGoogleUfficiale placeId={placeId} />}
    </section>
  );
}
