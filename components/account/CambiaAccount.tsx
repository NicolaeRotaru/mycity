'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { CART_UPDATED_AT_KEY, fondiCarrelli, getCart, type CartItem } from '@/lib/cart';
import {
  EVENTO_ACCOUNT,
  cambiaAccount,
  iniziaAggiunta,
  leggiAccount,
  rinnovaAccesso,
  type AccountSalvato,
  type MondoDelCambio,
  type SessioneMinima,
} from '@/lib/account/piu-account';

/**
 * «CAMBIA ACCOUNT» NEI MENU DELL'ACCOUNT — 25/11/2026 (regole in lib/account/piu-account.ts).
 *
 * Nicola: «aggiungi la possibilità di avere più account e fare lo switch senza doversi disconnettere».
 * Un blocco solo, uguale ovunque: gli altri account salvati su questo dispositivo (un clic e si passa)
 * e «Aggiungi un altro account». Sta nel menu del cliente (computer e telefono), del negozio, del
 * fattorino e dell'admin. `tono="scuro"` per i menu su fondo scuro.
 */

/** Le chiavi del carrello nel browser (lib/cart.ts e components/CartCrossDeviceSync.tsx). */
const CHIAVI_CARRELLO = ['cart', CART_UPDATED_AT_KEY, 'mc_cart_synced_at'];

const mondo: MondoDelCambio = {
  sessioneAttuale: async () => {
    const { data } = await supabase.auth.getSession();
    return (data.session as SessioneMinima | null) ?? null;
  },
  installa: async (s) => {
    const { error } = await supabase.auth.setSession(s);
    return { error };
  },
  ruoloDi: async (id) => {
    const { data } = await supabase.from('profiles').select('role').eq('id', id).maybeSingle();
    return (data as { role?: string } | null)?.role ?? null;
  },
  // La spesa di chi si lascia sale sul server fusa con quella che c'è già: non si perde niente.
  salvaCarrello: async (id) => {
    const locale = getCart();
    if (locale.length === 0) return;
    const { data } = await supabase.from('user_carts').select('items').eq('user_id', id).maybeSingle();
    const cloud = Array.isArray((data as { items?: unknown } | null)?.items) ? ((data as { items: CartItem[] }).items) : [];
    await supabase.from('user_carts').upsert(
      { user_id: id, items: fondiCarrelli(locale, cloud) as unknown as Record<string, unknown>[], updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  },
  // Senza passare da clearCart: quello avvisa il sito, che salverebbe il carrello vuoto sul nuovo account.
  svuotaCarrello: () => {
    const prima = CHIAVI_CARRELLO.map((k) => {
      try { return [k, localStorage.getItem(k)] as const; } catch { return [k, null] as const; }
    });
    for (const k of CHIAVI_CARRELLO) { try { localStorage.removeItem(k); } catch { /* noop */ } }
    return () => {
      for (const [k, v] of prima) { try { if (v !== null) localStorage.setItem(k, v); } catch { /* noop */ } }
    };
  },
  rinnova: (refreshToken) =>
    rinnovaAccesso(refreshToken, {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      chiave: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    }),
};

const etichetta = (a: AccountSalvato) => a.nome ?? a.email ?? 'Account senza nome';

export default function CambiaAccount({ tono = 'chiaro' }: { tono?: 'chiaro' | 'scuro' }) {
  const [lista, setLista] = useState<AccountSalvato[]>([]);
  const [attivo, setAttivo] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);

  useEffect(() => {
    const aggiorna = () => setLista(leggiAccount());
    aggiorna();
    // Difensivo come QueryProvider: dove il client non ha la sessione (prove, ambienti ridotti) non si fa niente.
    try {
      void Promise.resolve(supabase.auth.getSession())
        .then((r) => setAttivo(r?.data?.session?.user?.id ?? null))
        .catch(() => undefined);
    } catch { /* niente sessione da leggere */ }
    window.addEventListener(EVENTO_ACCOUNT, aggiorna);
    window.addEventListener('storage', aggiorna);
    return () => {
      window.removeEventListener(EVENTO_ACCOUNT, aggiorna);
      window.removeEventListener('storage', aggiorna);
    };
  }, []);

  const altri = lista.filter((a) => a.id !== attivo);

  async function passa(a: AccountSalvato) {
    setAvviso(null);
    setInCorso(a.id);
    const esito = await cambiaAccount(a.id, mondo).catch(() => ({ ok: false as const, motivo: 'rete' as const, email: a.email }));
    if (esito.ok) {
      // Da capo: memoria, carrello e pagine ripartono col nuovo account.
      window.location.assign(esito.dove);
      return;
    }
    setInCorso(null);
    setAvviso(
      esito.motivo === 'scaduto'
        ? `L’accesso di ${etichetta(a)} è scaduto: l’abbiamo tolto. Per riaverlo, aggiungilo di nuovo.`
        : 'Non sono riuscito a cambiare account. Sei ancora nell’account di prima: riprova fra un momento.',
    );
  }

  async function aggiungi() {
    setInCorso('aggiungi');
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    iniziaAggiunta((data.session as SessioneMinima | null) ?? null);
    window.location.assign('/sign-in?aggiungi=1');
  }

  const scuro = tono === 'scuro';
  const voce = scuro
    ? 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-white/[0.78] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60'
    : 'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-ink-800 hover:bg-cream-50 disabled:opacity-60';

  return (
    <div role="group" aria-label="Cambia account" data-testid="cambia-account">
      {altri.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => passa(a)}
          disabled={inCorso !== null}
          aria-label={`Passa all’account ${etichetta(a)}${a.email && a.nome ? ` (${a.email})` : ''}`}
          className={voce}
        >
          <ArrowLeftRight size={16} className={`shrink-0 ${scuro ? '' : 'text-ink-500'}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{inCorso === a.id ? 'Cambio account…' : `Passa a ${etichetta(a)}`}</span>
            {a.email && a.nome && <span className={`block truncate text-xs ${scuro ? 'text-white/50' : 'text-ink-500'}`}>{a.email}</span>}
          </span>
        </button>
      ))}
      <button type="button" onClick={aggiungi} disabled={inCorso !== null} className={voce}>
        <UserPlus size={16} className={`shrink-0 ${scuro ? '' : 'text-ink-500'}`} aria-hidden />
        Aggiungi un altro account
      </button>
      {avviso && (
        <p role="alert" className={`px-4 py-2 text-xs ${scuro ? 'text-amber-200' : 'text-amber-800'}`}>{avviso}</p>
      )}
    </div>
  );
}
