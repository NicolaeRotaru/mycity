'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { logger } from '@/lib/logger';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type CounterpartProfile = {
  full_name: string | null;
  store_name: string | null;
};

type Conversation = {
  id: string;
  buyer_id: string;
  seller_id: string;
  buyer: CounterpartProfile | null;
  seller: CounterpartProfile | null;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Oggi';
  if (d.toDateString() === yesterday.toDateString()) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ConversationThreadPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push(`/sign-in?returnTo=/messages/${params.id}`);
        return;
      }
      setUserId(data.user.id);
    });
  }, [params.id, router]);

  const { data: conversation } = useQuery({
    queryKey: queryKeys.messages.conversationByParam(params.id),
    enabled: !!userId,
    queryFn: async (): Promise<Conversation | null> => {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, buyer_id, seller_id,
          buyer:profiles!conversations_buyer_id_fkey ( full_name, store_name ),
          seller:profiles!conversations_seller_id_fkey ( full_name, store_name )
        `)
        .eq('id', params.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Conversation | null;
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: queryKeys.messages.byParam(params.id),
    enabled: !!userId,
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', params.id)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime: nuovi messaggi → push in cache locale, niente refetch.
  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`msg-${params.id}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${params.id}` },
          (payload) => {
            const newMsg = payload.new as Message;
            qc.setQueryData<Message[]>(['messages', params.id], (prev = []) => {
              if (prev.find((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          },
        )
        .subscribe();
    } catch (err) {
      logger.warn('[messages-thread] realtime subscribe failed', err);
    }
    return () => { if (channel) { try { supabase.removeChannel(channel); } catch { /* noop */ } } };
  }, [userId, params.id, qc]);

  // Auto scroll bottom su nuovi messaggi
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Mark-read quando entro o ricevo
  useEffect(() => {
    if (!userId || messages.length === 0) return;
    fetch('/api/chat/mark-read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: params.id }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: queryKeys.messages.conversations });
    }).catch(() => { /* noop */ });
  }, [userId, messages.length, params.id, qc]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: params.id, body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err, 'Invio non riuscito'));
      }
      return res.json();
    },
    onSuccess: () => {
      setText('');
      // Niente refetch: il Realtime ci aggiorna; ma se per qualche motivo
      // non arriva subito, invalida dopo 1s come safety net.
      setTimeout(() => qc.invalidateQueries({ queryKey: queryKeys.messages.byParam(params.id) }), 1000);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMutation.mutate(trimmed);
  };

  if (!userId) return <LoadingState />;
  if (!conversation) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center mt-8 bg-white rounded-2xl border">
        <div className="text-5xl mb-3">💬</div>
        <h1 className="text-xl font-bold mb-2">Conversazione non trovata</h1>
        <Link href="/messages" className="inline-block mt-4 text-primary-700 font-semibold hover:underline">
          ← Torna ai messaggi
        </Link>
      </div>
    );
  }

  const iAmBuyer = conversation.buyer_id === userId;
  const counterpart = iAmBuyer ? conversation.seller : conversation.buyer;
  const counterpartName =
    (iAmBuyer ? counterpart?.store_name : counterpart?.full_name) ??
    counterpart?.full_name ?? 'Utente';

  // Raggruppamento separatori di data
  const items: Array<{ type: 'date'; label: string; key: string } | { type: 'msg'; msg: Message }> = [];
  let lastDay = '';
  for (const m of messages) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      items.push({ type: 'date', label: formatDateSeparator(m.created_at), key: 'date-' + day });
      lastDay = day;
    }
    items.push({ type: 'msg', msg: m });
  }

  return (
    <div className="container mx-auto px-0 sm:px-4 max-w-2xl py-0 sm:py-6">
      <div className="bg-white sm:border sm:rounded-xl flex flex-col h-[calc(100dvh-160px)] sm:h-[calc(100dvh-200px)]">
        {/* HEADER */}
        <div className="flex items-center gap-3 p-4 border-b">
          <Link href="/messages" className="text-ink-500 hover:text-ink-700">
            <ArrowLeft size={20} />
          </Link>
          <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
            iAmBuyer ? 'bg-secondary-100 text-secondary-700' : 'bg-primary-100 text-primary-800'
          }`}>
            {counterpartName[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-ink-900 truncate">{counterpartName}</h2>
            <p className="text-xs text-ink-500">{iAmBuyer ? 'Negozio' : 'Cliente'}</p>
          </div>
        </div>

        {/* THREAD */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-cream-50">
          {items.length === 0 ? (
            <div className="text-center text-ink-400 text-sm py-12">
              Scrivi il primo messaggio per iniziare la conversazione.
            </div>
          ) : (
            items.map((it) => {
              if (it.type === 'date') {
                return (
                  <div key={it.key} className="flex justify-center my-3">
                    <span className="text-xs text-ink-500 bg-white px-3 py-1 rounded-full border">{it.label}</span>
                  </div>
                );
              }
              const mine = it.msg.sender_id === userId;
              return (
                <div key={it.msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                    mine ? 'bg-primary-700 text-white rounded-br-sm' : 'bg-white text-ink-900 border rounded-bl-sm'
                  }`}>
                    <p className="whitespace-pre-wrap break-words">{it.msg.body}</p>
                    <p className={`text-[10px] mt-0.5 text-right ${mine ? 'text-indigo-200' : 'text-ink-400'}`}>
                      {formatTime(it.msg.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* INPUT */}
        <form onSubmit={handleSend} className="border-t bg-white p-3 flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Scrivi un messaggio..."
            aria-label="Scrivi un messaggio"
            maxLength={4000}
            disabled={sendMutation.isPending}
            className="flex-1 border border-cream-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sendMutation.isPending || !text.trim()}
            aria-label="Invia"
            className="bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white rounded-full p-3"
          >
            <Send size={18} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
