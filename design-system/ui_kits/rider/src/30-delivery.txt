// ===== Live delivery (full-screen flow over the phone content) =====
const RD_FLOW = ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const RD_ACTION = {
  ASSIGNED: { label: 'Sono al negozio · ritira', icon: 'package', sub: 'Vai al negozio a ritirare l’ordine' },
  PICKED_UP: { label: 'Inizia la consegna', icon: 'bike', sub: 'Ordine ritirato, vai dal cliente' },
  OUT_FOR_DELIVERY: { label: 'Consegnato', icon: 'check', sub: 'Sei arrivato dal cliente' },
};

function LiveDelivery({ order, onAdvance, onClose }) {
  const o = order;
  const stepIdx = RD_FLOW.indexOf(o.status);
  const action = RD_ACTION[o.status];
  const done = o.status === 'DELIVERED';
  return (
    <div style={{ position: 'absolute', inset: 0, top: '44px', background: 'var(--surface-50)', zIndex: 20, display: 'flex', flexDirection: 'column', animation: 'mc-slide-up var(--dur-medium) var(--ease-out-quint)' }}>
      {/* map placeholder */}
      <div style={{ position: 'relative', height: '220px', flexShrink: 0, background: 'linear-gradient(135deg, var(--olive-100), var(--cream-200))', overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px)' }} />
        <svg viewBox="0 0 390 220" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M70 180 Q 140 120 200 130 T 320 60" fill="none" stroke="var(--primary-600)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
        </svg>
        <span style={{ position: 'absolute', left: '60px', top: '168px', width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary-700)', border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-warm)' }}><Lucide name="store" size={14} color="#fff" /></span>
        <span style={{ position: 'absolute', left: '306px', top: '46px', width: '28px', height: '28px', borderRadius: '50%', background: 'var(--olive-600)', border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-warm)' }}><Lucide name="map-pin" size={14} color="#fff" /></span>
        <button onClick={onClose} aria-label="Chiudi" style={{ position: 'absolute', top: '12px', left: '12px', width: '36px', height: '36px', borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.95)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Lucide name="chevron-down" size={20} color="var(--ink-700)" /></button>
        <span style={{ position: 'absolute', top: '14px', right: '14px', background: 'rgba(28,26,24,.82)', color: '#fff', fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '999px' }}>{o.distance} · {o.eta}</span>
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <OrderStatusBadge status={o.status} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink-400)' }}>#{o.id}</span>
        </div>

        {/* progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '18px' }}>
          {RD_FLOW.map((s, i) => (
            <div key={s} style={{ flex: 1, height: '5px', borderRadius: '999px', background: i <= stepIdx ? 'var(--olive-500)' : 'var(--cream-300)' }} />
          ))}
        </div>

        {/* current target card */}
        {!done && (
          <Card variant="elevated" padding="lg" style={{ marginBottom: '14px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink-400)' }}>{stepIdx === 0 ? 'Ritira al negozio' : 'Consegna al cliente'}</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{stepIdx === 0 ? o.store : o.cust}</p>
            <p style={{ margin: '2px 0 12px', fontSize: '14px', color: 'var(--ink-600)' }}>{stepIdx === 0 ? o.storeAddr : o.custAddr}</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="secondary" size="sm" icon="navigation" fullWidth>Naviga</Button>
              <Button variant="secondary" size="sm" icon="phone" fullWidth>Chiama</Button>
            </div>
          </Card>
        )}

        {/* order summary */}
        <Card variant="bordered" padding="md" style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '6px' }}><span style={{ color: 'var(--ink-500)' }}>Articoli</span><span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{o.items} prodotti</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '6px' }}><span style={{ color: 'var(--ink-500)' }}>Il tuo compenso</span><span style={{ fontWeight: 700, color: 'var(--olive-700)' }}>{fmt(o.fee)}</span></div>
          {o.pay === 'cod' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', padding: '10px 12px', background: 'var(--accent-100)', borderRadius: 'var(--radius-md)' }}>
              <Lucide name="banknote" size={18} color="var(--accent-800)" />
              <span style={{ fontSize: '13px', color: 'var(--accent-900)' }}>Incassa <strong>{fmt(o.total)}</strong> in contanti dal cliente.</span>
            </div>
          )}
        </Card>

        {done && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <span style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--olive-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}><Lucide name="check" size={32} stroke={3} color="var(--olive-700)" /></span>
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800, color: 'var(--ink-900)' }}>Consegna completata!</p>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-500)' }}>Hai guadagnato {fmt(o.fee)}{o.pay === 'cod' ? ` + ${fmt(o.total)} contanti incassati` : ''}.</p>
          </div>
        )}
      </div>

      {/* action footer */}
      <div style={{ flexShrink: 0, padding: '14px 18px 24px', borderTop: '1px solid var(--cream-200)', background: 'var(--surface-0)' }}>
        {done
          ? <Button variant="primary" size="lg" fullWidth onClick={onClose}>Torna alle consegne</Button>
          : <Button variant={o.status === 'OUT_FOR_DELIVERY' ? 'success' : 'primary'} size="lg" fullWidth icon={action.icon} onClick={() => onAdvance(o)}>{action.label}</Button>}
      </div>
    </div>
  );
}
