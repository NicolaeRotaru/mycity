'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Send,
  ImagePlus,
  Check,
  X,
  RefreshCw,
  Pencil,
  PackagePlus,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { uploadProductImages, ALLOWED_IMAGE_TYPES } from '@/lib/products/uploadImages';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import type { AiProductPatch } from '@/lib/products/aiPatch';
import type { ProductSnapshot } from '@/lib/products/aiSnapshot';
import {
  ETICHETTE_STATO,
  avvisoSullaPubblicazione,
  bozzaDaCreare,
  caratteristicheDellaBozza,
  messaggioDopoLaBozza,
  riquadroDichiarazioni,
  righeDellaProposta,
  type BozzaSalvata,
} from '@/lib/products/prontoPerLaVendita';

/**
 * Assistente AI prodotto dentro la chat Assistenza.
 *
 * Il venditore NON cerca il prodotto a mano: lo descrive o manda una FOTO e
 * l'AI lo riconosce nel catalogo (/api/ai/catalog-chat). Quando il venditore
 * chiede una modifica, l'AI propone un patch: appare una card di riepilogo e —
 * con "Applica" — la modifica viene salvata (/api/ai/catalog-apply). Le foto
 * vengono compresse lato client prima dell'upload (anche quelle pesanti da
 * smartphone), così l'Ai può sempre "vederle".
 */

type Proposal = { productId: string; patch: AiProductPatch; product: ProductSnapshot };

/** Bozza estratta dalle foto (risposta di /api/vision/extract-product). */
type ExtractedDraft = {
  name: string;
  description: string;
  category_id: string | null;
  subcategory_id: string | null;
  category_slug: string | null;
  suggested_price: number | null;
  attributes: Record<string, string>;
  tags: string[];
  image_quality: { score: number; issues: string[] } | null;
  alt_text: string | null;
};

type NewDraft = { draft: ExtractedDraft; imageUrls: string[] };

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  /** Foto allegate dal venditore (solo nei turni user). */
  images?: string[];
  /** Proposta di modifica (solo nei turni assistant), se presente. */
  proposal?: Proposal;
  /** true quando la proposta è stata applicata. */
  applied?: boolean;
  /** Bozza di nuovo prodotto proposta dalle foto (solo nei turni assistant). */
  newDraft?: NewDraft;
  /** true quando la bozza è stata creata. */
  created?: boolean;
  /**
   * La bozza come l'ha salvata il server: il riquadro delle dichiarazioni,
   * dopo la creazione, dice «entrate» solo per quello che c'è qui.
   */
  bozzaSalvata?: BozzaSalvata;
  /**
   * R36 — il negoziante ha spuntato «le ho controllate» sotto allergeni e
   * ingredienti letti dalle foto. Senza la spunta la bozza nasce senza.
   */
  dichiarazioniConfermate?: boolean;
};

const MAX_IMAGES = 4;

const STATUS_LABELS = ETICHETTE_STATO;

const WELCOME =
  "Ciao! Dimmi quale prodotto vuoi sistemare — scrivi il nome o mandami una foto e lo trovo io nel tuo catalogo. Oppure mandami le foto di un prodotto NUOVO e lo inserisco io: compilo nome, prezzo, categoria, descrizione e tag.";

export default function SupportProductAssistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string[]>([]); // foto allegate non ancora inviate
  const [sessionImages, setSessionImages] = useState<string[]>([]); // foto viste dall'AI
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState(false); // estrazione dalle foto in corso
  const [creatingIndex, setCreatingIndex] = useState<number | null>(null); // insert in corso
  const [focused, setFocused] = useState<ProductSnapshot | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const bad = list.find((f) => !ALLOWED_IMAGE_TYPES.includes(f.type));
    if (bad) {
      toast.error('Allega una foto (JPG, PNG o WEBP).');
      return;
    }
    if (pending.length + sessionImages.length + list.length > MAX_IMAGES) {
      toast.error(`Massimo ${MAX_IMAGES} foto.`);
      return;
    }
    setUploading(true);
    try {
      const urls = await uploadProductImages(list); // comprime in automatico le foto pesanti
      setPending((prev) => [...prev, ...urls]);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || loading) return;

    const newSession = [...sessionImages, ...pending].slice(-MAX_IMAGES);
    const userMsg: Msg = { role: 'user', content: text || '(foto allegata)', images: pending };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setPending([]);
    setSessionImages(newSession);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        return;
      }
      const history = next.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/ai/catalog-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          history,
          imageUrls: newSession,
          focusProductId: focused?.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));

      const product: ProductSnapshot | null = json.product ?? null;
      const patch: AiProductPatch = json.patch ?? {};
      const hasPatch = product && Object.keys(patch).length > 0;
      if (product) setFocused(product);

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: json.reply ?? 'Fatto.',
          proposal: hasPatch ? { productId: product!.id, patch, product: product! } : undefined,
        },
      ]);
    } catch (err) {
      toast.error(friendlyError(err));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Ops, qualcosa è andato storto. Riprova.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const applyProposal = async (index: number, proposal: Proposal) => {
    if (applyingIndex !== null) return;
    setApplyingIndex(index);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        return;
      }
      const res = await fetch('/api/ai/catalog-apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ productId: proposal.productId, patch: proposal.patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));

      if (json.product) setFocused(json.product as ProductSnapshot);
      setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, applied: true } : m)));
      toast.success('Modifiche salvate sul prodotto');
      // Quello che il server NON ha applicato (prezzo fuori banda, allergeni)
      // si dice, invece di sparire dietro «salvate».
      for (const riga of Array.isArray(json.changed) ? (json.changed as string[]) : []) {
        if (riga.includes('NON ')) toast.warning(riga);
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setApplyingIndex(null);
    }
  };

  const dismissProposal = (index: number) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, proposal: undefined } : m)));
  };

  // Crea un nuovo prodotto dalle SOLE foto: estrae i campi con l'AI (vision) e
  // propone una bozza da confermare.
  const createFromPhotos = async () => {
    if (creating || loading) return;
    const imgs = Array.from(new Set([...sessionImages, ...pending])).slice(-MAX_IMAGES);
    if (imgs.length === 0) {
      toast.error('Allega prima una foto del prodotto.');
      return;
    }
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: 'Crea un nuovo prodotto da queste foto.', images: imgs },
    ]);
    setPending([]);
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        return;
      }
      const res = await fetch('/api/vision/extract-product', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ image_urls: imgs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Non riesco a leggere le foto'));

      const draft = json as ExtractedDraft;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Ho letto le foto: sembra "${draft.name}". Ho preparato una bozza — controllala e creala quando vuoi.`,
          newDraft: { draft, imageUrls: imgs },
        },
      ]);
    } catch (err) {
      toast.error(friendlyError(err));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Non sono riuscito a leggere le foto. Riprova con scatti più nitidi.' },
      ]);
    } finally {
      setCreating(false);
    }
  };

  const confirmCreate = async (index: number, nd: NewDraft, dichiarazioniConfermate: boolean) => {
    if (creatingIndex !== null) return;
    setCreatingIndex(index);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        return;
      }
      const res = await fetch('/api/ai/catalog-create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        // R36 — Allergeni e ingredienti letti dalle foto entrano nella bozza solo
        // se il negoziante li ha visti e confermati qui sotto.
        body: JSON.stringify({
          imageUrls: nd.imageUrls,
          draft: bozzaDaCreare(nd.draft, dichiarazioniConfermate),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));

      const product = json.product as ProductSnapshot;
      setFocused(product);
      setSessionImages([]); // le foto erano del nuovo prodotto, non del contesto chat
      setMessages((prev) => [
        ...prev.map((m, i) =>
          i === index
            ? { ...m, created: true, bozzaSalvata: { categorySlug: product.categorySlug, attributes: product.attributes } }
            : m,
        ),
        // R36 — «pubblica» si propone solo se la scheda ha già tutto: per un
        // alimento senza allergeni e ingredienti si dice cosa manca e dove.
        { role: 'assistant', content: messaggioDopoLaBozza(product) },
      ]);
      toast.success('Bozza prodotto creata');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setCreatingIndex(null);
    }
  };

  const toggleConfermaDichiarazioni = (index: number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, dichiarazioniConfermate: !m.dichiarazioniConfermate } : m)),
    );
  };

  const dismissDraft = (index: number) => {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, newDraft: undefined } : m)));
  };

  return (
    <div className="flex flex-col h-[70vh] sm:h-[60vh]">
      {/* Prodotto in focus */}
      {focused && (
        <div className="flex items-center gap-3 border-b border-cream-200 bg-cream-50 px-4 py-2">
          {focused.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sizedImage(focused.image, 80)} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-cream-200" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-800">{focused.name}</p>
            <p className="text-xs text-ink-500">
              {focused.price != null ? formatPrice(focused.price) : 's.p.'} · {STATUS_LABELS[focused.status] ?? focused.status}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/seller/products/${focused.id}/edit`}
              className="inline-flex items-center gap-1 rounded-lg border border-cream-300 px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-cream-100"
            >
              <Pencil size={12} aria-hidden /> Apri
            </Link>
            <button
              type="button"
              onClick={() => setFocused(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-cream-300 px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-cream-100"
            >
              <RefreshCw size={12} aria-hidden /> Cambia
            </button>
          </div>
        </div>
      )}

      {/* Conversazione */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="rounded-lg bg-secondary-50 px-3 py-2 text-sm text-ink-600">{WELCOME}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className="max-w-[88%] space-y-2">
              <div
                className={
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-sm bg-primary-600 px-3 py-2 text-sm text-white'
                    : 'rounded-2xl rounded-bl-sm bg-cream-100 px-3 py-2 text-sm text-ink-800'
                }
              >
                {m.images && m.images.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.images.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={sizedImage(url, 128)} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    ))}
                  </div>
                )}
                {m.content}
              </div>

              {/* Card di riepilogo modifica */}
              {m.proposal && (
                <div className="rounded-xl border border-secondary-200 bg-white p-3 shadow-warm">
                  <div className="mb-2 flex items-center gap-2">
                    {m.proposal.product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sizedImage(m.proposal.product.image, 72)} alt="" className="h-9 w-9 rounded-lg object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-cream-200" />
                    )}
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">
                      {m.proposal.product.name}
                    </p>
                  </div>
                  <ul className="mb-3 space-y-1 text-sm text-ink-700">
                    {righeDellaProposta(m.proposal.patch, m.proposal.product).map((line, k) => (
                      <li key={k} className="flex gap-1.5">
                        <span className="text-secondary-500">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  {!m.applied &&
                    (() => {
                      // R36 — La scheda si legge come la leggera' il server (con il
                      // resto della proposta), e mostra le dichiarazioni con cui il
                      // prodotto va in vetrina, da rileggere prima di Applica.
                      const avviso = avvisoSullaPubblicazione(m.proposal.product, m.proposal.patch);
                      if (!avviso) return null;
                      if (avviso.mancanti.length > 0) {
                        return (
                          <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-accent-50 px-2 py-1.5 text-xs text-accent-800">
                            <AlertTriangle size={13} strokeWidth={2.4} className="mt-0.5 shrink-0" aria-hidden />
                            <span>
                              Non si può ancora mettere in vendita: manca {avviso.mancanti.join(', ')}. Aprilo con
                              «Apri» e compila tu questi campi.
                            </span>
                          </p>
                        );
                      }
                      if (avviso.dichiarazioni.length === 0) return null;
                      return (
                        <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50 p-2 text-xs text-ink-800">
                          <p className="mb-1 flex items-center gap-1.5 font-semibold text-accent-800">
                            <AlertTriangle size={13} strokeWidth={2.4} aria-hidden /> Va in vendita con queste
                            dichiarazioni: rileggile, ai clienti le dai tu
                          </p>
                          <ul className="space-y-0.5">
                            {avviso.dichiarazioni.map((d) => (
                              <li key={d.etichetta}>
                                <span className="font-semibold">{d.etichetta}:</span> {d.valore}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}
                  {m.applied ? (
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
                      <Check size={15} strokeWidth={2.6} aria-hidden /> Modifiche salvate
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => applyProposal(i, m.proposal!)}
                        disabled={applyingIndex !== null}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        {applyingIndex === i ? (
                          <Loader2 size={15} className="animate-spin" aria-hidden />
                        ) : (
                          <Check size={15} strokeWidth={2.4} aria-hidden />
                        )}
                        Applica
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissProposal(i)}
                        disabled={applyingIndex !== null}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-cream-300 px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-cream-100 disabled:opacity-50"
                      >
                        <X size={15} aria-hidden /> Annulla
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Card bozza nuovo prodotto */}
              {m.newDraft && (
                <div className="rounded-xl border border-secondary-200 bg-white p-3 shadow-warm">
                  <div className="mb-2 flex items-center gap-2">
                    {m.newDraft.imageUrls[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sizedImage(m.newDraft.imageUrls[0], 96)} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-cream-200" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-800">{m.newDraft.draft.name}</p>
                      <p className="text-xs text-ink-500">
                        {m.newDraft.draft.suggested_price != null ? formatPrice(m.newDraft.draft.suggested_price) : 's.p.'}
                        {m.newDraft.draft.category_slug ? ` · ${m.newDraft.draft.category_slug}` : ''}
                      </p>
                    </div>
                  </div>
                  {m.newDraft.draft.description && (
                    <p className="mb-2 line-clamp-3 text-sm text-ink-600">{m.newDraft.draft.description}</p>
                  )}
                  {(() => {
                    // Solo le caratteristiche che entrano; dopo la creazione,
                    // quelle che la bozza salvata ha davvero.
                    const altri = caratteristicheDellaBozza(
                      m.newDraft.draft,
                      m.created && m.bozzaSalvata ? { creata: true, salvata: m.bozzaSalvata } : { creata: false },
                    );
                    return altri.length > 0 ? (
                      <ul className="mb-2 space-y-0.5 text-xs text-ink-600">
                        {altri.map((a) => (
                          <li key={a.etichetta}>
                            <span className="font-semibold">{a.etichetta}:</span> {a.valore}
                          </li>
                        ))}
                      </ul>
                    ) : null;
                  })()}
                  {(() => {
                    // R36 — Allergeni e ingredienti in evidenza, da confermare; e
                    // dopo la creazione il riquadro dice il vero su cosa e' entrato.
                    const confermate = !!m.dichiarazioniConfermate;
                    const riquadro = riquadroDichiarazioni(
                      m.newDraft.draft,
                      m.created && m.bozzaSalvata
                        ? { creata: true, confermate, salvata: m.bozzaSalvata }
                        : { creata: false, confermate },
                    );
                    if (!riquadro) return null;
                    return (
                      <div
                        data-riquadro="dichiarazioni"
                        className="mb-2 rounded-lg border border-accent-200 bg-accent-50 p-2 text-xs text-ink-800"
                      >
                        <p className="mb-1 flex items-center gap-1.5 font-semibold text-accent-800">
                          <AlertTriangle size={13} strokeWidth={2.4} aria-hidden /> {riquadro.titolo}
                        </p>
                        {riquadro.righe.length > 0 && (
                          <ul className="mb-1 space-y-0.5">
                            {riquadro.righe.map((d) => (
                              <li key={d.etichetta}>
                                <span className="font-semibold">{d.etichetta}:</span> {d.valore}
                              </li>
                            ))}
                          </ul>
                        )}
                        {riquadro.daScrivere && <p className="mb-1">{riquadro.daScrivere}</p>}
                        {riquadro.chiediSpunta && (
                          <label className="mt-1 flex items-start gap-1.5">
                            <input
                              type="checkbox"
                              checked={!!m.dichiarazioniConfermate}
                              onChange={() => toggleConfermaDichiarazioni(i)}
                              disabled={creatingIndex !== null}
                              className="mt-0.5"
                            />
                            <span>
                              Le ho controllate sull&apos;etichetta: sono giuste. Senza questa spunta la bozza nasce
                              senza, e le scrivi tu nella scheda.
                            </span>
                          </label>
                        )}
                      </div>
                    );
                  })()}
                  {m.newDraft.draft.tags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {m.newDraft.draft.tags.slice(0, 8).map((t) => (
                        <span key={t} className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.newDraft.draft.image_quality && m.newDraft.draft.image_quality.score < 0.4 && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-accent-700">
                      <AlertTriangle size={13} strokeWidth={2.4} aria-hidden /> Foto di bassa qualità: valuta uno scatto migliore.
                    </p>
                  )}
                  {m.created ? (
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
                      <Check size={15} strokeWidth={2.6} aria-hidden /> Bozza creata
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => confirmCreate(i, m.newDraft!, !!m.dichiarazioniConfermate)}
                        disabled={creatingIndex !== null}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        {creatingIndex === i ? (
                          <Loader2 size={15} className="animate-spin" aria-hidden />
                        ) : (
                          <PackagePlus size={15} strokeWidth={2.4} aria-hidden />
                        )}
                        Crea bozza
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissDraft(i)}
                        disabled={creatingIndex !== null}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-cream-300 px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-cream-100 disabled:opacity-50"
                      >
                        <X size={15} aria-hidden /> Annulla
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {(loading || creating) && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-cream-100 px-3 py-2 text-sm text-ink-500">
              <Loader2 size={14} className="animate-spin" strokeWidth={2.4} aria-hidden />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-cream-200 p-2">
        {pending.length > 0 && (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pending.map((url) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sizedImage(url, 112)} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() => setPending((prev) => prev.filter((u) => u !== url))}
                    aria-label="Rimuovi foto"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-ink-800 p-0.5 text-white"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void createFromPhotos()}
              disabled={creating || loading}
              className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-1.5 text-xs font-semibold text-secondary-800 hover:bg-secondary-100 disabled:opacity-50"
            >
              {creating ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <PackagePlus size={13} strokeWidth={2.4} aria-hidden />}
              Crea nuovo prodotto da queste foto
            </button>
          </>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(',')}
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || loading || creating}
            aria-label="Allega foto"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cream-300 text-ink-600 hover:bg-cream-100 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Es. metti a 4,90 il pane di segale"
            className="flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || uploading || creating || (!input.trim() && pending.length === 0)}
            aria-label="Invia"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
