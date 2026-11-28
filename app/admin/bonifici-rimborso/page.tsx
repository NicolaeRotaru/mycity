'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, Banknote, CheckCircle2, Info, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPriceFromCents } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AdminPageTitle, AdminSectionLabel } from '@/components/admin/AdminUI';
import { vistaDaQuery } from '@/lib/vista-query';
import {
  GIORNI_DI_PREAVVISO,
  GIORNI_PER_RIMBORSARE,
  PARTENZA_DEL_TERMINE_DEI_RECLAMI,
  chiEQuando,
  doveArrivaLIban,
  elencoDeiBonifici,
  fraseDelTermine,
  messaggioDelSegno,
  type BonificoInElenco,
  type RigaDelBonifico,
  type RispostaDelSegno,
} from '@/lib/rimborsi/bonifici-da-fare';

/**
 * I BONIFICI DI RIMBORSO DA FARE (26/11/2026).
 *
 * Chi ha pagato in contanti riavrà i soldi con un bonifico, che fa a mano chi amministra MyCity
 * dall'app della banca, «poi tocca "fatto"» (registro dei fatti di Nicola, 29/10). Prima l'unico
 * promemoria era un avviso nella campanella, e contro il doppio pagamento c'era solo «cerca la
 * causale nei movimenti del conto».
 *
 * I bonifici sono i segni `bonifico:<centesimi>:<chiave>` che `refundOrder` scrive sull'ordine;
 * l'esito (FATTO / RESPINTO) lo tiene la migrazione 910. «Fatto» passa una volta sola: un secondo
 * amministratore legge chi l'ha già fatto e quando. «Respinto dalla banca» lo rimette da fare.
 */

type Segna = (b: BonificoInElenco, esito: 'FATTO' | 'RESPINTO') => Promise<void>;

function Termine({ b, adesso }: { b: BonificoInElenco; adesso: Date }) {
  const frase = fraseDelTermine(b.termine, adesso);
  if (!b.inEvidenza) return <p className="text-sm text-ink-600">{frase}</p>;
  const rosso = b.urgenza.tipo === 'passato' || b.urgenza.tipo === 'sconosciuto';
  return (
    <p
      role="status"
      className={`inline-flex items-start gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold ${
        rosso ? 'border-secondary-300 bg-secondary-50 text-secondary-800' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
      {frase}
    </p>
  );
}

function BonificoDaFare({ b, adesso, segna, inCorso }: { b: BonificoInElenco; adesso: Date; segna: Segna; inCorso: boolean }) {
  return (
    <li className={`rounded-2xl border-2 bg-white p-4 shadow-warm ${b.inEvidenza ? 'border-secondary-200' : 'border-cream-300'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xl font-extrabold text-ink-900">{formatPriceFromCents(b.centesimi)}</p>
          <p className="text-sm text-ink-700">
            {b.cliente_nome ?? 'Cliente senza nome'} ·{' '}
            <Link href={`/admin/orders/${b.order_id}`} className="font-semibold text-primary-700 underline">
              ordine {b.numeroOrdine}
            </Link>
          </p>
          <p className="text-sm text-ink-600">{doveArrivaLIban(b.cliente_email)}</p>
          <p className="text-sm text-ink-700">
            Causale: <span className="select-all font-mono text-xs text-ink-900">{b.causale}</span>
          </p>
          <Termine b={b} adesso={adesso} />
          {b.stato === 'RESPINTO' && (
            <p className="text-sm font-semibold text-secondary-800">
              Respinto dalla banca {chiEQuando(b.respinto_da_nome, b.respinto_il, adesso)}: va rifatto.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void segna(b, 'FATTO')}
          disabled={inCorso}
          className="rounded-lg border border-olive-300 bg-olive-600 px-4 py-2 text-sm font-semibold text-white hover:bg-olive-700 disabled:opacity-50"
        >
          {inCorso ? 'Segno…' : 'Fatto'}
        </button>
      </div>
    </li>
  );
}

function BonificoFatto({ b, adesso, segna, inCorso }: { b: BonificoInElenco; adesso: Date; segna: Segna; inCorso: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cream-300 bg-white px-4 py-3">
      <div className="min-w-0 text-sm text-ink-700">
        <p>
          <span className="font-semibold text-ink-900">{formatPriceFromCents(b.centesimi)}</span> · {b.cliente_nome ?? 'Cliente senza nome'} ·
          ordine {b.numeroOrdine} · <span className="font-mono text-xs">{b.causale}</span>
        </p>
        <p className="text-ink-500">Fatto {chiEQuando(b.fatto_da_nome, b.fatto_il, adesso)}</p>
      </div>
      <button
        type="button"
        onClick={() => void segna(b, 'RESPINTO')}
        disabled={inCorso}
        className="inline-flex items-center gap-1.5 rounded-lg border border-secondary-300 bg-white px-3 py-1.5 text-xs font-semibold text-secondary-800 hover:bg-secondary-50 disabled:opacity-50"
      >
        <Undo2 size={14} aria-hidden />
        {inCorso ? 'Segno…' : 'Respinto dalla banca'}
      </button>
    </li>
  );
}

export default function AdminBonificiRimborsoPage() {
  const query = useQuery({
    queryKey: ['admin', 'bonifici-rimborso'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<RigaDelBonifico[]> => {
      const { data, error } = await supabase.rpc('admin_bonifici_rimborso');
      if (error) throw error;
      return (data ?? []) as RigaDelBonifico[];
    },
  });
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);

  const adesso = new Date();
  const { daFare, fatti } = elencoDeiBonifici(query.data ?? [], adesso);

  const segna: Segna = async (b, cosa) => {
    const domanda =
      cosa === 'FATTO'
        ? `Hai fatto il bonifico di ${formatPriceFromCents(b.centesimi)} con la causale «${b.causale}»?`
        : `La banca ha respinto il bonifico di ${formatPriceFromCents(b.centesimi)} con la causale «${b.causale}»? Torna fra quelli da fare.`;
    if (!window.confirm(domanda)) return;
    setInCorso(b.chiave);
    setEsito(null);
    const { data, error } = await supabase.rpc('admin_segna_bonifico_rimborso', {
      p_order_id: b.order_id,
      p_chiave: b.chiave,
      p_centesimi: b.centesimi,
      p_esito: cosa,
    } as never);
    setInCorso(null);
    setEsito(error ? { ok: false, testo: 'Non sono riuscito a segnarlo: riprova.' } : messaggioDelSegno(data as RispostaDelSegno, new Date()));
    void query.refetch();
  };

  const vista = vistaDaQuery(query, { quanti: daFare.length + fatti.length });
  if (vista.mostraScheletro) return <LoadingState />;

  if (vista.mostraErrore) {
    return (
      <div className="space-y-6">
        <AdminPageTitle eyebrow="Pagamenti" title="Bonifici di rimborso" />
        <ErrorState
          variant="compact"
          title="Non riesco a leggere i bonifici di rimborso"
          description="Non so quali bonifici ai clienti sono ancora da fare. Riprova tra poco."
          retry={() => void query.refetch()}
          supportHref={null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Pagamenti"
        title="Bonifici di rimborso"
        sub="I rimborsi degli ordini pagati in contanti. Fai il bonifico dall'app della banca, poi premi «Fatto»."
      />

      <div className="flex items-start gap-2.5 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-600">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        <p>
          La legge dà {GIORNI_PER_RIMBORSARE} giorni dalla richiesta del reso; per un reclamo li contiamo dal giorno in cui{' '}
          {PARTENZA_DEL_TERMINE_DEI_RECLAMI === 'decisione' ? 'è stato deciso' : 'il cliente l’ha aperto'}. Un bonifico va in evidenza quando ne mancano{' '}
          {GIORNI_DI_PREAVVISO} o meno, o il termine è passato. «Fatto» si segna una volta sola: se un altro amministratore
          l&apos;ha già fatto, te lo dice. Se la banca lo respinge, premi «Respinto dalla banca» fra i fatti: torna qui sopra.
        </p>
      </div>

      {esito && (
        <p
          role={esito.ok ? 'status' : 'alert'}
          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
            esito.ok ? 'border-olive-200 bg-olive-50 text-olive-800' : 'border-secondary-200 bg-secondary-50 text-secondary-800'
          }`}
        >
          {esito.testo}
        </p>
      )}

      <section>
        <AdminSectionLabel icon={Banknote}>Da fare ({daFare.length})</AdminSectionLabel>
        {daFare.length === 0 ? (
          <div className="rounded-2xl border-2 border-cream-300 bg-white p-10 text-center">
            <CheckCircle2 size={36} strokeWidth={2} className="mx-auto mb-2 text-olive-500" aria-hidden />
            <p className="font-medium text-ink-600">Nessun bonifico di rimborso da fare</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {daFare.map((b) => (
              <BonificoDaFare key={b.chiave} b={b} adesso={adesso} segna={segna} inCorso={inCorso === b.chiave} />
            ))}
          </ul>
        )}
      </section>

      {fatti.length > 0 && (
        <section>
          <AdminSectionLabel icon={CheckCircle2}>Fatti ({fatti.length})</AdminSectionLabel>
          <ul className="space-y-2">
            {fatti.map((b) => (
              <BonificoFatto key={b.chiave} b={b} adesso={adesso} segna={segna} inCorso={inCorso === b.chiave} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
