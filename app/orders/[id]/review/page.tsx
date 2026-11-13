'use client';

import { useState, use, useRef, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';
import EmptyState from '@/components/EmptyState';
import { Package, Store, Bike } from 'lucide-react';
import { queryKeys } from '@/lib/queries/keys';
import { conFattorinoDellOrdine, conNegozioDellOrdine } from '@/lib/queries/negozio-dell-ordine';

/**
 * 3/9/2026 — LE STELLE NON DICEVANO QUAL È IL VOTO SCELTO.
 *
 * I cinque pulsanti avevano solo l'etichetta («3 stelle») e nient'altro: chi
 * naviga con un lettore di schermo sentiva la stessa identica cosa prima e dopo
 * aver premuto, e non aveva modo di sapere che il modulo parte già con cinque
 * stelle selezionate. Sono i criteri WCAG 4.1.2 (Name, Role, Value) e 1.4.11.
 * Lo stesso selettore in app/product/[id]/page.tsx era già stato riparato — la
 * correzione non era stata portata anche qui.
 *
 * Le stelle non scelte erano `text-ink-300`: 2,52 a 1 sul bianco, sotto il 3 a 1
 * che serve perché una parte grafica si distingua. Ora `text-ink-400`, 4,80 a 1.
 *
 * L'etichetta del gruppo arriva da fuori perché in questa pagina i selettori
 * sono due — il negozio e il fattorino — e sentirseli annunciare tutti e due
 * «Il tuo voto» non dice quale dei due si sta compilando.
 */
/*
 * R24-012 — Col Tab si arrivava su «1 stella», ma le frecce non spostavano né il fuoco né il voto
 * (andava solo Tab più Invio, stella per stella). Ora nel giro del Tab entra una stella sola, quella
 * scelta o la prima, e le frecce (Home e Fine agli estremi) cambiano il voto e portano il fuoco.
 */
const StarRating = ({ value, onChange, etichetta }: { value: number; onChange: (v: number) => void; etichetta: string }) => {
  const conLeFrecce = (e: KeyboardEvent<HTMLButtonElement>) => {
    const da = Number(e.currentTarget.dataset.stella) || value || 1;
    const a =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? Math.min(5, da + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? Math.max(1, da - 1)
          : e.key === 'Home' ? 1
            : e.key === 'End' ? 5
              : null;
    if (a === null) return;
    e.preventDefault();
    onChange(a);
    e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-stella="${a}"]`)?.focus();
  };
  return (
    <div className="flex gap-1" role="group" aria-label={etichetta}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onKeyDown={conLeFrecce}
          aria-pressed={n <= value}
          data-stella={n}
          tabIndex={n === (value || 1) ? 0 : -1}
          className="text-4xl transition-transform hover:scale-110"
          aria-label={`${n} ${n === 1 ? 'stella' : 'stelle'}`}
        >
          <span className={n <= value ? 'text-accent-700' : 'text-ink-400'}>★</span>
        </button>
      ))}
    </div>
  );
};

/** R24-012 — Il commento aveva campo libero senza tetto né contatore: il tetto e il conto, come nel reclamo. */
const TETTO_COMMENTO = 1000;

export default function OrderReviewPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  // 5/11/2026 — Le stelle partono vuote: un voto di 5 già scelto lo lasciava anche chi non le
  // toccava. «Invia» resta spento finché non si sceglie un voto (vedi sotto).
  const [storeRating, setStoreRating] = useState(0);
  const [storeComment, setStoreComment] = useState('');
  const [riderRating, setRiderRating] = useState(0);
  const [riderComment, setRiderComment] = useState('');
  // R24-012 — Il freno al doppio clic. `submit.isPending` diventa vero solo al disegno dopo: due clic
  // nello stesso istante arrivavano tutti e due a `mutate`, il secondo urtava il vincolo (order_id,
  // user_id) e il cliente alla sua prima recensione leggeva «Avevi già recensito».
  const inviando = useRef(false);

  type OrderForReview = {
    id: string;
    delivery_status: string;
    seller_id: string;
    rider_id: string | null;
    seller: { store_name: string | null } | null;
    rider: { full_name: string | null } | null;
    /** 5/11/2026 — La recensione già lasciata su questo ordine, se c'è. */
    giaRecensito?: boolean;
    /** 12/11/2026 (R07-015) — negozio e fattorino si guardano separati. */
    giaNegozio?: boolean;
    giaFattorino?: boolean;
  };
  // 5/11/2026 — Un guasto di rete non è «Ordine non trovato»: si guarda isError (con Riprova),
  // e «non trovato» resta per l'ordine che non c'è (maybeSingle → null).
  const { data: order, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.orders.forReview(id),
    queryFn: async (): Promise<OrderForReview | null> => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, delivery_status, seller_id, rider_id
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // 18/10/2026 — Il nome del negozio da valutare viene dalla vetrina pubblica,
      // non da `profiles` (lib/queries/negozio-dell-ordine.ts).
      const [conNegozio] = await conNegozioDellOrdine(
        supabase,
        [data as unknown as Omit<OrderForReview, 'seller' | 'rider'>],
        'id, store_name',
      );
      // 31/10/2026 (migrazione 164) — Il nome del fattorino da valutare viene dalla vista
      // `nomi_pubblici`, non da `profiles`: dopo la 161 qui c'era sempre «Il tuo rider».
      const [conFattorino] = await conFattorinoDellOrdine(supabase, [conNegozio]);
      // 5/11/2026 — Una seconda recensione urta il vincolo (order_id, user_id) e veniva buttata
      // dicendo «Grazie». Se c'è già, la pagina lo dice al posto del modulo.
      //
      // 12/11/2026 (R07-015) — Si guardava solo la recensione al negozio: se quella
      // entrava e quella al fattorino no (rete caduta fra le due scritture), la pagina
      // diceva «già recensito» e il fattorino non si poteva più votare. Ora si guardano
      // tutte e due, e il modulo chiede solo quella che manca.
      // Una lettura che cade non vuol dire «non recensito»: sale l'errore, e la pagina offre Riprova.
      const { data: gia, error: erroreGia } = await supabase.from('store_reviews').select('id').eq('order_id', id).limit(1);
      if (erroreGia) throw erroreGia;
      const giaNegozio = ((gia as unknown[] | null) ?? []).length > 0;
      let giaFattorino = false;
      if (data.rider_id) {
        const { data: giaR, error: erroreGiaR } = await supabase.from('rider_reviews').select('id').eq('order_id', id).limit(1);
        if (erroreGiaR) throw erroreGiaR;
        giaFattorino = ((giaR as unknown[] | null) ?? []).length > 0;
      }
      return {
        ...(conFattorino as OrderForReview),
        giaNegozio,
        giaFattorino,
        giaRecensito: giaNegozio && (!data.rider_id || giaFattorino),
      };
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      if (!order || order.delivery_status !== 'DELIVERED') throw new Error('Ordine non consegnato');
      const chiediNegozio = !order.giaNegozio;
      const chiediFattorino = !!order.rider_id && !order.giaFattorino;
      if ((chiediNegozio && storeRating < 1) || (chiediFattorino && riderRating < 1)) throw new Error('Tocca le stelle per votare');
      // «Avevi già recensito» solo se non è entrata nessuna recensione nuova: se il negozio
      // urta il doppione ma il fattorino entra, il voto nuovo c'è e va ringraziato.
      let doppioni = 0;
      let nuove = 0;

      if (order.seller_id && chiediNegozio) {
        const { error: e1 } = await supabase.from('store_reviews').insert({
          store_id: order.seller_id,
          user_id: user.id,
          order_id: id,
          rating: storeRating,
          comment: storeComment.trim() || null,
        });
        if (e1 && e1.code !== '23505') throw e1;
        if (e1) doppioni += 1; else nuove += 1;
      }
      if (order.rider_id && chiediFattorino) {
        const { error: e2 } = await supabase.from('rider_reviews').insert({
          rider_id: order.rider_id,
          user_id: user.id,
          order_id: id,
          rating: riderRating,
          comment: riderComment.trim() || null,
        });
        if (e2 && e2.code !== '23505') throw e2;
        if (e2) doppioni += 1; else nuove += 1;
      }
      return { doppione: doppioni > 0 && nuove === 0 };
    },
    onSuccess: ({ doppione }) => {
      if (doppione) toast.info('Avevi già recensito questo ordine: la recensione di prima resta quella valida.');
      else toast.success('Grazie per la recensione!');
      router.push(`/orders/${id}`);
    },
    // Una delle due scritture può essere già entrata: si rilegge l'ordine, e il modulo chiede
    // solo quella che manca.
    onError: (err: unknown) => { toast.error(friendlyError(err)); void refetch(); },
  });

  if (isLoading) return <LoadingState />;
  if (isError) {
    return (
      <div className="container mx-auto py-12 max-w-2xl">
        <ErrorState
          title="Non riesco a caricare l'ordine"
          description="Sembra un problema di collegamento. L'ordine c'è: riprova."
          retry={() => { void refetch(); }}
        />
      </div>
    );
  }
  if (!order) return <div className="container mx-auto py-12 max-w-2xl"><EmptyState icon={Package} title="Ordine non trovato" ctaLabel="Tutti gli ordini" ctaHref="/orders" /></div>;
  if (order.delivery_status !== 'DELIVERED') {
    return (
      <div className="container mx-auto p-8 text-center space-y-3">
        <p className="text-ink-700">Puoi lasciare una recensione solo per ordini consegnati.</p>
        <Link href={`/orders/${id}`} className="text-primary-700 hover:underline">← Torna all'ordine</Link>
      </div>
    );
  }

  if (order.giaRecensito) {
    return (
      <div className="container mx-auto p-8 text-center space-y-3">
        <p className="text-ink-700">Hai già lasciato una recensione per questo ordine. Grazie!</p>
        <Link href={`/orders/${id}`} className="text-primary-700 hover:underline">← Torna all&apos;ordine</Link>
      </div>
    );
  }

  const chiediNegozio = !order.giaNegozio;
  const chiediFattorino = !!order.rider_id && !order.giaFattorino;
  const manca = (chiediNegozio && storeRating < 1) || (chiediFattorino && riderRating < 1);

  return (
    <div className="container mx-auto px-4 py-8 max-w-xl space-y-6">
      <div>
        <Link href={`/orders/${id}`} className="text-sm text-primary-700 hover:underline">← Torna all'ordine</Link>
        <h1 className="text-2xl font-bold text-ink-900 mt-1">Lascia una recensione</h1>
        <p className="text-sm text-ink-500">Le tue stelle aiutano gli altri clienti a scegliere.</p>
      </div>

      {chiediNegozio && (
      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div>
          <p className="font-semibold text-ink-900 flex items-center gap-1.5"><Store size={16} strokeWidth={2.2} aria-hidden /> {order.seller?.store_name ?? 'Negozio'}</p>
          <p className="text-xs text-ink-500 mb-3">Com'è stato il negozio? Qualità, packaging, prodotti.</p>
          <StarRating value={storeRating} onChange={setStoreRating} etichetta="Il tuo voto sul negozio" />
          <Textarea
            value={storeComment}
            onChange={(e) => setStoreComment(e.target.value)}
            rows={2}
            maxLength={TETTO_COMMENTO}
            placeholder="Scrivi un commento (opzionale)…"
            containerClassName="mt-3"
            className="resize-none"
          />
          <p className="text-xs text-ink-500 mt-1 text-right">{storeComment.length}/{TETTO_COMMENTO}</p>
        </div>
      </div>
      )}
      {!chiediNegozio && (
        <p className="text-sm text-ink-600">Il negozio l&apos;hai già recensito: manca solo il voto al fattorino.</p>
      )}

      {chiediFattorino && (
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <div>
            <p className="font-semibold text-ink-900 flex items-center gap-1.5"><Bike size={16} strokeWidth={2.2} aria-hidden /> {order.rider?.full_name ?? 'Il tuo rider'}</p>
            <p className="text-xs text-ink-500 mb-3">Com'è stato il rider? Puntualità, gentilezza.</p>
            <StarRating value={riderRating} onChange={setRiderRating} etichetta="Il tuo voto sul fattorino" />
            <Textarea
              value={riderComment}
              onChange={(e) => setRiderComment(e.target.value)}
              rows={2}
              maxLength={TETTO_COMMENTO}
              placeholder="Scrivi un commento (opzionale)…"
              containerClassName="mt-3"
              className="resize-none"
            />
            <p className="text-xs text-ink-500 mt-1 text-right">{riderComment.length}/{TETTO_COMMENTO}</p>
          </div>
        </div>
      )}

      {manca && <p className="text-center text-sm text-ink-500">Tocca le stelle per votare.</p>}
      <Button
        onClick={() => {
          if (inviando.current) return;
          inviando.current = true;
          // Si riapre solo se l'invio non riesce: dopo il successo la pagina se ne va, e un clic
          // in mezzo (prima che router.push cambi pagina) non deve mandare una seconda recensione.
          submit.mutate(undefined, { onError: () => { inviando.current = false; } });
        }}
        loading={submit.isPending || submit.isSuccess}
        disabled={manca}
        fullWidth
        size="lg"
      >
        Invia recensione
      </Button>
    </div>
  );
}
