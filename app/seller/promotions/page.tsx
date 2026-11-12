'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Plus, Calendar, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { vistaDaQuery } from '@/lib/vista-query';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { queryKeys } from '@/lib/queries/keys';
import { confirmDialog } from '@/components/ConfirmDialog';
import { statoDellaPromo } from './stato-promo';

type Promo = {
  id: string;
  title: string;
  discount_percent: number;
  scope: 'store' | 'category' | 'products';
  starts_at: string;
  ends_at: string;
  status: string;
};

const PERCENTS = [10, 15, 20, 25, 30, 50];
const DURATIONS = [
  { label: 'Oggi (fino a mezzanotte)', value: 'today' },
  { label: '3 giorni', value: '3d' },
  { label: '1 settimana', value: '7d' },
  { label: '1 mese', value: '30d' },
];

function endDateFor(duration: string): Date {
  const d = new Date();
  switch (duration) {
    case 'today':
      d.setHours(23, 59, 59, 999);
      return d;
    case '3d':
      d.setDate(d.getDate() + 3);
      return d;
    case '7d':
      d.setDate(d.getDate() + 7);
      return d;
    case '30d':
      d.setDate(d.getDate() + 30);
      return d;
    default:
      return d;
  }
}

export default function SellerPromotionsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [title, setTitle] = useState('Saldi del weekend');
  const [percent, setPercent] = useState(15);
  const [scope, setScope] = useState<'store' | 'category'>('store');
  // 12/11/2026 (R03-020) — «Una categoria specifica» non faceva scegliere QUALE: la promo nasceva
  // senza category_id, il database non scontava niente (il confronto con NULL non è mai vero) e
  // intanto la vetrina annunciava «-15%». Ora la categoria si sceglie ed è obbligatoria.
  const [categoriaId, setCategoriaId] = useState('');
  const [duration, setDuration] = useState('7d');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/seller/promotions'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  const queryPromos = useQuery({
    queryKey: queryKeys.seller.promotionsByUser(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<Promo[]> => {
      const { data, error } = await supabase
        .from('seller_promotions')
        .select('*')
        .eq('seller_id', userId!)
        .order('created_at', { ascending: false });
      // L'errore non si ingoia: senza questa riga la lettura non FALLISCE mai — torna «riuscita»
      // con la lista vuota, e nessun riquadro d'errore potrà mai comparire perché non c'è niente da
      // mostrare. È la forma che «Vicino a te» aveva sul lato cliente: il freno a valle non serve a
      // niente se il guasto non arriva mai fin lì.
      if (error) throw error;
      return (data ?? []) as Promo[];
    },
  });
  const promos = queryPromos.data ?? [];

  // Collaudo del 12/11 — una chiave sua (quella delle categorie della vetrina ha un'altra forma:
  // condividerla rompeva i link della home), e solo le categorie dove il negozio ha prodotti: lo
  // sconto confronta la categoria ESATTA del prodotto, e una promo sulla categoria madre o su una
  // categoria vuota annuncerebbe uno sconto che non c'è.
  const queryCategorie = useQuery({
    queryKey: ['seller', 'promo-categorie', userId ?? ''] as const,
    enabled: !!userId && showWizard && scope === 'category',
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data: prodotti, error: errProdotti } = await supabase
        .from('products')
        .select('category_id')
        .eq('seller_id', userId!);
      if (errProdotti) throw errProdotti;
      const ids = [...new Set(((prodotti ?? []) as Array<{ category_id: string | null }>).map((p) => p.category_id).filter((x): x is string => !!x))];
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('categories').select('id, name').in('id', ids).order('name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
  const categorie = queryCategorie.data ?? [];
  const nomeCategoria = categorie.find((c) => c.id === categoriaId)?.name ?? null;

  const create = useMutation({
    mutationFn: async () => {
      const ends = endDateFor(duration);
      if (scope === 'category' && !categoriaId) throw new Error('Scegli la categoria da scontare.');
      const { error } = await supabase.from('seller_promotions').insert({
        seller_id: userId,
        title: title.trim() || `Sconto ${percent}%`,
        discount_percent: percent,
        scope,
        ...(scope === 'category' ? { category_id: categoriaId } : {}),
        ends_at: ends.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Promozione creata! È già attiva e visibile ai clienti.');
      qc.invalidateQueries({ queryKey: queryKeys.seller.promotions });
      setShowWizard(false);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('seller_promotions').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Promo cancellata');
      qc.invalidateQueries({ queryKey: queryKeys.seller.promotions });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // Un tocco solo non chiude più una promo: si chiede conferma.
  const chiediCancellazione = async (p: { id: string; title: string }) => {
    const ok = await confirmDialog({
      title: 'Cancellare la promozione?',
      message: `«${p.title}» smette subito di valere: i clienti vedranno di nuovo il prezzo pieno.`,
      confirmLabel: 'Sì, cancella',
      danger: true,
    });
    if (ok) cancel.mutate(p.id);
  };

  const vista = vistaDaQuery(queryPromos);
  if (!userId || vista.mostraScheletro) return <LoadingState />;
  if (vista.mostraErrore) {
    return (
      <ErrorState
        title="Non sono riuscito a leggere le tue promozioni"
        description="La lettura non è riuscita, quindi non so quali promozioni hai attive. Non vuol dire che non ne hai: riprova fra un momento."
        onRetry={() => queryPromos.refetch()}
      />
    );
  }

  const active = promos.filter((p) => p.status === 'active' && new Date(p.ends_at) > new Date());
  const past = promos.filter((p) => p.status !== 'active' || new Date(p.ends_at) <= new Date());

  return (
    <div className="space-y-6">
      <SellerPageTitle
        eyebrow="Crescita"
        title="Promozioni"
        sub="Crea sconti che spingono le vendite. Si attivano automaticamente."
        className="mb-0"
        action={<Button onClick={() => setShowWizard(true)} icon={Plus}>Nuova promo (30 sec)</Button>}
      />

      {/* Promo attive */}
      <section>
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Attive ({active.length})</h2>
        {active.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
            <Sparkles size={32} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-600 font-medium">Nessuna promo attiva</p>
            <button onClick={() => setShowWizard(true)} className="mt-3 text-primary-700 hover:underline font-semibold text-sm">
              Crea la prima →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {active.map((p) => (
              <div key={p.id} className="bg-gradient-to-br from-accent-100 to-accent-50 border-2 border-accent-300 rounded-2xl p-5 relative shadow-warm">
                <div className="absolute top-3 right-3 bg-secondary-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                  -{p.discount_percent}%
                </div>
                <p className="font-serif font-bold text-lg text-ink-900 pr-12">{p.title}</p>
                <p className="text-xs text-ink-600 mt-1 flex items-center gap-1">
                  <Calendar size={12} />
                  Fino al {new Date(p.ends_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-xs text-ink-600 mt-0.5 flex items-center gap-1">
                  <Tag size={12} />
                  {p.scope === 'store' ? 'Tutto il negozio' : p.scope === 'category' ? 'Una categoria' : 'Prodotti selezionati'}
                </p>
                <button
                  type="button"
                  onClick={() => { void chiediCancellazione(p); }}
                  disabled={cancel.isPending}
                  className="mt-3 text-xs text-secondary-700 hover:underline font-semibold disabled:opacity-50"
                >
                  Cancella anticipatamente
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Storico */}
      {past.length > 0 && (
        <section>
          <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Storico ({past.length})</h2>
          <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden">
            {past.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-700">{p.title}</p>
                  <p className="text-xs text-ink-400">-{p.discount_percent}% · Terminata {new Date(p.ends_at).toLocaleDateString('it-IT')}</p>
                </div>
                <span className="text-xs text-ink-400 uppercase tracking-wider">{statoDellaPromo(p)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Wizard modal */}
      <Modal
        open={showWizard}
        onClose={() => setShowWizard(false)}
        title="Nuova promozione"
      >
        <div className="space-y-5">
            {/* Step 1: Titolo */}
            <Input
              label="Titolo"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Es. Saldi del weekend"
              maxLength={80}
              className="bg-cream-50"
            />

            {/* Step 2: Percentuale */}
            <fieldset>
              <legend className="block text-sm font-semibold text-ink-900 mb-2">Sconto</legend>
              <div className="grid grid-cols-6 gap-2">
                {PERCENTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPercent(p)}
                    aria-pressed={percent === p}
                    className={`py-2 rounded-lg font-bold border-2 transition-colors text-sm ${
                      percent === p
                        ? 'bg-secondary-500 text-white border-secondary-500'
                        : 'bg-white text-ink-900 border-cream-300 hover:border-secondary-300'
                    }`}
                  >
                    -{p}%
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Step 3: Cosa scontare */}
            <div>
              <label className="block text-sm font-semibold text-ink-900 mb-2">Cosa scontare</label>
              <div className="space-y-2">
                <label className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${scope === 'store' ? 'border-primary-400 bg-primary-50' : 'border-cream-300'}`}>
                  <input type="radio" name="scope" checked={scope === 'store'} onChange={() => setScope('store')} />
                  <span className="text-sm font-semibold">Tutto il negozio</span>
                </label>
                <label className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors ${scope === 'category' ? 'border-primary-400 bg-primary-50' : 'border-cream-300'}`}>
                  <input type="radio" name="scope" checked={scope === 'category'} onChange={() => setScope('category')} />
                  <span className="text-sm font-semibold">Una categoria specifica</span>
                </label>
                {scope === 'category' && (
                  <Select
                    label="Quale categoria"
                    value={categoriaId}
                    onChange={(e) => setCategoriaId(e.target.value)}
                    className="bg-cream-50"
                  >
                    <option value="">{queryCategorie.isError ? '— categorie non lette, riprova' : categorie.length === 0 && !queryCategorie.isLoading ? '— nessun tuo prodotto ha una categoria' : '— scegli la categoria'}</option>
                    {categorie.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                )}
              </div>
            </div>

            {/* Step 4: Durata */}
            <Select
              label="Durata"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="bg-cream-50"
            >
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </Select>

            {/* Preview */}
            <div className="bg-accent-50 border border-accent-200 rounded-lg p-3 text-sm text-ink-700">
              <p className="font-semibold">Anteprima:</p>
              <p>«{title || `Sconto ${percent}%`}» — sconto del <strong>{percent}%</strong> su {scope === 'store' ? 'tutti i tuoi prodotti' : nomeCategoria ? `la categoria «${nomeCategoria}»` : 'la categoria che scegli qui sopra'} fino al {endDateFor(duration).toLocaleDateString('it-IT')}.</p>
            </div>

            <Button
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={scope === 'category' && !categoriaId}
              fullWidth
              size="lg"
            >
              Crea promo
            </Button>
        </div>
      </Modal>
    </div>
  );
}
