'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Eye, Image as ImageIcon, ScanLine, Trash2, Save, FileText, Zap } from 'lucide-react';
import PhotoFillButton, { ExtractedProduct } from '@/components/seller/PhotoFillButton';
import ProductChatAssistant, {
  type ProductChatSnapshot,
  type ProductEditPatch,
} from '@/components/seller/ProductChatAssistant';
import ProductImagesField from '@/components/seller/ProductImagesField';
import AttributesFields from '@/components/seller/AttributesFields';
import BarcodeScanner from '@/components/seller/BarcodeScanner';
import AIDescriptionButton from '@/components/AIDescriptionButton';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field';
import { getAttributesForCategory } from '@/lib/category-attributes';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { uploadProductImages } from '@/lib/products/uploadImages';
import { useFormAutosave } from '@/lib/hooks/useFormAutosave';
import {
  createProductSchema,
  buildProductPayload,
  normalizeCondition,
  UNIT_OPTIONS,
  UNIT_SUFFIX,
  CONDITION_LABELS,
  PRODUCT_CONDITIONS,
  PRODUCT_UNITS,
  type ProductUnit,
  type ProductCondition,
  type ProductFormValues,
} from '@/lib/products/schema';
import {
  type ExpressMode,
  expressEnabledToMode,
  modeToExpressEnabled,
} from '@/lib/products/express';
import {
  type ProductVariant,
  totalVariantStock,
  reconcileVariants,
  deriveOptionGroups,
} from '@/lib/products/variants';

type Category = { id: string; name: string; slug: string; parent_id: string | null };

export interface ProductInitialValues {
  name?: string;
  description?: string;
  price?: number | string;
  compareAtPrice?: number | string | null;
  unit?: ProductUnit | null;
  condition?: ProductCondition | null;
  stock?: number | null;
  category_id?: string | null;
  images?: string[];
  attributes?: Record<string, unknown>;
  tags?: string[];
  expressEnabled?: boolean | null;
  status?: string;
  variants?: ProductVariant[];
}

export type ProductPayload = ReturnType<typeof buildProductPayload>;

interface ProductFormProps {
  mode: 'create' | 'edit';
  categories: Category[];
  initialValues?: ProductInitialValues;
  submitting?: boolean;
  onSubmit: (
    payload: ProductPayload,
    ctx: { intent: 'publish' | 'draft' | 'save'; variants: ProductVariant[] },
  ) => void;
  onDelete?: () => void;
  deleting?: boolean;
  productId?: string;
  sellerOffersExpress?: boolean;
  /** create: chiave localStorage per l'autosalvataggio della bozza. */
  autosaveKey?: string;
}

// Mappa le chiavi attributo generiche estratte dall'AI sui key per-categoria.
const AI_ATTR_TO_FIELD: Record<string, string> = {
  marca: 'marca', modello: 'modello', colore: 'colore', taglia: 'taglia',
  materiale: 'materiale', peso: 'peso', dimensioni: 'dimensioni',
  origine: 'origine', allergeni: 'allergeni', ingredienti: 'ingredienti',
  scadenza: 'scadenza', ean: 'ean', autore: 'autore', editore: 'editore',
  anno: 'anno', pagine: 'pagine', lingua: 'lingua', isbn: 'isbn', formato: 'formato',
};

export default function ProductForm({
  mode,
  categories,
  initialValues,
  submitting = false,
  onSubmit,
  onDelete,
  deleting = false,
  productId,
  sellerOffersExpress = false,
  autosaveKey,
}: ProductFormProps) {
  const schema = useMemo(
    () => createProductSchema({ minDescription: mode === 'create' ? 30 : 10 }),
    [mode],
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initialValues?.name ?? '',
      description: initialValues?.description ?? '',
      price: (initialValues?.price as number | undefined) ?? undefined,
      compareAtPrice: (initialValues?.compareAtPrice as number | undefined) ?? undefined,
      stock: initialValues?.stock === null ? undefined : (initialValues?.stock ?? 1),
      category_id: initialValues?.category_id ?? '',
    },
  });

  // Campi "ricchi" come stato del componente (pattern già usato per immagini/attributi).
  const [imageUrls, setImageUrls] = useState<string[]>(initialValues?.images ?? []);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attributes, setAttributes] = useState<Record<string, unknown>>(initialValues?.attributes ?? {});
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [unit, setUnit] = useState<ProductUnit>((initialValues?.unit as ProductUnit) ?? 'pezzo');
  const [condition, setCondition] = useState<ProductCondition | ''>((initialValues?.condition as ProductCondition) ?? '');
  const [unlimitedStock, setUnlimitedStock] = useState<boolean>(initialValues?.stock === null);
  const [expressMode, setExpressMode] = useState<ExpressMode>(expressEnabledToMode(initialValues?.expressEnabled));
  const [status, setStatus] = useState<string>(initialValues?.status ?? 'available');
  const [variants, setVariants] = useState<ProductVariant[]>(initialValues?.variants ?? []);
  // Assi di variante attivi (chiave campo → valori). Ricostruiti dalle varianti
  // esistenti in modifica; in creazione partono vuoti.
  const [variantAxes, setVariantAxes] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(deriveOptionGroups(initialValues?.variants ?? []).map((g) => [g.name, g.values])),
  );
  const [scanOpen, setScanOpen] = useState(false);
  const hasVariants = variants.length > 0;

  // ---- Categoria a due livelli (il DB ha già parent_id) ---------------------
  const currentCategoryId = watch('category_id') || '';
  const topCategories = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const resolveTop = (catId: string): string => {
    let cur = categories.find((c) => c.id === catId);
    while (cur?.parent_id) {
      const parent = categories.find((c) => c.id === cur!.parent_id);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? '';
  };
  const currentTopId = currentCategoryId ? resolveTop(currentCategoryId) : '';
  const subcategories = useMemo(
    () => (currentTopId ? categories.filter((c) => c.parent_id === currentTopId) : []),
    [categories, currentTopId],
  );
  const topName = categories.find((c) => c.id === currentTopId)?.name;

  const { fields: attrFields, topSlug } = getAttributesForCategory(categories, currentCategoryId);
  const topCategoryLabel = topSlug ? categories.find((c) => c.slug === topSlug)?.name : undefined;
  const hasEanField = attrFields.some((f) => f.key === 'ean');

  const setAttribute = (key: string, value: unknown) => {
    setAttributes((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '' || value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  // ---- Varianti (assi inline dentro le caratteristiche) ---------------------
  // Rigenera le combinazioni dagli assi, preservando lo stock già inserito.
  const applyAxes = (next: Record<string, string[]>) => {
    setVariantAxes(next);
    const order = attrFields.map((f) => f.key);
    const types = Object.entries(next)
      .filter(([, vals]) => vals.length > 0)
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([name, values]) => ({ name, values }));
    setVariants((cur) => reconcileVariants(types, cur));
  };
  const toggleVariantAxis = (key: string, on: boolean) => {
    const next = { ...variantAxes };
    if (on) {
      next[key] = next[key] ?? [];
      setAttribute(key, ''); // la caratteristica ora varia per variante
    } else {
      delete next[key];
    }
    applyAxes(next);
  };
  const setAxisValues = (key: string, values: string[]) => applyAxes({ ...variantAxes, [key]: values });
  const setVariantStock = (idx: number, stock: number) =>
    setVariants((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, stock: Math.max(0, Math.trunc(stock || 0)) } : v)),
    );

  // ---- Autosave (solo creazione) -------------------------------------------
  const watched = watch();
  const snapshot = useMemo(
    () => ({ ...watched, imageUrls, attributes, tags, unit, condition, expressMode, unlimitedStock }),
    [watched, imageUrls, attributes, tags, unit, condition, expressMode, unlimitedStock],
  );
  useFormAutosave(autosaveKey ?? 'mc_product_unused', snapshot, {
    enabled: mode === 'create' && !!autosaveKey,
  });

  // ---- Foto AI → immagini prodotto -----------------------------------------
  const handlePhotoImages = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = await uploadProductImages(files);
      if (urls.length) {
        setImageUrls((prev) => [...prev, ...urls]);
        setImageError(null);
        toast.success('Foto aggiunte al prodotto');
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setUploading(false);
    }
  };

  const handleExtracted = (data: ExtractedProduct) => {
    if (data.name) setValue('name', data.name, { shouldValidate: true });
    if (data.description) setValue('description', data.description, { shouldValidate: true });
    if (data.suggested_price && data.suggested_price > 0) {
      setValue('price', data.suggested_price as unknown as number, { shouldValidate: true });
    }
    // Se l'AI ha riconosciuto una sottocategoria figlia, selezionala: resolveTop
    // ricava da sola la categoria di primo livello. Altrimenti resta sul top.
    const resolvedCategory = data.subcategory_id ?? data.category_id;
    if (resolvedCategory) setValue('category_id', resolvedCategory, { shouldValidate: true });
    // Tag/parole chiave suggeriti: uniti ai correnti, dedupe, max 15.
    if (Array.isArray(data.tags) && data.tags.length > 0) {
      setTags((prev) => {
        const next = [...prev];
        for (const raw of data.tags!) {
          const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
          if (t && !next.includes(t) && next.length < 15) next.push(t);
        }
        return next;
      });
    }
    if (data.attributes) {
      const cond = data.attributes['condizione'];
      if (typeof cond === 'string') {
        const norm = normalizeCondition(cond);
        if (norm) setCondition(norm);
      }
      if (data.category_id) {
        const { fields } = getAttributesForCategory(categories, data.category_id);
        for (const [aiKey, rawValue] of Object.entries(data.attributes)) {
          if (aiKey === 'condizione') continue; // ora è campo di primo livello
          const value = typeof rawValue === 'string' ? rawValue.trim() : '';
          if (!value) continue;
          const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
          const field = fields.find((f) => f.key === targetKey);
          if (!field) continue;
          if (field.type === 'select' && !(field.options ?? []).includes(value)) continue;
          setAttribute(targetKey, value);
        }
      }
    }
    if (data.alt_text) setAttribute('alt_text', data.alt_text);
  };

  // ---- Assistente AI in chat ------------------------------------------------
  // Snapshot dei campi correnti (DATO inviato al modello).
  const chatSnapshot: ProductChatSnapshot = {
    name: watch('name') ?? '',
    description: watch('description') ?? '',
    price: Number(watch('price')) || null,
    compareAtPrice: Number(watch('compareAtPrice')) || null,
    unit,
    condition,
    stock: unlimitedStock ? null : Number(watch('stock')) || null,
    unlimitedStock,
    categorySlug: categories.find((c) => c.id === currentTopId)?.slug ?? null,
    subcategoryName:
      currentCategoryId && currentCategoryId !== currentTopId
        ? categories.find((c) => c.id === currentCategoryId)?.name ?? null
        : null,
    tags,
    attributes,
    status,
  };

  // Risolve slug categoria (+ nome sottocategoria) → category_id, riusando la
  // logica a due livelli del form. Ritorna '' se lo slug non esiste.
  const resolveCategoryId = (slug: string, subName?: string): string => {
    const top = categories.find((c) => !c.parent_id && c.slug === slug);
    if (!top) return '';
    if (subName) {
      const norm = subName.trim().toLowerCase();
      const sub = categories.find(
        (c) => c.parent_id === top.id && c.name.toLowerCase() === norm,
      );
      if (sub) return sub.id;
    }
    return top.id;
  };

  // Applica un patch dell'AI allo stato del form. Ritorna le etichette dei
  // campi modificati (per il feedback in chat). Stesse regole di handleExtracted.
  const applyPatch = (patch: ProductEditPatch): string[] => {
    const changed: string[] = [];

    if (typeof patch.name === 'string' && patch.name.trim()) {
      setValue('name', patch.name.trim(), { shouldValidate: true });
      changed.push('nome');
    }
    if (typeof patch.description === 'string' && patch.description.trim()) {
      setValue('description', patch.description.trim(), { shouldValidate: true });
      changed.push('descrizione');
    }
    if (typeof patch.price === 'number' && patch.price > 0) {
      setValue('price', patch.price as unknown as number, { shouldValidate: true });
      changed.push('prezzo');
    }
    if ('compare_at_price' in patch) {
      if (patch.compare_at_price == null) {
        setValue('compareAtPrice', undefined as unknown as number, { shouldValidate: true });
      } else if (typeof patch.compare_at_price === 'number' && patch.compare_at_price > 0) {
        setValue('compareAtPrice', patch.compare_at_price as unknown as number, { shouldValidate: true });
      }
      changed.push('prezzo pieno');
    }
    if (patch.unit && (PRODUCT_UNITS as readonly string[]).includes(patch.unit)) {
      setUnit(patch.unit as ProductUnit);
      changed.push('unità');
    }
    if ('condition' in patch) {
      if (patch.condition == null) setCondition('');
      else setCondition(normalizeCondition(String(patch.condition)));
      changed.push('condizione');
    }
    if (patch.unlimited_stock === true) {
      setUnlimitedStock(true);
      changed.push('disponibilità');
    } else if (typeof patch.stock === 'number' && patch.stock >= 0) {
      setUnlimitedStock(false);
      setValue('stock', Math.trunc(patch.stock) as unknown as number, { shouldValidate: true });
      changed.push('disponibilità');
    }

    // Categoria → risolvi slug/sottocategoria su category_id.
    let effectiveCategoryId = currentCategoryId;
    if (patch.category_slug) {
      const resolved = resolveCategoryId(patch.category_slug, patch.subcategory_name);
      if (resolved) {
        setValue('category_id', resolved, { shouldValidate: true });
        effectiveCategoryId = resolved;
        changed.push('categoria');
      }
    }

    if (Array.isArray(patch.tags)) {
      const next: string[] = [];
      for (const raw of patch.tags) {
        const t = String(raw).trim().toLowerCase().replace(/,+$/, '');
        if (t && !next.includes(t) && next.length < 15) next.push(t);
      }
      setTags(next);
      changed.push('tag');
    }

    // Attributi: valida contro i campi della categoria EFFETTIVA (post-cambio).
    if (patch.attributes && typeof patch.attributes === 'object') {
      const { fields } = getAttributesForCategory(categories, effectiveCategoryId);
      for (const [aiKey, rawValue] of Object.entries(patch.attributes)) {
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!value) continue;
        const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
        const field = fields.find((f) => f.key === targetKey);
        if (!field) continue;
        if (field.type === 'select' && !(field.options ?? []).includes(value)) continue;
        setAttribute(targetKey, value);
        changed.push(field.label);
      }
    }
    if (Array.isArray(patch.attributes_remove)) {
      for (const key of patch.attributes_remove) {
        const targetKey = AI_ATTR_TO_FIELD[key] ?? key;
        setAttribute(targetKey, '');
        changed.push(`rimosso ${targetKey}`);
      }
    }

    if (mode === 'edit' && patch.status && ['available', 'draft', 'sold'].includes(patch.status)) {
      setStatus(patch.status);
      changed.push('stato');
    }

    return changed;
  };

  // ---- Tag ------------------------------------------------------------------
  const addTag = (raw: string) => {
    const t = raw.trim().replace(/,+$/, '').toLowerCase();
    if (!t) return;
    if (tags.includes(t)) { setTagInput(''); return; }
    if (tags.length >= 15) { toast('Massimo 15 tag'); return; }
    setTags([...tags, t]);
    setTagInput('');
  };

  // ---- Submit ---------------------------------------------------------------
  const makeSubmit = (intent: 'publish' | 'draft' | 'save') =>
    handleSubmit((values) => {
      if (imageUrls.length === 0) {
        setImageError('Aggiungi almeno una foto: senza immagini il prodotto non vende.');
        document.getElementById('image-dropzone')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const finalStatus = mode === 'create' ? (intent === 'draft' ? 'draft' : 'available') : status;
      const payload = buildProductPayload({
        values,
        imageUrls,
        attributes,
        unit,
        condition,
        tags,
        expressEnabled: modeToExpressEnabled(expressMode),
        // Con varianti lo stock prodotto è la SOMMA delle varianti (e mai illimitato):
        // viene comunque riallineato dal trigger DB dopo l'insert delle varianti.
        unlimitedStock: hasVariants ? false : unlimitedStock,
        status: finalStatus,
      });
      if (hasVariants) payload.stock = totalVariantStock(variants);
      onSubmit(payload, { intent, variants });
    });

  // ---- Anteprima prezzo -----------------------------------------------------
  const priceNum = Number(watch('price')) || 0;
  const cmpNum = Number(watch('compareAtPrice')) || 0;
  const hasDiscount = cmpNum > priceNum && priceNum > 0;
  const discountPct = hasDiscount ? Math.round((1 - priceNum / cmpNum) * 100) : 0;

  const busy = submitting || uploading;
  const primaryIntent: 'publish' | 'save' = mode === 'create' ? 'publish' : 'save';

  return (
    <div className="space-y-6">
      <PhotoFillButton onFilled={handleExtracted} onImages={(files) => void handlePhotoImages(files)} />

      <ProductChatAssistant
        product={chatSnapshot}
        attributeSchema={attrFields}
        topCategories={topCategories.map((c) => ({ name: c.name, slug: c.slug }))}
        imageUrls={imageUrls}
        onApplyPatch={applyPatch}
      />

      <form onSubmit={makeSubmit(primaryIntent)} className="bg-white border rounded-lg p-6 space-y-4">
        <Input
          label="Nome prodotto"
          {...register('name')}
          placeholder="Es. Pomodori biologici"
          error={typeof errors.name?.message === 'string' ? errors.name.message : undefined}
        />

        <Textarea
          label="Descrizione"
          labelAction={
            <AIDescriptionButton
              productName={watch('name') ?? ''}
              categoryName={categories.find((c) => c.id === currentCategoryId)?.name}
              currentText={watch('description') ?? ''}
              onResult={(text) => setValue('description', text, { shouldValidate: true })}
            />
          }
          {...register('description')}
          rows={4}
          placeholder="Cosa è, materiali, dimensioni/taglia, condizione, cosa lo rende speciale…"
          error={typeof errors.description?.message === 'string' ? errors.description.message : undefined}
        />

        {/* Prezzo + unità + prezzo pieno barrato */}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Prezzo (€)"
            type="number"
            step="0.01"
            inputMode="decimal"
            {...register('price')}
            error={typeof errors.price?.message === 'string' ? errors.price.message : undefined}
          />
          <Select label="Unità" value={unit} onChange={(e) => setUnit(e.target.value as ProductUnit)}>
            {UNIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Prezzo pieno (barrato)"
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="Opzionale"
            hint="Mostra lo sconto rispetto a questo prezzo"
            {...register('compareAtPrice')}
            error={typeof errors.compareAtPrice?.message === 'string' ? errors.compareAtPrice.message : undefined}
          />
          <Select label="Condizione" value={condition} onChange={(e) => setCondition(e.target.value as ProductCondition | '')}>
            <option value="">— non specificata</option>
            {PRODUCT_CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </Select>
        </div>

        {/* Disponibilità + illimitato — nascosto quando ci sono varianti
            (la disponibilità è gestita per variante, vedi sotto). */}
        {hasVariants ? (
          <p className="rounded-lg bg-cream-50 px-3 py-2.5 text-sm text-ink-600">
            Disponibilità gestita per variante (totale: <strong>{totalVariantStock(variants)} pezzi</strong>).
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 items-start">
            <Input
              label="Disponibilità (pezzi)"
              type="number"
              inputMode="numeric"
              disabled={unlimitedStock}
              {...register('stock')}
              error={typeof errors.stock?.message === 'string' ? errors.stock.message : undefined}
            />
            <div className="pt-7">
              <Checkbox
                label="Disponibilità illimitata"
                checked={unlimitedStock}
                onChange={(e) => setUnlimitedStock(e.target.checked)}
              />
            </div>
          </div>
        )}

        {/* Categoria + sottocategoria (a due livelli) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Categoria"
            value={currentTopId}
            onChange={(e) => setValue('category_id', e.target.value, { shouldValidate: true })}
            error={typeof errors.category_id?.message === 'string' ? errors.category_id.message : undefined}
          >
            <option value="">Seleziona...</option>
            {topCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          {currentTopId && subcategories.length > 0 && (
            <Select
              label="Sottocategoria (opzionale)"
              value={currentCategoryId !== currentTopId ? currentCategoryId : ''}
              onChange={(e) => setValue('category_id', e.target.value || currentTopId, { shouldValidate: true })}
            >
              <option value="">— tutta «{topName}»</option>
              {subcategories.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          )}
        </div>

        {/* Attributi per categoria (+ scan EAN se previsto) */}
        <div className="border-t pt-4 space-y-3">
          {hasEanField && (
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:bg-primary-50"
            >
              <ScanLine size={16} strokeWidth={2.2} aria-hidden /> Scansiona codice EAN
            </button>
          )}
          <AttributesFields
            fields={attrFields}
            values={attributes}
            onChange={setAttribute}
            categoryLabel={topCategoryLabel}
            variantAxes={variantAxes}
            onToggleVariant={toggleVariantAxis}
            onAxisValuesChange={setAxisValues}
          />

          {/* Disponibilità per variante: appare quando un campo è stato reso
              "varianti" qui sopra. Resta dentro la sezione Caratteristiche. */}
          {variants.length > 0 && (
            <div className="rounded-lg border border-cream-300 overflow-hidden">
              <div className="flex items-center justify-between bg-cream-50 px-3 py-2 text-xs font-semibold text-ink-600">
                <span>Variante</span>
                <span>Disponibilità</span>
              </div>
              <div className="divide-y divide-cream-200">
                {variants.map((v, idx) => (
                  <div key={v.label || idx} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm font-medium text-ink-800">{v.label || '—'}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={v.stock}
                      onChange={(e) => setVariantStock(idx, Number(e.target.value))}
                      aria-label={`Disponibilità ${v.label}`}
                      className="w-24 rounded-lg border border-cream-300 px-2 py-1 text-sm text-right focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between bg-cream-50 px-3 py-2 text-sm font-semibold text-ink-700">
                <span>Totale</span>
                <span>{totalVariantStock(variants)} pezzi</span>
              </div>
            </div>
          )}
        </div>

        {/* Tag / parole chiave */}
        <div className="border-t pt-4">
          <label className="block text-sm font-medium text-ink-700 mb-1">Tag / parole chiave</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-cream-300 p-2">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-700">
                {t}
                <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Rimuovi ${t}`} className="text-primary-500 hover:text-primary-800">×</button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                else if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
              }}
              onBlur={() => addTag(tagInput)}
              placeholder={tags.length === 0 ? 'Es. regalo, artigianale, bio…' : 'Aggiungi tag'}
              className="flex-1 min-w-[8rem] border-0 p-1 text-sm focus:outline-none focus:ring-0"
            />
          </div>
          <p className="text-xs text-ink-400 mt-1">Invio o virgola per aggiungere. Aiutano i clienti a trovarti.</p>
        </div>

        {/* Express */}
        {(sellerOffersExpress || expressMode !== 'inherit') && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium text-ink-700 mb-1 inline-flex items-center gap-1.5">
              <Zap size={14} strokeWidth={2.4} className="text-amber-500" aria-hidden /> Consegna Express
            </p>
            <Select
              aria-label="Consegna Express"
              value={expressMode}
              onChange={(e) => setExpressMode(e.target.value as ExpressMode)}
            >
              <option value="inherit">Eredita dal negozio {sellerOffersExpress ? '(attivo)' : '(non attivo)'}</option>
              <option value="yes">Sì, disponibile per Express</option>
              <option value="no">No, escludi questo prodotto</option>
            </Select>
            {!sellerOffersExpress && (
              <p className="text-xs text-ink-400 mt-1">
                Attiva l&apos;Express per tutto il negozio dal{' '}
                <Link href="/seller/profile" className="text-primary-700 hover:underline">profilo negozio</Link>.
              </p>
            )}
          </div>
        )}

        <ProductImagesField
          value={imageUrls}
          onChange={setImageUrls}
          error={imageError}
          onUploadingChange={setUploading}
          onUploadSuccess={() => setImageError(null)}
          label={<>Foto del prodotto <span className="text-ink-400 font-normal">— almeno 1, consigliate 3</span></>}
          dropzoneHint="Trascina qui le foto o clicca per selezionarle"
          hint="Luce naturale, sfondo pulito, prodotto centrato — è la prima cosa che convince chi compra."
          showCoverBadge
        />

        {/* ANTEPRIMA */}
        <div className="border-t pt-4 space-y-2">
          <h2 className="text-sm font-semibold text-ink-500 flex items-center gap-1.5">
            <Eye size={15} strokeWidth={2.2} aria-hidden /> Anteprima — come la vede il cliente
          </h2>
          <div className="bg-white border border-cream-300 rounded-xl overflow-hidden shadow-warm max-w-[16rem]">
            <div className="aspect-square bg-cream-100">
              {imageUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrls[0]} alt={typeof attributes.alt_text === 'string' ? attributes.alt_text : ''} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ink-300">
                  <ImageIcon size={40} strokeWidth={1.5} aria-hidden />
                </div>
              )}
            </div>
            <div className="p-3">
              <p className="font-semibold text-ink-900 line-clamp-1">{watch('name') || 'Nome prodotto'}</p>
              <p className="text-sm text-ink-500 line-clamp-2 mt-0.5">{watch('description') || 'La descrizione apparirà qui…'}</p>
              <p className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-bold text-primary-700">
                  {priceNum ? formatPrice(priceNum) : '€—'}
                  <span className="text-xs font-normal text-ink-400">{UNIT_SUFFIX[unit]}</span>
                </span>
                {hasDiscount && <span className="text-xs text-ink-400 line-through">{formatPrice(cmpNum)}</span>}
                {hasDiscount && <span className="text-xs font-bold text-secondary-600">-{discountPct}%</span>}
              </p>
            </div>
          </div>
        </div>

        {/* AZIONI */}
        {mode === 'create' ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button type="submit" loading={submitting} disabled={busy} fullWidth size="lg">
              Pubblica prodotto
            </Button>
            <button
              type="button"
              onClick={makeSubmit('draft')}
              disabled={busy}
              className="sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-ink-700 bg-white border-2 border-cream-300 hover:bg-cream-50 disabled:opacity-50"
            >
              <FileText size={16} aria-hidden /> Salva come bozza
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2 border-t">
            <Select label="Stato" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="available">In vendita</option>
              <option value="draft">Bozza (non visibile)</option>
              <option value="sold">Esaurito</option>
            </Select>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleting}
                  className="sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-rose-700 bg-white border-2 border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden /> Elimina prodotto
                </button>
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 disabled:opacity-40 text-white py-3 rounded-lg font-bold shadow"
              >
                <Save size={18} aria-hidden /> {submitting ? 'Salvataggio…' : 'Salva modifiche'}
              </button>
            </div>
          </div>
        )}
      </form>

      {productId && (
        <Link
          href={`/product/${productId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm inline-flex items-center gap-1.5 text-primary-700 hover:underline"
        >
          <Eye size={15} strokeWidth={2.2} aria-hidden /> Apri l&apos;anteprima cliente
        </Link>
      )}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={(code) => setAttribute('ean', code)}
      />
    </div>
  );
}
