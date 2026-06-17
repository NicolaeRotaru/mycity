// ===== Cart drawer =====
function CartDrawer({ open, items, onClose, onQty, onRemove, onCheckout, onContinue }) {
  const subtotal = items.reduce((s, it) => s + it.finalPrice * it.qty, 0);
  const FREE = 25;
  const shipping = subtotal >= FREE || subtotal === 0 ? 0 : 3.5;
  const total = subtotal + shipping;
  const toFree = Math.max(0, FREE - subtotal);
  if (!open) return null;
  return ReactDOM.createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-modal)', background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'flex-end', animation: 'mc-fade-in var(--dur-fast) ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Carrello" style={{ width: '420px', maxWidth: '92vw', height: '100%', background: 'var(--surface-0)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-warm-xl)', animation: 'mc-slide-right var(--dur-medium) var(--ease-out-quint)' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--cream-200)' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Lucide name="shopping-cart" size={20} /> Carrello <span style={{ fontSize: '14px', color: 'var(--ink-400)', fontFamily: 'var(--font-sans)' }}>· {items.reduce((s, it) => s + it.qty, 0)}</span>
          </h2>
          <button onClick={onClose} aria-label="Chiudi" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-500)', display: 'inline-flex' }}><Lucide name="x" size={22} /></button>
        </header>

        {items.length > 0 && (
          <div style={{ padding: '12px 20px', background: toFree > 0 ? 'var(--accent-100)' : 'var(--olive-50)', borderBottom: '1px solid var(--cream-200)' }}>
            <div style={{ fontSize: '13px', color: 'var(--ink-700)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lucide name="truck" size={15} color={toFree > 0 ? 'var(--accent-700)' : 'var(--olive-700)'} />
              {toFree > 0 ? <span>Aggiungi <strong>{fmt(toFree)}</strong> per la <strong>spedizione gratis</strong></span> : <span><strong>Spedizione gratis</strong> sbloccata!</span>}
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,.6)', borderRadius: '3px', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.min(100, (subtotal / FREE) * 100)}%`, background: toFree > 0 ? 'var(--accent-500)' : 'var(--olive-500)', transition: 'width var(--dur-medium) var(--ease-out-quint)' }} /></div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
          {items.length === 0 ? (
            <EmptyState icon="shopping-cart" title="Il carrello è vuoto" description="Aggiungi prodotti dai negozi di Piacenza per iniziare." action={<Button variant="primary" onClick={onContinue}>Esplora i negozi</Button>} />
          ) : items.map((it) => (
            <div key={it.id} style={{ display: 'flex', gap: '12px', padding: '14px 0', borderBottom: '1px solid var(--cream-200)' }}>
              <img src={it.img} alt={it.name} style={{ width: '64px', height: '64px', borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)', lineHeight: 1.3 }}>{it.name}</p>
                <p style={{ margin: '2px 0 8px', fontSize: '12px', color: 'var(--ink-500)' }}>{it.store}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-full)' }}>
                    <button onClick={() => onQty(it.id, -1)} style={miniBtn}><Lucide name="minus" size={13} /></button>
                    <span style={{ minWidth: '24px', textAlign: 'center', fontSize: '13px', fontWeight: 700 }}>{it.qty}</span>
                    <button onClick={() => onQty(it.id, 1)} style={miniBtn}><Lucide name="plus" size={13} /></button>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--ink-900)' }}>{fmt(it.finalPrice * it.qty)}</span>
                </div>
              </div>
              <button onClick={() => onRemove(it.id)} aria-label="Rimuovi" style={{ border: 0, background: 'transparent', color: 'var(--ink-400)', cursor: 'pointer', alignSelf: 'flex-start', display: 'inline-flex' }}><Lucide name="trash-2" size={16} /></button>
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <footer style={{ borderTop: '1px solid var(--cream-200)', padding: '16px 20px', background: 'var(--cream-50)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--ink-600)', marginBottom: '6px' }}><span>Subtotale</span><span>{fmt(subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--ink-600)', marginBottom: '10px' }}><span>Consegna</span><span>{shipping === 0 ? <span style={{ color: 'var(--olive-700)', fontWeight: 600 }}>Gratis</span> : fmt(shipping)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 800, color: 'var(--ink-900)', marginBottom: '14px' }}><span>Totale</span><span>{fmt(total)}</span></div>
            <Button variant="primary" size="lg" fullWidth iconRight="arrow-right" onClick={onCheckout}>Vai alla conferma</Button>
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--ink-500)', textAlign: 'center', display: 'inline-flex', width: '100%', justifyContent: 'center', gap: '5px' }}><Lucide name="banknote" size={14} color="var(--olive-600)" /> Paghi alla consegna · contanti al rider</p>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
const miniBtn = { width: '28px', height: '28px', border: 0, background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
