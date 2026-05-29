'use client';

import { useState } from 'react';
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
import { friendlyError } from '@/lib/errors';
import type { StoreHours } from '@/lib/store-hours';
import { storeCustomizationSchema, type StoreCustomization } from '@/lib/store-customization';
import { zodFieldErrors } from '@/lib/zod-field-errors';
import CustomizationSection from './seller/CustomizationSection';
import AccentPicker from './seller/AccentPicker';
import CoverPicker from './seller/CoverPicker';
import SocialLinksFields from './seller/SocialLinksFields';
import AnnouncementEditor from './seller/AnnouncementEditor';
import BadgePicker from './seller/BadgePicker';
import StoreHoursEditor from './seller/StoreHoursEditor';
import FeaturedProductsPicker from './seller/FeaturedProductsPicker';

const VendorSchema = z.object({
  storeName:  z.string().min(3, 'Il nome deve essere di almeno 3 caratteri'),
  storePhone: z.string().length(10, 'Il numero di telefono deve essere di 10 cifre'),
});

type SchemaData = z.infer<typeof VendorSchema>;

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

interface Props {
  onSubmit: (data: VendorFormData) => void;
  isLoading?: boolean;
  defaultValues?: Partial<VendorFormData>;
}

const VendorForm = ({ onSubmit, isLoading = false, defaultValues }: Props) => {
  const tStates = useTranslations('states');
  const tForms = useTranslations('forms');
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SchemaData>({
    resolver: zodResolver(VendorSchema),
    defaultValues: {
      storeName:  defaultValues?.storeName  ?? '',
      storePhone: defaultValues?.storePhone ?? '',
    },
  });

  const [location, setLocation] = useState<StoreLocation>({
    address: defaultValues?.storeAddress ?? '',
    lat:     defaultValues?.storeLat     ?? 41.9028,
    lng:     defaultValues?.storeLng     ?? 12.4964,
  });
  const [locationError, setLocationError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(defaultValues?.storeLogo ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [media, setMedia] = useState<StoreMediaItem[]>(defaultValues?.storeMedia ?? []);
  const [description, setDescription] = useState<string>(defaultValues?.storeDescription ?? '');
  const [hours, setHours] = useState<StoreHours>(defaultValues?.storeHours ?? {});
  const [custom, setCustom] = useState<StoreCustomization>(defaultValues?.storeCustomization ?? {});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ aspetto: true });

  // Mappa un path di errore zod alla sezione dell'editor che lo contiene.
  const sectionOf = (p: string): 'aspetto' | 'social' | 'vetrina' =>
    p.startsWith('socials')
      ? 'social'
      : p.startsWith('announcement') || p.startsWith('featuredProductIds') || p.startsWith('badges')
        ? 'vetrina'
        : 'aspetto';
  const sectionHasError = (sec: string) => Object.keys(customErrors).some((p) => sectionOf(p) === sec);
  const setSection = (key: string, open: boolean) =>
    setOpenSections((s) => (s[key] === open ? s : { ...s, [key]: open }));
  const clearErrors = (prefix: string) =>
    setCustomErrors((e) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [k, v] of Object.entries(e)) {
        if (k === prefix || k.startsWith(`${prefix}.`)) changed = true;
        else next[k] = v;
      }
      return changed ? next : e;
    });

  const storeName = watch('storeName');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    maxFiles: 1,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setUploadingLogo(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');
        const ext = file.name.split('.').pop() ?? 'png';
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

  const handleFormSubmit = (data: SchemaData) => {
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
    const parsed = storeCustomizationSchema.safeParse(custom);
    if (!parsed.success) {
      const map = zodFieldErrors(parsed.error);
      setCustomErrors(map);
      // Apri le sezioni con errori e porta l'utente al primo errore.
      const secs = Array.from(new Set(Object.keys(map).map(sectionOf)));
      setOpenSections((s) => {
        const next = { ...s };
        secs.forEach((k) => { next[k] = true; });
        return next;
      });
      if (secs[0]) {
        setTimeout(() => {
          document
            .getElementById(`vetrina-sec-${secs[0]}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
      return;
    }
    setCustomErrors({});
    onSubmit({
      ...data,
      storeAddress: location.address,
      storeLat: location.lat,
      storeLng: location.lng,
      storeLogo: logoUrl,
      storeMedia: media,
      storeDescription: description.trim(),
      storeHours: hours,
      storeCustomization: parsed.data,
    });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      {/* Logo upload */}
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-2">Logo del negozio</label>
        <div className="flex items-center gap-4">
          <StoreAvatar logoUrl={logoUrl} storeName={storeName || defaultValues?.storeName} size="lg" />
          <div
            {...getRootProps()}
            className={`flex-1 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors text-sm ${
              isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
            } ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input {...getInputProps()} />
            {uploadingLogo ? (
              <LoadingState variant="inline" />
            ) : logoUrl ? (
              <p className="text-ink-600">
                <span className="font-medium">Sostituisci</span> · trascina o clicca
              </p>
            ) : (
              <p className="text-ink-500">
                <span className="font-medium text-primary-700">Carica</span> un'immagine quadrata (PNG, JPG)
              </p>
            )}
          </div>
          {logoUrl && (
            <button
              type="button"
              onClick={() => setLogoUrl(null)}
              className="text-sm text-ink-500 hover:text-red-600 underline"
            >
              Rimuovi
            </button>
          )}
        </div>
      </div>

      {/* Cover media gallery */}
      <StoreMediaManager value={media} onChange={setMedia} />

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Nome del negozio</label>
        <input
          {...register('storeName')}
          type="text"
          placeholder="Es. Panificio Rossi"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        {errors.storeName && <p className="text-red-500 text-sm mt-1">{errors.storeName.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Descrizione (opzionale)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Cosa rende speciale il tuo negozio? Storia, tradizione, prodotti tipici…"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Telefono</label>
        <input
          {...register('storePhone')}
          type="text"
          placeholder="3331234567 (10 cifre)"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        {errors.storePhone && <p className="text-red-500 text-sm mt-1">{errors.storePhone.message}</p>}
      </div>

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
      {locationError && <p className="text-red-500 text-sm">{locationError}</p>}

      {/* ===== Personalizzazione vetrina ===== */}
      <div className="space-y-3 pt-2">
        <h3 className="text-sm font-semibold text-ink-900">Personalizza la tua vetrina</h3>

        <CustomizationSection
          id="vetrina-sec-aspetto"
          title="Aspetto della vetrina"
          description="Colore, sfondo cover e slogan"
          icon={<Palette size={18} />}
          open={openSections.aspetto ?? false}
          onToggle={(o) => setSection('aspetto', o)}
          hasError={sectionHasError('aspetto')}
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
            <label className="block text-sm font-medium text-ink-700 mb-1">Slogan (opzionale)</label>
            <input
              type="text"
              value={custom.tagline ?? ''}
              maxLength={80}
              onChange={(e) => { setCustom({ ...custom, tagline: e.target.value }); clearErrors('tagline'); }}
              placeholder="Es. Pane fresco tutti i giorni dal 1962"
              aria-invalid={customErrors['tagline'] ? true : undefined}
              className={`w-full border p-2 rounded focus:outline-none focus:ring-2 text-sm ${
                customErrors['tagline'] ? 'border-red-400 focus:ring-red-300' : 'focus:ring-primary-400'
              }`}
            />
            {customErrors['tagline'] && <p className="text-red-500 text-xs mt-1">Slogan: {customErrors['tagline']}</p>}
          </div>
        </CustomizationSection>

        <CustomizationSection
          id="vetrina-sec-social"
          title="Social e contatti"
          description="Instagram, Facebook, TikTok, WhatsApp, sito"
          icon={<Share2 size={18} />}
          open={openSections.social ?? false}
          onToggle={(o) => setSection('social', o)}
          hasError={sectionHasError('social')}
        >
          <SocialLinksFields
            value={custom.socials}
            onChange={(next) => { setCustom({ ...custom, socials: next }); clearErrors('socials'); }}
            errors={{
              instagram: customErrors['socials.instagram'],
              facebook: customErrors['socials.facebook'],
              tiktok: customErrors['socials.tiktok'],
              whatsapp: customErrors['socials.whatsapp'],
              website: customErrors['socials.website'],
            }}
          />
        </CustomizationSection>

        <CustomizationSection
          id="vetrina-sec-orari"
          title="Orari di apertura"
          description="Quando i clienti ti trovano aperto"
          icon={<Clock size={18} />}
          open={openSections.orari ?? false}
          onToggle={(o) => setSection('orari', o)}
        >
          <StoreHoursEditor value={hours} onChange={setHours} />
        </CustomizationSection>

        <CustomizationSection
          id="vetrina-sec-vetrina"
          title="Vetrina prodotti"
          description="Prodotti in evidenza, annuncio e badge"
          icon={<Store size={18} />}
          open={openSections.vetrina ?? false}
          onToggle={(o) => setSection('vetrina', o)}
          hasError={sectionHasError('vetrina')}
        >
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-2">Prodotti in evidenza</label>
            <FeaturedProductsPicker
              value={custom.featuredProductIds}
              onChange={(next) => setCustom({ ...custom, featuredProductIds: next })}
            />
          </div>
          <div className="border-t border-cream-200 pt-4">
            <label className="block text-sm font-medium text-ink-700 mb-2">Banner annuncio</label>
            <AnnouncementEditor
              value={custom.announcement}
              onChange={(next) => { setCustom({ ...custom, announcement: next }); clearErrors('announcement'); }}
            />
            {(customErrors['announcement.text'] || customErrors['announcement.until']) && (
              <p className="text-red-500 text-xs mt-1">
                Annuncio: {customErrors['announcement.text'] || customErrors['announcement.until']}
              </p>
            )}
          </div>
          <div className="border-t border-cream-200 pt-4">
            <BadgePicker value={custom.badges} onChange={(next) => setCustom({ ...custom, badges: next })} />
          </div>
        </CustomizationSection>

        {Object.keys(customErrors).length > 0 && (
          <p className="text-red-500 text-sm">Controlla i campi evidenziati in rosso qui sopra e salva di nuovo.</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || uploadingLogo}
        className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition-colors shadow-warm-sm"
      >
        {isLoading ? tStates('saving') : tForms('saveStore')}
      </button>
    </form>
  );
};

export default VendorForm;
