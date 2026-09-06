'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Share, SquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import {
  attivaPushSuQuestoDispositivo,
  notificheAttiveQui,
  scollegaQuestoDispositivo,
} from '@/lib/push/dispositivo';
import { eApple, percheNienteNotifiche, type PercheNienteNotifiche } from '@/lib/installabile';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'checking';

/**
 * Bottone "Attiva notifiche push" — un solo tap.
 * - Registra il service worker se non già registrato
 * - Chiede permesso al browser
 * - Crea subscription PushManager con VAPID public key
 * - La salva su Supabase (push_subscriptions)
 *
 * Bottone "Disattiva" per cancellare la subscription.
 *
 * Disabilitato (mostra messaggio info) se VAPID public key non è configurata.
 */
export default function PushNotificationOptIn({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>('checking');
  const [working, setWorking] = useState(false);
  // 6/9/2026 — SU iPHONE QUI SI LEGGEVA «IL TUO BROWSER NON SUPPORTA», E NON ERA VERO.
  //
  // Safari su iOS espone `PushManager` solo quando il sito è stato aggiunto alla schermata Home:
  // dal browser il controllo qui sotto cade sempre in `unsupported`, e la frase dava del vecchio
  // al telefono di chi compra invece di dirgli i due gesti che accendono le notifiche.
  // Il perché sta in lib/installabile.ts, insieme alla decisione sull'installazione.
  const [motivo, setMotivo] = useState<PercheNienteNotifiche>('browser-senza-push');

  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && !!VAPID_PUBLIC;

  // `navigator` esiste solo nel browser: la domanda si fa dopo il montaggio, non durante il render.
  //
  // ⚠️ `matchMedia` si chiede prima di usarlo. Manca in qualche webview incorporata — e mancava
  // nell'ambiente in cui gira la prova della pagina impostazioni: questa riga, scritta senza
  // riparo, faceva cadere l'INTERA pagina delle impostazioni. Una domanda su cosa sa fare il
  // telefono non deve mai poter spegnere la pagina che la fa: nel dubbio, non è installata.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const inHome = typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
    setMotivo(percheNienteNotifiche({
      eApple: eApple(navigator.userAgent, navigator.maxTouchPoints ?? 0),
      giaInstallata: inHome,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!supported) { setStatus('unsupported'); return; }
    (async () => {
      try {
        if (Notification.permission === 'denied') { setStatus('denied'); return; }
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        // Il browser risponde «c'è un'iscrizione» anche quando quell'iscrizione
        // è di chi ha usato questo apparecchio prima di me: da sola non basta a
        // scrivere «Notifiche attive». Vale solo se la riga è intestata a me.
        const { data: { user } } = await supabase.auth.getUser();
        const { data: righe } = await supabase
          .from('push_subscriptions')
          .select('endpoint')
          .eq('user_id', user?.id ?? '')
          .eq('endpoint', sub?.endpoint ?? '');
        const mie = ((righe ?? []) as { endpoint: string }[]).map((r) => r.endpoint);
        setStatus(
          user && notificheAttiveQui({ endpointDelBrowser: sub?.endpoint ?? null, endpointMiei: mie })
            ? 'subscribed'
            : 'unsubscribed',
        );
      } catch {
        setStatus('unsubscribed');
      }
    })();
  }, [supported]);

  const subscribe = async () => {
    setWorking(true);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'unsubscribed');
        toast.error('Permesso negato');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Devi essere loggato');
        return;
      }

      // Cast a BufferSource via .buffer per evitare incompatibilità di tipi
      // tra Uint8Array<ArrayBufferLike> (lib.dom.d.ts moderna) e BufferSource.
      const keyArray = urlBase64ToUint8Array(VAPID_PUBLIC);
      // Se l'indirizzo di questo apparecchio è ancora di chi c'era prima, il
      // salvataggio viene rifiutato: allora si butta quell'iscrizione (che così
      // smette di consegnargli gli avvisi qui) e se ne prende una nuova. E se
      // nemmeno così si salva, non si scrive «attivate» a chi non lo è.
      const esito = await attivaPushSuQuestoDispositivo({
        creaIscrizione: () => reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyArray.buffer as ArrayBuffer,
        }),
        salva: (iscrizione) => {
          const json = iscrizione.toJSON();
          return supabase
            .from('push_subscriptions')
            .upsert({
              user_id: user.id,
              endpoint: json.endpoint!,
              p256dh: json.keys!.p256dh!,
              auth: json.keys!.auth!,
              user_agent: navigator.userAgent.slice(0, 200),
            }, { onConflict: 'endpoint' });
        },
      });

      if (!esito.salvata) {
        setStatus('unsubscribed');
        toast.error('Non sono riuscito ad attivare le notifiche su questo dispositivo.');
        return;
      }

      setStatus('subscribed');
      toast.success('Notifiche attivate!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Impossibile attivare');
    } finally {
      setWorking(false);
    }
  };

  const unsubscribe = async () => {
    setWorking(true);
    try {
      // Lo stesso lavoro che si fa uscendo dall'account, e nello stesso ordine:
      // prima la riga (finché la sessione vale), poi l'iscrizione del browser.
      await scollegaQuestoDispositivo((endpoint) =>
        supabase.from('push_subscriptions').delete().eq('endpoint', endpoint),
      );
      setStatus('unsubscribed');
      toast.success('Notifiche disattivate');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore');
    } finally {
      setWorking(false);
    }
  };

  if (status === 'unsupported') {
    if (compact) return null;
    // Su iPhone non c'è niente di rotto: manca solo l'icona in Home. Si dicono i due gesti, gli
    // stessi che compaiono nel banner d'installazione, così la frase è una sola su tutto il sito.
    if (motivo === 'iphone-da-installare') {
      return (
        <div className="text-xs text-ink-600">
          <p>Su iPhone le notifiche funzionano dall&apos;app in schermata Home.</p>
          <ol className="mt-2 space-y-1.5 text-ink-700">
            <li className="flex items-center gap-1.5">
              <Share size={14} className="shrink-0 text-primary-700" aria-hidden />
              Tocca <strong>Condividi</strong>, in fondo allo schermo
            </li>
            <li className="flex items-center gap-1.5">
              <SquarePlus size={14} className="shrink-0 text-primary-700" aria-hidden />
              Poi <strong>Aggiungi a Home</strong>
            </li>
          </ol>
          <p className="mt-2">Poi torna qui e attivale.</p>
        </div>
      );
    }
    return (
      <p className="text-xs text-ink-400 italic">
        Il tuo browser non supporta le notifiche push, oppure il marketplace non le ha ancora configurate.
      </p>
    );
  }

  if (status === 'denied') {
    return (
      <div className="text-sm text-ink-600">
        <p className="font-medium">Notifiche bloccate</p>
        <p className="text-xs text-ink-500">Vai nelle impostazioni del browser per riattivarle.</p>
      </div>
    );
  }

  if (status === 'subscribed') {
    return (
      <button
        type="button"
        onClick={unsubscribe}
        disabled={working}
        className="inline-flex items-center gap-2 bg-olive-100 hover:bg-olive-200 text-olive-800 px-4 py-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-50"
      >
        <BellOff size={16} />
        {working ? '…' : 'Notifiche attive'}
      </button>
    );
  }

  return (
    <Button
      type="button"
      onClick={subscribe}
      loading={working || status === 'checking'}
      size="sm"
      shape="pill"
      icon={Bell}
    >Attiva notifiche</Button>
  );
}
