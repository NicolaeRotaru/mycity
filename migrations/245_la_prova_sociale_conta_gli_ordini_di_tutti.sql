-- =============================================================================
-- 245 — La prova sociale conta gli ordini di tutti, e restituisce solo un numero
-- =============================================================================
-- IL DIFETTO (schede 256 e 732, S10 del 5/11/2026). La scritta «Ordinato N
-- volte negli ultimi 7 giorni» sulla scheda prodotto (components/ui/SocialProof)
-- leggeva `order_items` dal browser. Le regole del database fanno vedere le
-- righe d'ordine solo a chi le possiede (cliente, negozio, fattorino, admin):
-- un cliente qualunque contava solo i SUOI ordini. In piu' il browser scaricava
-- ogni riga d'ordine del prodotto per sommarle a mano.
--
-- COSA FA. Una funzione SECURITY DEFINER che restituisce SOLO il numero di
-- ordini distinti, non annullati e non falliti nel pagamento, degli ultimi 7 giorni per quel prodotto, e
-- solo se il prodotto e' in vendita. Nessuna riga, nessun dato del cliente.
-- L'indice order_items(product_id) esiste gia' (036).
--
-- COSA NON FA. Non tocca le regole di lettura di `order_items` e `orders`.
--
-- RITORNO INDIETRO (down):
--   DROP FUNCTION IF EXISTS public.ordini_recenti_del_prodotto(uuid);
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ordini_recenti_del_prodotto(p_product_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT oi.order_id)::integer
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.products p ON p.id = oi.product_id
   WHERE oi.product_id = p_product_id
     AND p.status = 'available'
     AND o.created_at >= now() - interval '7 days'
     AND COALESCE(o.delivery_status, '') <> 'CANCELED'
     AND COALESCE(o.payment_status, '') <> 'FAILED';
$$;

REVOKE ALL ON FUNCTION public.ordini_recenti_del_prodotto(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.ordini_recenti_del_prodotto(uuid) TO anon, authenticated, service_role;
