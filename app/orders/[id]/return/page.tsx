'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import EmptyState from '@/components/EmptyState';
import { Textarea } from '@/components/ui/Field';
import { haUnaParteInContanti } from '@/lib/rimborsi/regole-del-rimborso';
import { confirmDialog } from '@/components/ConfirmDialog';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { attributoAccept } from '@/lib/storage/regole-secchi';
import { acceptSenzaHeic, avvisoFotoHeic, senzaHeic } from '@/lib/immagini/heic-in-jpeg';
import { recessoAperto, ultimoGiornoDelRecesso } from '@/lib/ordini/termine-del-recesso';
import { MOTIVO_RIPENSAMENTO } from '@/lib/ordini/recesso';
import { nomeDellaRigaOrdine, type RigaOrdine } from '@/lib/ordini/riga-ordine';
import { formatPrice } from '@/lib/format';
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

/**
 * 31/10/2026 — IL CLIENTE PUO' RITIRARE LA SUA RICHIESTA, E QUI TROVA IL PULSANTE.
 *
 * La scheda del negozio diceva «se il cliente ci ha ripensato, puo' ritirare lui la
 * richiesta», e la rotta `avanza` lo permette (CANCELED, solo a chi ha fatto l'ordine,
 * finche' la merce non e' partita). Ma nessuna pagina del cliente la chiamava: il
 * recesso lasciato cadere restava aperto e il bonifico al negozio fermo 14 giorni.
 * Gli stati sono gli stessi della rotta (`PARTENZE_DEL_RITIRO`) e della creazione.
 */
const STATI_APERTI = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'];
const STATI_RITIRABILI = ['REQUESTED', 'APPROVED'];

/**
 * 26/11/2026 — IL CLIENTE DICE QUALE ARTICOLO RENDE.
 * La rotta e il database sapevano gia' tenere il reso di un solo articolo
 * (`order_item_id`), ma il modulo non lo faceva scegliere: ogni reso valeva per
 * tutto l'ordine, e al negozio arrivava il totale da rimborsare per un vasetto
 * rotto. Con piu' di un articolo si sceglie, senza scelta gia' fatta, come il
 * motivo. «Tutto l'ordine» resta una scelta. Una riga si rende intera: la
 * quantita' parziale di una riga il database non la sa ancora tenere.
 */
const TUTTO_L_ORDINE = 'tutto';
type RigaDaRendere = RigaOrdine & { id: string; quantity?: number | null; unit_price?: number | string | null; variant_label?: string | null };

export default function NewReturnPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tStates = useTranslations('states');
  // 5/11/2026 — Nessun motivo già scelto: «Prodotto danneggiato» è un'accusa al negozio, e col
  // motivo preselezionato il controllo dei freschi (solo su «Ho cambiato idea») non scattava.
  const [reason, setReason] = useState<string>('');
  const [cosaRendo, setCosaRendo] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [resoAperto, setResoAperto] = useState<{ id: string; status: string } | null>(null);
  const [ritiroInCorso, setRitiroInCorso] = useState(false);
  // 5/11/2026 — Una lettura caduta non è «ordine non trovato»: si offre «Riprova».
  const [letturaFallita, setLetturaFallita] = useState(false);
  const [tentativo, setTentativo] = useState(0);

  useEffect(() => {
    (async () => {
      setLetturaFallita(false);
      const [{ data, error }, { data: aperti }] = await Promise.all([
        supabase
          .from('orders')
          .select('id, total_price, delivered_at, created_at, delivery_status, payment_method, stripe_payment_intent, wallet_applied_cents, order_items ( id, quantity, unit_price, product_name, variant_label, products ( name ) )')
          .eq('id', params.id)
          .single(),
        supabase.from('returns').select('id, status').eq('order_id', params.id).in('status', STATI_APERTI).limit(1),
      ]);
      // PGRST116 = nessuna riga (id inesistente o ordine non tuo): quello sì è «non trovato».
      if (error && (error as { code?: string }).code !== 'PGRST116') {
        setLetturaFallita(true);
        setLoaded(true);
        return;
      }
      setOrder(data);
      setResoAperto((aperti as Array<{ id: string; status: string }> | null)?.[0] ?? null);
      setLoaded(true);
    })();
  }, [params.id, tentativo]);

  const righe: RigaDaRendere[] = Array.isArray(order?.order_items) ? (order.order_items as RigaDaRendere[]) : [];
  const serveSceltaArticolo = righe.length > 1;
  const articoloMancante = serveSceltaArticolo && !cosaRendo;
  const articoloScelto = serveSceltaArticolo && cosaRendo && cosaRendo !== TUTTO_L_ORDINE ? cosaRendo : undefined;

  // 12/11/2026 (R07-002) — «Ho cambiato idea» non vale quando tutti i prodotti
  // dell'ordine sono esclusi dal recesso (pane, freschi, su ordinazione). Il server
  // lo rifiutava già: la pagina lo accettava, e il cliente lo scopriva solo dopo aver
  // compilato tutto. Appena il cliente sceglie quel motivo, la pagina chiede l'esito
  // al server, che legge i prodotti col servizio: il client del cliente non vede i
  // prodotti tolti dalla vetrina dopo l'ordine (il pane segnato esaurito la sera) e li
  // avrebbe contati come recedibili. Se c'è un rifiuto la scelta si toglie, si spegne
  // e la pagina dice perché. Se la domanda cade, la pagina non decide al buio: lascia
  // la scelta e il server risponde all'invio.
  // 27/11/2026 — La domanda va a /api/returns/create (GET), la stessa funzione che
  // decide l'invio: /api/returns/ripensamento guardava solo la spunta del negozio, e su
  // un pane del Panificio non spuntato la pagina offriva il motivo che l'invio
  // rifiutava. E si chiede per la riga scelta: nell'ordine misto il pane da solo è
  // escluso, il miele no. Cambiando riga si chiede di nuovo.
  // 28/11/2026 (R04-001, onda 2) — Un esito per riga, non uno solo. Con un esito solo, due
  // risposte fuori ordine si sovrascrivevano: miele → «Ho cambiato idea» → pane, e se la risposta
  // del miele arrivava dopo quella del pane il rifiuto del pane spariva, il motivo si riaccendeva
  // e non si richiedeva più. Ogni risposta ora scrive solo la sua chiave.
  const chiaveRipensamento = order?.id ? `${order.id}|${articoloScelto ?? ''}` : null;
  const [esitiRipensamento, setEsitiRipensamento] = useState<Record<string, string | null>>({});
  const [ripensamentoChiestoPer, setRipensamentoChiestoPer] = useState<string | null>(null);
  const rifiutoRipensamento = chiaveRipensamento ? (esitiRipensamento[chiaveRipensamento] ?? null) : null;
  useEffect(() => {
    if (!chiaveRipensamento || reason !== MOTIVO_RIPENSAMENTO || ripensamentoChiestoPer === chiaveRipensamento) return;
    if (chiaveRipensamento in esitiRipensamento) return;
    setRipensamentoChiestoPer(chiaveRipensamento);
    const chiave = chiaveRipensamento;
    const domanda = new URLSearchParams({ orderId: String(order.id) });
    if (articoloScelto) domanda.set('orderItemId', articoloScelto);
    (async () => {
      try {
        const r = await fetch(`/api/returns/create?${domanda.toString()}`);
        if (!r.ok) return;
        const json = (await r.json()) as { rifiuto?: string | null };
        const rifiuto = typeof json.rifiuto === 'string' ? json.rifiuto : null;
        setEsitiRipensamento((prima) => ({ ...prima, [chiave]: rifiuto }));
      } catch {
        /* domanda non riuscita: decide il server all'invio */
      }
    })();
  }, [chiaveRipensamento, order?.id, articoloScelto, reason, ripensamentoChiestoPer, esitiRipensamento]);
  useEffect(() => {
    if (rifiutoRipensamento && reason === MOTIVO_RIPENSAMENTO) setReason('');
  }, [rifiutoRipensamento, reason]);

  async function ritira() {
    if (!resoAperto) return;
    const ok = await confirmDialog({
      title: 'Ritirare la richiesta di reso?',
      message: 'Il reso si chiude e il prodotto resta a te: non devi rispedire niente e non ricevi un rimborso.',
      confirmLabel: 'Sì, ritira',
      cancelLabel: 'No, tienila',
      danger: true,
    });
    if (!ok) return;
    setRitiroInCorso(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/returns/${resoAperto.id}/avanza`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ stato: 'CANCELED' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(apiErrorMessage(data, 'La richiesta non si è ritirata.'));
      toast.success('Richiesta di reso ritirata');
      router.push(`/orders/${params.id}`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setRitiroInCorso(false);
    }
  }

  async function uploadPhoto(scelta: File) {
    setUploading(true);
    try {
      // Una foto HEIC salvata com'e' su Chrome e Android (anche dal negozio che valuta il reso)
      // resta un riquadro rotto: qui diventa JPEG, o non parte (`lib/immagini/heic-in-jpeg.ts`).
      const file = await senzaHeic(scelta);
      if (!file) {
        toast.error(avvisoFotoHeic());
        return;
      }
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
    // 5/11/2026 — Con la foto ancora in caricamento il reso partiva senza, e dopo non si poteva
    // più aggiungere. Senza motivo non parte niente.
    if (uploading || !reason || articoloMancante) return;
    setSubmitting(true);
    try {
      const r = await fetch('/api/returns/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: params.id,
          orderItemId: articoloScelto,
          reason,
          notes: notes || undefined,
          photoUrls: photos,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorMessage(data));
      toast.success('Richiesta di reso inviata');
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
  if (letturaFallita)
    return (
      <div className="container mx-auto max-w-xl px-4 py-12">
        <ErrorState
          title="Non riesco a caricare l'ordine"
          description="Sembra un problema di collegamento. L'ordine c'è: riprova."
          retry={() => {
            setLoaded(false);
            setTentativo((t) => t + 1);
          }}
        />
      </div>
    );
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

  // Viene prima del controllo sui 14 giorni: un recesso chiesto il tredicesimo giorno si
  // ritira anche il quindicesimo, e un secondo reso sullo stesso ordine la creazione lo rifiuta.
  if (resoAperto) {
    const ritirabile = STATI_RITIRABILI.includes(resoAperto.status);
    return (
      <div className="container mx-auto max-w-xl px-4 py-8">
        <Link href={`/orders/${params.id}`} className="text-sm text-primary-700 hover:underline">
          ← Torna all&apos;ordine
        </Link>
        <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm-neutral ring-1 ring-cream-300">
          <h1 className="text-2xl font-bold text-ink-900">Hai già una richiesta di reso aperta</h1>
          {ritirabile ? (
            <>
              <p className="mt-3 text-ink-700">
                Se ci hai ripensato e vuoi tenere il prodotto, puoi ritirarla: il reso si chiude e non
                devi rispedire niente.
              </p>
              <button
                type="button"
                onClick={ritira}
                disabled={ritiroInCorso}
                className="mt-5 rounded-lg border border-secondary-300 bg-white px-4 py-2 text-sm font-semibold text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
              >
                Ritira la richiesta
              </button>
            </>
          ) : (
            <p className="mt-3 text-ink-700">
              La merce è già in viaggio o in negozio: la richiesta non si può più ritirare. Se ti
              serve qualcosa, scrivi al negozio.
            </p>
          )}
        </div>
      </div>
    );
  }

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
  // 12/11/2026 (R07-006) — la stessa regola del server: giorni di calendario a
  // Piacenza, e senza data di consegna si conta dalla data dell'ordine. Prima la
  // pagina arrotondava per difetto e lasciava compilare il reso, IBAN compreso,
  // anche quando il server lo avrebbe rifiutato come scaduto.
  const baseRecesso = order.delivered_at ?? order.created_at ?? null;
  const fuoriTempo = baseRecesso !== null && !recessoAperto(baseRecesso);

  if (!consegnato || fuoriTempo) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-8">
        <Link href={`/orders/${params.id}`} className="text-sm text-primary-700 hover:underline">
          ← Torna all&apos;ordine
        </Link>
        <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm-neutral ring-1 ring-cream-300">
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
                Il termine per il recesso è scaduto: valeva fino a tutto il{' '}
                <strong>{new Date(`${ultimoGiornoDelRecesso(baseRecesso!)}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' })}</strong>,
                quattordici giorni dopo la consegna.
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

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm-neutral ring-1 ring-cream-300">
        {serveSceltaArticolo && (
          <fieldset className="mb-6">
            <legend className="block text-sm font-medium text-ink-700">Cosa vuoi rendere?</legend>
            <div className="mt-2 space-y-2">
              {righe.map((riga) => (
                <label key={riga.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-cream-300 p-3 hover:bg-cream-50">
                  <input
                    type="radio"
                    name="articolo"
                    value={riga.id}
                    checked={cosaRendo === riga.id}
                    onChange={(e) => setCosaRendo(e.target.value)}
                    className="h-4 w-4 text-primary-700"
                  />
                  <span className="text-sm">
                    {nomeDellaRigaOrdine(riga)}
                    {riga.variant_label ? ` · ${riga.variant_label}` : ''}
                    {Number(riga.quantity ?? 1) > 1 ? ` × ${riga.quantity}` : ''}
                    <span className="text-ink-500"> · {formatPrice(Number(riga.unit_price ?? 0) * Number(riga.quantity ?? 1))}</span>
                  </span>
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-cream-300 p-3 hover:bg-cream-50">
                <input
                  type="radio"
                  name="articolo"
                  value={TUTTO_L_ORDINE}
                  checked={cosaRendo === TUTTO_L_ORDINE}
                  onChange={(e) => setCosaRendo(e.target.value)}
                  className="h-4 w-4 text-primary-700"
                />
                <span className="text-sm">Tutto l&apos;ordine</span>
              </label>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Un articolo si rende per intero. Se ne rendi più di uno ma non tutti, scegline uno e scrivi gli altri nei dettagli: il negozio li aggiunge al rimborso.
            </p>
          </fieldset>
        )}
        <fieldset>
        <legend className="block text-sm font-medium text-ink-700">Motivo del reso</legend>
        <div className="mt-2 space-y-2">
          {REASONS.map((r) => {
            const spento = r.value === MOTIVO_RIPENSAMENTO && rifiutoRipensamento !== null;
            return (
            <label key={r.value} className={`flex items-center gap-3 rounded-lg border border-cream-300 p-3 ${spento ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-cream-50'}`}>
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                disabled={spento}
                aria-describedby={spento ? 'ripensamento-escluso' : undefined}
                onChange={(e) => setReason(e.target.value)}
                className="h-4 w-4 text-primary-700"
              />
              <span className="text-sm inline-flex items-center gap-2"><r.icon size={15} strokeWidth={2.2} className="text-ink-500" aria-hidden /> {r.label}</span>
            </label>
            );
          })}
          {rifiutoRipensamento && (
            <p id="ripensamento-escluso" className="text-sm text-ink-600">{rifiutoRipensamento}</p>
          )}
        </div>
        </fieldset>

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
            <div key={p} className="relative">
              <img
                src={p}
                alt={`Foto ${i + 1} allegata alla richiesta di reso`}
                loading="lazy"
                className="h-20 w-20 rounded-lg object-cover ring-1 ring-cream-300"
              />
              {/* 5/11/2026 — La foto sbagliata si stacca: prima l'elenco cresceva e basta. */}
              <button
                type="button"
                onClick={() => setPhotos((tutte) => tutte.filter((x) => x !== p))}
                aria-label={`Togli la foto ${i + 1}`}
                // 12/11/2026 (R07-008) — il tasto era 24 px, la metà dei 44 minimi: ora l'area
                // che si tocca è 44 px e dentro resta il pallino visibile da 24. Sporge di 8 px,
                // quanto lo spazio fra le miniature: non copre la foto accanto né il «+».
                className="absolute -right-2 -top-2 inline-flex h-11 w-11 items-center justify-center rounded-full"
              >
                <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white shadow-sm-neutral">
                  ×
                </span>
              </button>
            </div>
          ))}
          {photos.length < 8 && (
            <label className="inline-flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-cream-300 text-2xl text-ink-400 hover:bg-cream-50 focus-within:ring-2 focus-within:ring-primary-700 focus-within:ring-offset-2">
              {uploading ? '…' : '+'}
              <input
                type="file"
                aria-label="Aggiungi una foto alla richiesta di reso"
                /* 8/9/2026 — erano tre tipi scritti a mano qui accanto, mentre la porta e il
                   deposito ne accettano sette (070). Il cliente che allega la foto del prodotto
                   rotto scattata con l'iPhone non la vedeva nemmeno comparire nella finestra di
                   scelta: il file c'era, il campo lo nascondeva. La lista arriva dalla stessa
                   regola che poi rifiuta il file. */
                accept={acceptSenzaHeic(attributoAccept())}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // 5/11/2026 — Si azzera il campo: dopo un errore la stessa foto si può riscegliere
                  // (il browser fa scattare change solo se il valore cambia).
                  e.currentTarget.value = '';
                  if (f) uploadPhoto(f);
                }}
              />
            </label>
          )}
        </div>

        {/* R71 — Chi ha pagato alla consegna riavrà i soldi con un bonifico: il modulo non
            chiede niente, lo dice e basta. L'IBAN lo chiede l'email del rimborso. */}
        {haUnaParteInContanti(order) && (
          <p className="mt-6 rounded-lg bg-cream-100 p-3 text-sm text-ink-700">
            Hai pagato alla consegna: se il reso viene rimborsato, ti restituiamo i soldi con un bonifico.
            L&apos;IBAN te lo chiediamo per email, quando parte il rimborso.
            {Number(order.wallet_applied_cents ?? 0) > 0 && (
              <> La parte che avevi pagato con il credito MyCity torna come credito.</>
            )}
          </p>
        )}

        <button
          onClick={submit}
          disabled={submitting || uploading || !reason || articoloMancante}
          className="mt-6 w-full rounded-lg bg-primary-700 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
        >
          {submitting ? tStates('sending') : uploading ? 'Attendi la foto…' : articoloMancante ? 'Scegli cosa vuoi rendere' : !reason ? 'Scegli il motivo del reso' : 'Invia richiesta di reso'}
        </button>
      </div>
    </div>
  );
}
