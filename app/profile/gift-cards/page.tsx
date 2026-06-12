'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Send, ArrowLeft, Copy, Wallet, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { queryKeys } from '@/lib/queries/keys';

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

export default function GiftCardsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<'buy' | 'redeem' | 'mine'>('buy');
  const [amount, setAmount] = useState(25);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [redeemCode, setRedeemCode] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/profile/gift-cards'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  // Esito ritorno da Stripe (?giftcard=success|canceled).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('giftcard');
    if (p === 'success') {
      toast.success('Pagamento riuscito! La gift card è in arrivo al destinatario.');
      setTab('mine');
      window.history.replaceState({}, '', '/profile/gift-cards');
    } else if (p === 'canceled') {
      toast.info('Pagamento annullato.');
      window.history.replaceState({}, '', '/profile/gift-cards');
    }
  }, []);

  const { data: balanceCents = 0 } = useQuery({
    queryKey: queryKeys.wallet.byUser(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<number> => {
      const { data } = await supabase.from('profiles').select('wallet_balance_cents').eq('id', userId!).single();
      return (data?.wallet_balance_cents as number) ?? 0;
    },
  });

  const { data: cards = [] } = useQuery({
    queryKey: queryKeys.giftCards.byUser(userId ?? ''),
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

  // Acquisto: paga con carta via Stripe, poi il webhook crea la carta e invia il codice.
  const buy = useMutation({
    mutationFn: async () => {
      if (!recipientName.trim() || !recipientEmail.trim()) throw new Error('Compila nome e email destinatario');
      const res = await fetch('/api/gift-cards/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountEuro: amount,
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim(),
          message: message.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || 'Errore nel pagamento');
      window.location.href = json.url as string; // redirect a Stripe Checkout
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // Riscatto: il codice diventa credito MyCity spendibile.
  const redeem = useMutation({
    mutationFn: async () => {
      const code = redeemCode.trim();
      if (!code) throw new Error('Inserisci il codice');
      const { data, error } = await supabase.rpc('redeem_gift_card', { p_code: code });
      if (error) throw error;
      return (data as { credited_cents?: number })?.credited_cents ?? 0;
    },
    onSuccess: (cents) => {
      toast.success(`Riscattata! +${formatPrice(cents / 100)} di credito`);
      setRedeemCode('');
      qc.invalidateQueries({ queryKey: queryKeys.wallet.all });
      qc.invalidateQueries({ queryKey: queryKeys.giftCards.all });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (!userId) return <LoadingState />;

  const TabBtn = ({ id, label }: { id: typeof tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-2 font-semibold text-sm border-b-2 -mb-px ${
        tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-ink-500'
      }`}
    >
      {label}
    </button>
  );

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

      {/* Saldo credito */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white rounded-2xl p-5 shadow-warm flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
          <Wallet size={24} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider opacity-80">Il tuo credito MyCity</p>
          <p className="text-3xl font-serif font-extrabold">{formatPrice(balanceCents / 100)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-cream-300">
        <TabBtn id="buy" label="Regala" />
        <TabBtn id="redeem" label="Riscatta" />
        <TabBtn id="mine" label={`Le mie gift card (${cards.length})`} />
      </div>

      {tab === 'buy' && (
        <form
          onSubmit={(e) => { e.preventDefault(); buy.mutate(); }}
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
          <Input
            label="Nome destinatario *"
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="Es. Mario Rossi"
          />
          <Input
            label="Email destinatario *"
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="mario@example.com"
            inputMode="email"
          />
          <Textarea
            label="Messaggio personale (opzionale)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Buon compleanno!"
            maxLength={500}
          />

          <div className="bg-accent-50 border border-accent-200 rounded-lg p-3 text-sm text-ink-700">
            <p><strong>Come funziona:</strong> paghi €{amount} con carta; inviamo subito un codice al destinatario via email. Lui lo riscatta su MyCity e ottiene €{amount} di credito (valido 2 anni).</p>
          </div>

          <Button
            type="submit"
            loading={buy.isPending}
            disabled={!recipientName.trim() || !recipientEmail.trim()}
            fullWidth
            size="lg"
            icon={Send}
          >
            Paga €{amount} e regala
          </Button>
        </form>
      )}

      {tab === 'redeem' && (
        <form
          onSubmit={(e) => { e.preventDefault(); redeem.mutate(); }}
          className="bg-white border border-cream-300 rounded-2xl p-6 space-y-5 shadow-warm"
        >
          <div className="flex items-center gap-2 text-ink-900">
            <Ticket size={20} className="text-primary-600" />
            <h2 className="font-serif font-bold text-lg">Riscatta un codice</h2>
          </div>
          <p className="text-sm text-ink-600">Hai ricevuto una gift card? Inserisci il codice: il valore diventa credito spendibile sul tuo account.</p>
          <Input
            label="Codice gift card"
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            placeholder="MC-XXXXXXXXXXXX"
            autoComplete="off"
          />
          <Button type="submit" loading={redeem.isPending} disabled={!redeemCode.trim()} fullWidth size="lg" icon={Wallet}>
            Riscatta
          </Button>
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
