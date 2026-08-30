'use client';

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  sellerId?: string;
  storeName?: string;
  /** Variante scelta (taglia/colore…): identifica la riga insieme a `id`. */
  variantId?: string;
  variantLabel?: string;
};

/** Due righe sono lo stesso articolo solo se coincidono prodotto E variante. */
const sameLine = (a: { id: string; variantId?: string }, b: { id: string; variantId?: string }) =>
  a.id === b.id && (a.variantId ?? null) === (b.variantId ?? null);

const KEY = 'cart';

/**
 * FONDERE DUE CARRELLI, NON SOSTITUIRNE UNO.
 *
 * 27/8/2026 (R092) — al momento dell'accesso il carrello del cloud prendeva il posto di quello nel
 * browser: `saveCart(cloudItems)`, sostituzione integrale, mentre in testa a
 * `components/CartCrossDeviceSync.tsx` c'era scritto «Strategia merge». Chi aveva riempito il
 * carrello sul telefono e poi accedeva dal computer perdeva la sua spesa in silenzio, e la perdita
 * è definitiva: nessuno può accorgersene, perché nessuno ricorda cosa c'era dentro.
 *
 * La regola è una sola: si tengono tutte e due, e per la stessa riga — stesso prodotto E stessa
 * variante, come dice `sameLine` — vale la quantità più alta, mai la somma (sommare farebbe
 * comparire sei pezzi a chi ne aveva scelti tre di qua e tre di là). I dati descrittivi li porta il
 * carrello passato per secondo, che è il più recente.
 */
export const fondiCarrelli = (locale: CartItem[], cloud: CartItem[]): CartItem[] => {
  const fuso: CartItem[] = locale.map((r) => ({ ...r }));
  for (const daCloud of cloud) {
    const gia = fuso.find((r) => sameLine(r, daCloud));
    if (gia) {
      Object.assign(gia, daCloud, { quantity: Math.max(gia.quantity, daCloud.quantity) });
    } else {
      fuso.push({ ...daCloud });
    }
  }
  for (const r of fuso) r.quantity = Math.min(Math.max(1, r.quantity), MAX_PEZZI_PER_ARTICOLO);
  return fuso;
};


/**
 * 22/8/2026 — IL CARRELLO NON AVEVA UN TETTO, IL SERVER SÌ.
 *
 * Le rotte di ordine rifiutano le quantità sopra 99 (`z.number().max(99)`), e
 * fanno bene. Ma il carrello lasciava salire quanto si voleva: si arrivava a
 * cento pezzi, si compilava l'indirizzo, si premeva «Ordina» — e si leggeva un
 * errore di validazione che non nomina nemmeno l'articolo.
 *
 * Il limite adesso sta dove si sceglie la quantità, ed è lo stesso numero.
 */
export const MAX_PEZZI_PER_ARTICOLO = 99;
// Timestamp dell'ultima modifica LOCALE del carrello. Condiviso con
// CartCrossDeviceSync: il merge cloud↔locale usa "il più recente vince", quindi
// ogni mutazione locale (aggiunta/rimozione/svuota) deve avanzare questo orologio,
// altrimenti un carrello cloud stale può "resuscitare" item rimossi al login.
export const CART_UPDATED_AT_KEY = 'cart_updated_at';

const bumpUpdatedAt = () => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CART_UPDATED_AT_KEY, String(Date.now())); } catch { /* noop */ }
};

export const getCart = (): CartItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const letto = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    // 22/8/2026 — se il valore salvato non è un elenco, il carrello viene
    // restituito com'è e il primo `.map()` esplode in faccia alla persona. Può
    // succedere per un salvataggio a metà, o per un'altra scheda che ha scritto
    // sotto la stessa chiave.
    return Array.isArray(letto) ? letto : [];
  } catch {
    return [];
  }
};

/**
 * 22/8/2026 — «AGGIUNGI AL CARRELLO» POTEVA NON FARE NIENTE, IN SILENZIO.
 *
 * `localStorage.setItem` non è una scrittura che riesce sempre: lancia se lo
 * spazio del browser è pieno, e in navigazione privata su alcuni browser lancia
 * comunque. Qui non era protetta, quindi l'eccezione risaliva fino a chi aveva
 * premuto il pulsante: nessun prodotto aggiunto, nessun messaggio, niente.
 *
 * Il carrello resta comunque in memoria per questa visita — l'evento parte lo
 * stesso — ma la persona deve sapere che al prossimo giro non lo ritrova.
 */
export type EsitoSalvataggio = { salvato: boolean; motivo?: string };

let ultimoAvviso = 0;

export const saveCart = (items: CartItem[]): EsitoSalvataggio => {
  if (typeof window === 'undefined') return { salvato: false };

  let salvato = true;
  let motivo: string | undefined;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch (e) {
    salvato = false;
    motivo =
      'Il browser non riesce a salvare il carrello. Libera spazio, oppure esci dalla navigazione privata: adesso funziona, ma alla prossima visita non lo ritrovi.';
    // Una volta ogni cinque minuti: chi aggiunge dieci prodotti non merita
    // dieci avvisi identici.
    const ora = Date.now();
    if (ora - ultimoAvviso > 5 * 60_000) {
      ultimoAvviso = ora;
      window.dispatchEvent(new CustomEvent('cart:non-salvato', { detail: { motivo, errore: e } }));
    }
  }

  bumpUpdatedAt();
  window.dispatchEvent(new Event('cart:updated'));
  void syncAbandonedCart(items);
  return { salvato, motivo };
};

/** Dice che il tetto è scattato, con il nome dell'articolo. */
function avvisaTetto(nome?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('cart:tetto-raggiunto', {
      detail: {
        motivo: `Massimo ${MAX_PEZZI_PER_ARTICOLO} pezzi${nome ? ` di «${nome}»` : ''} per ordine. Per una quantità più grande scrivi direttamente al negozio: te la prepara.`,
      },
    }),
  );
}

export const addToCart = (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
  const cart = getCart();
  const existing = cart.find((c) => sameLine(c, item));
  const qty = item.quantity ?? 1;
  /**
   * 30/8/2026 (R167) — SI DICHIARAVA LA QUANTITA' CHIESTA, NON QUELLA ENTRATA.
   *
   * Quando scatta il tetto per articolo le due cose non coincidono: chi ne
   * chiede venti con tetto a dieci ne mette dentro dieci, chi ne ha gia' otto e
   * ne aggiunge cinque ne mette dentro due. L'evento partiva col numero
   * CHIESTO, e su GA4 il valore e' prezzo x quantita': il valore del carrello
   * risultava piu' alto del vero e l'imbuto «aggiunto al carrello → acquisto»
   * sembrava peggiore di com'era. `updateQuantity`, venti righe piu' sotto,
   * faceva gia' la cosa giusta mandando la differenza reale.
   */
  let entrati: number;
  if (existing) {
    const prima = existing.quantity;
    const voluta = prima + qty;
    existing.quantity = Math.min(voluta, MAX_PEZZI_PER_ARTICOLO);
    entrati = existing.quantity - prima;
    if (voluta > MAX_PEZZI_PER_ARTICOLO) avvisaTetto(item.name);
  } else {
    const messi = Math.min(qty, MAX_PEZZI_PER_ARTICOLO);
    cart.push({ ...item, quantity: messi });
    entrati = messi;
    if (qty > MAX_PEZZI_PER_ARTICOLO) avvisaTetto(item.name);
  }
  saveCart(cart);
  // Carrello gia' al tetto: non e' entrato niente, e un evento da zero pezzi
  // direbbe solo il falso.
  if (entrati <= 0) return;
  // Tracking unificato (PostHog + GA4) via façade lib/analytics/events.
  // Fire-and-forget; no-op senza consenso analytics.
  import('@/lib/analytics/events')
    .then((m) => m.trackAddToCart(item.id, entrati, Math.round(item.price * 100), { name: item.name, storeName: item.storeName }))
    .catch(() => {});
};

/**
 * Rimuove dal carrello. Con `variantId` rimuove SOLO quella riga; senza, rimuove
 * tutte le righe del prodotto (utile per gli articoli non più disponibili).
 */
export const removeFromCart = (id: string, variantId?: string) => {
  const prima = getCart();
  const tolte = prima.filter((c) =>
    variantId === undefined ? c.id === id : sameLine(c, { id, variantId }),
  );
  saveCart(
    prima.filter((c) =>
      variantId === undefined ? c.id !== id : !sameLine(c, { id, variantId }),
    ),
  );
  // #226 — La rimozione porta quantita' e prezzo, come l'aggiunta. Prima
  // viaggiava nuda: su GA4 il valore tolto dal carrello era sempre zero.
  const qta = tolte.reduce((s, r) => s + r.quantity, 0);
  const riga = tolte[0];
  if (!riga) return;
  import('@/lib/analytics/events')
    .then((m) => m.trackRemoveFromCart(id, qta, Math.round(riga.price * 100), { name: riga.name, storeName: riga.storeName }))
    .catch(() => {});
};

/**
 * Toglie SOLO la riga senza variante di un prodotto, lasciando intatte le sue righe con variante.
 *
 * ⚠️ PERCHÉ NON BASTA `removeFromCart(id)`. Quella, senza variante, toglie TUTTE le righe di quel
 * prodotto. Serve qui perché il caso da riparare è una riga rotta — un articolo con varianti finito
 * nel carrello senza sceglierne una, aggiunto dal «+» di una vetrina. Chi ha anche la riga giusta,
 * con la taglia scelta, non deve perderla per riparare quella rotta.
 *
 * `undefined` e la stringa vuota sono la stessa cosa qui: «variante non scelta».
 */
export const rimuoviRigaSenzaVariante = (id: string) => {
  const senzaVariante = (c: CartItem) => c.id === id && !c.variantId;
  const prima = getCart();
  const tolte = prima.filter(senzaVariante);
  if (tolte.length === 0) return;
  saveCart(prima.filter((c) => !senzaVariante(c)));
  const qta = tolte.reduce((s, r) => s + r.quantity, 0);
  const riga = tolte[0];
  import('@/lib/analytics/events')
    .then((m) => m.trackRemoveFromCart(id, qta, Math.round(riga.price * 100), { name: riga.name, storeName: riga.storeName }))
    .catch(() => {});
};

export const updateQuantity = (id: string, quantity: number, variantId?: string) => {
  if (quantity < 1) return removeFromCart(id, variantId);
  const prima = getCart();
  const riga = prima.find((c) => sameLine(c, { id, variantId }));
  // 22/8/2026 — il tetto vale anche qui: prima si poteva scrivere la quantità
  // a mano e superarlo comunque.
  const voluta = quantity;
  quantity = Math.min(quantity, MAX_PEZZI_PER_ARTICOLO);
  if (voluta > MAX_PEZZI_PER_ARTICOLO) avvisaTetto(riga?.name);
  const delta = quantity - (riga?.quantity ?? 0);
  saveCart(prima.map((c) => (sameLine(c, { id, variantId }) ? { ...c, quantity } : c)));
  // #226 — Il cambio di quantita' non si vedeva affatto: nei numeri un
  // carrello portato da 1 a 6 pezzi era identico a uno lasciato a 1. Si emette
  // la differenza, che e' la convenzione GA4.
  if (!riga || delta === 0) return;
  const cents = Math.round(riga.price * 100);
  const meta = { name: riga.name, storeName: riga.storeName };
  import('@/lib/analytics/events')
    .then((m) => (delta > 0
      ? m.trackAddToCart(id, delta, cents, meta)
      : m.trackRemoveFromCart(id, -delta, cents, meta)))
    .catch(() => {});
};

export const clearCart = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  bumpUpdatedAt();
  window.dispatchEvent(new Event('cart:updated'));
  void syncAbandonedCart([]);
};

export const cartTotal = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.price * item.quantity, 0);

export const cartCount = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.quantity, 0);

/**
 * Persistenza server-side del carrello, per abilitare il recupero ("hai
 * dimenticato qualcosa"). Salva una copia in `abandoned_carts` SOLO per gli
 * utenti loggati; su carrello vuoto (es. dopo l'ordine) rimuove la riga.
 * Best-effort / fire-and-forget: non blocca né rompe mai il carrello locale.
 * La RLS consente all'utente di scrivere solo il proprio record.
 */
async function syncAbandonedCart(items: CartItem[]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return; // solo utenti autenticati
    if (items.length === 0) {
      await supabase.from('abandoned_carts').delete().eq('user_id', userId);
      return;
    }
    await supabase.from('abandoned_carts').upsert(
      {
        user_id: userId,
        cart_data: items,
        cart_total: cartTotal(items),
        last_activity: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  } catch {
    /* best-effort: il recupero carrello non deve mai rompere il carrello locale */
  }
}
