'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useProfile } from './hooks/useProfile';
import { friendlyError } from '@/lib/errors';

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sezione domande & risposte sulla scheda prodotto.
 *  - Tutti gli utenti loggati possono fare domande.
 *  - Solo il seller del prodotto può rispondere (RLS DB-side).
 *  - Le risposte sono pubbliche → contenuto SEO indicizzabile.
 */
export default function ProductQA({ productId, sellerId }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { isAuthenticated, profile } = useProfile();
  const [text, setText] = useState('');
  const [answerText, setAnswerText] = useState<Record<string, string>>({});

  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['qa', productId],
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from('product_questions')
        .select(`
          id, product_id, author_id, question, answer, answered_at, created_at,
          author:profiles!product_questions_author_id_fkey ( full_name )
        `)
        .eq('product_id', productId)
        .eq('is_public', true)
        .order('answered_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Question[];
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
      qc.invalidateQueries({ queryKey: ['qa', productId] });
      toast.success('Domanda inviata. Riceverai una notifica quando ti rispondono.');
    },
    onError: (err: any) => {
      if (err.message !== 'REDIRECT') toast.error(friendlyError(err));
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
      qc.invalidateQueries({ queryKey: ['qa', productId] });
      toast.success('Risposta pubblicata!');
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

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
          Il venditore ti risponderà al più presto. La risposta sarà visibile anche agli altri clienti.
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
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Es: questo prodotto è disponibile in altre dimensioni?"
              maxLength={500}
              className="flex-1 bg-white border border-cream-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <button
              type="submit"
              disabled={askMutation.isPending || text.trim().length < 5}
              className="inline-flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-semibold text-sm shrink-0 transition-colors"
            >
              <Send size={16} />
              {askMutation.isPending ? 'Invio…' : 'Invia'}
            </button>
          </form>
        )}
      </div>

      {/* Lista domande */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl skeleton" />)}
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
              </div>

              {/* Risposta */}
              {q.answer ? (
                <div className="pl-9 border-l-2 border-olive-300 ml-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-7 h-7 rounded-full bg-olive-100 text-olive-700 flex items-center justify-center text-xs font-bold">
                      R
                    </span>
                    <span className="text-xs text-olive-700 font-semibold uppercase tracking-wider">
                      Risposta del venditore
                    </span>
                    {q.answered_at && (
                      <span className="text-xs text-ink-400">· {formatDate(q.answered_at)}</span>
                    )}
                  </div>
                  <p className="text-ink-700 ml-9">{q.answer}</p>
                </div>
              ) : isSellerOfThis ? (
                <div className="pl-9 border-l-2 border-accent-300 ml-3">
                  <p className="text-xs font-semibold text-accent-700 mb-2 uppercase tracking-wider">Rispondi a questa domanda</p>
                  <textarea
                    rows={2}
                    value={answerText[q.id] ?? ''}
                    onChange={(e) => setAnswerText((s) => ({ ...s, [q.id]: e.target.value }))}
                    placeholder="Scrivi la tua risposta…"
                    className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
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
