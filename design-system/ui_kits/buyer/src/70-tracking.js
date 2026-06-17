// ===== Order tracking (post-checkout) — 8-state timeline =====
const MC_FLOW = [
  { status: 'NEW', label: 'Ordine ricevuto', icon: 'clock', sub: 'Il negozio sta confermando' },
  { status: 'ACCEPTED', label: 'In preparazione', icon: 'chef-hat', sub: 'Il negozio prepara il tuo ordine' },
  { status: 'READY', label: 'Pronto per il ritiro', icon: 'package', sub: 'Pronto in negozio' },
  { status: 'ASSIGNED', label: 'Rider assegnato', icon: 'bike', sub: 'Un rider sta arrivando in negozio' },
  { status: 'PICKED_UP', label: 'Ritirato', icon: 'hand', sub: 'Il rider ha ritirato l’ordine' },
  { status: 'OUT_FOR_DELIVERY', label: 'In consegna', icon: 'truck', sub: 'Il rider è in viaggio verso di te' },
  { status: 'DELIVERED', label: 'Consegnato', icon: 'check-circle-2', sub: 'Consegnato — grazie!' },
];

function OrderTracking({ order, onContinue, onHome }) {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (step >= MC_FLOW.length - 1) return;
    const t = setTimeout(() => setStep((s) => Math.min(MC_FLOW.length - 1, s + 1)), step === 0 ? 2600 : 3400);
    return () => clearTimeout(t);
  }, [step]);

  const store = storeBy(order.items[0].store) || {};
  const current = MC_FLOW[step];
  const delivered = current.status === 'DELIVERED';
  const eta = delivered ? 'Consegnato' : (store.deliveryToday ? 'Oggi, entro le 19:30' : 'Domani, 24–48h');

  return (
    <div style={{ maxWidth: '880px', margin: '0 auto', padding: '28px 20px' }}>
      <button onClick={onHome} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: 0, background: 'transparent', color: 'var(--ink-600)', fontSize: '14px', fontWeight: 500, cursor: 'pointer', padding: '8px 0', fontFamily: 'var(--font-sans)' }}>
        <Lucide name="arrow-left" size={17} /> Torna al marketplace
      </button>

      {/* hero status */}
      <Card variant="elevated" padding="lg" style={{ marginTop: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <span style={{ width: '60px', height: '60px', borderRadius: 'var(--radius-full)', background: delivered ? 'var(--olive-100)' : 'var(--primary-100)', color: delivered ? 'var(--olive-700)' : 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Lucide name={current.icon} size={28} stroke={2.2} color={delivered ? 'var(--olive-700)' : 'var(--primary-700)'} />
          </span>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 700, color: 'var(--ink-900)' }}>{delivered ? 'Ordine consegnato!' : 'Ordine confermato!'}</h1>
              <OrderStatusBadge status={current.status} />
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-600)' }}>Ordine <strong>{order.id}</strong> · {current.sub}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Consegna stimata</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--ink-900)' }}>{eta}</div>
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '24px', marginTop: '24px', alignItems: 'start' }}>
        {/* timeline */}
        <Card variant="bordered" padding="lg">
          <h2 style={{ margin: '0 0 18px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Stato dell’ordine</h2>
          <div>
            {MC_FLOW.map((s, i) => {
              const done = i < step, active = i === step;
              const color = done ? 'var(--olive-600)' : active ? 'var(--primary-600)' : 'var(--cream-400)';
              return (
                <div key={s.status} style={{ display: 'flex', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: done || active ? color : 'var(--cream-100)', color: done || active ? '#fff' : 'var(--ink-300)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: active ? '3px solid var(--primary-200)' : 'none', transition: 'background var(--dur-medium)' }}>
                      <Lucide name={done ? 'check' : s.icon} size={16} stroke={2.4} color={done || active ? '#fff' : 'var(--ink-300)'} />
                    </span>
                    {i < MC_FLOW.length - 1 && <span style={{ width: '2px', flex: 1, minHeight: '26px', background: done ? 'var(--olive-400)' : 'var(--cream-300)' }} />}
                  </div>
                  <div style={{ paddingBottom: '18px' }}>
                    <p style={{ margin: 0, fontSize: '15px', fontWeight: active ? 700 : 600, color: done || active ? 'var(--ink-900)' : 'var(--ink-400)' }}>{s.label}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>{active ? s.sub : done ? 'Completato' : 'In attesa'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Card variant="bordered" padding="lg">
            <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Riepilogo</h2>
            {order.items.map((it) => (
              <div key={it.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--cream-200)' }}>
                <img src={it.img} alt={it.name} style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--ink-900)', lineHeight: 1.3 }}>{it.name}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)' }}>× {it.qty}</p>
                </div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(it.finalPrice * it.qty)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '17px', fontWeight: 800, color: 'var(--ink-900)' }}><span>Totale</span><span>{fmt(order.total)}</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '10px 12px', background: 'var(--olive-50)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--olive-800)', fontWeight: 600 }}>
              <Lucide name="banknote" size={16} color="var(--olive-700)" /> Paghi {fmt(order.total)} in contanti al rider
            </div>
          </Card>
          <Card variant="bordered" padding="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <StoreChip name={order.items[0].store} size={28} />
              {store.verified && <Lucide name="badge-check" size={15} color="var(--primary-600)" />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '13px', color: 'var(--ink-600)' }}>
              <Lucide name="map-pin" size={15} color="var(--primary-600)" /> Consegna in {order.address ? `${order.address.street}, ${order.address.city}` : 'Via Roma 12, Piacenza'}
            </div>
          </Card>
          <Button variant="secondary" fullWidth onClick={onContinue}>Continua lo shopping</Button>
        </div>
      </div>
    </div>
  );
}
