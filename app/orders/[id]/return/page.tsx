'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import EmptyState from '@/components/EmptyState';
import { Input, Textarea } from '@/components/ui/Field';
import { serveLaSceltaDelRimborso } from '@/lib/rimborsi/regole-del-rimborso';
import { leggiSceltaDelRimborso } from '@/lib/rimborsi/scelta-del-cliente';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { attributoAccept } from '@/lib/storage/regole-secchi';
import { useTranslations } from 'next-intl';
import { Package, RefreshCw, AlertTriangle, MessageSquare, Clock, Pencil, type LucideIcon } from 'lucide-react';

const REASONS: Array<{ value: string; label: string; icon: LucideIcon }> = [
  { value: 'DAMAGED',           label: 'Prodotto danneggiato',          icon: Package },
  { value: 'WRONG_ITEM',        label: 'Prodotto sbagliato',            icon: RefreshCw },
  { value: 'NOT_AS_DESCRIBED',  label: 'Non come descritto',            icon: AlertTriangle },
  { value: 'CHANGED_MIND',      label: 'Ho cambiato idea',              icon: MessageSquare },
  { value: 'LATE',              label: 'Consegna troppo in ritardo',    icon: Clock },
  { value: 'OTHER',             label: 'Altro',                         icon: Pencil },
];

export default function NewReturnPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tStates = useTranslations('states');
  const [reason, setReason] = useState<string>('DAMAGED');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  // R71 — «Come vuoi il rimborso?»: il bonifico e' la prima scelta, il credito
  // MyCity un'opzione che il cliente prende lui.
  const [modoRimborso, setModoRimborso] = useState<'BONIFICO' | 'CREDITO'>('BONIFICO');
  const [iban, setIban] = useState('');
  const [erroreIban, setErroreIban] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, total_price, delivered_at, delivery_status, payment_method, stripe_payment_intent')
        .eq('id', params.id)
        .single();
      setOrder(data);
      setLoaded(true);
    })();
  }, [params.id]);

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      // Il percorso lo costruisce la porta unica: la regola del secchio pubblico pretende che il
      // primo livello sia l'identita' di chi carica, e da qui quel livello non si vede piu'.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessione scaduta');
      const { publicUrl } = await caricaImmagine(supabase, {
        file,
        userId: user.id,
        cartella: `returns/${params.id}`,
        etichetta: file.name,
      });
      setPhotos((p) => [...p, publicUrl]);
    } catch (e) {
      // Qui il messaggio grezzo del deposito arrivava al cliente senza passare da
      // nessuna traduzione: «The object exceeded the maximum allowed size», in
      // inglese, mentre sta allegando la foto del prodotto arrivato rotto. Gli
      // altri tre punti che caricano passano tutti da friendlyError: questo no.
      toast.error(friendlyError(e));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    // R71 — La scelta si controlla con la stessa regola del server
    // (lib/rimborsi/scelta-del-cliente.ts): un IBAN sbagliato si corregge qui.
    const esitoScelta = leggiSceltaDelRimborso(
      { modo: modoRimborso, iban },
      { pagatoInContanti: !!order && serveLaSceltaDelRimborso(order) },
    );
    if (!esitoScelta.ok) {
      setErroreIban(esitoScelta.errore);
      return;
    }
    setErroreIban(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/returns/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: params.id,
          reason,
          notes: notes || undefined,
          photoUrls: photos,
          ...(esitoScelta.scelta ? { rimborso: esitoScelta.scelta } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorMessage(data));
      if (data?.sceltaDelRimborso === 'non_salvata') {
        toast.warning(
          "Richiesta di reso inviata. La tua scelta sul rimborso non si è potuta salvare: il rimborso arriverà con un bonifico e ti chiederemo l'IBAN.",
        );
      } else {
        toast.success('Richiesta di reso inviata');
      }
      router.push(`/orders/${params.id}`);
    } catch (e) {
      // 6/9/2026 — L'AVVISO DICEVA SOLTANTO «ERRORE».
      // Quando quello che viene lanciato non e' un Error — capita con un
      // reject nudo o con una stringa — restava la parola secca «Errore»: non
      // dice cosa e' successo ne' cosa fare, e chi la legge puo' solo
      // riprovare a caso. `friendlyError` tiene il messaggio del server
      // quando c'e' ed e' leggibile, e altrimenti mette la frase che il sito
      // usa gia' dappertutto: «Qualcosa non ha funzionato. Riprova fra un
      // momento.»
      toast.error(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  // audit 🟠-20: distinguere "in caricamento" da "non trovato" (prima: spinner
  // infinito su id inesistente o ordine altrui bloccato da RLS).
  if (!loaded) return <LoadingState />;
  if (!order)
    return (
      <div className="container mx-auto max-w-xl px-4 py-12">
        <EmptyState
          icon={Package}
          title="Ordine non trovato"
          description="L'ordine non esiste o non hai i permessi per vederlo."
          ctaLabel="Tutti gli ordini"
          ctaHref="/orders"
        />
      </div>
    );

  /**
   * 22/8/2026 — LA PAGINA LEGGEVA STATO E DATA DI CONSEGNA E NON LI USAVA MAI.
   *
   * Chiunque poteva aprire il modulo di reso su un ordine non ancora
   * consegnato, o consegnato quattro mesi fa: compilava tutto, caricava le
   * foto, premeva invia, e il rifiuto arrivava dal server. Trenta secondi di
   * lavoro buttati e nessuna spiegazione di cosa c'entra la data.
   *
   * I due campi erano già letti, riga 40. Bastava guardarli.
   */
  const consegnato = order.delivery_status === 'DELIVERED';
  const giorniDallaConsegna = order.delivered_at
    ? Math.floor((Date.now() - new Date(order.delivered_at).getTime()) / 86_400_000)
    : null;
  const fuoriTempo = giorniDallaConsegna !== null && giorniDallaConsegna > 14;

  if (!consegnato || fuoriTempo) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-8">
        <Link href={`/orders/${params.id}`} className="text-sm text-primary-700 hover:underline">
          ← Torna all&apos;ordine
        </Link>
        <div className="mt-4 rounded-2xl bg-white p-6 shadow ring-1 ring-cream-300">
          <h1 className="text-2xl font-bold text-ink-900">Qui il reso non si può chiedere</h1>
          {!consegnato ? (
            <>
              <p className="mt-3 text-ink-700">
                Questo ordine non risulta ancora consegnato. Il diritto di reso
                parte dal giorno in cui ricevi la merce: fino ad allora non c&apos;è
                niente da restituire.
              </p>
              <p className="mt-2 text-ink-700">
                Se l&apos;ordine è arrivato ma qui non risulta, oppure se vuoi
                annullarlo prima che parta, scrivici: lo sistemiamo a mano.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-ink-700">
                Sono passati <strong>{giorniDallaConsegna} giorni</strong> dalla
                consegna, e i giorni per il recesso sono quattordici.
              </p>
              <p className="mt-2 text-ink-700">
                Questo non chiude tutte le strade: se il prodotto è difettoso o
                non è come descritto, la garanzia legale vale due anni ed è una
                cosa diversa dal recesso. Scrivici e ne parliamo.
              </p>
            </>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
            >
              Scrivici
            </Link>
            <Link
              href={`/orders/${params.id}`}
              className="rounded-lg border border-cream-300 px-4 py-2 text-sm font-semibold text-ink-800 hover:border-primary-300"
            >
              Torna all&apos;ordine
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-xl px-4 py-8">
      <Link href={`/orders/${params.id}`} className="text-sm text-primary-700 hover:underline">
        ← Torna all&apos;ordine
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-ink-900">Richiedi un reso</h1>
      <p className="mt-1 text-sm text-ink-600">
        Hai 14 giorni dalla consegna per richiedere il reso (recesso legale).
      </p>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow ring-1 ring-cream-300">
        <label className="block text-sm font-medium text-ink-700">Motivo del reso</label>
        <div className="mt-2 space-y-2">
          {REASONS.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-cream-300 p-3 hover:bg-cream-50">
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={(e) => setReason(e.target.value)}
                className="h-4 w-4 text-primary-700"
              />
              <span className="text-sm inline-flex items-center gap-2"><r.icon size={15} strokeWidth={2.2} className="text-ink-500" aria-hidden /> {r.label}</span>
            </label>
          ))}
        </div>

        <Textarea
          label="Dettagli aggiuntivi (opzionale)"
          containerClassName="mt-6"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Descrivi il problema in dettaglio…"
        />

        <label className="mt-6 block text-sm font-medium text-ink-700">
          Foto (max 8)
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* 27/8/2026 (R117) — ogni foto allegata al reso si chiamava «prova»:
              otto foto, otto volte la stessa parola. Almeno si numerano. */}
          {photos.map((p, i) => (
            <img
              key={p}
              src={p}
              alt={`Foto ${i + 1} allegata alla richiesta di reso`}
              loading="lazy"
              className="h-20 w-20 rounded-lg object-cover ring-1 ring-cream-300"
            />
          ))}
          {photos.length < 8 && (
            <label className="inline-flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-cream-300 text-2xl text-ink-400 hover:bg-cream-50">
              {uploading ? '…' : '+'}
              <input
                type="file"
                /* 8/9/2026 — erano tre tipi scritti a mano qui accanto, mentre la porta e il
                   deposito ne accettano sette (070). Il cliente che allega la foto del prodotto
                   rotto scattata con l'iPhone non la vedeva nemmeno comparire nella finestra di
                   scelta: il file c'era, il campo lo nascondeva. La lista arriva dalla stessa
                   regola che poi rifiuta il file. */
                accept={attributoAccept()}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                }}
              />
            </label>
          )}
        </div>

        {serveLaSceltaDelRimborso(order) && (
          <fieldset className="mt-6">
            <legend className="block text-sm font-medium text-ink-700">Come vuoi il rimborso?</legend>
            <p className="mt-1 text-xs text-ink-500">
              Hai pagato in contanti alla consegna: scegli tu come riavere i soldi.
            </p>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cream-300 p-3 hover:bg-cream-50">
                <input
                  type="radio"
                  name="modo-rimborso"
                  value="BONIFICO"
                  checked={modoRimborso === 'BONIFICO'}
                  onChange={() => setModoRimborso('BONIFICO')}
                  className="mt-0.5 h-4 w-4 text-primary-700"
                />
                <span className="text-sm font-medium text-ink-900">
                  Con un bonifico sul mio conto
                  <span className="block font-normal text-ink-600">Ti mandiamo i soldi sul conto che indichi qui sotto.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cream-300 p-3 hover:bg-cream-50">
                <input
                  type="radio"
                  name="modo-rimborso"
                  value="CREDITO"
                  checked={modoRimborso === 'CREDITO'}
                  onChange={() => setModoRimborso('CREDITO')}
                  className="mt-0.5 h-4 w-4 text-primary-700"
                />
                <span className="text-sm font-medium text-ink-900">
                  Come credito MyCity
                  <span className="block font-normal text-ink-600">
                    Arriva appena il negozio approva il rimborso e si usa sui prossimi ordini pagati alla consegna.
                  </span>
                </span>
              </label>
            </div>
            {modoRimborso === 'BONIFICO' && (
              <Input
                label="IBAN del tuo conto"
                containerClassName="mt-3"
                value={iban}
                onChange={(e) => {
                  setIban(e.target.value);
                  if (erroreIban) setErroreIban(null);
                }}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                placeholder="IT60 X054 2811 1010 0000 0123 456"
                required
                error={erroreIban ?? undefined}
                hint="Lo usiamo solo per questo rimborso. Lo vede MyCity, che fa il bonifico: il negozio no."
              />
            )}
          </fieldset>
        )}

        <button
          onClick={submit}
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-primary-700 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
        >
          {submitting ? tStates('sending') : 'Invia richiesta di reso'}
        </button>
      </div>
    </div>
  );
}
