'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { logger } from '@/lib/logger';
import { useUtente } from '@/components/hooks/useUtente';

/**
 * Somma dei messaggi non letti su tutte le conversazioni dell'utente.
 * Refetch ogni 60s + Realtime: si aggiorna quando una conversazione cambia.
 *
 * Nota: `refetch` cambia identity ad ogni render. Se lo mettiamo nelle deps
 * dell'effect Realtime, il channel viene ricreato e Supabase reagisce con
 * "cannot add postgres_changes callbacks after subscribe()" perché il channel
 * con lo stesso nome viene ri-usato già subscribed. Lo passiamo via ref.
 */
/**
 * 101 — Un canale per persona, condiviso da tutti i punti che mostrano il
 * numero dei messaggi non letti. Vive fuori dal componente proprio perché deve
 * sopravvivere ai montaggi: è lì che sta la condivisione.
 */
const registro = new Map<
  string,
  {
    usi: number;
    canale: ReturnType<typeof supabase.channel> | null;
    ascoltatori: Set<{ current: () => void }>;
  }
>();

export const useMessagesUnread = () => {
  // #88 — Questo hook e' montato due volte in ogni pagina (barra in alto e
  // barra in basso sul telefono): erano due chiamate di rete identiche al
  // server di autenticazione, su ogni pagina. Ora l'identita' arriva dalla
  // cache condivisa, che la chiede una volta sola.
  const { userId } = useUtente();

  const { data: unread = 0, refetch } = useQuery({
    queryKey: queryKeys.messages.unreadByUser(userId ?? ''),
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!userId) return 0;
      const { data, error } = await supabase
        .from('conversations')
        .select('buyer_id, seller_id, buyer_unread_count, seller_unread_count')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
      // La tabella `conversations` nasce dalla migration 026, e la paura era giusta: se non e'
      // applicata, questa lettura fallisce sempre. Ma `return 0` non proteggeva la UI — chi legge
      // il numero ha gia' il suo valore di riserva (`= 0` qui sopra), quindi a schermo non cambiava
      // niente. Cambiava che la query risultava RIUSCITA, e una query riuscita react-query non la
      // riprova: un guasto di rete di un secondo spegneva il contatore fino al ricaricamento.
      if (error) throw error;
      type ConvRow = { buyer_id: string; seller_id: string; buyer_unread_count: number | null; seller_unread_count: number | null };
      return (data ?? []).reduce((sum: number, c: ConvRow) => {
        if (c.buyer_id === userId) return sum + (c.buyer_unread_count ?? 0);
        if (c.seller_id === userId) return sum + (c.seller_unread_count ?? 0);
        return sum;
      }, 0);
    },
  });

  // Ref stabile per refetch — l'effect Realtime non dipende da una funzione
  // che cambia identity ad ogni render.
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!userId) return;

    // 101 — Questo aggancio nasceva UNA VOLTA PER MONTAGGIO, e il gancio è
    // montato due volte insieme: la barra in alto e la barra in basso vivono
    // tutte e due nel guscio dell'applicazione. Ogni persona che entra teneva
    // quindi due collegamenti in tempo reale identici, che ascoltano la stessa
    // tabella e chiamano la stessa ricarica: il doppio del costo per lo stesso
    // numero. Nell'area account diventavano perfino tre.
    //
    // Il canale ora è UNO per persona, con un contatore di chi lo usa: il primo
    // montaggio lo apre, gli altri si agganciano, e si chiude quando l'ultimo
    // se ne va. Il nome del canale non porta più l'orologio — era proprio
    // quello a renderlo irripetibile e quindi impossibile da condividere.
    const chiamanti = registro.get(userId);
    if (chiamanti) {
      chiamanti.usi += 1;
      chiamanti.ascoltatori.add(refetchRef);
    } else {
      const ascoltatori = new Set<typeof refetchRef>([refetchRef]);
      let canale: ReturnType<typeof supabase.channel> | null = null;
      try {
        /**
         * 22/8/2026 — OGNI PERSONA COLLEGATA ASCOLTAVA TUTTA LA TABELLA.
         *
         * L'ascolto era senza filtro: il server mandava a OGNI persona
         * collegata un avviso per OGNI cambiamento su `conversations`, comprese
         * le conversazioni fra sconosciuti. Con cento persone collegate e un
         * messaggio scritto, sono cento avvisi spediti perché uno solo serva.
         *
         * Il filtro Realtime accetta una colonna sola, e l'appartenenza qui sta
         * su due (`buyer_id`, `seller_id`): si aprono due ascolti sullo stesso
         * canale, uno per colonna. Il conteggio si ricarica lo stesso, ma solo
         * quando cambia qualcosa che riguarda davvero questa persona.
         */
        canale = supabase
          .channel(`msg-unread-${userId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'conversations', filter: `buyer_id=eq.${userId}` },
            () => { for (const a of ascoltatori) a.current(); },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'conversations', filter: `seller_id=eq.${userId}` },
            () => { for (const a of ascoltatori) a.current(); },
          )
          .subscribe();
      } catch (err) {
        logger.warn('[useMessagesUnread] realtime subscribe failed', err);
      }
      registro.set(userId, { usi: 1, canale, ascoltatori });
    }

    return () => {
      const voce = registro.get(userId);
      if (!voce) return;
      voce.ascoltatori.delete(refetchRef);
      voce.usi -= 1;
      if (voce.usi > 0) return;
      registro.delete(userId);
      if (voce.canale) {
        try { supabase.removeChannel(voce.canale); } catch { /* noop */ }
      }
    };
  }, [userId]); // solo userId — refetch via ref

  return unread;
};
