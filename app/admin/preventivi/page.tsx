'use client';

import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';

/**
 * I PREVENTIVI COL LINK — 24/11/2026. Il link da mandare al titolare di un'attività in «modalità
 * preventivo» (per ora Ora del Gusto), lo stato e se n8n ha già mandato la scheda del locale.
 * Il link apre solo quel preventivo: va mandato solo al titolare.
 */
type Riga = {
  sellerId: string;
  negozio: string;
  stato: 'aperto' | 'accettato' | 'chiuso';
  fascia: string | null;
  creatoIl: string;
  accettatoIl: string | null;
  link: string;
  schedaRicevutaIl: string | null;
};

const STATO: Record<Riga['stato'], string> = { aperto: 'Da mandare / in attesa', accettato: 'Accettato', chiuso: 'Chiuso' };
const quando = (d: string | null) => (d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : '—');

async function leggi(): Promise<Riga[]> {
  const r = await fetch('/api/admin/preventivi-col-link', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: Riga[]; error?: { message?: string } } | null;
  if (!r.ok || !corpo?.ok) throw new Error(corpo?.error?.message ?? 'Lettura non riuscita');
  return corpo.data ?? [];
}

export default function PreventiviColLink() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'preventivi-col-link'], queryFn: leggi });
  if (isLoading) return <LoadingState />;
  return (
    <div className="max-w-4xl p-4">
      <h1 className="font-serif text-2xl font-extrabold text-ink-900">Preventivi col link</h1>
      <p className="mt-1 text-sm text-ink-600">
        Le attività in «modalità preventivo» non hanno ancora un accesso. Manda il link solo al titolare: quando accetta, lascia la sua email,
        riceve il link per entrare e il negozio passa in revisione.
      </p>
      {error && <p role="alert" className="mt-4 text-sm text-secondary-700">{error instanceof Error ? error.message : 'Lettura non riuscita'}</p>}
      {data && data.length === 0 && <p className="mt-4 text-sm text-ink-600">Nessun preventivo col link.</p>}
      <ul className="mt-4 space-y-3">
        {data?.map((r) => (
          <li key={r.sellerId} className="rounded-xl border border-cream-200 bg-surface-0 p-4">
            <p className="font-semibold text-ink-900">{r.negozio}</p>
            <p className="text-xs text-ink-600">
              {STATO[r.stato]}{r.fascia ? ` · ${r.fascia}` : ''} · creato {quando(r.creatoIl)}{r.accettatoIl ? ` · accettato ${quando(r.accettatoIl)}` : ''}
            </p>
            <p className="text-xs text-ink-600">Scheda del locale da n8n: {r.schedaRicevutaIl ? `ricevuta ${quando(r.schedaRicevutaIl)}` : 'non ancora arrivata (la bozza resta generica)'}</p>
            {r.stato === 'aperto' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded bg-cream-100 px-2 py-1 text-xs">{r.link}</code>
                <button
                  type="button"
                  className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-bold text-white"
                  onClick={() => navigator.clipboard.writeText(r.link).then(() => toast.success('Link copiato'), () => toast.error('Non sono riuscito a copiarlo'))}
                >
                  Copia il link
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
