'use client';

import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '@/components/ui/LoadingState';

/**
 * LE BOZZE DEL SITO DA SCRIVERE — 24/11/2026.
 *
 * Nicola: la bozza del sito fatta con l'IA la scrive «l'AD in un giro». Questa pagina dice chi la
 * aspetta: i negozi senza un sito loro, che non hanno ancora una bozza o che hanno ricevuto da n8n
 * una scheda più nuova dell'ultima bozza. La bozza arriva dallo script dell'AD (POST
 * /api/agenzia/bozza-sito) e la pagina «Sito web» del negozio la mostra, da confermare dal titolare.
 */
type Riga = {
  id_attivita: string;
  nome: string;
  tipo: string | null;
  perche: 'nessuna_bozza' | 'scheda_nuova' | 'scheda_aperta';
  in_revisione: boolean;
  scheda_il: string | null;
  bozza_il: string | null;
};

const PERCHE: Record<Riga['perche'], string> = {
  nessuna_bozza: 'Non ha ancora una bozza',
  scheda_nuova: 'n8n ha mandato dati nuovi dopo l’ultima bozza',
  scheda_aperta: 'Ha pagato l’abbonamento: la scheda è aperta, la bozza va rifatta coi suoi dati',
};
const quando = (d: string | null) => (d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : '—');

async function leggi(): Promise<Riga[]> {
  const r = await fetch('/api/admin/bozze-sito', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: Riga[]; error?: { message?: string } } | null;
  if (!r.ok || !corpo?.ok) throw new Error(corpo?.error?.message ?? 'Lettura non riuscita');
  return corpo.data ?? [];
}

export default function BozzeDelSito() {
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'bozze-sito'], queryFn: leggi });
  if (isLoading) return <LoadingState />;
  return (
    <div className="max-w-4xl p-4">
      <h1 className="font-serif text-2xl font-extrabold text-ink-900">Bozze del sito da scrivere</h1>
      <p className="mt-1 text-sm text-ink-600">
        I negozi senza un sito loro che aspettano la bozza. La scrive l’AD nel suo giro e la manda al sito: il titolare la vede nella pagina
        «Sito web», con ogni testo da confermare.
      </p>
      {error && <p role="alert" className="mt-4 text-sm text-secondary-700">{error instanceof Error ? error.message : 'Lettura non riuscita'}</p>}
      {data && data.length === 0 && <p className="mt-4 text-sm text-ink-600">Nessun negozio aspetta la bozza.</p>}
      {data && data.length > 0 && <p className="mt-4 text-sm font-semibold text-ink-900">{data.length} {data.length === 1 ? 'negozio aspetta' : 'negozi aspettano'} la bozza</p>}
      <ul className="mt-3 space-y-3">
        {data?.map((r) => (
          <li key={r.id_attivita} className="rounded-xl border border-cream-200 bg-surface-0 p-4">
            <p className="font-semibold text-ink-900">{r.nome}{r.in_revisione && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">in verifica</span>}</p>
            <p className="text-xs text-ink-600">{PERCHE[r.perche]}{r.tipo ? ` · ${r.tipo}` : ''}</p>
            <p className="text-xs text-ink-600">Scheda di n8n: {r.scheda_il ? quando(r.scheda_il) : 'non ancora arrivata'} · ultima bozza: {quando(r.bozza_il)}</p>
            <p className="mt-1 font-mono text-[11px] text-ink-500">{r.id_attivita}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
