'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useProfile } from './hooks/useProfile';
import { confirmDialog } from '@/components/ConfirmDialog';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { fetchNomiPubblici } from '@/lib/queries/seller-public-profiles';
import { Button } from '@/components/ui/Button';

type Question = {
  id: string;
  product_id: string;
  author_id: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  author: { full_name: string | null } | null;
};

type Props = {
  productId: string;
  sellerId: string;
};

/** R16-009 — Il database non ha toccato la domanda: non si dice «tolta». */
const NON_TOLTA = 'La domanda non è stata tolta: riprova fra poco o scrivi all\'assistenza.';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sezione domande & risposte sulla scheda prodotto.
 *  - Tutti gli utenti loggati possono fare domande.
 *  - Solo il seller del prodotto può rispondere (RLS DB-side).
 *  - Le risposte sono pubbliche → contenuto SEO indicizzabile.
 *  - Chi ha scritto la domanda la toglie (970), l'amministratore la nasconde (364).
 */
export default function ProductQA({ productId, sellerId }: Props) {
  // 27/8/2026 (R115) — il campo della domanda e quello della risposta avevano
  // per unica indicazione la scritta grigia dentro, che sparisce alla prima
  // lettera scritta: chi torna indietro a correggere non sa più cosa ci va.
  const idDomanda = useId();
  const router = useRouter();
  const qc = useQueryClient();
  const { isAuthenticated, profile, isAdmin } = useProfile();
  const [text, setText] = useState('');
  const [answerText, setAnswerText] = useState<Record<string, string>>({});
  // 5/11/2026 — Qui c'era un pulsante «Utile» con un conteggio che viveva solo nello stato
  // locale: «Utile · 1» spariva ricaricando la pagina e non sommava i voti degli altri. Tolto
  // finché non esiste un posto dove salvare i voti.

  const { data: questions = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.qa.product(productId),
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from('product_questions')
        .select(`
          id, product_id, author_id, question, answer, answered_at, created_at
        `)
        .eq('product_id', productId)
        .eq('is_public', true)
        .order('answered_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      // 31/10/2026 (migrazione 164) — Chi ha scritto la domanda si legge dalla vista `nomi_pubblici`,
      // non da `profiles`: dopo la 161 l'aggancio tornava vuoto e ogni domanda era firmata «Cliente».
      const righe = (data ?? []) as unknown as Array<Omit<Question, 'author'>>;
      const nomi = await fetchNomiPubblici(supabase, righe.map((q) => q.author_id));
      return righe.map((q) => ({ ...q, author: { full_name: nomi.get(q.author_id) ?? null } })) as Question[];
    },
  });

  const askMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/product/${productId}`);
        throw new Error('REDIRECT');
      }
      const { error } = await supabase.from('product_questions').insert({
        product_id: productId,
        author_id: user.id,
        question: text.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: queryKeys.qa.product(productId) });
      // 5/11/2026 — Il testo non promette notifiche. Dal 24/11 le scrive il database (migrazione 821
      // al negozio per la domanda, 822 a chi chiede alla prima risposta), ma partono solo da quando
      // le migrazioni sono applicate: fino ad allora una promessa qui sarebbe di nuovo falsa.
      toast.success('Domanda pubblicata: la risposta del negozio comparirà qui sotto.');
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message !== 'REDIRECT') toast.error(friendlyError(err));
    },
  });

  const answerMutation = useMutation({
    mutationFn: async ({ questionId, answer }: { questionId: string; answer: string }) => {
      const { error } = await supabase
        .from('product_questions')
        .update({ answer: answer.trim(), answered_at: new Date().toISOString(), answered_by: profile?.id })
        .eq('id', questionId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      setAnswerText((s) => ({ ...s, [vars.questionId]: '' }));
      qc.invalidateQueries({ queryKey: queryKeys.qa.product(productId) });
      toast.success('Risposta pubblicata!');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // R16-009 — Una domanda si toglie: l'amministratore la nasconde (is_public = false, migrazione 364),
  // chi l'ha scritta la cancella (migrazione 970). Si chiede indietro la riga toccata: se il database
  // non ha cambiato niente (una regola che non c'è ancora) si dice, invece di «tolta».
  const removeMutation = useMutation({
    mutationFn: async ({ questionId, come }: { questionId: string; come: 'nascondi' | 'cancella' }) => {
      const domanda = supabase.from('product_questions');
      const { data, error } = await (come === 'nascondi'
        ? domanda.update({ is_public: false }).eq('id', questionId).select('id')
        : domanda.delete().eq('id', questionId).select('id'));
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(NON_TOLTA);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.qa.product(productId) });
      toast.success(vars.come === 'nascondi' ? 'Domanda nascosta.' : 'Domanda tolta.');
    },
    onError: (err: unknown) => toast.error(err instanceof Error && err.message === NON_TOLTA ? NON_TOLTA : friendlyError(err)),
  });

  const togli = async (q: Question, come: 'nascondi' | 'cancella') => {
    const ok = await confirmDialog(come === 'nascondi'
      ? { title: 'Nascondere questa domanda?', message: 'Non sarà più visibile sotto il prodotto.', confirmLabel: 'Nascondi', danger: true }
      : { title: 'Togliere la tua domanda?', message: 'La domanda e l\'eventuale risposta del negozio spariscono per sempre.', confirmLabel: 'Togli', danger: true });
    if (ok) removeMutation.mutate({ questionId: q.id, come });
  };

  const isSellerOfThis = profile?.id === sellerId;

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-serif font-bold text-ink-900 flex items-center gap-2">
          <MessageSquare size={22} className="text-primary-600" />
          Domande sul prodotto
          {questions.length > 0 && (
            <span className="text-base font-normal text-ink-500">({questions.length})</span>
          )}
        </h2>
      </div>

      {/* Form domanda */}
      <div className="bg-cream-50 border border-cream-300 rounded-2xl p-5">
        <p className="text-sm font-semibold text-ink-900 mb-2">Hai una domanda?</p>
        <p className="text-xs text-ink-500 mb-3">
          La domanda compare sotto il prodotto; quando il negozio risponde, la risposta è visibile anche agli altri clienti.
        </p>
        {!isAuthenticated ? (
          <p className="text-sm text-ink-600">
            <Link href={`/sign-in?returnTo=/product/${productId}`} className="text-primary-700 hover:underline font-semibold">
              Accedi
            </Link> per fare una domanda.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length < 5) {
                toast.error('Scrivi almeno 5 caratteri');
                return;
              }
              askMutation.mutate();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <label htmlFor={idDomanda} className="sr-only">La tua domanda al negozio</label>
            <input
              id={idDomanda}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Es: questo prodotto è disponibile in altre dimensioni?"
              maxLength={500}
              className="flex-1 bg-white border border-cream-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
            />
            <Button
              type="submit"
              loading={askMutation.isPending}
              disabled={text.trim().length < 5}
              size="sm"
              icon={Send}
            >Invia</Button>
          </form>
        )}
      </div>

      {/* Lista domande */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl skeleton" />)}
        </div>
      ) : isError ? (
        // 5/11/2026 — Una lettura caduta non è «nessuna domanda ancora».
        <div role="status" className="text-center text-ink-600 py-8 text-sm">
          Non riesco a caricare le domande.{' '}
          <button
            type="button"
            onClick={() => { void refetch(); }}
            className="font-semibold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded"
          >
            Riprova
          </button>
        </div>
      ) : questions.length === 0 ? (
        <p className="text-center text-ink-500 py-8 text-sm">
          Nessuna domanda ancora. <strong>Sii il primo</strong> a chiedere!
        </p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className="bg-white border border-cream-200 rounded-2xl p-5 space-y-3">
              {/* Domanda */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">
                    D
                  </span>
                  <span className="text-xs text-ink-500">
                    {q.author?.full_name?.split(' ')[0] ?? 'Cliente'} · {formatDate(q.created_at)}
                  </span>
                </div>
                <p className="text-ink-800 ml-9">{q.question}</p>
                {(isAdmin || (!!profile?.id && profile.id === q.author_id)) && (
                  <button
                    type="button"
                    onClick={() => { void togli(q, isAdmin ? 'nascondi' : 'cancella'); }}
                    disabled={removeMutation.isPending}
                    aria-label={`${isAdmin ? 'Nascondi' : 'Togli'} la domanda: ${q.question}`}
                    className="ml-9 mt-1 text-xs font-semibold text-ink-500 hover:text-ink-800 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded"
                  >
                    {isAdmin ? 'Nascondi' : 'Togli la mia domanda'}
                  </button>
                )}
              </div>

              {/* Risposta */}
              {q.answer ? (
                <div className="pl-9 border-l-2 border-olive-300 ml-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-7 h-7 rounded-full bg-olive-100 text-olive-700 flex items-center justify-center text-xs font-bold">
                      R
                    </span>
                    <span className="text-xs text-olive-700 font-semibold uppercase tracking-label">
                      Risposta del venditore
                    </span>
                    {/* 5/11/2026 — Qui c'era il bollino «Venditore verificato» per tutti: sul sito
                        «verificato» vuol dire approvato e con i pagamenti Stripe abilitati
                        (isVerifiedStore), e al lancio nessun negozio lo è. L'etichetta qui sopra
                        dice già chi risponde. */}
                    {q.answered_at && (
                      <span className="text-xs text-ink-400">· {formatDate(q.answered_at)}</span>
                    )}
                  </div>
                  <p className="text-ink-700 ml-9">{q.answer}</p>
                </div>
              ) : isSellerOfThis ? (
                <div className="pl-9 border-l-2 border-accent-300 ml-3">
                  <p className="text-xs font-semibold text-accent-700 mb-2 uppercase tracking-label">Rispondi a questa domanda</p>
                  <textarea
                    rows={2}
                    value={answerText[q.id] ?? ''}
                    onChange={(e) => setAnswerText((s) => ({ ...s, [q.id]: e.target.value }))}
                    aria-label={`La tua risposta alla domanda: ${q.question}`}
                    placeholder="Scrivi la tua risposta…"
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700 resize-none"
                  />
                  <button
                    onClick={() => {
                      const a = (answerText[q.id] ?? '').trim();
                      if (a.length < 2) {
                        toast.error('Scrivi una risposta');
                        return;
                      }
                      answerMutation.mutate({ questionId: q.id, answer: a });
                    }}
                    disabled={answerMutation.isPending}
                    className="mt-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-ink-900 px-4 py-1.5 rounded-lg font-semibold text-sm"
                  >
                    Pubblica risposta
                  </button>
                </div>
              ) : (
                <p className="pl-9 ml-3 text-xs text-ink-400 italic">In attesa di risposta dal venditore.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
