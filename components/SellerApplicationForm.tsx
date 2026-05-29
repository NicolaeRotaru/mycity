'use client';

import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import Link from 'next/link';
import StoreLocationPicker, { StoreLocation } from './StoreLocationPickerLazy';
import StoreAvatar from './StoreAvatar';
import StoreMediaManager from './StoreMediaManager';
import { supabase } from '@/lib/supabase/client';
import type { StoreMediaItem } from './StoreMediaCarousel';
import { friendlyError } from '@/lib/errors';
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field';
import { useTranslations } from 'next-intl';

/**
 * Form completo per la richiesta di diventare venditore business su MyCity.
 *
 * Differenze rispetto al vecchio VendorForm:
 *  - raccoglie dati anagrafici del titolare (richiesti per legge)
 *  - raccoglie dati azienda (P.IVA, ragione sociale, sede legale)
 *  - richiede consensi espliciti a ToS, Privacy, accuratezza dati, addebito €50/mese
 *  - dopo l'invio NON attiva il negozio: parte la procedura di approvazione admin
 *
 * Il form è lungo ma in una pagina sola (no wizard) per consentire la
 * compilazione "tutta insieme" tipica del primo onboarding.
 */

const SellerSchema = z.object({
  // Contatti operativi
  contactEmail: z.string().email('Email non valida'),
  contactPhone: z.string().regex(/^[0-9 +]{8,16}$/, 'Numero di telefono non valido'),

  // Anagrafica titolare
  legalFirstName: z.string().min(2, 'Inserisci il nome'),
  legalLastName:  z.string().min(2, 'Inserisci il cognome'),
  legalFiscalCode: z.string().regex(/^[A-Z0-9]{11,16}$/i, 'Codice fiscale non valido (11-16 caratteri)'),
  legalBirthDate: z.string().min(1, 'Inserisci la data di nascita'),
  legalResidenceAddr: z.string().min(3, 'Inserisci la via di residenza'),
  legalResidenceCity: z.string().min(2, 'Inserisci la città'),
  legalResidenceZip:  z.string().regex(/^[0-9]{5}$/, 'CAP non valido (5 cifre)'),

  // Azienda
  businessLegalName: z.string().min(2, 'Inserisci la ragione sociale'),
  businessVatNumber: z.string().regex(/^[A-Z0-9]{8,15}$/i, 'P.IVA non valida'),
  businessForm: z.enum(['ditta_individuale', 'srl', 'srls', 'snc', 'sas', 'spa', 'altro']),
  businessAddress: z.string().min(3, 'Inserisci la sede legale'),
  businessCity: z.string().min(2, 'Inserisci la città'),
  businessZip: z.string().regex(/^[0-9]{5}$/, 'CAP non valido (5 cifre)'),
  businessPec: z.string().email('PEC non valida').optional().or(z.literal('')),
  businessSdi: z.string().regex(/^[A-Z0-9]{6,7}$/, 'Codice SDI non valido').optional().or(z.literal('')),

  // Vetrina pubblica
  storeName: z.string().min(3, 'Nome del negozio (almeno 3 caratteri)'),
  storeDescription: z.string().max(500, 'Massimo 500 caratteri').optional().or(z.literal('')),

  // Pagamenti
  billingIban: z.string().regex(/^[A-Z0-9]{15,34}$/i, 'IBAN non valido').optional().or(z.literal('')),

  // Consensi legali
  // boolean + refine (non literal(true)): permette default false nel form
  // ma valida che sia true al submit. Evita il cast `false as unknown as true`.
  acceptTos: z.boolean().refine((v) => v === true, { message: 'Devi accettare i Termini di servizio' }),
  acceptPrivacy: z.boolean().refine((v) => v === true, { message: 'Devi accettare la Privacy policy' }),
  acceptAccuracy: z.boolean().refine((v) => v === true, { message: 'Devi confermare i dati' }),
  acceptBilling: z.boolean().refine((v) => v === true, { message: "Devi accettare l'addebito" }),
});

type SchemaData = z.infer<typeof SellerSchema>;

export type SellerApplicationData = SchemaData & {
  storeLogo: string | null;
  storeMedia: StoreMediaItem[];
  storeAddress: string;
  storeLat: number;
  storeLng: number;
};

interface Props {
  defaultValues?: Partial<SchemaData & { storeLogo: string | null; storeMedia: StoreMediaItem[]; storeAddress: string; storeLat: number; storeLng: number }>;
  onSubmit: (data: SellerApplicationData) => void;
  isLoading?: boolean;
}

const Section = ({
  step, title, subtitle, children,
}: { step: number; title: string; subtitle?: string; children: React.ReactNode }) => (
  <section className="bg-white border rounded-2xl p-6 space-y-4">
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

const Field = ({
  label, required, error, children, hint,
}: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-semibold text-ink-700 mb-1">
      {label} {required && <span className="text-rose-500" aria-label="obbligatorio">*</span>}
    </label>
    {children}
    {hint && !error && <p className="text-xs text-ink-400 mt-1">{hint}</p>}
    {error && <p role="alert" aria-live="polite" className="text-xs text-rose-600 mt-1">{error}</p>}
  </div>
);

const BUSINESS_FORMS: { value: SchemaData['businessForm']; label: string }[] = [
  { value: 'ditta_individuale', label: 'Ditta individuale / Libero professionista' },
  { value: 'srl',               label: 'S.r.l.' },
  { value: 'srls',              label: 'S.r.l.s.' },
  { value: 'snc',               label: 'S.n.c.' },
  { value: 'sas',               label: 'S.a.s.' },
  { value: 'spa',               label: 'S.p.A.' },
  { value: 'altro',             label: 'Altro' },
];

export default function SellerApplicationForm({ defaultValues, onSubmit, isLoading = false }: Props) {
  const tStates = useTranslations('states');
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SchemaData>({
    resolver: zodResolver(SellerSchema),
    defaultValues: {
      contactEmail:    defaultValues?.contactEmail    ?? '',
      contactPhone:    defaultValues?.contactPhone    ?? '',
      legalFirstName:  defaultValues?.legalFirstName  ?? '',
      legalLastName:   defaultValues?.legalLastName   ?? '',
      legalFiscalCode: defaultValues?.legalFiscalCode ?? '',
      legalBirthDate:  defaultValues?.legalBirthDate  ?? '',
      legalResidenceAddr: defaultValues?.legalResidenceAddr ?? '',
      legalResidenceCity: defaultValues?.legalResidenceCity ?? '',
      legalResidenceZip:  defaultValues?.legalResidenceZip  ?? '',
      businessLegalName: defaultValues?.businessLegalName ?? '',
      businessVatNumber: defaultValues?.businessVatNumber ?? '',
      businessForm:      defaultValues?.businessForm      ?? 'ditta_individuale',
      businessAddress:   defaultValues?.businessAddress   ?? '',
      businessCity:      defaultValues?.businessCity      ?? '',
      businessZip:       defaultValues?.businessZip       ?? '',
      businessPec:       defaultValues?.businessPec       ?? '',
      businessSdi:       defaultValues?.businessSdi       ?? '',
      storeName:         defaultValues?.storeName         ?? '',
      storeDescription:  defaultValues?.storeDescription  ?? '',
      billingIban:       defaultValues?.billingIban       ?? '',
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
  });
  const [locationError, setLocationError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(defaultValues?.storeLogo ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [media, setMedia] = useState<StoreMediaItem[]>(defaultValues?.storeMedia ?? []);

  const storeName = watch('storeName');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] },
    maxFiles: 1,
    maxSize: 3 * 1024 * 1024,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setUploadingLogo(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');
        const ext = file.type.split('/')[1];
        const path = `logos/${user.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('products').upload(path, file, {
          upsert: true,
          contentType: file.type,
        });
        if (error) throw error;
        const { data } = supabase.storage.from('products').getPublicUrl(path);
        setLogoUrl(data.publicUrl);
        toast.success('Logo caricato');
      } catch (err) {
      toast.error(friendlyError(err));
    } finally {
        setUploadingLogo(false);
      }
    },
  });

  const submit = (data: SchemaData) => {
    if (!location.address.trim()) {
      setLocationError("Inserisci l'indirizzo del negozio");
      return;
    }
    onSubmit({
      ...data,
      storeLogo: logoUrl,
      storeMedia: media,
      storeAddress: location.address,
      storeLat: location.lat,
      storeLng: location.lng,
    });
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      {/* INFO HEADER */}
      <div className="bg-gradient-to-r from-primary-600 via-purple-600 to-pink-600 text-white rounded-2xl p-6">
        <h1 className="text-2xl md:text-3xl font-extrabold mb-1">🏪 Diventa venditore business</h1>
        <p className="text-primary-100 text-sm leading-relaxed">
          Vetrina dedicata, prodotti illimitati, niente commissioni per vendita.
          <strong className="text-white"> Abbonamento €50/mese</strong>, attivo solo dopo approvazione del nostro team.
        </p>
        <ul className="text-xs text-primary-100 mt-3 space-y-1">
          <li>✓ Vetrina pubblica con logo, copertina, descrizione</li>
          <li>✓ Pubblica prodotti illimitati e gestisci ordini da dashboard</li>
          <li>✓ Pagamento mensile, niente commissioni sulle vendite</li>
          <li>✓ Bonifico settimanale su IBAN per i tuoi incassi</li>
        </ul>
      </div>

      {/* STEP 1: Contatti */}
      <Section step={1} title="Contatti operativi" subtitle="Come ti contatteremo per ordini e supporto">
        <Input
          label="Email operativa"
          required
          type="email"
          inputMode="email"
          placeholder="negozio@example.com"
          {...register('contactEmail')}
          error={errors.contactEmail?.message}
          hint="Diverso da quella di login? Inserisci quella che leggi tutti i giorni"
        />
        <Input
          label="Telefono"
          required
          type="tel"
          inputMode="tel"
          placeholder="3331234567"
          {...register('contactPhone')}
          error={errors.contactPhone?.message}
        />
      </Section>

      {/* STEP 2: Anagrafica titolare */}
      <Section step={2} title="Anagrafica del titolare" subtitle="Rappresentante legale dell'attività">
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Nome" required {...register('legalFirstName')} error={errors.legalFirstName?.message} />
          <Input label="Cognome" required {...register('legalLastName')} error={errors.legalLastName?.message} />
          <Input
            label="Codice fiscale"
            required
            className="uppercase"
            maxLength={16}
            {...register('legalFiscalCode')}
            error={errors.legalFiscalCode?.message}
            hint="16 caratteri alfanumerici"
          />
          <Input label="Data di nascita" required type="date" {...register('legalBirthDate')} error={errors.legalBirthDate?.message} />
        </div>
        <Input
          label="Indirizzo di residenza"
          required
          placeholder="Via, numero civico"
          {...register('legalResidenceAddr')}
          error={errors.legalResidenceAddr?.message}
          hint="Resta privato, non viene mostrato ai clienti"
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Città di residenza" required {...register('legalResidenceCity')} error={errors.legalResidenceCity?.message} />
          <Input label="CAP" required inputMode="numeric" maxLength={5} {...register('legalResidenceZip')} error={errors.legalResidenceZip?.message} />
        </div>
      </Section>

      {/* STEP 3: Azienda */}
      <Section step={3} title="Dati azienda" subtitle="Necessari per fatturazione ed obblighi fiscali">
        <Select label="Forma giuridica" required {...register('businessForm')} error={errors.businessForm?.message}>
          {BUSINESS_FORMS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
        <Input
          label="Ragione sociale"
          required
          placeholder="Es. Rossi Mario, Salumeria del Borgo S.r.l."
          {...register('businessLegalName')}
          error={errors.businessLegalName?.message}
          hint="Nome completo dell'azienda come da visura camerale"
        />
        <Input
          label="Partita IVA"
          required
          className="uppercase"
          maxLength={15}
          {...register('businessVatNumber')}
          error={errors.businessVatNumber?.message}
          hint="Italiana 11 cifre, oppure formato UE"
        />
        <Input label="Sede legale — Via" required placeholder="Via, numero civico" {...register('businessAddress')} error={errors.businessAddress?.message} />
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Città" required {...register('businessCity')} error={errors.businessCity?.message} />
          <Input label="CAP" required inputMode="numeric" maxLength={5} {...register('businessZip')} error={errors.businessZip?.message} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="PEC"
            type="email"
            inputMode="email"
            placeholder="negozio@pec.it"
            {...register('businessPec')}
            error={errors.businessPec?.message}
            hint="Opzionale ma consigliata"
          />
          <Input
            label="Codice SDI"
            className="uppercase"
            maxLength={7}
            {...register('businessSdi')}
            error={errors.businessSdi?.message}
            hint="7 caratteri per fatturazione elettronica"
          />
        </div>
      </Section>

      {/* STEP 4: Vetrina */}
      <Section step={4} title="La tua vetrina pubblica" subtitle="Quello che vedranno i clienti">
        {/* Logo upload */}
        <Field label="Logo del negozio">
          <div className="flex items-center gap-4">
            <StoreAvatar logoUrl={logoUrl} storeName={storeName} size="lg" />
            <div
              {...getRootProps()}
              className={`flex-1 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors text-sm ${
                isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
              } ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <input {...getInputProps()} />
              {uploadingLogo ? <p className="text-ink-500">{tStates('loading')}</p>
                : logoUrl ? <p className="text-ink-600"><span className="font-medium">Sostituisci</span> · trascina o clicca</p>
                : <p className="text-ink-500"><span className="font-medium text-primary-700">Carica</span> immagine quadrata (max 3MB)</p>}
            </div>
            {logoUrl && (
              <button type="button" onClick={() => setLogoUrl(null)} className="text-sm text-ink-500 hover:text-rose-600 underline">
                Rimuovi
              </button>
            )}
          </div>
        </Field>

        <StoreMediaManager value={media} onChange={setMedia} />

        <Input
          label="Nome del negozio"
          required
          placeholder="Es. Salumeria del Borgo"
          {...register('storeName')}
          error={errors.storeName?.message}
          hint="Come ti chiameranno i clienti (può essere diverso dalla ragione sociale)"
        />

        <Textarea
          label="Descrizione (opzionale)"
          rows={3}
          className="resize-none"
          placeholder="Cosa rende speciale il tuo negozio? Storia, tradizione, prodotti tipici…"
          {...register('storeDescription')}
          error={errors.storeDescription?.message}
        />

        <Field label="Indirizzo del negozio (pubblico)" required hint="Dove i clienti possono ritirare. È mostrato sulla mappa nel marketplace.">
          <StoreLocationPicker
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
          {locationError && <p className="text-xs text-rose-600 mt-1">{locationError}</p>}
        </Field>
      </Section>

      {/* STEP 5: Pagamenti */}
      <Section step={5} title="Pagamenti" subtitle="Come ricevi i guadagni e come ti addebitiamo l'abbonamento">
        <Input
          label="IBAN per i bonifici dei tuoi incassi"
          className="uppercase font-mono text-xs"
          placeholder="IT60X0542811101000000123456"
          {...register('billingIban')}
          error={errors.billingIban?.message}
          hint="Italiano (IT) o europeo. Lo riceveremo cifrato."
        />

        <div className="bg-accent-50 border border-accent-200 rounded-lg p-4 text-sm text-accent-900">
          <p className="font-semibold mb-1">💳 Carta di credito per abbonamento</p>
          <p>
            L'abbonamento (€50/mese) viene addebitato <strong>solo dopo che l'admin avrà approvato la richiesta</strong>.
            In quel momento ti chiederemo di inserire la carta tramite un pagamento sicuro (Stripe). Non ti chiediamo i
            dati carta adesso per ridurre i tuoi rischi.
          </p>
        </div>
      </Section>

      {/* STEP 6: Consensi */}
      <Section step={6} title="Consensi legali" subtitle="Obbligatori per attivare il negozio">
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
          label="Confermo che i dati anagrafici e aziendali forniti sono corretti e completi"
          register={register('acceptAccuracy')}
          error={errors.acceptAccuracy?.message as string | undefined}
        />
        <Consent
          label="Accetto che, all'approvazione, mi venga richiesto l'inserimento della carta per l'addebito mensile di €50"
          register={register('acceptBilling')}
          error={errors.acceptBilling?.message as string | undefined}
        />
      </Section>

      <button
        type="submit"
        disabled={isLoading || uploadingLogo}
        className="w-full bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-bold text-base shadow-lg transition-all"
      >
        {isLoading ? 'Invio in corso…' : '📨 Invia richiesta'}
      </button>
      <p className="text-center text-xs text-ink-500">
        Risposta entro 48 ore lavorative. Sarai notificato via email e dentro la piattaforma.
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
