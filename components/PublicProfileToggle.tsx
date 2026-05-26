'use client';

import { useState, useEffect } from 'react';
import { Globe, Lock, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { COPY } from '@/lib/copy';

/**
 * Toggle profilo pubblico buyer opt-in.
 *
 * Esperti senior consultati:
 * - Privacy Officer: "Default OFF. Tutto opt-in esplicito. Niente PII non
 *   esplicitamente attivate dall'utente."
 * - Community Manager: "Un handle pubblico univoco crea identità digitale
 *   = pride + reputation."
 * - Security: "Validate handle alfanumerico, 3-30 char, blocca handle riservati"
 */

const RESERVED = ['admin', 'mycity', 'seller', 'rider', 'support', 'help', 'about', 'shop', 'store', 'cart', 'checkout', 'profile', 'orders', 'returns', 'api', 'auth'];

function validateHandle(h: string): string | null {
  const v = h.trim().toLowerCase();
  if (v.length < 3) return 'Almeno 3 caratteri';
  if (v.length > 30) return 'Massimo 30 caratteri';
  if (!/^[a-z0-9_]+$/.test(v)) return 'Solo lettere, numeri, underscore';
  if (RESERVED.includes(v)) return 'Handle riservato';
  return null;
}

export default function PublicProfileToggle() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [appUrl, setAppUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setAppUrl(window.location.origin);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('public_profile_enabled, public_handle, public_bio')
        .eq('id', user.id)
        .single();
      if (data) {
        setEnabled(!!data.public_profile_enabled);
        setHandle(data.public_handle ?? '');
        setBio(data.public_bio ?? '');
      }
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  const save = async () => {
    if (enabled && !handle.trim()) {
      toast.error('Scegli un handle pubblico');
      return;
    }
    if (enabled) {
      const err = validateHandle(handle);
      if (err) { toast.error(err); return; }
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .update({
          public_profile_enabled: enabled,
          public_handle: enabled ? handle.trim().toLowerCase() : null,
          public_bio: enabled ? bio.trim().slice(0, 200) || null : null,
        })
        .eq('id', user.id);
      if (error) {
        if (error.code === '23505') {
          toast.error('Handle già preso, scegline un altro');
        } else {
          throw error;
        }
        return;
      }
      toast.success(enabled ? 'Profilo pubblico attivato' : 'Profilo pubblico disattivato');
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  const publicUrl = handle ? `${appUrl}/u/${handle}` : '';

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h3 className="font-bold mb-1 flex items-center gap-2">
        {enabled ? <Globe size={16} className="text-olive-600" /> : <Lock size={16} className="text-ink-500" />}
        Profilo pubblico
      </h3>
      <p className="text-sm text-ink-600">
        Crea un profilo pubblico con un handle univoco. Altri utenti possono vedere i tuoi badge e bio.
        Default: <strong>disattivato</strong>. Nessun dato personale è esposto senza tuo consenso.
      </p>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-primary-600"
        />
        <span className="text-sm font-semibold">Abilita profilo pubblico</span>
      </label>

      {enabled && (
        <div className="space-y-3 pl-6">
          <div>
            <label className="block text-xs font-semibold text-ink-700 mb-1">Handle pubblico</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-500">@</span>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="marco_pc"
                maxLength={30}
                className="flex-1 bg-cream-50 border border-cream-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            {publicUrl && (
              <p className="text-xs text-ink-500 mt-1 inline-flex items-center gap-1">
                <span>URL:</span>
                <code className="bg-cream-100 px-1 rounded">{publicUrl}</code>
                <button onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success('Copiato!'); }} className="text-primary-700 hover:text-primary-800" aria-label="Copia">
                  <Copy size={11} />
                </button>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-700 mb-1">Bio (opzionale, max 200 char)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Ciao, sono Marco. Adoro la pasta fresca!"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </div>
        </div>
      )}

      <Button onClick={save} loading={saving} size="sm">{COPY.actions.save}</Button>
    </div>
  );
}
