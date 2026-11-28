'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, CheckCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { categorieDiNotificheSpente, useNotificationsCount } from '@/components/hooks/useNotificationsCount';
import { useUtente } from '@/components/hooks/useUtente';
import { toneFor, formatDate } from '@/lib/notifiche-aspetto';
import { useProfile } from '@/components/hooks/useProfile';
import { indirizzoDellaNotifica } from '@/lib/notifiche/indirizzo-per-chi-apre';

type Notification = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
  category?: string | null;
};

/** Un errore di sessione (non c'è, è scaduta): quello sì manda all'accesso. Gli altri no. */
function sessioneMancante(e: unknown): boolean {
  const x = e as { name?: string; status?: number } | null;
  return x?.name === 'AuthSessionMissingError' || x?.status === 401 || x?.status === 403;
}

/** Il marcatore del non-autenticato: una costante, cosi' il confronto non e' su una frase libera. */
const AUTH_RICHIESTA = 'AUTH_REQUIRED';

/** Finché la preferenza non è letta: promozioni e newsletter fuori, come quando non si legge. */
const CATEGORIE_SPENTE_FINCHE_NON_SI_SA: readonly string[] = ['promo', 'newsletter'];

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
  // R01-varie — Dentro un oggetto: quando cambia la sessione si riparte dalle prime con un oggetto
  // nuovo, e la pagina si ridisegna anche se erano già le prime.
  const [{ quante }, setElenco] = useState({ quante: PER_VOLTA });
  const nonLetteDelCampanello = useNotificationsCount();
  // R01-varie — Di chi è l'elenco: sta nella chiave, e la domanda parte quando lo si sa.
  const { userId, caricamento: utenteInLettura } = useUtente();
  // 28/11/2026 — L'admin che apre una notifica non finisce nel pannello di un negozio (lib/notifiche/indirizzo-per-chi-apre.ts).
  const { isAdmin } = useProfile();

  // R10-012 — L'ultimo elenco letto davvero. Il segnaposto di «Carica altre» vale solo mentre la
  // lettura è in corso: se cade, la domanda nuova non ha dati suoi, e l'errore prendeva tutta la
  // pagina cancellando le notifiche già a video. Con questo restano, e l'errore sta accanto al tasto.
  // Un riferimento, non uno stato: tenerlo da parte non deve ridisegnare la pagina.
  // Vale solo per la sessione che l'ha letto (le righe dicono di chi sono): se la sessione finisce o
  // cambia si butta, e una lettura caduta torna a dare la pagina d'errore. R01-varie — Porta anche
  // l'utente della chiave con cui è stato letto, e si usa solo con quello.
  const ultimoLetto = useRef<{ utente: string | null; righe: Notification[] } | null>(null);

  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useQuery({
    queryKey: [...queryKeys.notifications.list, quante, userId],
    enabled: !utenteInLettura,
    // Caricandone altre resta a video l'elenco di prima, non la pagina di attesa. Se cambia chi
    // guarda, l'elenco si rilegge da capo.
    // R01-001 — Se c'è, l'elenco tenuto di questo utente: è lo stesso elenco di prima, e dopo
    // «Segna tutte» è già segnato letto anche quando la domanda da cui veniva è uscita dalla memoria.
    placeholderData: (prima, domandaPrima) => {
      if (userId === null || domandaPrima?.queryKey.at(-1) !== userId) return undefined;
      const tenuto = ultimoLetto.current;
      return tenuto && tenuto.utente === userId ? tenuto.righe : prima;
    },
    queryFn: async (): Promise<Notification[]> => {
      const { data: { user }, error: errUtente } = await supabase.auth.getUser();
      // 5/11/2026 — Con la rete caduta getUser non lancia: risponde user null CON un errore. Quello
      // non è «non sei collegato»: si mostra l'errore con «Riprova», non la pagina di accesso.
      // All'accesso si va solo se la sessione manca davvero (nessun utente, o un errore di sessione).
      if (!user && errUtente && !sessioneMancante(errUtente)) throw errUtente;
      if (!user || ultimoLetto.current?.righe.some((n) => n.user_id !== user.id)) ultimoLetto.current = null;
      // Un marcatore riconoscibile, non una frase: a valle i due casi vanno distinti, e
      // distinguerli su un testo libero e' come non distinguerli.
      if (!user) throw new Error(AUTH_RICHIESTA);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(quante);
      if (error) throw error;
      return data ?? [];
    },
  });

  // R14-010 — Le promozioni si vedono solo a chi le ha accese (`notif_promos`), come sul campanello
  // del negozio. Finché la preferenza non si legge, o se non si legge, le promozioni restano fuori.
  // 28/11/2026 (R07-008, onda 2) — Non solo le promozioni: anche la newsletter e i gruppi spenti
  // restavano nell'elenco, mentre il campanello li toglieva dal conto. Adesso l'elenco toglie le
  // stesse categorie del campanello, con la stessa regola (`categorieDiNotificheSpente`).
  const { data: categorieSpente = CATEGORIE_SPENTE_FINCHE_NON_SI_SA } = useQuery({
    queryKey: ['notifiche-categorie-spente', userId],
    enabled: !!userId,
    queryFn: () => categorieDiNotificheSpente(userId as string),
  });

  // Un elenco vuoto non ha niente da tenere, e non dice di chi è.
  useEffect(() => {
    if (data && !isPlaceholderData) ultimoLetto.current = data.length > 0 ? { utente: userId, righe: data } : null;
  }, [data, isPlaceholderData, userId]);
  // R01-varie — Quando cambia la sessione a pagina aperta, QueryProvider svuota la memoria delle
  // domande senza ridisegnare chi la guarda: la pagina restava ferma e la lettura nuova non partiva.
  // Qui la pagina riparte dalle prime e si ridisegna, così le domande ripartono dalla memoria svuotata.
  const sessioneVista = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const { data: ascolto } = supabase.auth.onAuthStateChange((evento, sessione) => {
      const chi = evento === 'SIGNED_OUT' ? null : (sessione?.user?.id ?? null);
      // Se la sessione finisce o cambia, l'elenco tenuto si butta subito, anche con la rete giù.
      if (!chi || ultimoLetto.current?.righe.some((n) => n.user_id !== chi)) ultimoLetto.current = null;
      if (evento !== 'SIGNED_OUT' && chi === sessioneVista.current) return;
      sessioneVista.current = chi;
      setElenco({ quante: PER_VOLTA });
    });
    return () => ascolto?.subscription?.unsubscribe();
  }, []);
  const tenuto = ultimoLetto.current;
  const ultimoElenco = tenuto && tenuto.utente === userId ? tenuto.righe : null;

  // Segna tutte come lette — su azione esplicita dell'utente (bottone), NON
  // automaticamente al montaggio: così la pagina resta consultabile come elenco
  // senza azzerare il badge appena la apri.
  const markAllRead = useMutation({
    // R01-001 — Chi ha premuto lo si sa al clic: se prima della scrittura è entrato un altro account,
    // non si scrive niente a nome suo.
    mutationFn: async (chiHaPremuto: string | null): Promise<string | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || (chiHaPremuto !== null && user.id !== chiHaPremuto)) return null;
      // 5/11/2026 — L'esito si legge: se la scrittura cade, i pallini restano e lo si dice.
      const { error: errAggiorna } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (errAggiorna) throw errAggiorna;
      return user.id;
    },
    onSuccess: async (chi) => {
      // R10-012 — Scritte lette davvero: lo diventa anche l'elenco tenuto, se la rilettura cade.
      if (chi && ultimoLetto.current) {
        const { utente, righe } = ultimoLetto.current;
        ultimoLetto.current = { utente, righe: righe.map((n) => (n.user_id === chi ? { ...n, is_read: true } : n)) };
      }
      // R01-001 — E lo diventano gli elenchi e i conti del campanello in memoria: react-query, se la
      // rilettura cade, tiene i dati di prima, e restavano «Non letta» col pulsante a video. Solo le
      // chiavi di chi ha premuto (l'ultimo pezzo della chiave è l'utente; la risposta può arrivare
      // dopo l'ingresso di un altro account), e solo quelle che ci sono già: niente di nuovo in
      // memoria a nome di chi magari è uscito.
      // Tutti gli elenchi, non solo quello di adesso: mentre si rilegge, a video c'è il segnaposto,
      // che viene dall'elenco più corto (prima di «Carica altre»).
      // Prima si fermano le letture in volo di quelle chiavi: partite prima della scrittura, porterebbero
      // ancora «Non letta» (per esempio «Carica altre» premuto subito prima). L'invalidazione qui sotto
      // le fa ripartire.
      if (chi) {
        const diChi = (prefisso: readonly string[]) => ({
          queryKey: prefisso,
          predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey.at(-1) === chi,
        });
        await Promise.all([
          qc.cancelQueries(diChi(queryKeys.notifications.list)),
          qc.cancelQueries(diChi(queryKeys.notifications.count)),
        ]);
        qc.setQueriesData<Notification[]>(diChi(queryKeys.notifications.list), (prima) =>
          prima?.map((n) => (n.user_id === chi ? { ...n, is_read: true } : n)),
        );
        qc.setQueriesData<number>(diChi(queryKeys.notifications.count), (prima) => (prima === undefined ? prima : 0));
      }
      void qc.invalidateQueries({ queryKey: queryKeys.notifications.count });
      void qc.invalidateQueries({ queryKey: queryKeys.notifications.list });
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

  if ((isLoading || utenteInLettura) && !ultimoElenco) {
    return <LoadingState />;
  }

  // R01-001 — Il titolo della pagina, anche nello stato d'errore: l'h2 dell'errore viene dopo l'h1.
  const intestazione = (
    <div>
      <p className="text-xs font-bold uppercase tracking-label text-primary-700">Attività</p>
      <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
        Notifiche
      </h1>
      <p className="mt-1 text-sm text-ink-500">Aggiornamenti su ordini, prodotti e novità</p>
    </div>
  );

  // La pagina intera di errore solo se non c'è niente di già letto da mostrare.
  if (error && !serveAccesso && !data && !ultimoElenco) {
    return (
      <div className="max-w-3xl">
        <div className="mb-6">{intestazione}</div>
        <ErrorState
          title="Non riusciamo a caricare le notifiche"
          description="Abbiamo provato a leggerle e non ci siamo riusciti. Riprova fra un attimo."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (serveAccesso) return null;

  const lette = data ?? ultimoElenco ?? [];
  // Il conto «ce ne sono altre» guarda le righe lette, categorie spente comprese: sono quelle che chiedono il limite.
  // Una riga senza categoria è un avviso d'ordine (il valore di serie della colonna).
  const notifications = lette.filter((n) => !categorieSpente.includes(n.category ?? 'order'));
  const hasUnread = nonLetteDelCampanello > 0 || notifications.some((n) => !n.is_read);
  // A video c'è l'elenco di prima mentre arrivano le altre: il tasto resta, fermo, e dice che carica.
  const caricaAltre = isFetching && (isPlaceholderData || !data);
  // La lettura è caduta ma l'elenco già letto resta: l'errore si dice qui sotto, con «Riprova».
  const letturaCaduta = !!error && !caricaAltre;
  // A cadere è proprio «Carica altre» se la domanda più lunga non ha dati suoi; se no è caduta una
  // rilettura dell'elenco già a video, e si dice quello.
  const altreCadute = letturaCaduta && !data && quante > PER_VOLTA;
  // Se ne sono arrivate quante ne ho chieste, ce ne possono essere altre più indietro.
  const forseAltre = caricaAltre || lette.length >= quante;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        {intestazione}
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAllRead.mutate(userId)}
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
          {/* R01-001 — Anche vuota, dopo l'h1 viene un h2 (se no il titolo seguente è l'h3 del piede).
              Stesso aspetto del paragrafo di prima: le regole di elemento di h2 (serif, 20px, spaziatura
              stretta) sono rimesse a posto dalle classi. */}
          <h2 className="mb-1 font-sans text-base font-semibold tracking-normal text-ink-600">Nessuna notifica</h2>
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
                    <h2 className={`font-semibold text-lg leading-snug ${n.is_read ? 'text-ink-700' : 'text-ink-900'}`}>
                      {n.title}
                    </h2>
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
                  <Link href={indirizzoDellaNotifica(n.link, { isAdmin })} className="block" onClick={() => { if (!n.is_read) segnaLetta(n.id); }}>
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

      {letturaCaduta ? (
        <div role="alert" className="mt-4 flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-ink-600">
            {altreCadute
              ? 'Non riusciamo a caricare altre notifiche. Quelle qui sopra restano.'
              : 'Non riusciamo ad aggiornare le notifiche.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-white px-4 py-2 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 disabled:opacity-60"
          >
            Riprova
          </button>
        </div>
      ) : forseAltre && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setElenco((prima) => ({ quante: prima.quante + PER_VOLTA }))}
            disabled={isFetching}
            aria-busy={caricaAltre}
            className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-white px-4 py-2 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 disabled:opacity-60"
          >
            {caricaAltre ? 'Caricamento…' : 'Carica altre'}
          </button>
        </div>
      )}
    </div>
  );
}
