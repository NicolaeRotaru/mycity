'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '@/components/ui/LoadingState';
import SitoConsegnato from '@/components/seller/lavoro-consegnato/SitoConsegnato';
import PianoEditorialeConsegnato from '@/components/seller/lavoro-consegnato/PianoEditorialeConsegnato';
import AnalisiConsegnata from '@/components/seller/lavoro-consegnato/AnalisiConsegnata';
import type { NegozioConLavoro } from '@/lib/agenzia/lavoro-consegnato/tipi';

/**
 * IL LAVORO DEI CLIENTI — 27/11/2026.
 *
 * Nicola: «dammi modo di accedere all'account Caffè di Piacenza» → «vederlo da Admin». Scegli il negozio e
 * vedi le sue voci «Sito web», «Gestione social» e «Analisi del business» come le vede lui, in sola lettura.
 * L'account del cliente non si tocca.
 */
type Parte = 'sito' | 'social' | 'analisi';
const ETICHETTE: Record<Parte, string> = { sito: 'Sito web', social: 'Gestione social', analisi: 'Analisi del business' };
const NOME_FASCIA = { base: 'Base', business: 'Business', premium: 'Premium' } as const;

async function leggi(): Promise<NegozioConLavoro[]> {
  const r = await fetch('/api/admin/lavoro-consegnato', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { negozi?: NegozioConLavoro[] } } | null;
  if (!r.ok || !corpo?.ok) throw new Error('Non sono riuscito a leggere il lavoro dei clienti.');
  return corpo.data?.negozi ?? [];
}

export default function LavoroDeiClienti() {
  const { data: negozi, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'lavoro-consegnato'], queryFn: leggi });
  const [scelto, setScelto] = useState<string | null>(null);
  const [parte, setParte] = useState<Parte>('sito');

  const negozio = negozi?.find((n) => n.negozioId === scelto) ?? negozi?.[0] ?? null;
  const parti = negozio ? (['sito', 'social', 'analisi'] as Parte[]).filter((p) => negozio.lavoro[p]) : [];
  const parteMostrata = parti.includes(parte) ? parte : parti[0] ?? null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-ink-900">Lavoro dei clienti</h1>
      <p className="mt-1 text-sm text-ink-600">
        Quello che ogni negozio vede nel suo pannello, alle voci dei servizi. Solo da leggere: l&apos;account del negozio non si tocca.
      </p>

      {isLoading && <LoadingState />}
      {isError && (
        <p className="mt-4 text-sm text-ink-700" role="alert">
          Non sono riuscito a leggere il lavoro dei clienti. Se sei uscito dall&apos;account, rientra e riprova.{' '}
          <button type="button" onClick={() => refetch()} className="font-semibold text-primary-700 underline underline-offset-2">Riprova</button>
        </p>
      )}
      {negozi && negozi.length === 0 && <p className="mt-4 text-sm text-ink-700">Nessun negozio ha ancora un lavoro consegnato.</p>}

      {negozi && negozi.length > 0 && negozio && (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Scegli il negozio">
            {negozi.map((n) => (
              <button
                key={n.negozioId}
                type="button"
                onClick={() => setScelto(n.negozioId)}
                aria-pressed={n.negozioId === negozio.negozioId}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${n.negozioId === negozio.negozioId ? 'border-primary-700 bg-primary-700 text-white' : 'border-cream-300 bg-white text-ink-800'}`}
              >
                {n.nome} · {NOME_FASCIA[n.lavoro.fascia]}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 border-b border-cream-300 pb-2" role="group" aria-label="Scegli la voce">
            {parti.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setParte(p)}
                aria-pressed={p === parteMostrata}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${p === parteMostrata ? 'bg-cream-200 text-ink-900' : 'text-ink-600'}`}
              >
                {ETICHETTE[p]}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {parti.length === 0 && <p className="text-sm text-ink-700">Per questo negozio non c&apos;è ancora nessuna voce consegnata da mostrare.</p>}
            {parteMostrata === 'sito' && negozio.lavoro.sito && <SitoConsegnato sito={negozio.lavoro.sito} fascia={negozio.lavoro.fascia} />}
            {parteMostrata === 'social' && negozio.lavoro.social && <PianoEditorialeConsegnato social={negozio.lavoro.social} />}
            {parteMostrata === 'analisi' && negozio.lavoro.analisi && <AnalisiConsegnata analisi={negozio.lavoro.analisi} />}
          </div>
        </>
      )}
    </div>
  );
}
