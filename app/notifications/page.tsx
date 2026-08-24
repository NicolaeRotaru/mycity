'use client';

import { useEffect } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, Inbox, Package, Tag, Gift, Sparkles, MessageCircle, CheckCheck,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';

type Notification = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'adesso';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min fa`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ore fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Tono icona-badge per tipo di notifica. Solo brand token (primary/secondary/
 * accent/olive) — nessun colore decorativo fuori palette. Il tipo è derivato
 * da link + titolo, dato che lo schema non ha una colonna `type` dedicata.
 */
type Tone = { bg: string; fg: string; icon: LucideIcon };
const TONES: Record<string, Tone> = {
  order:    { bg: 'bg-primary-100',   fg: 'text-primary-700',   icon: Package },
  promo:    { bg: 'bg-secondary-100', fg: 'text-secondary-700', icon: Tag },
  gift:     { bg: 'bg-accent-100',    fg: 'text-accent-700',    icon: Gift },
  loyalty:  { bg: 'bg-olive-100',     fg: 'text-olive-700',     icon: Sparkles },
  message:  { bg: 'bg-primary-100',   fg: 'text-primary-700',   icon: MessageCircle },
  default:  { bg: 'bg-cream-200',     fg: 'text-ink-600',       icon: Bell },
};

function toneFor(n: Notification): Tone {
  const hay = `${n.link ?? ''} ${n.title} ${n.body ?? ''}`.toLowerCase();
  if (/order|ordin|consegn|spedi|delivery|rider/.test(hay)) return TONES.order;
  if (/promo|sconto|offert|saldo|deal|drop/.test(hay)) return TONES.promo;
  if (/gift|regalo|buono|gift.?card/.test(hay)) return TONES.gift;
  if (/punt|loyalty|livello|tier|premio|cashback|referral|invit/.test(hay)) return TONES.loyalty;
  if (/messagg|chat|risposta/.test(hay)) return TONES.message;
  return TONES.default;
}

/** Il marcatore del non-autenticato: una costante, cosi' il confronto non e' su una frase libera. */
const AUTH_RICHIESTA = 'AUTH_REQUIRED';

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: async (): Promise<Notification[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      // Un marcatore riconoscibile, non una frase: a valle i due casi vanno distinti, e
      // distinguerli su un testo libero e' come non distinguerli.
      if (!user) throw new Error(AUTH_RICHIESTA);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Segna tutte come lette — su azione esplicita dell'utente (bottone), NON
  // automaticamente al montaggio: così la pagina resta consultabile come elenco
  // senza azzerare il badge appena la apri.
  const markAllRead = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.count });
      qc.invalidateQueries({ queryKey: queryKeys.notifications.list });
    },
  });

  // Qui la query lanciava in due casi — «non sei collegato» e «la lettura e' fallita» — e il render
  // li trattava uguali: qualunque errore buttava la persona sulla pagina di accesso. A un cliente
  // regolarmente collegato bastava un timeout o una rete storta per essere sloggato a vista, senza
  // che nessuno gli dicesse perche'.
  const serveAccesso = error instanceof Error && error.message === AUTH_RICHIESTA;

  // Il salto alla pagina di accesso sta in un effetto, non dentro il render: navigare mentre React
  // sta disegnando e' un effetto collaterale nel posto sbagliato, e prima era scritto cosi'.
  useEffect(() => {
    if (serveAccesso) router.push('/sign-in');
  }, [serveAccesso, router]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (error && !serveAccesso) {
    return (
      <ErrorState
        title="Non riusciamo a caricare le notifiche"
        description="Abbiamo provato a leggerle e non ci siamo riusciti. Riprova fra un attimo."
        onRetry={() => refetch()}
      />
    );
  }

  if (serveAccesso) return null;

  const notifications = data ?? [];
  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Attività</p>
          <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
            Notifiche
          </h1>
          <p className="mt-1 text-sm text-ink-500">Aggiornamenti su ordini, prodotti e novità</p>
        </div>
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cream-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 disabled:opacity-60"
          >
            <CheckCheck size={15} strokeWidth={2.2} className="text-primary-600" aria-hidden />
            Segna tutte come lette
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-cream-300 bg-white p-12 text-center">
          <Inbox size={48} className="mx-auto mb-3 text-ink-500" aria-hidden />
          <p className="mb-1 font-semibold text-ink-600">Nessuna notifica</p>
          <p className="text-sm text-ink-400">Quando ci saranno aggiornamenti, li vedrai qui.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {notifications.map((n) => {
            const tone = toneFor(n);
            const ToneIcon = tone.icon;
            const inner = (
              <div
                className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
                  n.is_read
                    ? 'border-cream-300 bg-white hover:bg-cream-50'
                    : 'border-primary-200 bg-primary-50/40 hover:bg-primary-50'
                }`}
              >
                <span
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.bg} ${tone.fg}`}
                  aria-hidden
                >
                  <ToneIcon size={19} strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <h3 className={`font-semibold ${n.is_read ? 'text-ink-700' : 'text-ink-900'}`}>
                      {n.title}
                    </h3>
                    <span className="whitespace-nowrap text-xs text-ink-400">
                      {formatDate(n.created_at)}
                    </span>
                  </div>
                  {n.body && <p className="text-sm text-ink-600">{n.body}</p>}
                </div>
                {!n.is_read && (
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600"
                    aria-label="Non letta"
                  />
                )}
              </div>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="block">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
