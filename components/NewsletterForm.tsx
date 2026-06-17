'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Inbox } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Honeypot from './Honeypot';
import { friendlyError } from '@/lib/errors';

type Props = {
  /** "dark" per il Footer su sfondo scuro; "light" per la sezione newsletter homepage. */
  variant?: 'dark' | 'light';
};

const NewsletterForm = ({ variant = 'dark' }: Props) => {
  const t = useTranslations('newsletter');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const honeypotRef = useRef('');
  const startedAtRef = useRef(Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    if (honeypotRef.current) { setSubscribed(true); return; }
    if (Date.now() - startedAtRef.current < 1500) { setSubscribed(true); return; }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('newsletter_subscribers')
        .insert({ email: email.trim().toLowerCase() });
      if (error && error.code !== '23505') throw error;
      setSubscribed(true);
      toast.success(t('subscribed'));
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const isLight = variant === 'light';

  if (subscribed) {
    return (
      <div className={
        isLight
          ? 'bg-olive-50 border border-olive-200 text-olive-700 rounded-lg p-4 text-sm font-medium'
          : 'bg-olive-500/20 border border-olive-400/40 text-emerald-200 rounded-lg p-3 text-sm'
      }>
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 size={16} className="text-olive-600" aria-hidden /> {t('subscribedBox')}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={isLight ? 'space-y-3' : 'space-y-2'}>
      <Honeypot value={honeypotRef.current} onChange={(v) => (honeypotRef.current = v)} name="company" />
      <p className={`text-xs inline-flex items-center gap-1.5 ${isLight ? 'text-ink-500' : 'text-ink-400'}`}>
        <Inbox size={14} aria-hidden /> {t('blurb')}
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('placeholder')}
          required
          className={`flex-1 min-w-0 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
            isLight
              ? 'bg-cream-50 border border-cream-300 text-ink-900 placeholder-ink-400 focus:ring-primary-400 focus:border-primary-400'
              : 'bg-ink-800 border border-gray-700 text-white focus:ring-primary-400'
          }`}
        />
        <button
          type="submit"
          disabled={loading}
          className={`disabled:opacity-50 px-5 py-2.5 rounded-lg text-sm font-bold shrink-0 transition-colors ${
            isLight
              ? 'bg-primary-700 hover:bg-primary-800 text-white'
              : 'bg-primary-600 hover:bg-primary-700 text-white'
          }`}
        >
          {loading ? '…' : t('subscribe')}
        </button>
      </div>
    </form>
  );
};

export default NewsletterForm;
