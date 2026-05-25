'use client';

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Honeypot from './Honeypot';

const NewsletterForm = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const honeypotRef = useRef('');
  const startedAtRef = useRef(Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // Bot guard 1: honeypot riempito
    if (honeypotRef.current) {
      setSubscribed(true); // simula successo, non insospettire
      return;
    }
    // Bot guard 2: form compilato troppo velocemente (< 1.5s)
    if (Date.now() - startedAtRef.current < 1500) {
      setSubscribed(true);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('newsletter_subscribers')
        .insert({ email: email.trim().toLowerCase() });
      if (error && error.code !== '23505') throw error; // 23505 = duplicate, ok
      setSubscribed(true);
      toast.success('Iscritto! Riceverai la newsletter ogni venerdì.');
    } catch (err: any) {
      toast.error(err.message || 'Errore');
    } finally {
      setLoading(false);
    }
  };

  if (subscribed) {
    return (
      <div className="bg-emerald-500/20 border border-emerald-400/40 rounded-lg p-3 text-sm text-emerald-200">
        ✅ Sei iscritto. Riceverai presto le ricette di Piacenza nella tua mail.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Honeypot value={honeypotRef.current} onChange={(v) => (honeypotRef.current = v)} name="company" />
      <p className="text-xs text-gray-400">
        📬 <strong>Cosa c'è nel piatto a Piacenza</strong> — ricetta + storia di un negoziante + 3 offerte. Ogni venerdì.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="la-tua@email.it"
          required
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-semibold shrink-0"
        >
          {loading ? '...' : 'Iscriviti'}
        </button>
      </div>
    </form>
  );
};

export default NewsletterForm;
