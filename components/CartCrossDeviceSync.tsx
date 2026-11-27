'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getCart, saveCart, clearCart, fondiCarrelli, CART_UPDATED_AT_KEY, type CartItem } from '@/lib/cart';
import { idUtenteInMemoria } from '@/components/hooks/useUtente';
import { allineaUtenteDelBrowser } from '@/lib/account/piu-account';

/**
 * Sincronizza il carrello locale (localStorage) con il cloud (Supabase) quando
 * l'utente è loggato. Funziona come backup + sync cross-device.
 *
 * Esperti senior consultati:
 * - Senior PM: "Una sessione mai persa = +20% retention"
 * - CRM Manager: "Il buyer apre il sito sul telefono mentre cammina e finisce
 *   l'acquisto da casa sul PC. Senza sync, abbandona."
 * - Security Engineer: "RLS già protegge user_carts. No PII sensibili nei
 *   campi (id, name, price, quantity, image), OK per cloud-sync."
 *
 * Strategia merge: usa la versione PIÙ RECENTE (cloud.updated_at vs
 * localStorage.lastUpdated). Se locale ha items + cloud è vuoto → upload
 * locale. Se cloud ha items + locale è vuoto (es. login da nuovo device)
 * → scarica cloud.
 *
 * Componente invisibile, side-effect only. Mountato in app/layout.tsx.
 */
// Stessa chiave usata da lib/cart.ts (bump ad ogni mutazione locale).
const LAST_UPDATED_KEY = CART_UPDATED_AT_KEY;

function getLocalUpdatedAt(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const v = localStorage.getItem(LAST_UPDATED_KEY);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

/**
 * 5/11/2026 — L'ultima volta che QUESTO carrello locale è stato allineato col cloud (salvato su o
 * scaricato giù). Serve a distinguere «il locale è vecchio» (non cambiato dopo l'ultimo
 * allineamento) da «il locale ha roba nuova mai salita» (l'ospite che riempie e poi accede).
 */
const SYNCED_AT_KEY = 'mc_cart_synced_at';

/**
 * R17-009 — UNA RIGA TOLTA SU UN DISPOSITIVO TORNAVA DALL'ALTRO.
 *
 * Il telefono toglie la torta e la manda su; il computer, col carrello vecchio, si apre: il cloud è più
 * recente e si fondeva con «la quantità più alta», così la torta tornava nel carrello e poi sul cloud
 * (e la spesa già pagata con lei). Adesso l'allineamento ricorda DUE cose, nella stessa chiave
 * («locale:cloud»):
 *  · `locale`: la data del carrello di QUESTO dispositivo quando era uguale al cloud (orologio di questo
 *    dispositivo, mai quello di un altro);
 *  · `cloud`: la data scritta sul cloud in quel momento, usata solo come segno di versione (uguale o no).
 * Se il locale non è cambiato dopo l'allineamento e il cloud sì, vince il cloud INTERO: anche le righe
 * tolte, anche il carrello svuotato. Se sono cambiati tutti e due, si fondono come prima. Una chiave
 * vecchia (solo un numero) vale come `locale` senza `cloud`: si segue la regola di prima finché il primo
 * allineamento non la riscrive.
 */
type Allineamento = { locale: number; cloud: number };
function getAllineamento(): Allineamento {
  try {
    const [locale, cloud] = (localStorage.getItem(SYNCED_AT_KEY) ?? '').split(':');
    return { locale: Number(locale) || 0, cloud: Number(cloud) || 0 };
  } catch {
    return { locale: 0, cloud: 0 };
  }
}
function setAllineamento(locale: number, cloud: number) {
  try { localStorage.setItem(SYNCED_AT_KEY, `${locale}:${cloud}`); } catch { /* noop */ }
}

export default function CartCrossDeviceSync() {
  useEffect(() => {
    let userId: string | null = null;
    let stopped = false;

    const syncDown = async (uid: string) => {
      // Carica il carrello cloud
      const { data, error } = await supabase
        .from('user_carts')
        .select('items, updated_at')
        .eq('user_id', uid)
        .maybeSingle();
      if (error || stopped) return;

      const cloudItems: CartItem[] = Array.isArray(data?.items) ? (data!.items as CartItem[]) : [];
      const cloudUpdated = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      const localItems = getCart();
      const localUpdated = getLocalUpdatedAt();
      const allineato = getAllineamento();

      // R17-009 — Il cloud preso INTERO, righe tolte comprese. La data locale resta quella di questo
      // dispositivo (saveCart la avanza): mai quella scritta da un altro orologio.
      const prendiIlCloud = () => {
        saveCart(cloudItems, { dallAltroDispositivo: true });
        setAllineamento(getLocalUpdatedAt(), cloudUpdated);
      };
      // Tutte e due le liste, e per la stessa riga la quantità più alta (vedi sotto, R092).
      const fondi = async () => {
        const fuso = fondiCarrelli(localItems, cloudItems);
        saveCart(fuso, { dallAltroDispositivo: true });
        // Se dalla fusione è uscito qualcosa che il cloud non aveva, il cloud adesso è quello
        // vecchio: si rimanda su, altrimenti al prossimo accesso da un altro dispositivo la roba
        // sparirebbe di nuovo.
        const cloudEraGiaCosi =
          fuso.length === cloudItems.length &&
          fuso.every((r, i) => r.id === cloudItems[i].id && r.quantity === cloudItems[i].quantity);
        if (cloudEraGiaCosi) setAllineamento(getLocalUpdatedAt(), cloudUpdated);
        else await syncUp(uid, fuso);
      };

      // R17-009 — Con un allineamento scritto da questa versione si confronta con quello.
      if (data && allineato.cloud > 0) {
        const localeCambiato = localUpdated > allineato.locale;
        const cloudCambiato = cloudUpdated !== allineato.cloud;
        if (!cloudCambiato) {
          if (localeCambiato) await syncUp(uid, localItems);
          return;
        }
        if (!localeCambiato) {
          // Il locale è quello dell'ultimo allineamento e il cloud è cambiato dopo (un altro
          // dispositivo ha tolto una riga, ha comprato, ha svuotato): vince il cloud.
          prendiIlCloud();
          return;
        }
        // Cambiati tutti e due: nessuno dei due si butta.
        await fondi();
        return;
      }

      if (cloudItems.length === 0 && localItems.length > 0) {
        // 5/11/2026 — Il cloud vuoto PIÙ RECENTE del locale vuol dire che un altro dispositivo l'ha
        // svuotato dopo (ha comprato, o ha tolto tutto): il locale è vecchio e non si rimanda su.
        // Prima la spesa appena pagata tornava nel cloud e poi, con la fusione, sul telefono.
        // Solo se il locale non è cambiato dopo l'ultimo allineamento riuscito: un carrello
        // riempito da ospite (mai salito) non si butta.
        const allineatoIl = allineato.locale;
        if (data && allineatoIl > 0 && localUpdated <= allineatoIl && cloudUpdated > allineatoIl) {
          prendiIlCloud();
          return;
        }
        // Carrello locale ma cloud vuoto (o mai scritto): spingi locale
        await syncUp(uid, localItems);
        return;
      }
      if (cloudUpdated > localUpdated && cloudItems.length > 0) {
        // 27/8/2026 (R092) — QUI IL CLOUD SOSTITUIVA IL LOCALE, E LA SPESA DELL'ALTRO
        // DISPOSITIVO SPARIVA SENZA UN AVVISO. Adesso si fondono: tutte e due le liste, e per la
        // stessa riga la quantità più alta.
        await fondi();
      }
    };

    // R17-009 — Gli invii al cloud vanno uno dopo l'altro: due scritture in volo potevano arrivare
    // al server nell'ordine sbagliato, e il cloud restava col carrello più vecchio.
    let invii: Promise<void> = Promise.resolve();
    const syncUp = (uid: string, items: CartItem[]): Promise<void> => {
      // La data locale del carrello che parte, letta ADESSO: se mentre la risposta arriva il
      // carrello cambia ancora, l'allineamento non deve coprire quel cambio (prima la data locale
      // tornava indietro all'ora dell'invio, e il cambio sembrava già sul cloud).
      const fotografia = getLocalUpdatedAt();
      const giro = invii.then(() => scriviSulCloud(uid, items, fotografia));
      invii = giro.catch(() => undefined);
      return giro;
    };

    const scriviSulCloud = async (uid: string, items: CartItem[], fotografia: number) => {
      // Niente da mandare: il cloud ha già questo carrello (preso da lì o mandato su), e
      // rimandarlo coprirebbe il cambio fatto intanto da un altro dispositivo.
      const allineato = getAllineamento();
      if (allineato.cloud > 0 && fotografia <= allineato.locale) return;
      const now = Date.now();
      try {
        // 5/11/2026 — Il client non lancia sugli errori del database o della rete: li restituisce.
        // Prima la data locale avanzava anche quando il server aveva rifiutato, e il telefono
        // credeva di aver salvato.
        const { error } = await supabase
          .from('user_carts')
          .upsert(
            { user_id: uid, items: items as unknown as Record<string, unknown>[], updated_at: new Date(now).toISOString() },
            { onConflict: 'user_id' },
          );
        if (error) return;
        setAllineamento(fotografia, now);
      } catch {
        // Rete caduta: l'allineamento non avanza, al prossimo giro si riprova.
      }
    };

    /**
     * 25/11/2026 (più account, lib/account/piu-account.ts) — LA SPESA DI A FINIVA A B.
     * Con più account sullo stesso dispositivo, nel browser poteva esserci il carrello di A quando
     * entrava B, per più strade (aggiunta, un link e poi «indietro», un'altra scheda), e qui si fondeva
     * nel carrello di B, anche sul server. La regola ora è una sola: prima di ogni fusione, i dati del
     * browser diventano dell'account che entra (`allineaUtenteDelBrowser`), e quelli di un altro
     * account vanno da parte per lui. Il carrello da ospite non è di nessuno e si fonde come sempre.
     */
    const sincronizzaGiu = (uid: string) => {
      allineaUtenteDelBrowser(uid);
      void syncDown(uid);
    };

    const handleAuth = async () => {
      // #88 — Il token in memoria basta: la sincronizzazione del carrello non
      // e' un'operazione di sicurezza.
      userId = await idUtenteInMemoria();
      if (userId) sincronizzaGiu(userId);
    };

    // Sync iniziale
    handleAuth();

    // Re-sync su login/logout
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      const precedente = userId;
      userId = session?.user?.id ?? null;
      if (userId) {
        sincronizzaGiu(userId);
        return;
      }
      // 106 — Mancava questo ramo. All'uscita il carrello restava nel browser:
      // sul computer di casa condiviso, o su quello di un negozio, la persona
      // successiva entrava e trovava dentro la spesa di chi c'era prima — e al
      // primo cambio la mandava perfino nel proprio carrello sul server.
      // Il punto giusto è uno solo: qui. I sei pulsanti di uscita sparsi per il
      // sito non devono ricordarsene, e nemmeno il settimo che nascerà.
      if (precedente) {
        clearCart();
        try { localStorage.removeItem(LAST_UPDATED_KEY); localStorage.removeItem(SYNCED_AT_KEY); } catch { /* noop */ }
      }
    });

    // Sync UP quando il carrello cambia (debounce 1s)
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const onCartUpdate = () => {
      if (!userId) return;
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        if (userId) syncUp(userId, getCart());
      }, 1000);
    };
    window.addEventListener('cart:updated', onCartUpdate);

    // Flush immediato se l'utente lascia/chiude la pagina entro il debounce:
    // così una rimozione non si perde (e non riappare al login successivo).
    const flush = () => {
      if (!debounceId) return;
      clearTimeout(debounceId);
      debounceId = null;
      if (userId) syncUp(userId, getCart());
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      sub.subscription.unsubscribe();
      window.removeEventListener('cart:updated', onCartUpdate);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      if (debounceId) clearTimeout(debounceId);
    };
  }, []);

  return null;
}
