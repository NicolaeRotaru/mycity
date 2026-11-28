'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDropzone } from 'react-dropzone';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Palette, Share2, Clock, Store } from 'lucide-react';
import StoreLocationPicker, { StoreLocation } from './StoreLocationPickerLazy';
import StoreAvatar from './StoreAvatar';
import StoreMediaManager from './StoreMediaManager';
import { supabase } from '@/lib/supabase/client';
import type { StoreMediaItem } from './StoreMediaCarousel';
import { LoadingState } from '@/components/ui/LoadingState';
import { Input, Textarea } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';
import { ANNO_IN_SECONDI, caricaImmagine } from '@/lib/storage/carica-immagine';
import { fileColTipoGiusto, mappaAccept, tipiScrittiPerUmani } from '@/lib/storage/casella-di-caricamento';
import { acceptSenzaHeic, avvisoFotoHeic, senzaHeic } from '@/lib/immagini/heic-in-jpeg';
import type { StoreHours } from '@/lib/store-hours';
import { MAX_TAGLINE, campoDellErrore, normalizzaSocials, storeCustomizationSchema, type StoreCustomization } from '@/lib/store-customization';
import CustomizationSection from './seller/CustomizationSection';
import AccentPicker from './seller/AccentPicker';
import CoverPicker from './seller/CoverPicker';
import SocialLinksFields from './seller/SocialLinksFields';
import AnnouncementEditor from './seller/AnnouncementEditor';
import BadgePicker from './seller/BadgePicker';
import StoreHoursEditor from './seller/StoreHoursEditor';
import { erroreDegliOrari } from './seller/orari-validi';
import { clicDaFermare } from './seller/site/dove-e-l-errore';

/**
 * R10-008, R10-009 — Il limite di un campo breve si vede: niente maxLength che taglia in silenzio.
 * Oltre il tetto il testo resta intero e sotto il campo si legge quanto è lungo.
 */
function sopraIlTetto(valore: string | undefined, max: number): string | undefined {
  const n = (valore ?? '').trim().length;
  return n > max
    ? `Troppo lungo: ${n.toLocaleString('it-IT')} caratteri su ${max.toLocaleString('it-IT')}. Accorcialo, così si salva.`
    : undefined;
}
import FeaturedProductsPicker from './seller/FeaturedProductsPicker';

type SchemaData = { storeName: string; storePhone: string };

/**
 * Il telefono come lo scrive una persona: «0523 456789», «+39 333 123 4567».
 * Si tolgono spazi, punti, trattini, barre e il prefisso +39/0039, poi si
 * contano le cifre: i numeri italiani vanno da 6 a 11 cifre, non sempre 10.
 */
export function normalizzaTelefonoNegozio(v: string): string {
  return v.replace(/[\s./()-]+/g, '').replace(/^(\+39|0039)/, '');
}
export function telefonoNegozioValido(v: string): boolean {
  return /^[0-9]{6,11}$/.test(normalizzaTelefonoNegozio(v));
}

export type VendorFormData = SchemaData & {
  storeAddress: string;
  storeLat: number;
  storeLng: number;
  storeLogo: string | null;
  storeDescription: string;
  storeMedia: StoreMediaItem[];
  storeHours: StoreHours;
  storeCustomization: StoreCustomization;
};

/**
 * `mode` decide quali gruppi di campi mostrare/validare (i campi nascosti
 * mantengono il valore di default e vengono ignorati dal salvataggio del chiamante):
 *  - 'branding': logo, copertina, nome, descrizione, personalizzazione vetrina.
 *  - 'contact':  telefono, indirizzo+mappa, orari di apertura.
 *  - 'all':      tutto (retro-compatibile).
 */
type VendorFormMode = 'all' | 'branding' | 'contact';

interface Props {
  onSubmit: (data: VendorFormData) => void;
  isLoading?: boolean;
  defaultValues?: Partial<VendorFormData>;
  mode?: VendorFormMode;
  /**
   * Un numero che cambia (e non è 0) quando il salvataggio è RIUSCITO: da quel momento i dati
   * in pagina sono quelli salvati e uscire non fa perdere niente. Se il salvataggio cade non
   * cambia, e l'avviso resta.
   */
  salvataggioRiuscito?: number;
  /** Dice a chi sta sopra se ci sono modifiche non salvate (per il suo tasto «indietro»). */
  onDirtyChange?: (dirty: boolean) => void;
}

const VendorForm = ({ onSubmit, isLoading = false, defaultValues, mode = 'all', salvataggioRiuscito = 0, onDirtyChange }: Props) => {
  const tStates = useTranslations('states');
  const tForms = useTranslations('forms');
  // Un identificativo generato: questo modulo puo' comparire piu' volte nella stessa pagina, e
  // due campi con lo stesso `id` fanno leggere al lettore di schermo sempre il primo.
  const idSlogan = useId();
  // R10-012 — Le etichette del logo e dei due gruppi della vetrina erano scollegate dal loro campo.
  const idLogo = useId();
  const idInEvidenza = useId();
  const idAnnuncio = useId();

  const showBranding = mode !== 'contact';
  const showContact = mode !== 'branding';

  // Validazione condizionale: i campi nascosti dal `mode` non vengono validati
  // (mantengono il default e non sono modificabili in quella schermata).
  const schema = useMemo(
    () =>
      z
        .object({ storeName: z.string(), storePhone: z.string() })
        .superRefine((d, ctx) => {
          if (showBranding && d.storeName.trim().length < 3) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['storeName'], message: 'Il nome deve essere di almeno 3 caratteri' });
          }
          // R16-008 — Lo stesso tetto della domanda d'iscrizione (modulo e rotta): da qui il nome si
          // cambiava senza limite, e un nome lunghissimo tornava nelle schede di home, negozi e «vicino a te».
          if (showBranding && d.storeName.trim().length > 80) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['storeName'], message: 'Il nome del negozio può avere al massimo 80 caratteri: accorcialo' });
          }
          if (showContact && !telefonoNegozioValido(d.storePhone)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['storePhone'], message: 'Scrivi il numero del negozio, es. 0523 456789' });
          }
        }),
    [showBranding, showContact],
  );

  const { register, handleSubmit, watch, formState: { errors } } = useForm<SchemaData>({
    resolver: zodResolver(schema),
    defaultValues: {
      storeName:  defaultValues?.storeName  ?? '',
      storePhone: defaultValues?.storePhone ?? '',
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
  const [logoUrl, setLogoUrl] = useState<string | null>(defaultValues?.storeLogo ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  // Mentre sale una foto della copertina l'invio aspetta: partirebbe senza quella foto.
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [media, setMedia] = useState<StoreMediaItem[]>(defaultValues?.storeMedia ?? []);
  const [description, setDescription] = useState<string>(defaultValues?.storeDescription ?? '');
  const [hours, setHours] = useState<StoreHours>(defaultValues?.storeHours ?? {});
  const [custom, setCustom] = useState<StoreCustomization>(defaultValues?.storeCustomization ?? {});
  const [customError, setCustomError] = useState<string | null>(null);
  // Gli errori dei campi social, uno per campo, e il contatore che apre la sezione «Social e contatti».
  const [erroriSocial, setErroriSocial] = useState<Partial<Record<string, string>>>({});
  const [apriSocial, setApriSocial] = useState(0);

  const storeName = watch('storeName');

  // Modifiche non salvate: l'istantanea di quello che il negoziante può cambiare, confrontata con
  // quella di quando la schermata si è aperta (o dell'ultimo salvataggio riuscito).
  const storePhone = watch('storePhone');
  const fotografia = (c: StoreCustomization) => JSON.stringify([
    storeName, storePhone, location.address.trim(), Number(location.lat).toFixed(5), Number(location.lng).toFixed(5),
    logoUrl, media, description, hours, c,
  ]);
  const istantanea = fotografia(custom);
  const [salvata, setSalvata] = useState(istantanea);
  // Finché il negoziante non ha fatto nulla nel modulo, quello che cambia da solo (il selettore della
  // mappa corregge il vecchio punto di Roma o le coordinate non valide appena si apre) è la
  // posizione di partenza, non una sua modifica: la fotografia di partenza lo assorbe.
  const primoGesto = useRef(false);
  const segnaGesto = () => { primoGesto.current = true; };
  useEffect(() => {
    if (!primoGesto.current) setSalvata(istantanea);
  }, [istantanea]);
  const dirty = primoGesto.current && istantanea !== salvata;
  // Quello che è partito con l'invio: a salvataggio riuscito la fotografia è questa, non quello che
  // il negoziante ha scritto mentre la risposta era in volo.
  const inviata = useRef<string | null>(null);
  // R07-007 — «Il resto è salvato» si dice quando il salvataggio è riuscito, non quando parte: se
  // fallisce, il negoziante non deve leggere quella frase accanto all'errore.
  const avvisoASalvataggioRiuscito = useRef<string | null>(null);
  useEffect(() => {
    if (salvataggioRiuscito > 0 && inviata.current !== null) setSalvata(inviata.current);
    if (salvataggioRiuscito > 0 && avvisoASalvataggioRiuscito.current !== null) {
      setCustomError(avvisoASalvataggioRiuscito.current);
      avvisoASalvataggioRiuscito.current = null;
    }
  }, [salvataggioRiuscito]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    // Chiusura, ricarica, indirizzo scritto a mano: lo chiede il browser.
    const alLasciare = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Next non lancia beforeunload per i link interni (il menu del pannello): li ferma questo.
    const alClic = (e: MouseEvent) => {
      if (clicDaFermare(e, true, window.location.pathname, (m) => window.confirm(m), mode === 'branding' ? 'alla vetrina' : 'al profilo')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', alLasciare);
    document.addEventListener('click', alClic, true);
    return () => {
      window.removeEventListener('beforeunload', alLasciare);
      document.removeEventListener('click', alClic, true);
    };
  }, [dirty, mode]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    // Il riquadro diceva «image/*» — SVG compreso — ma il deposito accetta solo sette tipi:
    // il logo del grafico partiva, saliva e veniva respinto alla fine. Adesso non parte.
    // R16-013 — E i sette tipi li detta il magazzino (`mappaAccept`): qui ne erano scritti tre a
    // mano, e il logo fotografato con l'iPhone (HEIC) restava fuori.
    accept: mappaAccept(),
    maxFiles: 1,
    // Il filtro qui sopra scarta, ma scartava in silenzio: chi trascinava una foto dell'iPhone
    // (HEIC) la vedeva sparire e non capiva se stesse caricando o no. Stesse parole di
    // StoreMediaManager, perche' il sito deve dire no in un modo solo.
    onDropRejected: (rifiutati) => {
      const troppi = rifiutati.some((r) => r.errors.some((e) => e.code === 'too-many-files'));
      toast.error(
        troppi
          ? 'Una foto alla volta: trascinane una sola.'
          : `Formato non accettato: servono foto in ${tipiScrittiPerUmani()}.`,
      );
    },
    onDrop: async (files) => {
      const scelta = files[0];
      if (!scelta) return;
      setUploadingLogo(true);
      try {
        // Un logo HEIC salvato com'e' su Chrome e Android resta un riquadro rotto: qui diventa
        // JPEG, o non parte (`lib/immagini/heic-in-jpeg.ts`).
        const file = await senzaHeic(scelta);
        if (!file) {
          toast.error(avvisoFotoHeic());
          return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');
        // Primo segmento = user.id: richiesto dalle RLS Storage del bucket `products`
        // (read/update/delete filtrano su (storage.foldername(name))[1] = auth.uid()).
        // upsert:false + path unico = nessun ON CONFLICT. Vedi seller/site/ImageUpload.tsx.
        const { publicUrl } = await caricaImmagine(supabase, {
          // Un HEIC trascinato da Windows arriva col tipo vuoto: senza il tipo giusto il deposito lo rifiuta.
          file: fileColTipoGiusto(file),
          userId: user.id,
          cartella: 'logos',
          cacheControl: ANNO_IN_SECONDI,
        });
        setLogoUrl(publicUrl);
        toast.success('Logo caricato');
      } catch (err) {
      toast.error(friendlyError(err));
    } finally {
        setUploadingLogo(false);
      }
    },
  });

  const handleFormSubmit = (data: SchemaData) => {
    if (showContact) {
      // Un orario sbagliato non si salva: quel giorno il negozio risulterebbe chiuso agli ordini.
      const erroreOrari = erroreDegliOrari(hours);
      if (erroreOrari) {
        toast.error(`Orari di apertura — ${erroreOrari}`);
        return;
      }
      if (!location.address.trim()) {
        setLocationError("Inserisci l'indirizzo del negozio");
        return;
      }
      const validCoords =
        Number.isFinite(location.lat) && Number.isFinite(location.lng) &&
        location.lat >= -90 && location.lat <= 90 &&
        location.lng >= -180 && location.lng <= 180;
      if (!validCoords) {
        setLocationError('Coordinate non valide. Cerca un indirizzo, usa la tua posizione, o sposta il pin sulla mappa.');
        return;
      }
      // L'indirizzo scritto non basta: senza «Cerca», GPS o un tocco sulla mappa le coordinate sono
      // il punto in cui si apre la mappa, e il negozio verrebbe salvato dove non è.
      if (!location.confermata) {
        setLocationError("Metti il negozio sulla mappa: premi «Cerca» accanto all'indirizzo, oppure tocca la mappa nel punto giusto. Senza la posizione, i clienti vicini non possono ordinarti la consegna.");
        return;
      }
    }
    let customData: StoreCustomization = custom;
    let socialNonSalvati = false;
    avvisoASalvataggioRiuscito.current = null;
    if (showBranding) {
      // Link incollati, @, sito senza https e WhatsApp senza +39 si correggono da soli.
      const corretta: StoreCustomization = { ...custom, socials: normalizzaSocials(custom.socials) };
      setCustom(corretta);
      const parsed = storeCustomizationSchema.safeParse(corretta);
      if (!parsed.success) {
        const sociali: Record<string, string> = {};
        let altro: string | null = null;
        for (const p of parsed.error.issues) {
          if (p.path[0] === 'socials' && typeof p.path[1] === 'string') sociali[p.path[1]] ??= p.message;
          else altro ??= p.message;
        }
        setErroriSocial(sociali);
        if (Object.keys(sociali).length > 0) setApriSocial((n) => n + 1);
        // L'errore sta sotto il campo giusto; il riepilogo in fondo nomina il campo e dice dove guardare.
        const primo = parsed.error.issues[0];
        const campo = primo ? campoDellErrore(primo.path) : null;
        // R10-010 — Un social sbagliato non ferma più nome, logo, descrizione e colore: quel social
        // resta com'era salvato, tutto il resto si salva, e l'errore resta sotto il suo campo.
        const salvati = (defaultValues?.storeCustomization?.socials ?? {}) as Record<string, string | undefined>;
        // R21-012 — Un valore GIA' salvato che il negoziante non ha toccato non blocca il resto, anche se le
        // regole di oggi lo rifiuterebbero (un sito salvato con «ftp://»): per il controllo si lascia vuoto,
        // poi si rimette com'era. Un valore NUOVO sbagliato resta rifiutato come prima.
        // R04-010 — Vale per ogni campo, non solo per il sito: un Instagram, Facebook o TikTok salvato che le
        // regole di oggi rifiutano bloccava nome, logo e colore finché non lo si correggeva.
        // R04-009 — Si confronta la forma corretta di tutti e due: dopo il primo «Salva» il campo mostra il
        // valore già corretto («https://…») e non è più uguale, lettera per lettera, a quello salvato.
        const salvatiCorretti = (normalizzaSocials(defaultValues?.storeCustomization?.socials) ?? {}) as Record<string, string | undefined>;
        const nonToccati = Object.keys(sociali).filter(
          (k) => !!salvati[k] && ((corretta.socials as Record<string, string | undefined> | undefined)?.[k] ?? '') === salvatiCorretti[k],
        );
        const conISocialDiPrima: StoreCustomization = {
          ...corretta,
          socials: {
            ...corretta.socials,
            ...Object.fromEntries(Object.keys(sociali).map((k) => [k, nonToccati.includes(k) ? '' : (salvati[k] ?? '')])),
          },
        };
        const riprova = altro === null ? storeCustomizationSchema.safeParse(conISocialDiPrima) : null;
        if (!riprova?.success) {
          setCustomError(
            campo ? `${campo}: ${primo.message}` : (altro ?? primo?.message ?? 'Personalizzazione non valida'),
          );
          return;
        }
        customData = nonToccati.length > 0
          ? { ...riprova.data, socials: { ...riprova.data.socials, ...Object.fromEntries(nonToccati.map((k) => [k, salvati[k]])) } }
          : riprova.data;
        const chiavi = Object.keys(sociali);
        const nomeDi = (k: string) => campoDellErrore(['socials', k]) ?? k;
        // Un campo che prima era vuoto non «resta com'era»: semplicemente non si salva.
        // Con due campi diversi (uno vuoto, uno già salvato) la frase si divide per gruppo.
        const vuoti = chiavi.filter((k) => !salvati[k]);
        const rimasti = chiavi.filter((k) => !!salvati[k] && !nonToccati.includes(k));
        const fraseVuoti = vuoti.length > 0
          ? `${vuoti.map(nomeDi).join(', ')} ${vuoti.length > 1 ? 'non si sono salvati' : 'non si è salvato'}`
          : '';
        const fraseRimasti = rimasti.length > 0
          ? `${rimasti.map(nomeDi).join(', ')} ${rimasti.length > 1 ? "sono rimasti com'erano" : "è rimasto com'era"}`
          : '';
        // R04-010 — Un valore già salvato che le regole di oggi rifiutano resta, ma il negoziante deve sapere
        // che così non va: «è rimasto com'era» da solo sembrava dire che era tutto a posto.
        const fraseDaCorreggere = nonToccati.length > 0
          ? `${nonToccati.map(nomeDi).join(', ')} ${nonToccati.length > 1 ? "sono rimasti com'erano ma vanno corretti" : "è rimasto com'era ma va corretto"}`
          : '';
        const cheFine = [fraseVuoti, fraseRimasti, fraseDaCorreggere].filter(Boolean).join(', ');
        socialNonSalvati = true;
        setCustomError(`${campo}: ${primo.message}`);
        avvisoASalvataggioRiuscito.current = `${campo}: ${primo.message} Il resto è salvato; ${cheFine}.`;
      } else {
        customData = parsed.data;
      }
    }
    if (!socialNonSalvati) {
      setCustomError(null);
      setErroriSocial({});
    }
    // Con un social non salvato la fotografia è quella salvata davvero: il modulo resta «da salvare».
    inviata.current = fotografia(
      socialNonSalvati ? customData : showBranding ? { ...custom, socials: normalizzaSocials(custom.socials) } : custom,
    );
    onSubmit({
      storeName: data.storeName,
      storePhone: normalizzaTelefonoNegozio(data.storePhone),
      storeAddress: location.address,
      storeLat: location.lat,
      storeLng: location.lng,
      storeLogo: logoUrl,
      storeMedia: media,
      storeDescription: description.trim(),
      storeHours: hours,
      storeCustomization: customData,
    });
  };

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      onInputCapture={segnaGesto}
      onChangeCapture={segnaGesto}
      onPointerDownCapture={segnaGesto}
      onKeyDownCapture={segnaGesto}
      onDropCapture={segnaGesto}
      className="space-y-5"
    >
      {showBranding && (
        <>
          {/* Logo upload */}
          <div>
            <label htmlFor={idLogo} className="block text-sm font-medium text-ink-700 mb-2">Logo del negozio</label>
            <div className="flex items-center gap-4">
              <StoreAvatar logoUrl={logoUrl} storeName={storeName || defaultValues?.storeName} size="lg" />
              <div
                {...getRootProps({ role: 'button', 'aria-label': 'Carica il logo del negozio: trascina il file o premi Invio' })}
                className={`flex-1 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors text-sm ${
                  isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
                } ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <input {...getInputProps({ id: idLogo, accept: acceptSenzaHeic(mappaAccept()), 'aria-label': 'Carica il logo del negozio' })} />
                {uploadingLogo ? (
                  <LoadingState variant="inline" />
                ) : logoUrl ? (
                  <p className="text-ink-600">
                    <span className="font-medium">Sostituisci</span> · trascina o clicca
                  </p>
                ) : (
                  <p className="text-ink-500">
                    <span className="font-medium text-primary-700">Carica</span> un'immagine quadrata ({tipiScrittiPerUmani()})
                  </p>
                )}
              </div>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl(null)}
                  className="text-sm text-ink-500 hover:text-secondary-600 underline"
                >
                  Rimuovi
                </button>
              )}
            </div>
          </div>

          {/* Cover media gallery */}
          <StoreMediaManager value={media} onChange={setMedia} onUploadingChange={setUploadingMedia} />

          <Input
            label="Nome del negozio"
            {...register('storeName')}
            type="text"
            placeholder="Es. Panificio Rossi"
            error={typeof errors.storeName?.message === 'string' ? errors.storeName.message : undefined}
          />

          <Textarea
            label="Descrizione (opzionale)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Cosa rende speciale il tuo negozio? Storia, tradizione, prodotti tipici…"
            className="resize-none"
          />
        </>
      )}

      {showContact && (
        <>
          <Input
            label="Telefono"
            {...register('storePhone')}
            type="text"
            inputMode="tel"
            placeholder="Es. 0523 456789"
            error={typeof errors.storePhone?.message === 'string' ? errors.storePhone.message : undefined}
          />

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
          {/* Era red-500: un terzo colore per «hai sbagliato questo campo», mentre la primitiva
              Field usa secondary-600 in tutto il resto del sito. */}
          {locationError && <p role="alert" className="text-sm font-medium text-secondary-600">{locationError}</p>}

          <CustomizationSection title="Orari di apertura" description="Quando i clienti ti trovano aperto" icon={<Clock size={18} />} defaultOpen>
            <StoreHoursEditor value={hours} onChange={setHours} />
          </CustomizationSection>
        </>
      )}

      {showBranding && (
        <div className="space-y-3 pt-2">
          <h3 className="text-sm font-semibold text-ink-900">Personalizza la tua vetrina</h3>

          <CustomizationSection
            title="Aspetto della vetrina"
            description="Colore, sfondo cover e slogan"
            icon={<Palette size={18} />}
            defaultOpen
          >
            <AccentPicker
              value={custom.theme?.accent}
              onChange={(hex) => setCustom({ ...custom, theme: { ...custom.theme, accent: hex } })}
            />
            <CoverPicker
              value={custom.theme?.coverStyle}
              onChange={(key) => setCustom({ ...custom, theme: { ...custom.theme, coverStyle: key } })}
            />
            <div>
              <label htmlFor={idSlogan} className="block text-sm font-medium text-ink-700 mb-1">Slogan (opzionale)</label>
              <input
                id={idSlogan}
                type="text"
                value={custom.tagline ?? ''}
                aria-invalid={sopraIlTetto(custom.tagline, MAX_TAGLINE) ? true : undefined}
                aria-describedby={sopraIlTetto(custom.tagline, MAX_TAGLINE) ? `${idSlogan}-errore` : undefined}
                onChange={(e) => setCustom({ ...custom, tagline: e.target.value })}
                placeholder="Es. Pane fresco tutti i giorni dal 1962"
                className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700 text-sm"
              />
              {sopraIlTetto(custom.tagline, MAX_TAGLINE) && (
                <p id={`${idSlogan}-errore`} role="alert" className="text-xs font-medium text-secondary-600 mt-1">
                  {sopraIlTetto(custom.tagline, MAX_TAGLINE)}
                </p>
              )}
            </div>
          </CustomizationSection>

          <CustomizationSection
            title="Social e contatti"
            description="Instagram, Facebook, TikTok, WhatsApp, sito"
            icon={<Share2 size={18} />}
            apriQuando={apriSocial}
          >
            <SocialLinksFields
              value={custom.socials}
              errori={erroriSocial}
              onChange={(next) => {
                // Si toglie solo l'errore del campo che si sta correggendo, non quelli degli altri.
                setErroriSocial((prima) => {
                  const resto = { ...prima };
                  for (const k of Object.keys(resto)) {
                    if ((next as Record<string, string | undefined>)[k] !== (custom.socials as Record<string, string | undefined> | undefined)?.[k]) delete resto[k];
                  }
                  return resto;
                });
                setCustom({ ...custom, socials: next });
              }}
            />
          </CustomizationSection>

          <CustomizationSection title="Vetrina prodotti" description="Prodotti in evidenza, annuncio e badge" icon={<Store size={18} />}>
            <div role="group" aria-labelledby={idInEvidenza}>
              <p id={idInEvidenza} className="block text-sm font-medium text-ink-700 mb-2">Prodotti in evidenza</p>
              <FeaturedProductsPicker
                value={custom.featuredProductIds}
                onChange={(next) => setCustom({ ...custom, featuredProductIds: next })}
              />
            </div>
            <div role="group" aria-labelledby={idAnnuncio} className="border-t border-cream-200 pt-4">
              <p id={idAnnuncio} className="block text-sm font-medium text-ink-700 mb-2">Banner annuncio</p>
              <AnnouncementEditor value={custom.announcement} onChange={(next) => setCustom({ ...custom, announcement: next })} />
            </div>
            <div className="border-t border-cream-200 pt-4">
              <BadgePicker value={custom.badges} onChange={(next) => setCustom({ ...custom, badges: next })} />
            </div>
          </CustomizationSection>

          {customError && <p role="alert" className="text-sm font-medium text-secondary-600">{customError}</p>}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || uploadingLogo || uploadingMedia}
        className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition-colors shadow-warm-sm"
      >
        {isLoading ? tStates('saving') : tForms('saveStore')}
      </button>
    </form>
  );
};

export default VendorForm;
