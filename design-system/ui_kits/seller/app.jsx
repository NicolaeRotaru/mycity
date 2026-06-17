/* AUTO-GENERATED from ui_kits/seller/src/*.jsx (numeric order). Do not edit directly. */
(function(){
"use strict";
// ===== Seller shared UI (DS wrappers + atoms) =====
const __ds = (n) => function DSComp(props) {
  const C = (window.MyCityDesignSystem_105480 || {})[n];
  return C ? React.createElement(C, props) : null;
};
const Button = __ds('Button');
const Badge = __ds('Badge');
const Card = __ds('Card');
const OrderStatusBadge = __ds('OrderStatusBadge');
const Modal = __ds('Modal');
const EmptyState = __ds('EmptyState');
const Input = __ds('Input');
const Select = __ds('Select');
const Checkbox = __ds('Checkbox');

const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const imgUrl = (kw, lock) => `https://loremflickr.com/300/300/${kw}?lock=${lock}`;
const initials = (s) => (s || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

function Icon({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}

const TONES = {
  olive: ['var(--olive-100)', 'var(--olive-700)'],
  primary: ['var(--primary-100)', 'var(--primary-700)'],
  accent: ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)'],
};

function StatCard({ kpi }) {
  const t = TONES[kpi.tone] || TONES.primary;
  const up = kpi.delta > 0, flat = kpi.delta === 0;
  return (
    <Card variant="bordered" padding="lg">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)', fontWeight: 600 }}>{kpi.label}</p>
          <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{kpi.value}</p>
        </div>
        <span style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-lg)', background: t[0], color: t[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={kpi.icon} size={22} stroke={2.2} color={t[1]} /></span>
      </div>
      {!flat && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '12px', fontSize: '13px', fontWeight: 700, color: up ? 'var(--olive-700)' : 'var(--secondary-600)' }}>
          <Icon name={up ? 'trending-up' : 'trending-down'} size={15} color={up ? 'var(--olive-600)' : 'var(--secondary-600)'} /> {up ? '+' : ''}{kpi.delta}% <span style={{ color: 'var(--ink-400)', fontWeight: 500 }}>vs mese scorso</span>
        </div>
      )}
      {flat && <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--ink-400)' }}>da saldare al prossimo giro rider</div>}
    </Card>
  );
}

// Simple inline SVG sparkline / bar chart.
function Sparkline({ data, w = 560, h = 120, color = 'var(--primary-600)' }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - ((v - min) / (max - min || 1)) * (h - 10) - 5]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs><linearGradient id="scfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--primary-500)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--primary-500)" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#scfill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => i === pts.length - 1 ? <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={color} /> : null)}
    </svg>
  );
}

function Bars({ data, h = 120, color = 'var(--accent-500)' }) {
  const max = Math.max(...data);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: h }}>
      {data.map((v, i) => <div key={i} title={fmt(v)} style={{ flex: 1, height: `${(v / max) * 100}%`, background: i === data.length - 1 ? 'var(--primary-600)' : color, borderRadius: '4px 4px 0 0', minHeight: '4px' }} />)}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{children}</h2>
      {action}
    </div>
  );
}

// ===== Seller shell (sidebar + topbar) =====
const SC_NAV = [
  { id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
  { id: 'ordini', icon: 'shopping-bag', label: 'Ordini', badge: 3 },
  { id: 'prodotti', icon: 'package', label: 'Prodotti' },
  { id: 'analytics', icon: 'bar-chart-3', label: 'Analytics' },
  { id: 'incassi', icon: 'wallet', label: 'Incassi' },
  { id: 'promozioni', icon: 'tag', label: 'Promozioni' },
  { id: 'recensioni', icon: 'star', label: 'Recensioni' },
  { id: 'clienti', icon: 'users', label: 'Clienti' },
];

function Sidebar({ active, onNav }) {
  const s = window.SC_STORE;
  return (
    <aside style={{ width: '248px', flexShrink: 0, background: 'var(--ink-900)', color: 'var(--cream-100)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
      <div style={{ padding: '20px 20px 16px' }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800 }}><span style={{ color: 'var(--accent-400)' }}>My</span>City <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink-300)', letterSpacing: '0.04em' }}>SELLER</span></div>
      </div>
      <div style={{ margin: '0 12px 12px', padding: '12px', background: 'rgba(255,255,255,.06)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px', flexShrink: 0 }}>{initials(s.name)}</span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</p>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--accent-300)' }}>{s.plan}</p>
        </div>
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {SC_NAV.map((n) => {
          const on = active === n.id;
          return (
            <button key={n.id} onClick={() => onNav(n.id)} style={{ display: 'flex', alignItems: 'center', gap: '11px', width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: on ? 700 : 500, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: on ? 'var(--primary-700)' : 'transparent', color: on ? '#fff' : 'var(--ink-200)' }}>
              <Icon name={n.icon} size={18} color={on ? '#fff' : 'var(--ink-300)'} /> {n.label}
              {n.badge && <span style={{ marginLeft: 'auto', background: 'var(--accent-500)', color: 'var(--ink-900)', fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '1px 7px' }}>{n.badge}</span>}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        <button onClick={() => onNav('profilo')} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', border: 0, background: active === 'profilo' ? 'rgba(255,255,255,.08)' : 'transparent', color: 'var(--ink-200)', cursor: 'pointer', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', fontSize: '14px' }}>
          <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--cream-200)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>GV</span>
          Giorgio Verdi
        </button>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '20px 28px', borderBottom: '1px solid var(--cream-300)', background: 'var(--surface-0)', position: 'sticky', top: 0, zIndex: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 800, color: 'var(--ink-900)' }}>{title}</h1>
        {subtitle && <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {actions}
        <button title="Notifiche" style={{ position: 'relative', width: '40px', height: '40px', borderRadius: 'var(--radius-md)', border: '1px solid var(--cream-300)', background: 'var(--surface-0)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-600)' }}>
          <Icon name="bell" size={19} /><span style={{ position: 'absolute', top: '8px', right: '9px', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--secondary-600)' }} />
        </button>
      </div>
    </div>
  );
}

function Layout({ active, onNav, title, subtitle, actions, children }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--surface-50)' }}>
      <Sidebar active={active} onNav={onNav} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar title={title} subtitle={subtitle} actions={actions} />
        <main style={{ flex: 1, padding: '28px', maxWidth: '1200px', width: '100%' }}>{children}</main>
      </div>
    </div>
  );
}

// ===== Seller: Dashboard =====
function Dashboard({ onNav, onOpenOrder }) {
  const recent = window.SC_ORDERS.slice(0, 5);
  const low = window.SC_PRODUCTS.filter((p) => p.stock > 0 && p.stock <= 3);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {window.SC_KPIS.map((k) => <StatCard key={k.id} kpi={k} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '20px', alignItems: 'start' }}>
        <Card variant="bordered" padding="lg">
          <SectionTitle action={<Badge variant="new">+12,4%</Badge>}>Incasso · ultimi 14 giorni</SectionTitle>
          <Sparkline data={window.SC_SALES} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '12px', color: 'var(--ink-400)' }}><span>2 set fa</span><span>1 set fa</span><span>oggi</span></div>
        </Card>

        <Card variant="bordered" padding="lg">
          <SectionTitle>Da fare ora</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <TodoRow icon="bell-ring" tone="primary" text="3 nuovi ordini da accettare" cta="Vedi" onClick={() => onNav('ordini')} />
            <TodoRow icon="package-x" tone="secondary" text={`${low.length} prodotti in esaurimento`} cta="Rifornisci" onClick={() => onNav('prodotti')} />
            <TodoRow icon="wallet" tone="olive" text="€612 contanti da saldare" cta="Salda" onClick={() => onNav('incassi')} />
            <TodoRow icon="star" tone="accent" text="1 recensione senza risposta" cta="Rispondi" onClick={() => onNav('recensioni')} />
          </div>
        </Card>
      </div>

      <Card variant="bordered" padding="none">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Ordini recenti</h2>
          <Button variant="ghost" size="sm" iconRight="arrow-right" onClick={() => onNav('ordini')}>Tutti gli ordini</Button>
        </div>
        <OrdersTable orders={recent} onOpenOrder={onOpenOrder} compact />
      </Card>
    </div>
  );
}

function TodoRow({ icon, tone, text, cta, onClick }) {
  const t = TONES[tone] || TONES.primary;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--cream-50)' }}>
      <span style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', background: t[0], color: t[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={17} color={t[1]} /></span>
      <span style={{ flex: 1, fontSize: '14px', color: 'var(--ink-800)', fontWeight: 500 }}>{text}</span>
      <Button variant="secondary" size="sm" onClick={onClick}>{cta}</Button>
    </div>
  );
}

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

// ===== Seller: Products =====
function ProductsView() {
  const [editing, setEditing] = React.useState(null); // product or 'new'
  const [q, setQ] = React.useState('');
  const STATUS = { active: ['Attivo', 'new'], soldout: ['Esaurito', 'soldout'], draft: ['Bozza', 'local'] };
  const list = window.SC_PRODUCTS.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div style={{ flex: 1, maxWidth: '320px' }}><Input placeholder="Cerca nel catalogo…" value={q} onChange={(e) => setQ(e.target.value)} leading={<Icon name="search" size={16} color="var(--ink-400)" />} /></div>
        <div style={{ marginLeft: 'auto' }}><Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Nuovo prodotto</Button></div>
      </div>
      <Card variant="bordered" padding="none">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <th style={th}>Prodotto</th><th style={th}>Categoria</th><th style={th}>Prezzo</th><th style={th}>Scorte</th><th style={th}>Venduti</th><th style={th}>Stato</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--cream-200)' }}>
                <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><img src={imgUrl(p.kw, p.lock)} alt={p.name} style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} /><span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{p.name}</span></div></td>
                <td style={td}>{p.cat}</td>
                <td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(p.price)}</td>
                <td style={td}><span style={{ color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)', fontWeight: p.stock <= 3 ? 700 : 500 }}>{p.stock}</span></td>
                <td style={td}>{p.sold}</td>
                <td style={td}><Badge variant={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge></td>
                <td style={{ ...td, textAlign: 'right' }}><Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(p)}>Modifica</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ProductEditor product={editing === 'new' ? null : editing} open={!!editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ProductEditor({ product, open, onClose }) {
  if (!open) return null;
  const isNew = !product;
  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Nuovo prodotto' : 'Modifica prodotto'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Annulla</Button><Button variant="primary" icon="check" onClick={onClose}>{isNew ? 'Pubblica' : 'Salva'}</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '18px' }}>
        <div>
          <div style={{ width: '120px', height: '120px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--cream-300)', background: 'var(--surface-100)' }}>
            {product ? <img src={imgUrl(product.kw, product.lock)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-300)' }}><Icon name="image-plus" size={28} color="var(--ink-300)" /></div>}
          </div>
          <Button variant="secondary" size="sm" icon="upload" style={{ marginTop: '8px', width: '120px' }}>Foto</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Nome prodotto" defaultValue={product ? product.name : ''} placeholder="Es. Coppa Piacentina DOP 200g" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <Input label="Prezzo (€)" defaultValue={product ? String(product.price) : ''} placeholder="0,00" />
            <Input label="Scorte" defaultValue={product ? String(product.stock) : ''} placeholder="0" />
            <Select label="Categoria" defaultValue={product ? product.cat : 'Salumi'}><option>Salumi</option><option>Formaggi</option><option>Conserve</option></Select>
          </div>
          <div>
            <label style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink-700)' }}>Descrizione</label>
            <textarea rows="3" defaultValue={product ? 'Stagionata 90 giorni, taglio a mano.' : ''} placeholder="Racconta il prodotto…" style={{ width: '100%', boxSizing: 'border-box', marginTop: '5px', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontFamily: 'var(--font-sans)', fontSize: '15px', resize: 'vertical', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Badge variant="local">DOP</Badge><Badge variant="local">Taglio a mano</Badge><button style={{ border: '1px dashed var(--cream-400)', background: 'transparent', color: 'var(--primary-700)', borderRadius: 'var(--radius-sm)', fontSize: '11px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>+ Tag</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===== Seller: Analytics =====
function AnalyticsView() {
  const top = [...window.SC_PRODUCTS].sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = Math.max(...top.map((p) => p.sold));
  const byCat = [['Salumi', 64], ['Formaggi', 28], ['Conserve', 8]];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[['Visite vetrina', '3.842', '+18%'], ['Tasso conversione', '4,8%', '+0,6pt'], ['Prodotti venduti', '423', '+9%'], ['Resi', '1,2%', '-0,3pt']].map(([l, v, d]) => (
          <Card key={l} variant="bordered" padding="lg"><p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)', fontWeight: 600 }}>{l}</p><p style={{ margin: '6px 0 0', fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 800, color: 'var(--ink-900)' }}>{v}</p><span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--olive-700)' }}>{d}</span></Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '20px', alignItems: 'start' }}>
        <Card variant="bordered" padding="lg">
          <SectionTitle>Vendite per giorno · 14 giorni</SectionTitle>
          <Bars data={window.SC_SALES} h={180} />
        </Card>
        <Card variant="bordered" padding="lg">
          <SectionTitle>Vendite per categoria</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '4px' }}>
            {byCat.map(([c, pct], i) => (
              <div key={c}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}><span style={{ color: 'var(--ink-700)', fontWeight: 600 }}>{c}</span><span style={{ color: 'var(--ink-500)' }}>{pct}%</span></div>
                <div style={{ height: '10px', background: 'var(--cream-200)', borderRadius: '5px', overflow: 'hidden' }}><div style={{ width: pct + '%', height: '100%', background: [ 'var(--primary-600)', 'var(--accent-500)', 'var(--olive-500)'][i] }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card variant="bordered" padding="lg">
        <SectionTitle>Prodotti più venduti</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {top.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ width: '22px', fontFamily: 'var(--font-serif)', fontWeight: 800, color: 'var(--ink-400)' }}>{i + 1}</span>
              <img src={imgUrl(p.kw, p.lock)} alt={p.name} style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
              <span style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{p.name}</span>
              <div style={{ flex: 1, maxWidth: '200px', height: '8px', background: 'var(--cream-200)', borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: (p.sold / maxSold * 100) + '%', height: '100%', background: 'var(--primary-600)' }} /></div>
              <span style={{ width: '60px', textAlign: 'right', fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>{p.sold} pz</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ===== Seller: Earnings, Promos, Reviews, Customers, Profile =====
function EarningsView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Card variant="bordered" padding="lg" style={{ background: 'var(--olive-50)', borderColor: 'var(--olive-200)' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--olive-800)', fontWeight: 600 }}>Saldo disponibile</p>
          <p style={{ margin: '6px 0 12px', fontFamily: 'var(--font-serif)', fontSize: '32px', fontWeight: 800, color: 'var(--ink-900)' }}>€1.226,40</p>
          <Button variant="success" icon="banknote">Richiedi payout</Button>
        </Card>
        <Card variant="bordered" padding="lg" style={{ background: 'var(--secondary-50)', borderColor: 'var(--secondary-200)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><p style={{ margin: 0, fontSize: '13px', color: 'var(--secondary-700)', fontWeight: 600 }}>Contanti incassati da saldare</p><p style={{ margin: '6px 0 12px', fontFamily: 'var(--font-serif)', fontSize: '32px', fontWeight: 800, color: 'var(--ink-900)' }}>€612,00</p></div>
            <Icon name="wallet" size={26} color="var(--secondary-600)" />
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--ink-600)' }}>I rider ti consegnano i contanti raccolti; la quota MyCity viene trattenuta dal payout.</p>
          <Button variant="secondary" icon="check">Conferma saldo contanti</Button>
        </Card>
      </div>
      <Card variant="bordered" padding="none">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream-200)' }}><h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Storico payout</h2></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase' }}><th style={th}>ID</th><th style={th}>Periodo</th><th style={th}>Importo</th><th style={th}>Stato</th><th style={th}>Data</th></tr></thead>
          <tbody>{window.SC_PAYOUTS.map((p) => (
            <tr key={p.id} style={{ borderTop: '1px solid var(--cream-200)' }}><td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{p.id}</td><td style={td}>{p.period}</td><td style={{ ...td, fontWeight: 700 }}>{fmt(p.amount)}</td><td style={td}><Badge variant="new">{p.status}</Badge></td><td style={td}>{p.when}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function PromosView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex' }}><div style={{ marginLeft: 'auto' }}><Button variant="primary" icon="plus">Nuova promozione</Button></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {window.SC_PROMOS.map((p) => (
          <Card key={p.id} variant="bordered" padding="lg">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, background: 'var(--cream-200)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--ink-800)' }}>{p.id}</span>
              <Badge variant={p.status === 'active' ? 'new' : 'soldout'}>{p.status === 'active' ? 'Attiva' : 'Terminata'}</Badge>
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>{p.type}</p>
            <p style={{ margin: '2px 0 12px', fontSize: '13px', color: 'var(--ink-500)' }}>{p.cond}</p>
            <div style={{ height: '8px', background: 'var(--cream-200)', borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: (p.uses / p.cap * 100) + '%', height: '100%', background: 'var(--accent-500)' }} /></div>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>{p.uses} / {p.cap} utilizzi</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ReviewsView() {
  const [reviews, setReviews] = React.useState(window.SC_REVIEWS);
  function reply(i) { setReviews((prev) => prev.map((r, j) => j === i ? { ...r, reply: 'Grazie mille per il feedback!' } : r)); }
  const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1).replace('.', ',');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Card variant="bordered" padding="lg"><div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--font-serif)', fontSize: '40px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{avg}</div><div style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{window.SC_STORE.reviews} recensioni</div></div>
        <div style={{ flex: 1, fontSize: '14px', color: 'var(--ink-600)' }}>Rispondi alle recensioni per fidelizzare i clienti. Un negozio che risponde vende il <strong style={{ color: 'var(--ink-900)' }}>+23%</strong>.</div>
      </div></Card>
      {reviews.map((r, i) => (
        <Card key={i} variant="bordered" padding="lg">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--cream-200)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px' }}>{initials(r.who)}</span>
            <div style={{ flex: 1 }}><strong style={{ fontSize: '14px', color: 'var(--ink-900)' }}>{r.who}</strong><div style={{ fontSize: '12px', color: 'var(--ink-400)' }}>{r.when} · {r.product}</div></div>
            <div style={{ display: 'inline-flex', gap: '1px' }}>{[1, 2, 3, 4, 5].map((s) => <Icon key={s} name="star" size={14} color={s <= r.rating ? 'var(--accent-500)' : 'var(--cream-300)'} />)}</div>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--ink-700)', lineHeight: 1.5 }}>{r.text}</p>
          {r.reply
            ? <div style={{ background: 'var(--cream-50)', borderLeft: '3px solid var(--primary-400)', padding: '10px 12px', borderRadius: '0 var(--radius-md) var(--radius-md) 0', fontSize: '13px', color: 'var(--ink-700)' }}><strong style={{ color: 'var(--primary-700)' }}>La tua risposta · </strong>{r.reply}</div>
            : <Button variant="secondary" size="sm" icon="reply" onClick={() => reply(i)}>Rispondi</Button>}
        </Card>
      ))}
    </div>
  );
}

function CustomersView() {
  return (
    <Card variant="bordered" padding="none">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase' }}><th style={th}>Cliente</th><th style={th}>Zona</th><th style={th}>Ordini</th><th style={th}>Speso</th><th style={th}>Ultimo</th></tr></thead>
        <tbody>{window.SC_CUSTOMERS.map((c) => (
          <tr key={c.name} style={{ borderTop: '1px solid var(--cream-200)' }}>
            <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px' }}>{initials(c.name)}</span><span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{c.name}</span></div></td>
            <td style={td}>{c.area}</td><td style={td}>{c.orders}</td><td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(c.spent)}</td><td style={td}>{c.last}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function ProfileView() {
  const s = window.SC_STORE;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
      <Card variant="bordered" padding="lg">
        <SectionTitle>Vetrina</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Nome negozio" defaultValue={s.name} />
          <Input label="Zona" defaultValue={s.area} />
          <Select label="Categoria principale" defaultValue="Gastronomia"><option>Gastronomia</option><option>Alimentari</option><option>Vini & Cantina</option></Select>
          <div><label style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink-700)' }}>Descrizione</label><textarea rows="3" defaultValue="Salumi e formaggi piacentini selezionati, tagliati a mano ogni giorno." style={{ width: '100%', boxSizing: 'border-box', marginTop: '5px', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontFamily: 'var(--font-sans)', fontSize: '15px', resize: 'vertical' }} /></div>
          <div><Button variant="primary">Salva vetrina</Button></div>
        </div>
      </Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Card variant="bordered" padding="lg">
          <SectionTitle>Orari & consegna</SectionTitle>
          {[['Lun – Ven', '8:00 – 19:30'], ['Sabato', '8:00 – 19:30'], ['Domenica', 'Chiuso']].map(([d, h]) => (
            <div key={d} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--cream-200)', fontSize: '14px' }}><span style={{ color: 'var(--ink-600)' }}>{d}</span><span style={{ fontWeight: 600, color: h === 'Chiuso' ? 'var(--secondary-600)' : 'var(--ink-900)' }}>{h}</span></div>
          ))}
          <div style={{ marginTop: '12px' }}><Checkbox defaultChecked label="Consegna in giornata disponibile" /></div>
        </Card>
        <Card variant="bordered" padding="lg" style={{ background: 'var(--ink-900)', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}><Icon name="shield-check" size={20} color="var(--accent-400)" /><strong style={{ fontFamily: 'var(--font-serif)', fontSize: '17px' }}>Piano {s.plan}</strong></div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-300)', lineHeight: 1.5 }}>Zero commissioni sugli ordini. Attivo dal {s.since}. Verificato da MyCity.</p>
        </Card>
      </div>
    </div>
  );
}

// ===== Seller app shell =====
function App() {
  const [view, setView] = React.useState('dashboard');
  const [order, setOrder] = React.useState(null);
  const [orders, setOrders] = React.useState(window.SC_ORDERS);

  function nav(v) { setView(v); window.scrollTo(0, 0); }
  function advance(o, next) {
    setOrders((prev) => prev.map((x) => x.id === o.id ? { ...x, status: next } : x));
    setOrder((cur) => cur ? { ...cur, status: next } : cur);
  }

  const TITLES = {
    dashboard: ['Ciao, Giorgio 👋', 'Ecco com’è andata oggi a ' + window.SC_STORE.name],
    ordini: ['Ordini', 'Gestisci e fai avanzare gli ordini'],
    prodotti: ['Prodotti', 'Il tuo catalogo'],
    analytics: ['Analytics', 'Andamento del negozio'],
    incassi: ['Incassi', 'Pagamenti alla consegna e payout'],
    promozioni: ['Promozioni', 'Coupon e offerte'],
    recensioni: ['Recensioni', 'Cosa dicono i clienti'],
    clienti: ['Clienti', 'I tuoi clienti abituali'],
    profilo: ['Profilo negozio', 'Vetrina e impostazioni'],
  };
  const [title, subtitle] = TITLES[view] || ['', ''];
  const actions = view === 'prodotti'
    ? <Button variant="primary" icon="plus">Nuovo prodotto</Button>
    : view === 'dashboard'
      ? <Button variant="secondary" icon="external-link">Vai al negozio</Button>
      : null;

  // window.SC_ORDERS kept in sync for child views reading it
  window.SC_ORDERS = orders;

  return (
    <Layout active={view} onNav={nav} title={title} subtitle={subtitle} actions={actions}>
      {view === 'dashboard' && <Dashboard onNav={nav} onOpenOrder={setOrder} />}
      {view === 'ordini' && <OrdersView onOpenOrder={setOrder} />}
      {view === 'prodotti' && <ProductsView />}
      {view === 'analytics' && <AnalyticsView />}
      {view === 'incassi' && <EarningsView />}
      {view === 'promozioni' && <PromosView />}
      {view === 'recensioni' && <ReviewsView />}
      {view === 'clienti' && <CustomersView />}
      {view === 'profilo' && <ProfileView />}
      <OrderDetail order={order} onClose={() => setOrder(null)} onAdvance={advance} />
    </Layout>
  );
}

function __ready(){ var ns=window.MyCityDesignSystem_105480; return ns && ns.Button && ns.Card && ns.OrderStatusBadge && ns.Modal && window.SC_ORDERS; }
function __mountOnce(){ var el=document.getElementById('root'); if(!el) return; try{ if(window.__scRoot){ window.__scRoot.unmount(); } }catch(e){} el.innerHTML=''; window.__scRoot=ReactDOM.createRoot(el); window.__scRoot.render(React.createElement(App)); }
(function waitReady(t){ if(__ready()){ __mountOnce(); setTimeout(function(){ var r=document.getElementById('root'); if(r && r.children.length===0){ __mountOnce(); } },200); return; } if(t>200) return; setTimeout(function(){ waitReady(t+1); },30); })(0);

})();
