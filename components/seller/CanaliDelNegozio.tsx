'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Facebook, Globe, Instagram, MapPin, Music2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { CANALI, NOMI_CANALI, type Canale, type Canali } from '@/lib/agenzia/canali';
import { CHIAVE_ANALISI, CHIAVE_CANALI, CHIAVE_PREVENTIVO, ErroreCanali, leggiCanali, salvaCanali } from '@/components/seller/preventivo-agenzia';
import { queryKeys } from '@/lib/queries/keys';

/**
 * «I TUOI CANALI» — 24/11/2026. Nella pagina dell'analisi del business e nel Profilo.
 *
 * Nicola: «ci deve essere un luogo dove l'imprenditore deve inserire l'id dei social e google e
 * quello che serve per analizzare anche il sito». Cinque campi; il controllo vero lo fa il server
 * (/api/seller/canali), qui si mostrano i suoi errori sotto il campo giusto.
 */

const CAMPI: Record<Canale, { icona: ReactNode; esempio: string; aiuto: string }> = {
  instagram: { icona: <Instagram size={16} />, esempio: 'panequotidiano', aiuto: 'Il nome del profilo, o il link copiato dall’app.' },
  facebook: { icona: <Facebook size={16} />, esempio: 'panequotidiano', aiuto: 'Il nome della pagina, o il suo link.' },
  tiktok: { icona: <Music2 size={16} />, esempio: 'panequotidiano', aiuto: 'Il nome del profilo, o il suo link.' },
  google_maps: { icona: <MapPin size={16} />, esempio: 'https://maps.app.goo.gl/…', aiuto: 'Su Google Maps apri la tua scheda, tocca «Condividi» e incolla qui il link.' },
  website: { icona: <Globe size={16} />, esempio: 'www.panequotidiano.it', aiuto: 'L’indirizzo del tuo sito, se ce l’hai.' },
};

export default function CanaliDelNegozio({ titolo = 'I tuoi canali' }: { titolo?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: CHIAVE_CANALI, queryFn: leggiCanali });
  const [valori, setValori] = useState<Canali>({});
  const [errori, setErrori] = useState<Partial<Record<Canale, string>>>({});

  useEffect(() => {
    if (data) setValori(data);
  }, [data]);

  const salva = useMutation({
    mutationFn: () => salvaCanali(valori),
    onSuccess: (r) => {
      setErrori({});
      setValori(r.canali);
      qc.setQueryData(CHIAVE_CANALI, r.canali);
      qc.invalidateQueries({ queryKey: CHIAVE_ANALISI });
      qc.invalidateQueries({ queryKey: CHIAVE_PREVENTIVO });
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      toast.success(r.analisiChiesta ? 'Canali salvati: li analizziamo e qui trovi il risultato.' : 'Canali salvati.');
    },
    onError: (e: unknown) => {
      if (e instanceof ErroreCanali) setErrori(e.errori);
      toast.error(e instanceof Error ? e.message : 'Non sono riuscito a salvare. Riprova.');
    },
  });

  return (
    <section aria-labelledby="i-tuoi-canali" className="rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm">
      <h2 id="i-tuoi-canali" className="text-sm font-bold text-ink-900">{titolo}</h2>
      <p className="mt-0.5 text-sm text-ink-600">
        Scrivi dove ti trovano i clienti: li leggiamo noi, solo nelle parti pubbliche, e ti diciamo cosa funziona e cosa migliorare.
        Non ci servono password.
      </p>
      {isError && <p role="alert" className="mt-3 text-sm text-secondary-700">Non sono riuscito a leggere i tuoi canali. Ricarica la pagina.</p>}
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          salva.mutate();
        }}
      >
        {CANALI.map((c) => (
          <div key={c}>
            <label htmlFor={`canale-${c}`} className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-900">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cream-100 text-ink-500" aria-hidden>{CAMPI[c].icona}</span>
              {NOMI_CANALI[c]}
            </label>
            <input
              id={`canale-${c}`}
              type="text"
              inputMode={c === 'google_maps' || c === 'website' ? 'url' : 'text'}
              autoComplete="off"
              disabled={isLoading || salva.isPending}
              value={valori[c] ?? ''}
              onChange={(e) => setValori((v) => ({ ...v, [c]: e.target.value }))}
              placeholder={CAMPI[c].esempio}
              aria-invalid={errori[c] ? true : undefined}
              aria-describedby={`canale-${c}-aiuto${errori[c] ? ` canale-${c}-errore` : ''}`}
              className="w-full rounded-lg border border-cream-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
            />
            <p id={`canale-${c}-aiuto`} className="mt-0.5 text-xs text-ink-500">{CAMPI[c].aiuto}</p>
            {errori[c] && <p id={`canale-${c}-errore`} role="alert" className="mt-0.5 text-xs font-medium text-secondary-600">{errori[c]}</p>}
          </div>
        ))}
        <Button type="submit" disabled={isLoading || salva.isPending}>{salva.isPending ? 'Salvo…' : 'Salva i canali'}</Button>
      </form>
    </section>
  );
}
