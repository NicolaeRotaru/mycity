'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { contanteDaRimettereCents } from '@/lib/shipping';
import { giornoLocale } from '@/lib/tempo/giorno-locale';
import type { Colonne, ColonneSalvo } from '@/lib/db-rows';
import { incassoDaDichiarare } from '@/lib/rider/incasso-alla-consegna';

/**
 * Rimesse contanti COD (🔴-1 slice 2/UI). Elenca i gruppi rider·giorno con ordini
 * COD consegnati in attesa di rimessa (payout_status='AWAITING_REMITTANCE'); l'admin
 * conferma i contanti ricevuti → confirm_cod_remittance rilascia quegli ordini a
 * 'HELD' e il cron release-payouts paga i venditori.
 */

/**
 * 30/8/2026 (R004) — La forma della riga viene dallo schema, non da qui.
 *
 * Questa pagina dice a un amministratore quanti contanti farsi rimettere da
 * ogni fattorino: se una colonna cambia nome, la lettura torna vuota e i
 * negozi non vengono pagati finche' qualcuno non se ne accorge. Ora una
 * colonna che sparisce fa diventare rosso `npm run typecheck`.
 *
 * Le ri-dichiarazioni: gli importi arrivano come stringa quando PostgREST
 * serializza i `numeric`; fattorino e data di consegna non sono mai nulli
 * perche' la query filtra proprio su quelli.
 */
type Row = ColonneSalvo<
  'orders',
  | 'id' | 'rider_id' | 'delivered_at' | 'total_price' | 'shipping_cost' | 'rider_fee_cents' | 'pickup_in_store'
  | 'payment_method' | 'delivery_status' | 'cash_confirmed_at',
  {
    rider_id: string;
    delivered_at: string;
    total_price: string | number;
    shipping_cost: string | number | null;
    delivery_status: string;
  }
> & {
  rider: Colonne<'profiles', 'full_name'> | null;
};

type Group = {
  riderId: string;
  riderName: string;
  date: string; // YYYY-MM-DD (UTC) — coerente con confirm_cod_remittance
  orders: number;
  // Σ (totale − compenso trattenuto): il fattorino tiene il suo compenso fisso,
  // rimette il resto. 22/8/2026 — qui si toglieva la SPEDIZIONE pagata dal
  // cliente, che sopra i 30 euro e' zero: su ogni ordine sopra soglia la pagina
  // chiedeva 3 euro in piu' del dovuto. L'amministratore contava i contanti,
  // ne trovava meno di quelli scritti, e o accusava il fattorino o non
  // confermava — e senza conferma il negozio non viene pagato.
  toRemitCents: number;
  /**
   * 15/10/2026 (R33) — Gli ordini di quel giorno senza incasso registrato: la
   * rimessa li salta, e il negozio non viene pagato finche' l'incasso non c'e'.
   */
  senzaIncasso: Row[];
};

/**
 * 5/11/2026 (S05) — Il tetto della lettura. Si chiede una riga in più: se arriva,
 * l'elenco è tagliato e la pagina lo dice (prima con 1000 righe esatte taceva
 * sempre, e i totali sembravano completi).
 */
const TETTO_RIMESSE = 1000;

/** Da «12,50» (o «12.50») ai centesimi; null se non è un importo. */
function centesimiDa(testo: string): number | null {
  const t = testo.trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export default function AdminCodRemittancePage() {
  const qc = useQueryClient();
  // La riga rider·giorno che si sta confermando: il tocco su «Conferma rimessa»
  // apre il passo dei contanti contati, non chiama il server.
  const [aperta, setAperta] = useState<string | null>(null);
  const [contati, setContati] = useState('');
  const [nota, setNota] = useState('');
  // 13/11/2026 (R14-006) — Il bottone si spegne quando React ridisegna con la
  // conferma in corso, cioe' dopo: un doppio clic (o Invio premuto due volte)
  // arrivava prima e mandava due conferme. Questo segno si alza nel clic stesso
  // e si abbassa solo quando la risposta e' arrivata.
  const inviando = useRef(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.admin.codRemittances,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, rider_id, delivered_at, total_price, shipping_cost, rider_fee_cents, pickup_in_store, payment_method, delivery_status, cash_confirmed_at, rider:profiles!orders_rider_id_fkey(full_name)')
        .eq('payment_method', 'cod')
        .eq('delivery_status', 'DELIVERED')
        .eq('payout_status', 'AWAITING_REMITTANCE')
        .not('rider_id', 'is', null)
        .order('delivered_at', { ascending: false })
        .limit(TETTO_RIMESSE + 1);
      // Una lettura caduta non e' «nessuna rimessa»: l'errore deve arrivare alla pagina.
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const tagliato = rows.length > TETTO_RIMESSE;
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const o of rows.slice(0, TETTO_RIMESSE)) {
      if (!o.delivered_at || !o.rider_id) continue;
      // 22/8/2026 — era `toISOString()`, cioè il giorno di Greenwich, mentre
      // il fattorino quadra sul giorno di Piacenza. Nelle sere d'estate le
      // consegne dopo le 22 finivano in due giorni diversi, e l'ordine restava
      // appeso: il negozio non veniva pagato.
      const date = giornoLocale(new Date(o.delivered_at));
      const key = `${o.rider_id}|${date}`;
      const cents = contanteDaRimettereCents(o);
      const g = map.get(key) ?? {
        riderId: o.rider_id,
        riderName: o.rider?.full_name ?? o.rider_id.slice(0, 8),
        date,
        orders: 0,
        toRemitCents: 0,
        senzaIncasso: [],
      };
      g.orders += 1;
      g.toRemitCents += Math.max(0, cents);
      if (incassoDaDichiarare(o)) g.senzaIncasso.push(o);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows]);

  const confirm = useMutation({
    mutationFn: async ({ riderId, date, contatiCents, attesiCents, nota: notaInviata }: {
      riderId: string; date: string; contatiCents: number; attesiCents: number; nota?: string;
    }): Promise<{ rilasciati: number; saltati: number; registrata: boolean }> => {
      // Cookie-based (niente Bearer): l'RPC confirm_cod_remittance verifica
      // is_admin() leggendo l'auth.uid() dell'admin via getServerSupabase.
      const res = await fetch('/api/admin/cod-remittance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId, date, contatiCents, attesiCents, ...(notaInviata ? { nota: notaInviata } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'Errore conferma rimessa');
      return {
        rilasciati: (data.released as number) ?? 0,
        saltati: (data.saltatiSenzaIncasso as number) ?? 0,
        registrata: data.registrata !== false,
      };
    },
    onSuccess: ({ rilasciati, saltati, registrata }) => {
      setAperta(null); setContati(''); setNota('');
      qc.invalidateQueries({ queryKey: queryKeys.admin.codRemittances });
      if (registrata) toast.success(`Rimessa confermata · ${rilasciati} ordini rilasciati al payout`);
      else toast.warning('Nessuna nuova rimessa: questa giornata era già confermata, oppure i suoi ordini aspettano ancora l\'incasso.');
      // Gli ordini senza incasso registrato non si pagano al buio: si dicono.
      if (saltati > 0) {
        toast.warning(
          `${saltati} ordine/i consegnato/i senza incasso registrato: non sono stati rilasciati. Vanno chiesti al fattorino.`,
          { duration: 10_000 },
        );
      }
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
    onSettled: () => { inviando.current = false; },
  });

  // Con l'elenco tagliato il gruppo del giorno più vecchio letto può essere a metà, ma la
  // conferma rilascia TUTTI gli ordini di quel fattorino in quel giorno: lì non si conferma.
  const giornoAlConfine = tagliato && rows[TETTO_RIMESSE - 1]?.delivered_at
    ? giornoLocale(new Date(rows[TETTO_RIMESSE - 1].delivered_at)) : null;
  const totalToRemit = groups.reduce((s, g) => s + g.toRemitCents, 0);

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Finanza"
        title="Rimesse contanti COD"
        sub="Conferma i contanti ricevuti dai rider per sbloccare il pagamento ai venditori. L'importo da rimettere è il totale incassato meno il compenso di consegna del rider."
      />

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl skeleton" />)}</div>
      ) : isError ? (
        // Senza lettura non si dice «nessuna rimessa» ne' «totale 0,00 €»: sono soldi che nessuno ha contato.
        <ErrorState
          variant="compact"
          title="Non riesco a leggere le rimesse contanti"
          description="Non so quali contanti i rider devono ancora rimettere. Riprova prima di confermare qualunque rimessa."
          retry={() => void refetch()}
          supportHref={null}
        />
      ) : groups.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
          <CheckCircle2 size={40} strokeWidth={2} className="mx-auto text-olive-500 mb-2" aria-hidden />
          <p className="text-ink-600 font-medium">Nessuna rimessa COD in attesa</p>
        </div>
      ) : (
        <>
          {tagliato && (
            <div role="alert" className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-800">
              <strong>Elenco tagliato:</strong> ci sono più di {TETTO_RIMESSE} consegne in attesa di rimessa. Qui sotto
              vedi solo le {TETTO_RIMESSE} più recenti: il totale e i gruppi sono parziali, e le più vecchie mancano.
            </div>
          )}
          <div className="bg-cream-50 border border-cream-300 rounded-xl px-4 py-3 text-sm text-ink-700">
            In attesa: <strong>{groups.length}</strong> rider·giorno · totale da rimettere{' '}
            <strong>{tagliato ? 'almeno ' : ''}{formatPrice(totalToRemit / 100)}</strong>
          </div>
          <div className="space-y-3">
            {groups.map((g) => (
              <div
                key={`${g.riderId}|${g.date}`}
                className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm flex items-center justify-between gap-4 flex-wrap"
              >
                <div>
                  <p className="text-sm font-bold text-ink-900">{g.riderName}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {new Date(g.date).toLocaleDateString('it-IT')} · {g.orders} ordini COD
                  </p>
                  <p className="text-lg font-bold text-ink-900 mt-1">{formatPrice(g.toRemitCents / 100)}</p>
                </div>
                {g.date === giornoAlConfine || (giornoAlConfine !== null && g.date < giornoAlConfine) ? (
                  <p className="text-xs font-semibold text-secondary-700">Gruppo forse incompleto (elenco tagliato): non si conferma da qui.</p>
                ) : aperta !== `${g.riderId}|${g.date}` ? (
                  <Button
                    size="sm"
                    icon={Check}
                    onClick={() => { setAperta(`${g.riderId}|${g.date}`); setContati(''); setNota(''); }}
                  >
                    Conferma rimessa
                  </Button>
                ) : (() => {
                  const contatiCents = centesimiDa(contati);
                  const diverso = contatiCents !== null && contatiCents !== g.toRemitCents;
                  const pronto = contatiCents !== null && (!diverso || nota.trim().length > 0);
                  const idCampo = `contati-${g.riderId}-${g.date}`;
                  return (
                    <form
                      className="w-full border-t border-cream-200 pt-3 space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!pronto || contatiCents === null || inviando.current) return;
                        inviando.current = true;
                        confirm.mutate({
                          riderId: g.riderId, date: g.date, contatiCents, attesiCents: g.toRemitCents,
                          nota: diverso ? nota.trim() : undefined,
                        });
                      }}
                    >
                      <p className="text-sm text-ink-800">
                        Stai confermando che <strong>{g.riderName}</strong> ti ha consegnato i contanti di{' '}
                        <strong>{new Date(g.date).toLocaleDateString('it-IT')}</strong>: {g.orders} ordini, atteso{' '}
                        <strong>{formatPrice(g.toRemitCents / 100)}</strong>. Dopo la conferma i negozi vengono pagati.
                      </p>
                      <label htmlFor={idCampo} className="block text-xs font-semibold text-ink-700">Contanti contati (€)</label>
                      <input
                        id={idCampo}
                        inputMode="decimal"
                        className="w-40 rounded-lg border border-cream-300 px-3 py-2 text-sm"
                        value={contati}
                        onChange={(e) => setContati(e.target.value)}
                        placeholder={(g.toRemitCents / 100).toFixed(2).replace('.', ',')}
                      />
                      {diverso && (
                        <>
                          <p role="alert" className="text-xs font-semibold text-secondary-700">
                            Hai contato {formatPrice((contatiCents ?? 0) / 100)} invece di {formatPrice(g.toRemitCents / 100)}: scrivi cosa è successo.
                          </p>
                          <label htmlFor={`${idCampo}-nota`} className="block text-xs font-semibold text-ink-700">Nota (obbligatoria)</label>
                          <textarea
                            id={`${idCampo}-nota`}
                            className="w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
                            maxLength={500}
                            value={nota}
                            onChange={(e) => setNota(e.target.value)}
                          />
                        </>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" type="submit" icon={Check} disabled={!pronto} loading={confirm.isPending}>
                          Conferma i contanti ricevuti
                        </Button>
                        <Button size="sm" type="button" variant="ghost" onClick={() => setAperta(null)}>Annulla</Button>
                      </div>
                    </form>
                  );
                })()}
                {g.senzaIncasso.length > 0 && (
                  <div className="w-full border-t border-cream-200 pt-3">
                    <p className="text-xs text-ink-600">
                      <strong>{g.senzaIncasso.length}</strong> consegna/e senza incasso registrato: la rimessa le salta
                      e il negozio non viene pagato. Chiedi al fattorino quanto ha incassato e registralo qui.
                    </p>
                    <div className="mt-2 space-y-2">
                      {g.senzaIncasso.map((o) => (
                        <IncassoDichiarato
                          key={o.id}
                          ordine={o}
                          onRegistrato={() => qc.invalidateQueries({ queryKey: queryKeys.admin.codRemittances })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 15/10/2026 (R33) — REGISTRA L'INCASSO DICHIARATO DAL FATTORINO.
 *
 * Prima qui si leggeva solo «vanno chiesti al fattorino», senza un pulsante:
 * se il fattorino non rimediava, l'unica strada era il database a mano. Adesso
 * l'amministratore scrive quanto ha dichiarato e una nota su chi e quando; la
 * rotta lo registra come farebbe il fattorino e lascia traccia nel registro
 * delle azioni. Il pagamento al negozio parte poi con «Conferma rimessa».
 */
function IncassoDichiarato({ ordine, onRegistrato }: { ordine: Row; onRegistrato: () => void }) {
  const [importo, setImporto] = useState((contanteDaRimettereCents(ordine) / 100).toFixed(2));
  const [nota, setNota] = useState('');
  const registra = useMutation({
    mutationFn: async () => {
      const cents = Math.round(parseFloat(importo) * 100);
      if (Number.isNaN(cents) || cents < 0) throw new Error('Importo non valido');
      const res = await fetch('/api/admin/cod-incasso-dichiarato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ordine.id, cashCollectedCents: cents, nota }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'Registrazione non riuscita');
    },
    onSuccess: () => {
      toast.success('Incasso registrato. Ora conferma la rimessa per pagare il negozio.');
      onRegistrato();
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-cream-50 p-2.5">
      <span className="font-mono text-[11px] text-ink-500">#{ordine.id.slice(0, 8)}</span>
      <label className="text-xs text-ink-700">
        Contanti (€)
        <input
          type="number"
          step="0.01"
          value={importo}
          onChange={(e) => setImporto(e.target.value)}
          className="ml-1 w-24 rounded border border-cream-300 px-2 py-1 font-mono"
        />
      </label>
      <label className="min-w-[200px] flex-1 text-xs text-ink-700">
        Chi li ha dichiarati, e quando
        <input
          type="text"
          value={nota}
          maxLength={300}
          onChange={(e) => setNota(e.target.value)}
          className="mt-0.5 block w-full rounded border border-cream-300 px-2 py-1"
        />
      </label>
      <Button size="sm" loading={registra.isPending} disabled={nota.trim().length < 5} onClick={() => registra.mutate()}>
        Registra incasso
      </Button>
    </div>
  );
}
