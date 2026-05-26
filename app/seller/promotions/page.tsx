'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ArrowLeft, Plus, Calendar, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { Modal } from '@/components/ui/Modal';

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
  const [duration, setDuration] = useState('7d');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/seller/promotions'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: promos = [] } = useQuery({
    queryKey: ['seller-promotions', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Promo[]> => {
      const { data } = await supabase
        .from('seller_promotions')
        .select('*')
        .eq('seller_id', userId!)
        .order('created_at', { ascending: false });
      return (data ?? []) as Promo[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const ends = endDateFor(duration);
      const { error } = await supabase.from('seller_promotions').insert({
        seller_id: userId,
        title: title.trim() || `Sconto ${percent}%`,
        discount_percent: percent,
        scope,
        ends_at: ends.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Promozione creata! È già attiva e visibile ai buyer.');
      qc.invalidateQueries({ queryKey: ['seller-promotions'] });
      setShowWizard(false);
    },
    onError: (err: any) => toast.error(err.message ?? 'Errore'),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('seller_promotions').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Promo cancellata');
      qc.invalidateQueries({ queryKey: ['seller-promotions'] });
    },
  });

  if (!userId) return <div className="container mx-auto p-8 text-center text-ink-500">Caricamento…</div>;

  const active = promos.filter((p) => p.status === 'active' && new Date(p.ends_at) > new Date());
  const past = promos.filter((p) => p.status !== 'active' || new Date(p.ends_at) <= new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/seller/dashboard" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
            <ArrowLeft size={14} /> Dashboard
          </Link>
          <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
            <Sparkles size={28} className="text-accent-600" />
            Promozioni
          </h1>
          <p className="text-sm text-ink-500 mt-1">Crea sconti che spingono le vendite. Si attivano automaticamente.</p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors shadow-warm"
        >
          <Plus size={18} />
          Nuova promo (30 sec)
        </button>
      </div>

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
                  onClick={() => cancel.mutate(p.id)}
                  className="mt-3 text-xs text-secondary-700 hover:underline font-semibold"
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
                <span className="text-xs text-ink-400 uppercase tracking-wider">{p.status}</span>
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
            <div>
              <label className="block text-sm font-semibold text-ink-900 mb-1">Titolo</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Es. Saldi del weekend"
                maxLength={80}
                className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>

            {/* Step 2: Percentuale */}
            <div>
              <label className="block text-sm font-semibold text-ink-900 mb-2">Sconto</label>
              <div className="grid grid-cols-6 gap-2">
                {PERCENTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPercent(p)}
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
            </div>

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
              </div>
            </div>

            {/* Step 4: Durata */}
            <div>
              <label className="block text-sm font-semibold text-ink-900 mb-2">Durata</label>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                {DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            {/* Preview */}
            <div className="bg-accent-50 border border-accent-200 rounded-lg p-3 text-sm text-ink-700">
              <p className="font-semibold">Anteprima:</p>
              <p>«{title || `Sconto ${percent}%`}» — sconto del <strong>{percent}%</strong> su {scope === 'store' ? 'tutti i tuoi prodotti' : 'la categoria selezionata'} fino al {endDateFor(duration).toLocaleDateString('it-IT')}.</p>
            </div>

            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-bold transition-colors"
            >
              {create.isPending ? 'Creazione…' : 'Crea promo'}
            </button>
        </div>
      </Modal>
    </div>
  );
}
