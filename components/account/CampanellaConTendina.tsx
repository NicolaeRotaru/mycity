'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { queryKeys } from '@/lib/queries/keys';
import { toneFor, formatDate } from '@/lib/notifiche-aspetto';

/**
 * LA CAMPANELLA CON LA TENDINA DELLE ULTIME NOTIFICHE — 28/11/2026.
 *
 * Nata nella barra in alto del negozio (components/seller/SellerShell.tsx, 25/11/2026). Nicola, dal
 * telefono, il 28/11: la barra dell'admin «rendila uguale a quella di Pane Quotidiano e SDG… mettici anche
 * le notifiche». Sta qui perché la usano le due barre: stesso conto, stessa tendina, stesse regole.
 */

/**
 * Le promozioni e la newsletter contano solo per chi le ha accese nelle impostazioni
 * (`notif_promos`, `notif_newsletter`): chi le ha spente non riceve la push, e il pallino
 * non deve accendersi per loro. Ritorna le categorie da lasciare fuori dal conto.
 * Se la preferenza non si legge, si va avanti senza le due categorie: un errore
 * sulla preferenza non deve spegnere il pallino degli ordini non letti.
 */
export async function categorieSpenteDelCampanello(userId: string): Promise<string[]> {
  const { data: preferenze, error } = await supabase
    .from('profiles')
    .select('notif_promos, notif_newsletter')
    .eq('id', userId)
    .maybeSingle();
  const spente: string[] = [];
  if (error || preferenze?.notif_promos !== true) spente.push('promo');
  if (error || preferenze?.notif_newsletter !== true) spente.push('newsletter');
  return spente;
}

/** Conta le notifiche non lette per il pallino del campanello. */
export function useNotifUnread(userId: string | null) {
  const { data = 0 } = useQuery({
    queryKey: [...queryKeys.notifications.count, 'seller-bell', userId ?? ''],
    enabled: !!userId,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!userId) return 0;
      let conta = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      for (const categoria of await categorieSpenteDelCampanello(userId)) conta = conta.neq('category', categoria);
      const { count, error } = await conta;
      if (error) return 0;
      return count ?? 0;
    },
  });
  return data;
}

/** Quante notifiche si vedono nella tendina: le altre stanno nel Centro notifiche. */
const ULTIME_NELLA_TENDINA = 6;

type NotificaTendina = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

/**
 * 25/11/2026 — LA TENDINA DICEVA «HAI 3 NOTIFICHE NON LETTE» E NON DICEVA QUALI.
 *
 * Nicola: «dentro la finestra delle notifiche in alto a destra siano visibili le ultime notifiche».
 * Per sapere cosa era successo il negoziante doveva aprire un'altra pagina. Ora la tendina legge le
 * ultime notifiche, con le stesse regole del pallino (le promozioni solo per chi le ha accese), e
 * solo quando è aperta: con la tendina chiusa non parte nessuna lettura in più.
 * L'utente sta in fondo alla chiave: così «Segna tutte come lette» del Centro notifiche aggiorna
 * anche questa lista (R01-001 cerca le chiavi per l'ultimo pezzo).
 */
function useUltimeNotifiche(userId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.notifications.list, 'seller-bell', userId ?? ''],
    enabled: !!userId,
    // Si apre per vedere cosa c'è di nuovo: ogni apertura rilegge.
    staleTime: 0,
    queryFn: async (): Promise<NotificaTendina[]> => {
      if (!userId) return [];
      let lista = supabase
        .from('notifications')
        .select('id, user_id, title, body, link, is_read, created_at')
        .eq('user_id', userId);
      for (const categoria of await categorieSpenteDelCampanello(userId)) lista = lista.neq('category', categoria);
      const { data, error } = await lista
        .order('created_at', { ascending: false })
        .limit(ULTIME_NELLA_TENDINA);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * 6/9/2026 — IL PANNELLO DICEVA DI ESSERE UNA FINESTRA DI DIALOGO E NON LO ERA.
 *
 * C'erano `role="dialog"` e l'etichetta, ma niente di quello che un dialogo deve
 * fare: il tasto Esc non lo chiudeva, il fuoco non entrava dentro e alla
 * chiusura non tornava al campanello. Chi lavora da sola tastiera apriva le
 * notifiche degli ordini e per uscirne doveva ritrovare il pulsante a mano.
 *
 * La regola della casa e' scritta in `components/hooks/useBottomSheetA11y.ts`:
 * nessun pannello sovrapposto scritto a mano: o passa da `components/ui/Modal.tsx`,
 * o passa da quell'hook. Qui passa dall'hook, come gia' fanno i filtri della
 * ricerca, il cassetto dell'amministrazione e la foto ingrandita del prodotto.
 */
function NotifPopover({
  unread,
  userId,
  onClose,
  triggerRef,
  idPannello,
}: {
  unread: number;
  userId: string | null;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
  idPannello: string;
}) {
  const pannelloRef = useRef<HTMLDivElement>(null);
  const elencoRef = useRef<HTMLUListElement>(null);
  const qc = useQueryClient();
  const { data: ultime, isLoading, isError, refetch } = useUltimeNotifiche(userId);
  // Il pannello esiste solo da aperto: il montaggio e' l'apertura, e lo
  // smontaggio riporta il fuoco sul campanello.
  // È una tendina, non un foglio a tutto schermo: la pagina sotto continua a scorrere.
  useBottomSheetA11y(true, pannelloRef, triggerRef, onClose, { bloccaScorrimento: false });

  // Aprire una notifica la segna letta, come nel Centro notifiche. Best effort: se la scrittura
  // non riesce la notifica si apre lo stesso, e il pallino resta finché non riesce.
  const segnaLetta = (id: string) => {
    if (!userId) return;
    void supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) return;
        void qc.invalidateQueries({ queryKey: queryKeys.notifications.count });
        void qc.invalidateQueries({ queryKey: queryKeys.notifications.list });
      });
  };

  const righe = ultime ?? [];

  // All'apertura si rilegge anche il numero delle non lette: la lista è appena letta, il numero no
  // (si aggiorna ogni due minuti), e i due non devono dire cose diverse (collaudo del 25/11).
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: [...queryKeys.notifications.count, 'seller-bell'] });
  }, [qc]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-dropdown"
      />
      <div
        ref={pannelloRef}
        id={idPannello}
        role="dialog"
        aria-modal="true"
        aria-label="Notifiche"
        className="absolute right-0 top-[calc(100%+10px)] z-modal w-[360px] max-w-[88vw] overflow-hidden rounded-xl border border-cream-200 bg-surface-0 text-ink-900 shadow-warm-xl"
      >
        <div className="flex items-center justify-between border-b border-cream-200 px-4 py-3">
          <span className="font-serif text-base font-bold">Notifiche</span>
          {unread > 0 && (
            <span className="text-xs font-semibold text-primary-700">{unread} non lette</span>
          )}
        </div>
        {isLoading && userId ? (
          <p className="px-4 py-6 text-center text-sm text-ink-500" role="status">Carico le notifiche…</p>
        ) : isError && righe.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center" role="alert">
            <p className="text-sm text-ink-600">Non riusciamo a leggere le notifiche.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-full border border-cream-300 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-cream-50"
            >
              Riprova
            </button>
          </div>
        ) : righe.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-500">Nessuna notifica, per ora.</p>
        ) : (
          <ul ref={elencoRef} tabIndex={-1} className="max-h-[min(60vh,420px)] divide-y divide-cream-200 overflow-y-auto focus:outline-none" aria-label="Ultime notifiche">
            {righe.map((n) => {
              const tono = toneFor(n);
              const Icona = tono.icon;
              const dentro = (
                <div className={`flex items-start gap-3 px-4 py-3 ${n.is_read ? '' : 'bg-primary-50/40'}`}>
                  <span
                    className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tono.bg} ${tono.fg}`}
                    aria-hidden
                  >
                    <Icona size={16} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug ${n.is_read ? 'font-medium text-ink-700' : 'font-semibold text-ink-900'}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{n.body}</p>}
                    <p className="mt-1 text-2xs text-ink-400">{formatDate(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
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
                    <Link
                      href={n.link}
                      className="block hover:bg-cream-50"
                      onClick={() => {
                        if (!n.is_read) segnaLetta(n.id);
                        onClose();
                      }}
                    >
                      {dentro}
                    </Link>
                  ) : !n.is_read ? (
                    // Senza un indirizzo da aprire, il clic la segna letta (collaudo del 25/11).
                    <button
                      type="button"
                      onClick={() => {
                        segnaLetta(n.id);
                        // Letta, la voce non è più un pulsante: il fuoco resta nella tendina (collaudo del 25/11).
                        elencoRef.current?.focus();
                      }}
                      aria-label={`${n.title}: segna come letta`}
                      className="block w-full text-left hover:bg-cream-50"
                    >
                      {dentro}
                    </button>
                  ) : (
                    dentro
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/notifications"
          onClick={onClose}
          className="block w-full border-t border-cream-200 bg-cream-50 px-4 py-3 text-center text-sm font-semibold text-ink-700 hover:bg-cream-100"
        >
          Vedi tutte nel Centro notifiche
        </Link>
      </div>
    </>
  );
}

/**
 * Il pulsante col pallino e la tendina. `idPannello` cambia fra le barre (nel negozio resta quello di
 * sempre); `etichettaConConto` fa dire al lettore di schermo quante sono da leggere («Notifiche: 3 da
 * leggere»), come la campanella che c'era nella barra nera dell'admin (R03-021).
 */
export default function CampanellaConTendina({
  userId,
  idPannello = 'pannello-notifiche-venditore',
  etichettaConConto = false,
}: {
  userId: string | null;
  idPannello?: string;
  etichettaConConto?: boolean;
}) {
  const [aperta, setAperta] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nonLette = useNotifUnread(userId);
  const etichetta = etichettaConConto && nonLette > 0 ? `Notifiche: ${nonLette > 99 ? '99+' : nonLette} da leggere` : 'Notifiche';
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setAperta((o) => !o)}
        aria-label={etichetta}
        aria-haspopup="dialog"
        aria-expanded={aperta}
        aria-controls={idPannello}
        className="relative inline-flex items-center justify-center rounded-full p-2 text-ink-600 hover:bg-cream-100"
      >
        <Bell size={20} aria-hidden />
        {nonLette > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-secondary-600" aria-hidden />
        )}
      </button>
      {aperta && (
        <NotifPopover
          unread={nonLette}
          userId={userId}
          onClose={() => setAperta(false)}
          triggerRef={triggerRef}
          idPannello={idPannello}
        />
      )}
    </div>
  );
}
