// ===== Seller: Orders (table + detail) =====
function OrdersTable({ orders, onOpenOrder, compact }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
        <thead>
          <tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <th style={th}>Ordine</th><th style={th}>Cliente</th>{!compact && <th style={th}>Articoli</th>}<th style={th}>Totale</th><th style={th}>Pagamento</th><th style={th}>Stato</th><th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} style={{ borderTop: '1px solid var(--cream-200)', cursor: 'pointer' }} onClick={() => onOpenOrder(o)}>
              <td style={td}><div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{o.id}</div><div style={{ fontSize: '12px', color: 'var(--ink-400)' }}>{o.when}</div></td>
              <td style={td}>{o.customer}</td>
              {!compact && <td style={td}>{o.items}</td>}
              <td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(o.total)}</td>
              <td style={td}><Badge variant="cod" icon="banknote">Consegna</Badge></td>
              <td style={td}><OrderStatusBadge status={o.status} size="sm" /></td>
              <td style={{ ...td, textAlign: 'right' }}><Icon name="chevron-right" size={16} color="var(--ink-400)" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const th = { padding: '12px 20px', fontWeight: 600 };
const td = { padding: '14px 20px', fontSize: '14px', color: 'var(--ink-700)', verticalAlign: 'middle' };

function OrdersView({ onOpenOrder }) {
  const [filter, setFilter] = React.useState('all');
  const tabs = [['all', 'Tutti'], ['NEW', 'Nuovi'], ['ACCEPTED', 'In preparazione'], ['READY', 'Pronti'], ['OUT_FOR_DELIVERY', 'In consegna'], ['DELIVERED', 'Consegnati']];
  const orders = window.SC_ORDERS.filter((o) => filter === 'all' || o.status === filter);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => {
          const on = filter === id;
          const count = id === 'all' ? window.SC_ORDERS.length : window.SC_ORDERS.filter((o) => o.status === id).length;
          return <button key={id} onClick={() => setFilter(id)} style={{ border: `1px solid ${on ? 'var(--primary-600)' : 'var(--cream-300)'}`, background: on ? 'var(--primary-700)' : 'var(--surface-0)', color: on ? '#fff' : 'var(--ink-700)', padding: '8px 14px', borderRadius: 'var(--radius-full)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{label} {count > 0 && <span style={{ opacity: .7 }}>· {count}</span>}</button>;
        })}
      </div>
      <Card variant="bordered" padding="none">
        {orders.length === 0 ? <div style={{ padding: '24px' }}><EmptyState icon="inbox" title="Nessun ordine" description="Non ci sono ordini in questo stato." /></div> : <OrdersTable orders={orders} onOpenOrder={onOpenOrder} />}
      </Card>
    </div>
  );
}

const SC_FLOW = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
function OrderDetail({ order, onClose, onAdvance }) {
  if (!order) return null;
  const lines = window.SC_ORDER_LINES[order.id] || [{ n: 'Prodotto', q: order.items, p: order.total / order.items, kw: 'salami', lock: 7 }];
  const idx = SC_FLOW.indexOf(order.status);
  const next = idx >= 0 && idx < SC_FLOW.length - 1 ? SC_FLOW[idx + 1] : null;
  const NEXT_LABEL = { ACCEPTED: 'Accetta ordine', READY: 'Segna pronto', ASSIGNED: 'Assegna rider', OUT_FOR_DELIVERY: 'Affida al rider', DELIVERED: 'Segna consegnato' };
  return (
    <Modal open={!!order} onClose={onClose} title={`Ordine ${order.id}`} description={`${order.when} · ${order.customer}`} size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Chiudi</Button>
        {order.status !== 'CANCELED' && order.status !== 'DELIVERED' && next && <Button variant="primary" icon="check" onClick={() => onAdvance(order, next)}>{NEXT_LABEL[next]}</Button>}
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OrderStatusBadge status={order.status} />
          <Badge variant="cod" icon="banknote">Paga alla consegna · {fmt(order.total)}</Badge>
        </div>
        <div style={{ border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderBottom: i < lines.length - 1 ? '1px solid var(--cream-200)' : 'none' }}>
              <img src={imgUrl(l.kw, l.lock)} alt={l.n} style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
              <div style={{ flex: 1 }}><p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{l.n}</p><p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)' }}>× {l.q}</p></div>
              <span style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(l.p * l.q)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 800, color: 'var(--ink-900)' }}><span>Totale</span><span>{fmt(order.total)}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'var(--cream-50)', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--ink-600)' }}>
          <Icon name="map-pin" size={16} color="var(--primary-600)" /> {order.customer} · Via Roma 12, Piacenza · contanti al rider
        </div>
      </div>
    </Modal>
  );
}
