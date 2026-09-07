'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Star, User, BadgeCheck, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { fotoDiCasa } from '@/lib/storage/foto-di-casa';
import type { SectionContext, SectionReview } from './SectionContext';
import { RatingStars } from '@/components/ui/RatingStars';

/**
 * Recensione singola arricchita con dati reali (store_reviews + profilo autore):
 * - nome autore reale (fallback "Cliente");
 * - pill "Acquisto verificato" quando `order_id` è valorizzato;
 * - miniature foto da `photo_urls` (text[]);
 * - risposta del negozio;
 * - azione "Utile" PERSISTENTE via `review_helpful` (insert/delete own-row): il
 *   conteggio `helpful_count` è mantenuto da un trigger DB. UX ottimistica: il
 *   bottone ribalta subito stato e conteggio, con rollback in caso di errore.
 *   L'utente non autenticato che vota riceve un invito ad accedere.
 */
function ReviewItem({ r, accent }: { r: SectionReview; accent: string }) {
  const author = r.author ?? null;
  const verified = r.order_id != null;
  // Ogni foto diventa un collegamento cliccabile sulla vetrina pubblica, e
  // l'indirizzo lo sceglie chi scrive la recensione: nessuna rotta server e
  // nessun vincolo sulla colonna lo controllano. `fotoDiCasa` tiene solo gli
  // `https` del nostro archivio — la stessa regola gia' applicata alle foto dei
  // resi (lib/storage/foto-di-casa.ts).
  const photos = (Array.isArray(r.photo_urls) ? r.photo_urls : []).filter(fotoDiCasa);

  // Stato voto "Utile": parte dal conteggio reale; lo stato own-voted viene
  // risolto a runtime (review_helpful own-row) e poi mantenuto ottimisticamente.
  const [hasVoted, setHasVoted] = useState(false);
  const [count, setCount] = useState<number>(r.helpful_count ?? 0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setCount(r.helpful_count ?? 0);
  }, [r.helpful_count]);

  // Risolve se l'utente corrente ha già votato questa recensione (own-row).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase
        .from('review_helpful')
        .select('review_id')
        .eq('review_id', r.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (active) setHasVoted(!!data);
    })();
    return () => { active = false; };
  }, [r.id]);

  const toggleHelpful = async () => {
    if (pending) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Accedi per segnalare una recensione utile');
      return;
    }
    // Ottimistico: ribalta subito stato + conteggio.
    const next = !hasVoted;
    setHasVoted(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setPending(true);
    try {
      if (next) {
        const { error } = await supabase
          .from('review_helpful')
          .insert({ review_id: r.id, user_id: user.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('review_helpful')
          .delete()
          .eq('review_id', r.id)
          .eq('user_id', user.id);
        if (error) throw error;
      }
    } catch {
      // Rollback in caso di errore.
      setHasVoted(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast.error('Non è stato possibile registrare il voto');
    } finally {
      setPending(false);
    }
  };

  return (
    <li className="rounded-2xl border border-cream-300 bg-white p-4 shadow-warm-sm">
      <div className="mb-1.5 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-200 text-primary-700">
          <User size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="text-sm text-ink-900">{author ?? 'Cliente'}</strong>
            <RatingStars rating={r.rating} size={14} />
            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-bold text-olive-700">
                <BadgeCheck size={11} aria-hidden /> Acquisto verificato
              </span>
            )}
          </div>
          <span className="text-xs text-ink-400">{new Date(r.created_at).toLocaleDateString('it-IT')}</span>
        </div>
      </div>

      {r.comment && <p className="text-sm leading-relaxed text-ink-700">{r.comment}</p>}

      {photos.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {/* 27/8/2026 (R117) — le foto di una recensione avevano tutte lo
              stesso testo alternativo: tre foto, e un lettore di schermo che
              diceva tre volte «Foto recensione». Cosa ci sia dentro una foto
              caricata da un cliente non possiamo saperlo, ma almeno adesso si
              distinguono l'una dall'altra. */}
          {photos.slice(0, 4).map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-[72px] w-[72px] overflow-hidden rounded-lg bg-cream-100 transition-opacity hover:opacity-80"
            >
              <Image
                src={sizedImage(url, 'thumb')}
                alt={`Foto ${i + 1} della recensione`}
                width={72}
                height={72}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {r.seller_reply && (
        <div className="mt-2.5 ml-3 rounded-r-lg border-l-2 border-primary-200 bg-cream-50 py-1.5 pl-3 pr-2">
          <p className="text-xs font-semibold text-primary-700">Risposta del negozio</p>
          <p className="whitespace-pre-wrap text-sm text-ink-700">{r.seller_reply}</p>
        </div>
      )}

      <button
        type="button"
        onClick={toggleHelpful}
        aria-pressed={hasVoted}
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
          hasVoted ? '' : 'border-cream-300 text-ink-500 hover:text-ink-800'
        }`}
        style={
          hasVoted
            ? {
                backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`,
                // 6/9/2026 — qui c'era `color: accent`, cioe' l'accent puro sopra il
                // suo stesso velo al 12%: su tre preset degli otto il testo scendeva
                // sotto 4,5:1 (oliva 4,10 · terracotta 4,20 · senape 4,27) mentre e'
                // scritto a 12px in grassetto. Scurendolo verso l'inchiostro il
                // peggiore risale a 6,10:1 e il colore resta quello del negozio.
                // Il bordo tiene l'accent pieno: li' l'identita' si vede e basta.
                color: `color-mix(in srgb, ${accent} 70%, #1C1A18)`,
                borderColor: accent,
              }
            : undefined
        }
      >
        <ThumbsUp size={13} aria-hidden /> Utile{count > 0 ? ` · ${count}` : ''}
      </button>
    </li>
  );
}

/** Recensioni clienti (ultime), con titolo serif, media voti e item arricchiti. */
export default function ReviewsSection({ ctx }: { ctx: SectionContext }) {
  const { reviews, accent } = ctx;
  if (reviews.length === 0) return null;

  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-ink-900">
          <Star size={18} className="fill-accent-400 text-accent-500" aria-hidden />
          Recensioni clienti
        </h2>
        <div className="flex items-center gap-1.5">
          {/* 6/9/2026 — le stelle della media erano disegnate qui dentro, in proprio:
              accent-500 sulle piene (2,16:1 sul bianco) e cream-200 sulle vuote
              (1,17:1), cioe' sotto il 3:1 che WCAG 1.4.11 chiede a un elemento
              grafico. La cura era gia' scritta e gia' in uso due righe sopra, per
              le stelle della singola recensione: RatingStars, accent-700 (5,00:1)
              e vuote ink-400. Una sola casa per la regola. */}
          <RatingStars rating={avgRating} size={16} />
          <span className="text-sm font-medium text-ink-600">
            {avgRating.toFixed(1).replace('.', ',')} ({reviews.length})
          </span>
        </div>
      </div>
      <ul className="space-y-3">
        {reviews.slice(0, 6).map((r) => (
          <ReviewItem key={r.id} r={r} accent={accent} />
        ))}
      </ul>
    </div>
  );
}
