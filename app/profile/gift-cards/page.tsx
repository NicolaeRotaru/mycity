'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Send, ArrowLeft, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';

type GiftCard = {
  code: string;
  amount_cents: number;
  balance_cents: number;
  buyer_id: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  message: string | null;
  redeemed_at: string | null;
  expires_at: string;
  created_at: string;
};

const AMOUNTS = [10, 25, 50, 100];

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'MC-';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function GiftCardsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<'buy' | 'mine'>('buy');
  const [amount, setAmount] = useState(25);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/profile/gift-cards'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: cards = [] } = useQuery({
    queryKey: ['gift-cards', userId],
    enabled: !!userId,
    queryFn: async (): Promise<GiftCard[]> => {
      const { data } = await supabase
        .from('gift_cards')
        .select('*')
        .or(`buyer_id.eq.${userId},redeemed_by.eq.${userId}`)
        .order('created_at', { ascending: false });
      return (data ?? []) as GiftCard[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!recipientName.trim() || !recipientEmail.trim()) throw new Error('Compila nome e email destinatario');
      const code = randomCode();
      const cents = amount * 100;
      const { error } = await supabase.from('gift_cards').insert({
        code,
        amount_cents: cents,
        balance_cents: cents,
        buyer_id: userId,
        recipient_name: recipientName.trim(),
        recipient_email: recipientEmail.trim(),
        message: message.trim() || null,
      });
      if (error) throw error;
      return { code, cents };
    },
    onSuccess: ({ code }) => {
      toast.success(`Gift card creata! Codice: ${code}`);
      setRecipientName(''); setRecipientEmail(''); setMessage('');
      qc.invalidateQueries({ queryKey: ['gift-cards'] });
      setTab('mine');
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  if (!userId) return <LoadingState />;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/profile" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft size={14} /> Profilo
        </Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <Gift size={28} className="text-primary-600" />
          Gift Card MyCity
        </h1>
        <p className="text-sm text-ink-500 mt-1">Regala buoni spesa ai tuoi cari. Spendibili nei negozi di Piacenza.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-cream-300">
        <button
          onClick={() => setTab('buy')}
          className={`px-4 py-2 font-semibold text-sm border-b-2 -mb-px ${
            tab === 'buy' ? 'border-primary-600 text-primary-700' : 'border-transparent text-ink-500'
          }`}
        >
          Regala
        </button>
        <button
          onClick={() => setTab('mine')}
          className={`px-4 py-2 font-semibold text-sm border-b-2 -mb-px ${
            tab === 'mine' ? 'border-primary-600 text-primary-700' : 'border-transparent text-ink-500'
          }`}
        >
          Le mie gift card ({cards.length})
        </button>
      </div>

      {tab === 'buy' && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          className="bg-white border border-cream-300 rounded-2xl p-6 space-y-5 shadow-warm"
        >
          {/* Importo */}
          <div>
            <label className="block text-sm font-semibold text-ink-900 mb-2">Importo</label>
            <div className="grid grid-cols-4 gap-2">
              {AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(a)}
                  className={`py-3 rounded-xl font-bold border-2 transition-colors ${
                    amount === a
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-ink-900 border-cream-300 hover:border-primary-300'
                  }`}
                >
                  €{a}
                </button>
              ))}
            </div>
          </div>

          {/* Destinatario */}
          <div>
            <label className="block text-sm font-semibold text-ink-900 mb-1">Nome destinatario *</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Es. Mario Rossi"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-900 mb-1">Email destinatario *</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="mario@example.com"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-ink-900 mb-1">Messaggio personale (opzionale)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Buon compleanno!"
              maxLength={500}
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          <div className="bg-accent-50 border border-accent-200 rounded-lg p-3 text-sm text-ink-700">
            <p><strong>Come funziona:</strong> generi un codice univoco da inviare al destinatario. Lui lo riscatta su MyCity e ha credito di €{amount} per 2 anni.</p>
          </div>

          <button
            type="submit"
            disabled={create.isPending || !recipientName.trim() || !recipientEmail.trim()}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-bold transition-colors"
          >
            <Send size={18} />
            {create.isPending ? 'Creazione…' : `Regala €${amount}`}
          </button>
        </form>
      )}

      {tab === 'mine' && (
        cards.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
            <Gift size={36} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-600 font-medium">Nessuna gift card ancora</p>
            <button onClick={() => setTab('buy')} className="mt-4 text-primary-700 hover:underline font-semibold text-sm">
              Regala la prima →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((c) => {
              const isMine = c.buyer_id === userId;
              const redeemed = !!c.redeemed_at;
              return (
                <div key={c.code} className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-mono font-bold text-lg text-primary-700 inline-flex items-center gap-2">
                        {c.code}
                        <button
                          onClick={() => { navigator.clipboard.writeText(c.code); toast.success('Codice copiato!'); }}
                          className="text-ink-400 hover:text-ink-800"
                          aria-label="Copia"
                        >
                          <Copy size={14} />
                        </button>
                      </p>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {isMine ? `Regalata a ${c.recipient_name}` : 'Ricevuta'} · {new Date(c.created_at).toLocaleDateString('it-IT')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-serif font-bold text-ink-900">{formatPrice(c.balance_cents / 100)}</p>
                      <p className="text-xs text-ink-400">
                        di {formatPrice(c.amount_cents / 100)}
                        {redeemed ? ' · Riscattata' : ' · Disponibile'}
                      </p>
                    </div>
                  </div>
                  {c.message && (
                    <p className="text-sm text-ink-700 italic mt-3 bg-cream-50 rounded-lg p-3">&laquo;{c.message}&raquo;</p>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
