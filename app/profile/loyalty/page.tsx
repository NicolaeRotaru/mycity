'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Flame, Trophy, Gift, ChevronRight, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import {
  fetchLoyaltyAccount,
  TIER_META,
  nextTier,
  pointsToEurValue,
  POINTS_REDEEM_RATE,
  POINTS_REDEEM_VALUE_CENTS,
  type LoyaltyAccount,
} from '@/lib/loyalty';
import { queryKeys } from '@/lib/queries/keys';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';

type Tx = { id: string; delta: number; reason: string; created_at: string };

const REASON_LABEL: Record<string, string> = {
  signup_bonus:     'Bonus iscrizione',
  first_order:      'Primo ordine',
  order_completed:  'Ordine completato',
  streak_7_days:    'Streak 7 giorni',
  streak_30_days:   'Streak 30 giorni',
  streak_100_days:  'Streak 100 giorni',
  referral_bonus:   'Referral amico',
  redeem:           'Sconto applicato',
  redeem_credit:    'Convertiti in credito',
};

// I numeri dei punti si scrivono all'italiana, col punto delle migliaia (12.345), come i prezzi.
// R23-018 correzione (14/11/2026) — Senza `useGrouping: 'always'` la regola italiana di Intl mette il
// punto solo da cinque cifre in su: 1250 punti uscivano «1250», «+1000 pt». Con 'always' anche
// quattro cifre hanno il punto: «1.250», «+1.000 pt».
const NUMERO_IT = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });

export default function LoyaltyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/sign-in?returnTo=/profile/loyalty');
        return;
      }
      setUserId(data.user.id);
    });
  }, [router]);

  const {
    data: account,
    isError: contoNonLetto,
    isPending: contoInLettura,
    error: erroreDelConto,
    refetch: rileggiConto,
  } = useQuery<LoyaltyAccount | null>({
    queryKey: queryKeys.loyalty.accountByUser(userId ?? ''),
    enabled: !!userId,
    queryFn: () => fetchLoyaltyAccount(),
  });

  // R23-018 correzione (14/11/2026) — Senza più la sessione (uscito da un'altra scheda, sessione scaduta)
  // `getUser` dà AuthSessionMissingError: non è un guasto da riprovare, si torna all'accesso. Prima la
  // pagina mostrava «Non riusciamo a leggere i tuoi punti» con un «Riprova» che non poteva funzionare.
  const sessioneFinita = isAuthSessionMissingError(erroreDelConto);
  useEffect(() => {
    if (sessioneFinita) router.push('/sign-in?returnTo=/profile/loyalty');
  }, [sessioneFinita, router]);

  const { data: txs = [], isError: movimentiNonLetti, refetch: rileggiMovimenti } = useQuery<Tx[]>({
    queryKey: queryKeys.loyalty.txsByUser(userId ?? ''),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loyalty_transactions')
        .select('id, delta, reason, created_at')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
  });

  const qc = useQueryClient();

  /**
   * 6/9/2026 — Stessa lettura e stessa chiave della pagina «Gift card»: l'errore
   * diventava lo zero, e lo zero finto restava in cache per tutte e due. Qui si
   * vedeva di meno (la frase «Hai gia' … di credito» spariva e basta), ma era la
   * stessa bugia: adesso l'errore esce e la pagina lo dice.
   */
  const { data: walletCents = 0, isError: creditoNonLetto } = useQuery<number>({
    queryKey: queryKeys.wallet.byUser(userId ?? ''),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('wallet_balance_cents').eq('id', userId!).single();
      if (error) throw error;
      return (data?.wallet_balance_cents as number) ?? 0;
    },
  });

  const convert = useMutation({
    mutationFn: async (pts: number) => {
      const { data, error } = await supabase.rpc('convert_loyalty_to_credit', { p_points: pts });
      if (error) throw error;
      return (data as { credited_cents?: number })?.credited_cents ?? 0;
    },
    onSuccess: (cents) => {
      toast.success(`Convertiti in ${formatPrice(cents / 100)} di credito!`);
      qc.invalidateQueries({ queryKey: queryKeys.loyalty.accountByUser(userId!) });
      qc.invalidateQueries({ queryKey: queryKeys.loyalty.txsByUser(userId!) });
      qc.invalidateQueries({ queryKey: queryKeys.wallet.all });
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (!userId) return <LoadingState />;

  // R23-018 correzione — Finché il conto non è arrivato (anche mentre ritenta dopo un guasto, o resta in
  // attesa della rete) non c'è nessun numero da scrivere: prima qui usciva «0 punti, Bronzo», e solo dopo
  // i tentativi l'errore giusto.
  if (sessioneFinita || (contoInLettura && !account)) return <LoadingState />;

  // Conto non letto (e niente di vecchio da mostrare): si dice, invece di scrivere «0 punti».
  if (contoNonLetto && !account) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
        <ErrorState
          title="Non riusciamo a leggere i tuoi punti"
          description="Non è colpa tua: i punti che hai restano tuoi. Riprova fra un momento."
          retry={() => rileggiConto()}
          backHref="/profile"
          backLabel="Torna al profilo"
        />
      </div>
    );
  }

  const points = account?.points_balance ?? 0;
  const lifetime = account?.lifetime_earned ?? 0;
  const tier = account?.tier ?? 'bronze';
  const streak = account?.streak_days ?? 0;
  const longest = account?.longest_streak ?? 0;
  const tierMeta = TIER_META[tier];
  const next = nextTier(lifetime, tier);
  const eurValue = pointsToEurValue(points);
  const convertiblePoints = Math.floor(points / 100) * 100;
  const convertibleEuro = (convertiblePoints / 100) * 5;

  // Progress bar verso prossimo livello
  const currentThreshold = tierMeta.threshold;
  const nextThreshold = next.tier ? TIER_META[next.tier].threshold : lifetime;
  const progress = nextThreshold > currentThreshold
    ? Math.min(100, ((lifetime - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
    : 100;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/profile" className="text-sm text-ink-500 hover:text-ink-800">← Torna al profilo</Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900">I tuoi punti MyCity</h1>
      </div>

      {/* HERO punti + tier */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 text-white rounded-2xl p-8 shadow-warm-lg relative overflow-hidden">
        <div aria-hidden className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -bottom-16 -left-12 w-56 h-56 rounded-full bg-accent-400/20" />

        <div className="relative">
          <div className="flex items-baseline gap-2">
            <span className="text-6xl md:text-7xl font-serif font-extrabold">{NUMERO_IT.format(points)}</span>
            <span className="text-lg opacity-90">punti</span>
          </div>
          {/* 31/10/2026 — Con i punti spenti (migrazione 168) i punti non diventano sconto: niente cifra in euro. */}
          <p className="text-sm opacity-90 mt-1">
            {INVITI_E_PUNTI_ACCESI
              ? <>= {formatPrice(eurValue)} di sconto disponibili (1 buono ogni {POINTS_REDEEM_RATE} punti)</>
              : <>I punti non sono ancora attivi: quelli che hai restano tuoi.</>}
          </p>

          <div className="mt-6 flex items-center gap-3 bg-white/15 rounded-2xl p-4 backdrop-blur">
            <tierMeta.icon size={30} className="text-white shrink-0" aria-hidden />

            <div className="flex-1">
              <p className="text-xs uppercase tracking-wider opacity-80">Il tuo livello</p>
              <p className="text-xl font-serif font-bold">{tierMeta.label}</p>
            </div>
            {next.tier && (
              <div className="text-right">
                <p className="text-xs opacity-80">{/^[AEIOU]/i.test(TIER_META[next.tier].label) ? "All'" : 'Al '}{TIER_META[next.tier].label}</p>
                <p className="text-sm font-bold">{NUMERO_IT.format(next.remaining)} punti</p>
              </div>
            )}
          </div>

          {next.tier && (
            <div className="mt-3">
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-400 rounded-full transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Converti punti in credito spendibile — solo coi punti accesi: spenti, il database rifiuta la conversione (migrazione 168). */}
      {INVITI_E_PUNTI_ACCESI ? (
      <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
        <div className="flex items-center gap-2 mb-1">
          <Wallet size={20} className="text-primary-600" />
          <h2 className="font-serif font-bold text-lg text-ink-900">Converti in credito</h2>
        </div>
        <p className="text-sm text-ink-600 mb-3">
          {POINTS_REDEEM_RATE} punti = {formatPrice(POINTS_REDEEM_VALUE_CENTS / 100)} di credito MyCity, spendibile negli ordini con pagamento alla consegna.
          {creditoNonLetto
            ? <> Il credito che hai gi&agrave; non riusciamo a leggerlo adesso.</>
            : walletCents > 0 && <> Hai già <strong>{formatPrice(walletCents / 100)}</strong> di credito.</>}
        </p>
        {convertiblePoints >= 100 ? (
          <Button onClick={() => convert.mutate(convertiblePoints)} loading={convert.isPending} icon={Wallet}>
            Converti {NUMERO_IT.format(convertiblePoints)} punti in {formatPrice(convertibleEuro)}
          </Button>
        ) : (
          <p className="text-sm text-ink-400">Ti servono almeno 100 punti per convertire.</p>
        )}
      </div>
      ) : (
      <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
        <div className="flex items-center gap-2 mb-1">
          <Wallet size={20} className="text-primary-600" />
          <h2 className="font-serif font-bold text-lg text-ink-900">I punti sono in pausa</h2>
        </div>
        <p className="text-sm text-ink-600">
          Per ora gli ordini non danno punti e i punti non si convertono in credito. Quelli che hai restano tuoi.
          {creditoNonLetto
            ? <> Il credito che hai gi&agrave; non riusciamo a leggerlo adesso.</>
            : walletCents > 0 && <> Hai già <strong>{formatPrice(walletCents / 100)}</strong> di credito, e resta spendibile negli ordini con pagamento alla consegna.</>}
        </p>
      </div>
      )}

      {/* Streak card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <div className="flex items-center gap-3 mb-2">
            <Flame size={24} className="text-primary-600" />
            <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Streak attuale</p>
          </div>
          <p className="text-3xl font-serif font-bold text-ink-900">{streak} <span className="text-base font-medium text-ink-600">{streak === 1 ? 'giorno' : 'giorni'}</span></p>
          <p className="text-xs text-ink-500 mt-1">
            {INVITI_E_PUNTI_ACCESI ? 'Visita ogni giorno per accumulare bonus a 7, 30, 100 giorni.' : 'I giorni di fila in cui sei passato da MyCity.'}
          </p>
        </div>
        <div className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm">
          <div className="flex items-center gap-3 mb-2">
            <Trophy size={24} className="text-accent-600" />
            <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold">Record personale</p>
          </div>
          <p className="text-3xl font-serif font-bold text-ink-900">{longest} <span className="text-base font-medium text-ink-600">{longest === 1 ? 'giorno' : 'giorni'}</span></p>
          <p className="text-xs text-ink-500 mt-1">Il tuo streak più lungo finora.</p>
        </div>
      </div>

      {/* Come funziona — spiega come si guadagnano punti: coi punti spenti sarebbe una promessa falsa. */}
      {INVITI_E_PUNTI_ACCESI && (
      <div className="bg-cream-50 border border-cream-300 rounded-2xl p-6">
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-4 flex items-center gap-2">
          <Sparkles size={18} className="text-primary-600" />
          Come accumuli punti
        </h2>
        <ul className="space-y-2.5 text-sm text-ink-700">
          {[
            { n: '+1 pt', t: `per ogni ${formatPrice(1)} speso negli ordini` },
            { n: '+20 pt', t: 'a 7 giorni di visite consecutive' },
            { n: '+100 pt', t: 'a 30 giorni di streak' },
            { n: '+500 pt', t: 'a 100 giorni di streak' },
            { n: '+50 pt', t: 'per ogni amico che si iscrive con il tuo codice referral' },
            { n: formatPrice(POINTS_REDEEM_VALUE_CENTS / 100), t: `puoi convertire ${POINTS_REDEEM_RATE} punti in un buono spendibile al checkout` },
          ].map((r) => (
            <li key={r.t} className="flex items-baseline gap-3">
              <span className="text-primary-700 font-bold w-20 shrink-0">{r.n}</span>
              <span>{r.t}</span>
            </li>
          ))}
        </ul>
      </div>
      )}

      {/* Storico */}
      <div>
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Movimenti recenti</h2>
        {txs.length === 0 && movimentiNonLetti ? (
          <ErrorState
            variant="compact"
            title="Non riusciamo a leggere i movimenti"
            description="Riprova fra un momento."
            retry={() => rileggiMovimenti()}
            supportHref={null}
          />
        ) : txs.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
            <Gift size={32} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-600 font-medium mb-1">Nessun movimento</p>
            <p className="text-sm text-ink-400">{INVITI_E_PUNTI_ACCESI ? 'I punti che guadagnerai compariranno qui.' : 'Qui compariranno i movimenti dei tuoi punti.'}</p>
            <Link href="/search" className="inline-flex items-center gap-1 mt-4 text-primary-700 hover:underline font-semibold text-sm">
              Vai allo shopping <ChevronRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden">
            {txs.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{REASON_LABEL[tx.reason] ?? tx.reason}</p>
                  <p className="text-xs text-ink-400">{new Date(tx.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <span className={`font-bold ${tx.delta >= 0 ? 'text-olive-700' : 'text-primary-700'}`}>
                  {tx.delta >= 0 ? '+' : ''}{NUMERO_IT.format(tx.delta)} pt
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
