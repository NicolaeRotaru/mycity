'use client';

import { useEffect, useRef, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ClipboardList } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Textarea } from '@/components/ui/Field';
import { useTranslations } from 'next-intl';
import { conNegozioDellOrdine } from '@/lib/queries/negozio-dell-ordine';

const REASONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'not_received',      label: 'Non l\'ho ricevuto',          hint: 'L\'ordine risulta consegnato ma non l\'hai ricevuto.' },
  { value: 'damaged',           label: 'Arrivato danneggiato',         hint: 'Il prodotto è arrivato rotto o non utilizzabile.' },
  { value: 'wrong_item',        label: 'Prodotto sbagliato',           hint: 'Hai ricevuto qualcosa di diverso da quanto ordinato.' },
  { value: 'not_as_described',  label: 'Diverso dalla descrizione',    hint: 'Qualità, colore o caratteristiche differenti.' },
  { value: 'seller_unreachable',label: 'Venditore non risponde',       hint: 'Hai provato a contattarlo ma non risponde.' },
  { value: 'other',             label: 'Altro motivo',                 hint: 'Descrivi nei dettagli qui sotto.' },
];

/**
 * R01-003 — LA BOZZA DEL RECLAMO, SE LA SESSIONE SCADE MENTRE LO SCRIVI.
 *
 * Con la sessione scaduta il server risponde 401: prima usciva solo un avviso che spariva, senza
 * modo di rientrare, e chi andava all'accesso tornava a un modulo vuoto. Adesso la pagina dice di
 * rientrare (il link torna qui) e tiene motivo e testo in questa scheda del browser
 * (sessionStorage), una bozza per ordine. Al ritorno la bozza torna nel modulo e si cancella
 * subito: da lì in poi il testo vero è quello del modulo, e una bozza vecchia non torna più.
 * La bozza riprende il testo solo per chi l'ha scritto.
 * I controlli restano tutti nel server (/api/disputes).
 *
 * R01-002 — La bozza nata dal 401 porta il segno `perIlRientro`: all'uscita non chiesta (la
 * sessione scaduta) il fornitore delle domande (components/providers/QueryProvider.tsx) la lascia
 * per il rientro, mentre all'uscita voluta e all'ingresso di un altro account la toglie.
 */
type BozzaReclamo = { utente: string; reason: string; description: string; perIlRientro?: boolean };
const chiaveBozza = (orderId: string) => `mycity:bozza-reclamo:${orderId}`;

/** Legge la bozza di questo ordine e la toglie dalla scheda: quello che serve passa nel modulo. */
function prendiBozza(orderId: string): BozzaReclamo | null {
  try {
    const grezza = window.sessionStorage.getItem(chiaveBozza(orderId));
    if (grezza === null) return null;
    window.sessionStorage.removeItem(chiaveBozza(orderId));
    const b = JSON.parse(grezza) as Partial<BozzaReclamo>;
    if (typeof b.utente !== 'string' || !b.utente) return null;
    const reason = REASONS.some((r) => r.value === b.reason) ? String(b.reason) : '';
    const description = typeof b.description === 'string' ? b.description.slice(0, 2000) : '';
    return reason || description ? { utente: b.utente, reason, description } : null;
  } catch {
    return null;
  }
}

/**
 * R01-varie — Le uscite volute contate da components/providers/QueryProvider.tsx (stessa chiave su
 * `globalThis`). Se il numero cambia mentre il modulo aspetta la risposta, la bozza non si riscrive.
 */
const USCITE_VOLUTE = Symbol.for('mycity.uscite-volute');
function usciteVolute(): number {
  const n = (globalThis as unknown as Record<PropertyKey, unknown>)[USCITE_VOLUTE];
  return typeof n === 'number' ? n : 0;
}

function scriviBozza(orderId: string, bozza: BozzaReclamo | null) {
  try {
    if (bozza) window.sessionStorage.setItem(chiaveBozza(orderId), JSON.stringify(bozza));
    else window.sessionStorage.removeItem(chiaveBozza(orderId));
  } catch {
    // Memoria della scheda chiusa (navigazione privata, blocchi): il testo resta nel modulo aperto.
  }
}

export default function OpenDisputePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const tStates = useTranslations('states');
  const tForms = useTranslations('forms');
  const [order, setOrder] = useState<{ id: string; total_price: number; delivery_status: string; seller_id: string; created_at: string; seller?: { store_name?: string | null } | null } | null>(null);
  const [reason, setReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 5/11/2026 — Una lettura caduta non è «ordine non trovato»: si resta qui con «Riprova».
  const [letturaFallita, setLetturaFallita] = useState(false);
  const [tentativo, setTentativo] = useState(0);
  // 5/11/2026 — Il database tiene un solo reclamo aperto per ordine: se c'è già, lo si dice.
  const [reclamoAperto, setReclamoAperto] = useState<{ created_at: string; status: string } | null>(null);
  // R01-003 — Il server ha risposto «non sei più dentro»: si dice di rientrare, e la bozza è salva.
  const [sessioneScaduta, setSessioneScaduta] = useState(false);
  // R01-003 — Chi ha aperto il modulo: la bozza porta il suo id.
  const utenteDelModulo = useRef<string | null>(null);
  // R01-003 — La bozza nata da un 401 segue il modulo finché il reclamo non parte, anche se un nuovo
  // invio cade (rete, errore del server): se no restava nella scheda il testo di prima.
  const bozzaInCorso = useRef(false);
  // R01-varie — Le uscite volute contate all'ultimo invio, e se al 401 la bozza è stata tenuta.
  const usciteAllInvio = useRef(0);
  const [bozzaTenuta, setBozzaTenuta] = useState(false);
  // Chi ha la sessione adesso, anche se cambia da un'altra scheda (null: nessuno o non si sa).
  const chiHaLaSessione = useRef<string | null>(null);
  useEffect(() => {
    if (typeof supabase.auth?.onAuthStateChange !== 'function') return;
    const { data } = supabase.auth.onAuthStateChange((_evento, sessione) => {
      chiHaLaSessione.current = sessione?.user?.id ?? null;
    });
    return () => data?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      setLetturaFallita(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/orders/${params.id}/dispute`);
        return;
      }
      utenteDelModulo.current = user.id;
      // R01-003 — Di ritorno dall'accesso: la bozza torna nel modulo e lascia la scheda (si toglie
      // anche se poi c'è già un reclamo aperto). La bozza riprende il testo solo per chi l'ha scritto.
      const bozza = prendiBozza(params.id);
      if (bozza && bozza.utente === user.id) {
        setReason(bozza.reason);
        setDescription(bozza.description);
      }
      const { data, error } = await supabase
        .from('orders')
        .select('id, total_price, delivery_status, seller_id, created_at')
        .eq('id', params.id)
        .maybeSingle();
      if (error) {
        setLetturaFallita(true);
        return;
      }
      if (!data) {
        toast.error('Ordine non trovato');
        router.push('/orders');
        return;
      }
      // 18/10/2026 — Il nome del negozio contro cui si reclama viene dalla vetrina
      // pubblica, non da `profiles` (lib/queries/negozio-dell-ordine.ts). Qui e'
      // solo un'etichetta: se quella lettura cade resta «Negozio», e il reclamo si
      // apre lo stesso.
      const riga = data as { seller_id: string };
      const [conNegozio] = await conNegozioDellOrdine(supabase, [riga], 'id, store_name')
        .catch(() => [{ ...riga, seller: null }]);
      // Se questa lettura cade si mostra il modulo: il database rifiuta comunque il doppione,
      // e il messaggio qui sotto (submit) lo dice con parole vere.
      const { data: aperti } = await supabase
        .from('disputes')
        .select('created_at, status')
        .eq('order_id', params.id)
        .in('status', ['open', 'under_review'])
        .limit(1);
      setReclamoAperto(((aperti as Array<{ created_at: string; status: string }> | null) ?? [])[0] ?? null);
      setOrder(conNegozio as unknown as typeof order);
    })();
  }, [params.id, router, tentativo]);

  // R01-003 — Dal 401 all'invio riuscito la bozza segue il modulo: si ritrova l'ultimo testo,
  // e un modulo svuotato non lascia una bozza vecchia.
  // R01-002 — Si riscrive anche quando arriva il 401 (`sessioneScaduta`): il testo cambiato fra il
  // clic e la risposta del server è quello che si ritrova, non quello del momento del clic.
  useEffect(() => {
    if (!bozzaInCorso.current || !utenteDelModulo.current) return;
    // R01-varie — Dopo un'uscita voluta il modulo non tiene più la bozza.
    if (usciteVolute() !== usciteAllInvio.current) {
      bozzaInCorso.current = false;
      return;
    }
    // È entrato un altro account: la bozza non è più di chi scrive qui.
    if (chiHaLaSessione.current !== null && chiHaLaSessione.current !== utenteDelModulo.current) {
      bozzaInCorso.current = false;
      return;
    }
    scriviBozza(params.id, description.trim() ? { utente: utenteDelModulo.current, reason, description, perIlRientro: true } : null);
  }, [sessioneScaduta, reason, description, params.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { toast.error('Seleziona un motivo'); return; }
    if (description.trim().length < 20) { toast.error('Descrivi meglio (min 20 caratteri)'); return; }

    setSubmitting(true);
    setSessioneScaduta(false);
    usciteAllInvio.current = usciteVolute();
    try {
      // 12/11/2026 (R03-013) — Il reclamo lo apre il server (/api/disputes): controlla che
      // l'ordine sia tuo, avvisa gli amministratori e il negozio, e ti manda la ricevuta. Prima la
      // riga si scriveva da qui e nessuno ne sapeva niente, mentre il bonifico del negozio si fermava.
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: params.id, reason, description: description.trim() }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          // R01-varie — La bozza si tiene solo se nel frattempo non c'è stata un'uscita voluta e la
          // sessione del browser, se c'è, è ancora di chi ha scritto il modulo.
          const { data: sessioneOra } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          const chiOra = sessioneOra?.session?.user?.id ?? null;
          const autore = utenteDelModulo.current;
          const tieni = !!autore && usciteVolute() === usciteAllInvio.current && (chiOra === null || chiOra === autore);
          if (tieni) scriviBozza(params.id, { utente: autore, reason, description, perIlRientro: true });
          else scriviBozza(params.id, null);
          bozzaInCorso.current = tieni;
          setBozzaTenuta(tieni);
          setSessioneScaduta(true);
          return;
        }
        const corpo = await res.json().catch(() => ({}));
        toast.error(apiErrorMessage(corpo, 'Non sono riuscito ad aprire il reclamo: riprova fra poco.'));
        return;
      }
      bozzaInCorso.current = false;
      scriviBozza(params.id, null);
      toast.success('Reclamo aperto: ti abbiamo mandato una ricevuta per email e ti scriviamo noi con la decisione.');
      router.push('/orders');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (letturaFallita) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-12 max-w-2xl">
        <ErrorState
          title="Non riesco a caricare l'ordine"
          description="Sembra un problema di collegamento. L'ordine c'è: riprova."
          retry={() => setTentativo((t) => t + 1)}
        />
      </div>
    );
  }
  if (!order) return <LoadingState />;
  if (reclamoAperto) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
        <Link href={`/orders/${params.id}`} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 mb-2">
          <ArrowLeft size={14} /> Torna all'ordine
        </Link>
        <div className="bg-accent-50 border border-accent-200 rounded-2xl p-5 mt-5 text-sm text-ink-700">
          <p className="font-semibold mb-1">Hai già un reclamo aperto su questo ordine</p>
          <p>
            L&apos;hai aperto il {new Date(reclamoAperto.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} ·
            stato: {reclamoAperto.status === 'under_review' ? 'in esame' : 'aperto'}. Ti scriviamo noi appena c&apos;è una decisione.
          </p>
        </div>
      </div>
    );
  }

  const selectedReason = REASONS.find((r) => r.value === reason);
  // R01-002 — Il bottone spento adesso dice cosa manca, a chi guarda e a chi ascolta: prima
  // restava grigio senza un perché, e i messaggi di `submit` non scattavano mai (il bottone
  // spento non manda il modulo). Le condizioni sono le stesse che lo spengono.
  const caratteriScritti = description.trim().length;
  const cosaManca: string[] = [];
  if (!reason) cosaManca.push('scegli un motivo');
  if (caratteriScritti < 20) {
    const mancano = 20 - caratteriScritti;
    cosaManca.push(`scrivi almeno 20 caratteri in «Cosa è successo?» (${mancano === 1 ? 'ne manca 1' : `ne mancano ${mancano}`})`);
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
      <Link href={`/orders/${params.id}`} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 mb-2">
        <ArrowLeft size={14} /> Torna all'ordine
      </Link>

      <h1 className="text-3xl font-serif font-bold text-ink-900 flex items-center gap-2 mt-3">
        <AlertCircle size={26} className="text-secondary-600" />
        Apri un reclamo
      </h1>
      <p className="text-sm text-ink-500 mt-1">
        Ordine #{params.id.slice(0, 8)} · {order.seller?.store_name ?? 'Negozio'}
      </p>

      <div className="bg-accent-50 border border-accent-200 rounded-2xl p-4 mt-5 text-sm text-ink-700">
        <p className="font-semibold mb-1">Prima di aprire un reclamo</p>
        <p>Hai già provato a <Link href="/messages" className="text-primary-700 hover:underline font-semibold">scrivere al venditore</Link>? Spesso il problema si risolve in pochi messaggi. Apri un reclamo solo se non hai ricevuto risposta entro 48h o se la situazione è grave.</p>
      </div>

      <form onSubmit={submit} className="bg-white border border-cream-300 rounded-2xl p-6 mt-5 space-y-5 shadow-warm">
        <fieldset>
          <legend className="block text-sm font-semibold text-ink-900 mb-2">Motivo del reclamo *</legend>
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label key={r.value} className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                reason === r.value ? 'border-primary-400 bg-primary-50' : 'border-cream-200 hover:border-cream-300'
              }`}>
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-semibold text-ink-900">{r.label}</p>
                  <p className="text-xs text-ink-500">{r.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <Textarea
            label="Cosa è successo?"
            hint="(min 20 caratteri)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder={selectedReason?.hint ?? 'Spiega in dettaglio cosa non ha funzionato, quando, e cosa ti aspetteresti per risolvere.'}
            className="bg-cream-50 resize-y"
          />
          <p className="text-xs text-ink-400 mt-1 text-right">{description.length}/2000</p>
        </div>

        <div className="bg-cream-100 rounded-lg p-3 text-xs text-ink-600">
          <p className="flex items-center gap-1.5"><ClipboardList size={14} strokeWidth={2.2} aria-hidden /> <strong>Cosa succede dopo:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Il team riceve subito un avviso col tuo reclamo, e tu una ricevuta per email</li>
            <li>Contattiamo il venditore per la sua versione</li>
            <li>Ti scriviamo con la decisione</li>
            <li>Se ti diamo ragione → rimborso completo o parziale</li>
          </ul>
        </div>

        {sessioneScaduta && (
          <div role="alert" className="rounded-lg border border-secondary-200 bg-secondary-50 p-3 text-sm text-secondary-800">
            <p className="font-semibold">La sessione è scaduta: rientra per aprire il reclamo.</p>
            {bozzaTenuta && (
              <p className="mt-1">Quello che hai scritto resta salvato in questa scheda e lo ritrovi qui al ritorno.</p>
            )}
            <Link
              href={`/sign-in?returnTo=${encodeURIComponent(`/orders/${params.id}/dispute`)}`}
              className="inline-block mt-2 font-semibold text-primary-700 hover:underline"
            >
              Rientra
            </Link>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !reason || description.trim().length < 20}
          aria-describedby={cosaManca.length > 0 ? 'reclamo-cosa-manca' : undefined}
          className="w-full bg-secondary-600 hover:bg-secondary-700 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-bold transition-colors"
        >
          {submitting ? tStates('sending') : tForms('openDispute')}
        </button>
        {cosaManca.length > 0 && (
          <p id="reclamo-cosa-manca" className="text-sm text-ink-600">
            Per aprire il reclamo: {cosaManca.join(' e ')}.
          </p>
        )}
      </form>
    </div>
  );
}
