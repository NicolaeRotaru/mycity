-- 108: corregge la policy SELECT rider su public.orders
--
-- PROBLEMA: il primo ramo della USING non referenzia auth.uid() → qualsiasi
-- account autenticato (o anonimo con anon key) può leggere nome/indirizzo/
-- telefono dei clienti con ordini ACCEPTED/READY in attesa di rider.
--
-- FIX: il ramo "ordini disponibili" richiede ora che il richiedente sia un
-- rider approvato. Viene aggiunto TO authenticated per escludere il ruolo
-- anon dal default permissive evaluation.
--
-- Idempotente.

DROP POLICY IF EXISTS "Riders can view available and own orders" ON public.orders;
CREATE POLICY "Riders can view available and own orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    rider_id = auth.uid()
    OR (
      delivery_status IN ('ACCEPTED', 'READY')
      AND rider_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'rider'
          AND is_approved = true
      )
    )
  );

NOTIFY pgrst, 'reload schema';
