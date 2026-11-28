'use client';

import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import StoreLocationPicker, { StoreLocation } from './StoreLocationPickerLazy';
import { Input, Checkbox } from '@/components/ui/Field';
// 31/8/2026 (R037) — Questa e' la pagina dove il negozio legge le condizioni
// PRIMA di firmare: la commissione qui non si scrive a mano, si prende da dove
// viene poi trattenuta davvero.
// R10-005 — Il prezzo dell'abbonamento arriva da dove si calcola l'addebito.
import { FRASE_PREZZO_NEGOZI, PREZZO_ABBONAMENTO_MESE } from '@/app/seller/earnings/commissione';
import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';
import { Store, Send } from 'lucide-react';
import { MAX_DETTAGLIO_ATTIVITA, SCHEDE_ATTIVITA, TIPI_ATTIVITA, tipoDelProfilo } from '@/lib/agenzia/tipi-attivita';
import { instagramDelTitolare, schedaGoogleDelTitolare } from '@/lib/agenzia/indizi-del-titolare';

/**
 * Il modulo per chiedere di vendere su MyCity.
 *
 * 25/11/2026 — IL MINIMO PER RICONOSCERE L'ATTIVITÀ. Nicola: «questa pagina è
 * troppo lunga, lascia il minimo indispensabile per identificare quella
 * attività facilmente». Erano 7 riquadri e 23 campi da scrivere o caricare.
 * Ne restano cinque, quelli che bastano a riconoscerla:
 *  - che attività è (negozio, bar, ristorante, artigiano, servizi, altro);
 *  - come si chiama;
 *  - dove sta, sulla mappa;
 *  - la partita IVA: la identifica senza dubbi, ed è l'unico dato che lo staff
 *    deve avere per approvare (lib/admin/regole-approvazione.ts);
 *  - il telefono, per parlarci.
 * Più le spunte legali, che si firmano qui e vanno a verbale.
 *
 * Il resto si chiede dopo l'approvazione, nel Profilo del negozio: i dati del
 * titolare (components/seller/DatiDelTitolare), IBAN e dati per la fattura
 * (components/seller/DatiPerIBonifici), logo, foto e descrizione (la vetrina).
 * La data di nascita qui non si chiede più: chi firma dichiara di avere 18
 * anni nella spunta dei dati (condizioni d'uso, punto 3).
 *
 * Resta vero quello che c'era prima:
 *  - l'addebito mensile dell'abbonamento si fa accettare SOLO se l'abbonamento
 *    è acceso (`ABBONAMENTO_NEGOZI_ACCESO`): far accettare un addebito che non
 *    faremo è una promessa falsa scritta in un contratto;
 *  - non chiede un'«email operativa»: avvisi e risposte vanno all'email di accesso;
 *  - dopo l'invio NON attiva il negozio: parte l'approvazione dello staff.
 */

const SellerSchema = z.object({
  // 22/11/2026 — Non serve più essere una bottega (Nicola): bar, ristoranti, artigiani, servizi.
  businessType: z.enum(TIPI_ATTIVITA, { errorMap: () => ({ message: 'Scegli che attività hai' }) }),
  businessTypeDetail: z.string().trim().max(MAX_DETTAGLIO_ATTIVITA, `Al massimo ${MAX_DETTAGLIO_ATTIVITA} caratteri`).optional().or(z.literal('')),

  // R28-011 — Come la rotta (app/api/seller/apply): senza spazi ai lati, da 3 a 80 caratteri, e l'avviso dice cosa correggere.
  storeName: z.string().trim().min(3, 'Il nome del negozio deve avere almeno 3 caratteri').max(80, 'Il nome del negozio può avere al massimo 80 caratteri: accorcialo'),

  // Il controllo completo della partita IVA (la cifra finale) lo fa il server.
  businessVatNumber: z.string().regex(/^\s*(IT)?\s*[0-9]{11}\s*$/i, 'Partita IVA non valida (11 cifre)'),

  contactPhone: z.string().regex(/^[0-9 +]{8,16}$/, 'Numero di telefono non valido'),

  // 26/11/2026 — Facoltativi (Nicola): due indizi per l'analisi, che vanno a n8n. Lo stesso controllo dei canali.
  instagram: z.string().max(400).optional().or(z.literal('')),
  googleMaps: z.string().max(400).optional().or(z.literal('')),

  // Consensi legali
  // boolean + refine (non literal(true)): permette default false nel form
  // ma valida che sia true al submit. Evita il cast `false as unknown as true`.
  acceptTos: z.boolean().refine((v) => v === true, { message: 'Devi accettare i Termini di servizio' }),
  acceptPrivacy: z.boolean().refine((v) => v === true, { message: 'Devi accettare la Privacy policy' }),
  acceptAccuracy: z.boolean().refine((v) => v === true, { message: 'Devi confermare i dati e la maggiore età' }),
  acceptBilling: ABBONAMENTO_NEGOZI_ACCESO
    ? z.boolean().refine((v) => v === true, { message: "Devi accettare l'addebito" })
    : z.boolean().optional(),
}).superRefine((d, ctx) => {
  if (d.businessType === 'altro' && (d.businessTypeDetail ?? '').trim().length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['businessTypeDetail'], message: 'Scrivi in poche parole che attività hai' });
  }
  // 26/11/2026 — Le stesse regole del server (lib/agenzia/indizi-del-titolare.ts): un indizio che il server
  // scarterebbe, il modulo lo dice subito, invece di perderlo in silenzio.
  if ((d.instagram ?? '').trim() && !instagramDelTitolare(d.instagram)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instagram'], message: 'Scrivi il nome del profilo Instagram dell’attività, per esempio @iltuonegozio, oppure lascia vuoto.' });
  }
  if ((d.googleMaps ?? '').trim() && !schedaGoogleDelTitolare(d.googleMaps)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['googleMaps'], message: 'Incolla il link della scheda del locale: in Google Maps apri il locale e premi «Condividi». Oppure lascia vuoto.' });
  }
});

type SchemaData = z.infer<typeof SellerSchema>;

export type SellerApplicationData = SchemaData & {
  storeAddress: string;
  storeLat: number;
  storeLng: number;
};

interface Props {
  defaultValues?: Partial<SchemaData & { storeAddress: string; storeLat: number; storeLng: number }>;
  onSubmit: (data: SellerApplicationData) => void;
  isLoading?: boolean;
  /** L'email con cui la persona accede: è lì che arrivano avvisi e risposte. */
  emailAccesso?: string | null;
}

const Section = ({
  step, title, subtitle, children,
}: { step: number; title: string; subtitle?: string; children: React.ReactNode }) => (
  <section className="bg-white border rounded-2xl p-5 space-y-4">
    <header className="flex items-start gap-3 -mt-1">
      <span className="w-8 h-8 bg-primary-100 text-primary-800 rounded-full flex items-center justify-center font-bold shrink-0">
        {step}
      </span>
      <div>
        <h2 className="font-extrabold text-lg text-ink-900">{title}</h2>
        {subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}
      </div>
    </header>
    <div className="space-y-4">{children}</div>
  </section>
);

export default function SellerApplicationForm({ defaultValues, onSubmit, isLoading = false, emailAccesso = null }: Props) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SchemaData>({
    resolver: zodResolver(SellerSchema),
    defaultValues: {
      // Chi si iscrive per la prima volta parte da «negozio», il caso più frequente: una scelta in
      // meno da fare. Chi corregge una richiesta ritrova quella che aveva mandato.
      businessType:       tipoDelProfilo(defaultValues?.businessType),
      businessTypeDetail: defaultValues?.businessTypeDetail ?? '',
      storeName:         defaultValues?.storeName         ?? '',
      businessVatNumber: defaultValues?.businessVatNumber ?? '',
      contactPhone:      defaultValues?.contactPhone      ?? '',
      instagram:         '',
      googleMaps:        '',
      acceptTos:         false,
      acceptPrivacy:     false,
      acceptAccuracy:    false,
      acceptBilling:     false,
    },
  });

  const [location, setLocation] = useState<StoreLocation>({
    address: defaultValues?.storeAddress ?? '',
    lat:     defaultValues?.storeLat     ?? 45.0532,
    lng:     defaultValues?.storeLng     ?? 9.6914,
    // Il selettore la conferma appena si apre, se il negozio una posizione l'aveva già.
    confermata: false,
  });
  const [locationError, setLocationError] = useState<string | null>(null);

  const tipoScelto = tipoDelProfilo(watch('businessType'));
  const scheda = SCHEDE_ATTIVITA[tipoScelto];

  const submit = (data: SchemaData) => {
    if (!location.address.trim()) {
      setLocationError(`Inserisci l'indirizzo ${scheda.del}`);
      return;
    }
    // L'indirizzo scritto non basta: senza «Cerca», GPS o un tocco sulla mappa le coordinate sono
    // il punto in cui si apre la mappa, e il negozio verrebbe salvato dove non è.
    if (!location.confermata) {
      setLocationError(`Metti ${scheda.il} sulla mappa: premi «Cerca» accanto all'indirizzo, oppure tocca la mappa nel punto giusto. Senza la posizione, i clienti vicini non possono ordinarti la consegna.`);
      return;
    }
    // 26/11/2026 — Gli indizi facoltativi partono solo se scritti: un campo vuoto non manda niente.
    const { instagram, googleMaps, ...resto } = data;
    onSubmit({
      ...resto,
      ...(instagram?.trim() ? { instagram: instagram.trim() } : {}),
      ...(googleMaps?.trim() ? { googleMaps: googleMaps.trim() } : {}),
      storeAddress: location.address,
      storeLat: location.lat,
      storeLng: location.lng,
    });
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      {/* INFO HEADER: il prezzo resta qui, è dove il negozio lo legge prima di firmare (R037). */}
      <div className="bg-gradient-to-r from-primary-600 via-primary-700 to-secondary-600 text-white rounded-2xl p-5">
        <h1 className="text-2xl md:text-3xl font-extrabold mb-1 flex items-center gap-2">
          <Store size={28} aria-hidden />
          Diventa venditore business
        </h1>
        {/* 22/11/2026 — Non solo botteghe: lo si dice prima di tutto. */}
        <p className="text-primary-100 text-sm leading-relaxed">
          Negozi, bar, ristoranti, artigiani, servizi: va bene ogni attività che vende qualcosa.
        </p>
        <p className="text-primary-100 text-sm leading-relaxed mt-2">
          {/* 31/10/2026 (ondata 6) — Diceva «Nessun costo mensile»: il prezzo dei negozi è una frase sola. */}
          {/* 25/11/2026 — Una volta sola: la frase del prezzo dice già canone e commissione, e la riga
              che li ripeteva accanto diceva due volte la stessa cosa. */}
          <strong className="text-white">{FRASE_PREZZO_NEGOZI}</strong> Vale dopo l&apos;approvazione del nostro team.
        </p>
      </div>

      {/* STEP 1: Che attività hai (22/11/2026) */}
      <Section step={1} title="Che attività hai?">
        <fieldset>
          <legend className="sr-only">Che attività hai?</legend>
          <div className="grid grid-cols-2 gap-2">
            {TIPI_ATTIVITA.map((t) => (
              <label
                key={t}
                title={SCHEDE_ATTIVITA[t].esempi}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 cursor-pointer transition-colors ${
                  tipoScelto === t ? 'border-primary-600 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
                }`}
              >
                <input type="radio" value={t} {...register('businessType')} className="accent-primary-700" />
                <span className="font-semibold text-ink-900 text-sm">{SCHEDE_ATTIVITA[t].etichetta}</span>
              </label>
            ))}
          </div>
          {errors.businessType?.message && (
            <p role="alert" className="text-xs font-medium text-secondary-600 mt-1">{errors.businessType.message}</p>
          )}
        </fieldset>
        {tipoScelto === 'altro' && (
          <Input
            label="Scrivi che attività hai"
            required
            maxLength={MAX_DETTAGLIO_ATTIVITA}
            placeholder="Es. fotografo, enoteca con degustazioni, palestra…"
            {...register('businessTypeDetail')}
            error={errors.businessTypeDetail?.message}
          />
        )}
      </Section>

      {/* STEP 2: chi è e dove sta — il minimo per riconoscerla */}
      <Section step={2} title="La tua attività" subtitle="Bastano questi dati per riconoscerla">
        <Input
          label={`Nome ${scheda.del}`}
          required
          placeholder="Es. Salumeria del Borgo"
          {...register('storeName')}
          error={errors.storeName?.message}
          hint="Come lo chiamano i clienti"
        />

        {/* L'etichetta la scrive il selettore (associata al campo): qui c'era una seconda etichetta uguale sopra. */}
        <div>
          <StoreLocationPicker
            etichetta={`Indirizzo ${scheda.del}`}
            defaultValue={{
              address: defaultValues?.storeAddress,
              lat:     defaultValues?.storeLat,
              lng:     defaultValues?.storeLng,
            }}
            onChange={(loc) => {
              setLocation(loc);
              if (loc.address.trim()) setLocationError(null);
            }}
          />
          {locationError
            ? <p role="alert" className="text-xs font-medium text-secondary-600 mt-1">{locationError}</p>
            : <p className="text-xs text-ink-400 mt-1">Si vede sulla mappa del marketplace.</p>}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="Partita IVA"
            required
            inputMode="numeric"
            maxLength={13}
            placeholder="01234567890"
            {...register('businessVatNumber')}
            error={errors.businessVatNumber?.message}
            hint="11 cifre"
          />
          <Input
            label="Telefono"
            required
            type="tel"
            inputMode="tel"
            placeholder="3331234567"
            {...register('contactPhone')}
            error={errors.contactPhone?.message}
            hint={emailAccesso ? `Gli avvisi arrivano anche a ${emailAccesso}` : undefined}
          />
        </div>

        {/* 26/11/2026 — Due indizi facoltativi per l'analisi (Nicola): nessuno dei due è obbligatorio. */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="Instagram (facoltativo)"
            placeholder="@iltuonegozio"
            maxLength={400}
            {...register('instagram')}
            error={errors.instagram?.message}
            hint="Il nome del profilo dell’attività: ci aiuta a preparare la tua analisi"
          />
          <Input
            label="Scheda Google Maps (facoltativo)"
            placeholder="https://maps.app.goo.gl/…"
            maxLength={400}
            inputMode="url"
            {...register('googleMaps')}
            error={errors.googleMaps?.message}
            hint="Il link della scheda del locale su Google Maps"
          />
        </div>
      </Section>

      {/* STEP 3: Consensi */}
      <Section step={3} title="Consensi">
        <Consent
          label={<>Ho letto e accetto i <Link href="/terms" target="_blank" className="text-primary-700 underline">Termini di servizio</Link> per venditori</>}
          register={register('acceptTos')}
          error={errors.acceptTos?.message as string | undefined}
        />
        <Consent
          label={<>Ho letto e accetto la <Link href="/privacy" target="_blank" className="text-primary-700 underline">Privacy policy</Link> (GDPR)</>}
          register={register('acceptPrivacy')}
          error={errors.acceptPrivacy?.message as string | undefined}
        />
        <Consent
          label="Confermo che i dati sono corretti e che ho almeno 18 anni"
          register={register('acceptAccuracy')}
          error={errors.acceptAccuracy?.message as string | undefined}
        />
        {ABBONAMENTO_NEGOZI_ACCESO && (
          <Consent
            label={`Accetto che, dopo il mio primo incasso con MyCity, mi venga richiesto l'inserimento della carta per l'addebito mensile di ${PREZZO_ABBONAMENTO_MESE}`}
            register={register('acceptBilling')}
            error={errors.acceptBilling?.message as string | undefined}
          />
        )}
      </Section>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-bold text-base shadow-warm-lg transition-all"
      >
        {isLoading ? (
          'Invio in corso…'
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            <Send size={18} aria-hidden />
            Invia richiesta
          </span>
        )}
      </button>
      <p className="text-center text-xs text-ink-500">
        Risposta entro 48 ore lavorative. Dopo l&apos;invio ti chiediamo i dati di chi firma.
        Logo, foto, IBAN e dati per la fattura li aggiungi dal tuo pannello, a negozio approvato.
      </p>
    </form>
  );
}

function Consent({
  label, register, error,
}: { label: React.ReactNode; register: UseFormRegisterReturn; error?: string }) {
  return (
    <Checkbox
      label={label}
      error={error}
      {...register}
      containerClassName="rounded-lg border hover:bg-cream-50 transition-colors [&>label]:p-3"
    />
  );
}
