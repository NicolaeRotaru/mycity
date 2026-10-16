'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { formatPriceFromCents } from '@/lib/format';
import { queryKeys } from '@/lib/queries/keys';
import { centesimiDaEuro } from '@/lib/rimborsi/divisione-del-rimborso';
import type { CarrelloDaDividere, ElencoDaDividere } from '@/lib/stripe/rimborsi-da-dividere';

/**
 * 16/10/2026 — I BONIFICI FERMATI DA UN RIMBORSO DAL CRUSCOTTO SI SBLOCCANO DA QUI.
 *
 * Un rimborso fatto dal cruscotto Stripe su un carrello di più negozi ferma i
 * bonifici di tutti: Stripe non dice di quale negozio è. Prima si sbloccavano
 * solo scrivendo a mano nel database. Qui chi amministra scrive la parte di
 * ciascun ordine (zero se non è sua); il server controlla che le parti facciano
 * esattamente il rimborso, toglie a ogni negozio la sua quota e riapre i
 * bonifici. Se non c'è niente da dividere il riquadro non compare.
 */

async function chiamata(metodo: 'GET' | 'POST', corpo?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch('/api/admin/orders/rimborsi-da-dividere', {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Richiesta non riuscita');
  return json?.data;
}

function Carrello({ carrello }: { carrello: CarrelloDaDividere }) {
  const qc = useQueryClient();
  const [cifre, setCifre] = useState<Record<string, string>>({});
  const parti = carrello.ordini.map((o) => ({ ordine: o.id, centesimi: centesimiDaEuro(cifre[o.id] ?? '') }));
  const illeggibile = parti.some((p) => p.centesimi === null);
  const somma = parti.reduce((s, p) => s + (p.centesimi ?? 0), 0);
  const torna = !illeggibile && somma === carrello.daDividereCents;

  const dividi = useMutation({
    mutationFn: () => chiamata('POST', { pagamento: carrello.pagamento, parti }),
    onSuccess: () => {
      toast.success('Rimborso diviso: i bonifici di questi ordini ripartono');
      qc.invalidateQueries({ queryKey: queryKeys.admin.rimborsiDaDividere });
      qc.invalidateQueries({ queryKey: queryKeys.admin.orders });
    },
    onError: (e: unknown) => {
      toast.error(friendlyError(e));
      qc.invalidateQueries({ queryKey: queryKeys.admin.rimborsiDaDividere });
    },
  });

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
      <p className="text-sm text-ink-700">
        Rimborso da dividere: <strong>{formatPriceFromCents(carrello.daDividereCents)}</strong>
        <span className="text-ink-500"> · pagamento {carrello.pagamento}</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-2 text-left">Ordine</th>
              <th className="p-2 text-left">Negozio</th>
              <th className="p-2 text-right">Pagato</th>
              <th className="p-2 text-right">Già rimborsato</th>
              <th className="p-2 text-right">Sua parte (€)</th>
            </tr>
          </thead>
          <tbody>
            {carrello.ordini.map((o) => (
              <tr key={o.id} className="border-t border-amber-200">
                <td className="p-2 font-mono text-xs text-ink-500">#{o.id.slice(0, 6).toUpperCase()}</td>
                <td className="p-2 text-ink-700">
                  {o.negozio}
                  {o.bonificoPartito && <span className="block text-xs text-ink-500">bonifico già partito: la quota si riprende con uno storno</span>}
                  {!o.fermo && (
                    <span className="block text-xs text-ink-500">bonifico non fermo: scrivi una parte solo se il rimborso è suo</span>
                  )}
                </td>
                <td className="p-2 text-right">{formatPriceFromCents(o.lordoCents)}</td>
                <td className="p-2 text-right">{formatPriceFromCents(o.giaRimborsatoCents)}</td>
                <td className="p-2 text-right">
                  <input
                    inputMode="decimal"
                    aria-label={`Parte del rimborso dell'ordine ${o.id.slice(0, 6).toUpperCase()}`}
                    placeholder="0,00"
                    value={cifre[o.id] ?? ''}
                    onChange={(e) => setCifre((c) => ({ ...c, [o.id]: e.target.value }))}
                    className="w-24 rounded-md border border-cream-300 bg-white px-2 py-1 text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className={torna ? 'text-emerald-700' : 'text-ink-600'}>
          {illeggibile
            ? 'Una cifra non si legge: scrivi per esempio 3,50'
            : `Le parti fanno ${formatPriceFromCents(somma)} su ${formatPriceFromCents(carrello.daDividereCents)}`}
        </span>
        <button
          type="button"
          onClick={() => dividi.mutate()}
          disabled={!torna || dividi.isPending}
          className="rounded-lg bg-primary-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {dividi.isPending ? 'Registro…' : 'Registra la divisione e riapri i bonifici'}
        </button>
      </div>
    </div>
  );
}

export function RimborsiDaDividere() {
  const { data, error } = useQuery({
    queryKey: queryKeys.admin.rimborsiDaDividere,
    queryFn: async () => (await chiamata('GET')) as ElencoDaDividere,
    refetchInterval: 120_000,
  });
  const titolo = (
    <h2 id="rimborsi-da-dividere" className="text-base font-bold text-ink-800">Rimborsi dal cruscotto da dividere</h2>
  );
  if (error) {
    // 16/10/2026 — Il messaggio è quello del server, da solo: prima gli si
    // metteva davanti la stessa frase, e si leggeva due volte «Non riesco a
    // leggere i rimborsi da dividere».
    return (
      <section className="space-y-2" aria-labelledby="rimborsi-da-dividere">
        {titolo}
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{friendlyError(error)}</p>
      </section>
    );
  }
  const carrelli = data?.carrelli ?? [];
  const nonLetti = data?.nonLetti ?? [];
  if (carrelli.length === 0 && nonLetti.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="rimborsi-da-dividere">
      {titolo}
      <p className="text-sm text-ink-600">
        Stripe non dice di quale negozio è un rimborso fatto dal cruscotto su un carrello di più negozi: i bonifici del
        carrello restano fermi finché non lo dividi. Scrivi la parte di ciascun ordine (0 se non è sua).
      </p>
      {nonLetti.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p>Stripe adesso non mi lascia leggere questi pagamenti: il riquadro riprova da solo fra due minuti.</p>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {nonLetti.map((n) => <li key={n.pagamento}>{n.pagamento}</li>)}
          </ul>
        </div>
      )}
      {carrelli.map((c) => <Carrello key={c.pagamento} carrello={c} />)}
    </section>
  );
}
