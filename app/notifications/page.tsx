'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Bell, Inbox, Package, Tag, Gift, Sparkles, MessageCircle, CheckCheck,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { useNotificationsCount } from '@/components/hooks/useNotificationsCount';

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

/** Un errore di sessione (non c'è, è scaduta): quello sì manda all'accesso. Gli altri no. */
function sessioneMancante(e: unknown): boolean {
  const x = e as { name?: string; status?: number } | null;
  return x?.name === 'AuthSessionMissingError' || x?.status === 401 || x?.status === 403;
}

/** Il marcatore del non-autenticato: una costante, cosi' il confronto non e' su una frase libera. */
const AUTH_RICHIESTA = 'AUTH_REQUIRED';

/** Quante notifiche si leggono alla volta: «Carica altre» ne aggiunge altrettante (R22-018). */
const PER_VOLTA = 50;

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  // 13/11/2026 (R22-018) — LE NON LETTE OLTRE LE ULTIME CINQUANTA RESTAVANO SUL CAMPANELLO PER SEMPRE.
  // La pagina leggeva solo le ultime 50 e decideva «Segna tutte come lette» guardando solo quelle,
  // mentre il campanello conta tutte le non lette. Chi apriva le notifiche una per una si trovava
  // 50 righe lette, nessun pulsante, nessun modo di arrivare alle più vecchie, e un numero fisso
  // sul campanello. Ora il pulsante guarda il conteggio vero (lo stesso del campanello) e le più
  // vecchie si raggiungono con «Carica altre».
  const [quante, setQuante] = useState(PER_VOLTA);
  const nonLetteDelCampanello = useNotificationsCount();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [...queryKeys.notifications.list, quante],
    // Caricandone altre resta a video l'elenco di prima, non la pagina di attesa.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Notification[]> => {
      const { data: { user }, error: errUtente } = await supabase.auth.getUser();
      // 5/11/2026 — Con la rete caduta getUser non lancia: risponde user null CON un errore. Quello
      // non è «non sei collegato»: si mostra l'errore con «Riprova», non la pagina di accesso.
      // All'accesso si va solo se la sessione manca davvero (nessun utente, o un errore di sessione).
      if (!user && errUtente && !sessioneMancante(errUtente)) throw errUtente;
      // Un marcatore riconoscibile, non una frase: a valle i due casi vanno distinti, e
      // distinguerli su un testo libero e' come non distinguerli.
      if (!user) throw new Error(AUTH_RICHIESTA);
      // 13/11/2026 (R22-013) — Chi ha spento le promozioni nelle impostazioni (`notif_promos`) le
      // vedeva lo stesso qui: l'interruttore lo leggeva solo l'invio delle push. Le promozioni si
      // mostrano solo a chi le ha accese. Se la preferenza non si legge, la lettura fallisce e si
      // riprova, come quella delle notifiche: non si indovina il consenso.
      const { data: preferenze, error: errPreferenze } = await supabase
        .from('profiles')
        .select('notif_promos')
        .eq('id', user.id)
        .maybeSingle();
      if (errPreferenze) throw errPreferenze;
      let lettura = supabase.from('notifications').select('*').eq('user_id', user.id);
      if (preferenze?.notif_promos !== true) lettura = lettura.neq('category', 'promo');
      const { data, error } = await lettura
        .order('created_at', { ascending: false })
        .limit(quante);
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
      // 5/11/2026 — L'esito si legge: se la scrittura cade, i pallini restano e lo si dice.
      const { error: errAggiorna } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (errAggiorna) throw errAggiorna;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications.count });
      qc.invalidateQueries({ queryKey: queryKeys.notifications.list });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  // 5/11/2026 — Aprire una notifica la segna letta: prima il numerino sul campanello restava finché
  // non si premeva «segna tutte». Best effort: se non riesce, la notifica si apre lo stesso.
  const segnaLetta = (id: string) => {
    void supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .then(({ error: e }) => {
        if (!e) {
          qc.invalidateQueries({ queryKey: queryKeys.notifications.count });
          qc.invalidateQueries({ queryKey: queryKeys.notifications.list });
        }
      });
  };

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
  const hasUnread = nonLetteDelCampanello > 0 || notifications.some((n) => !n.is_read);
  // Se ne sono arrivate quante ne ho chieste, ce ne possono essere altre più indietro.
  const forseAltre = notifications.length >= quante;

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
                  // 12/11/2026 (R07-007) — un aria-label su uno <span> senza ruolo i lettori
                  // di schermo lo ignorano: il pallino resta muto e la parola sta in sr-only.
                  <>
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-hidden="true" />
                    <span className="sr-only">Non letta</span>
                  </>
                )}
              </div>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="block" onClick={() => { if (!n.is_read) segnaLetta(n.id); }}>
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

      {forseAltre && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setQuante((q) => q + PER_VOLTA)}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-white px-4 py-2 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 disabled:opacity-60"
          >
            Carica altre
          </button>
        </div>
      )}
    </div>
  );
}
