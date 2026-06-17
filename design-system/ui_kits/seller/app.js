/* AUTO-GENERATED from ui_kits/seller/src/*.js (numeric order). Do not edit directly. */
// ===== Shared (concat first) =====
const { Button, Badge, Card, OrderStatusBadge, Modal, EmptyState, Input, Select, Checkbox } = window.MyCityDesignSystem_105480;

const fmt = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const img = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const initials = (name) => (name || '').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();

function Lucide({ name, size = 20, stroke = 2, color, style }) {
  return <i data-lucide={name} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } }); } catch (e) {} }} style={{ width: size, height: size, display: 'inline-flex', color, flexShrink: 0, ...style }} />;
}
function Stars({ value = 5, size = 14 }) {
  return <span style={{ display: 'inline-flex', gap: '1px' }}>{[1,2,3,4,5].map((i) => (
    <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)'}><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z" /></svg>
  ))}</span>;
}

const TINT = {
  primary:   ['var(--primary-100)', 'var(--primary-700)'],
  olive:     ['var(--olive-100)', 'var(--olive-700)'],
  accent:    ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)'],
};

function PageTitle({ title, sub, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 800, color: 'var(--ink-900)' }}>{title}</h1>
        {sub && <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--ink-500)' }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// ===== Seller shell (sidebar + topbar) =====
const SC_NAV = [
  { id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
  { id: 'orders', icon: 'receipt', label: 'Ordini', badge: 'todo' },
  { id: 'products', icon: 'package', label: 'Prodotti' },
  { id: 'promotions', icon: 'tag', label: 'Promozioni' },
  { id: 'analytics', icon: 'bar-chart-3', label: 'Analisi' },
  { id: 'customers', icon: 'users', label: 'Clienti' },
  { id: 'reviews', icon: 'star', label: 'Recensioni' },
  { id: 'earnings', icon: 'wallet', label: 'Guadagni' },
];

function SellerShell({ view, onNav, onNewProduct, children }) {
  const store = window.SC_STORE;
  const todo = window.SC_ORDERS.filter((o) => ['NEW', 'ACCEPTED', 'READY'].includes(o.status)).length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', minHeight: '100vh', background: 'var(--cream-100)' }}>
      {/* sidebar */}
      <aside style={{ background: 'var(--ink-900)', color: '#fff', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}>
        <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.01em' }}>
            <span style={{ color: 'var(--accent-300)' }}>My</span><span style={{ color: '#fff' }}>City</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 700, color: 'var(--ink-300)', textTransform: 'uppercase', letterSpacing: '0.08em', marginLeft: '6px' }}>Seller</span>
          </div>
        </div>
        <nav style={{ flex: 1, padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
          {SC_NAV.map((n) => {
            const on = view === n.id;
            return (
              <button key={n.id} onClick={() => onNav(n.id)} style={{ display: 'flex', alignItems: 'center', gap: '11px', border: 0, background: on ? 'var(--primary-700)' : 'transparent', color: on ? '#fff' : 'rgba(255,255,255,.78)', fontWeight: on ? 700 : 500, fontSize: '14px', padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left', width: '100%' }}>
                <Lucide name={n.icon} size={18} stroke={2.2} color={on ? '#fff' : 'rgba(255,255,255,.7)'} /> {n.label}
                {n.badge === 'todo' && todo > 0 && <span style={{ marginLeft: 'auto', background: 'var(--accent-500)', color: 'var(--ink-900)', fontSize: '11px', fontWeight: 700, borderRadius: '999px', minWidth: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{todo}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <a href="../buyer/index.html" style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'rgba(255,255,255,.7)', fontSize: '13px', padding: '8px 12px', textDecoration: 'none' }}>
            <Lucide name="external-link" size={16} color="rgba(255,255,255,.6)" /> Vai al marketplace
          </a>
        </div>
      </aside>

      {/* main */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 'var(--z-sticky)', background: 'var(--surface-0)', borderBottom: '1px solid var(--cream-300)', padding: '12px 28px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: '420px' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><Lucide name="search" size={17} color="var(--ink-400)" /></span>
            <input placeholder="Cerca ordini, prodotti, clienti…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-full)', padding: '9px 14px 9px 38px', fontSize: '14px', fontFamily: 'var(--font-sans)', outline: 'none', background: 'var(--cream-50)' }} />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Button variant="primary" size="sm" icon="plus" onClick={onNewProduct}>Pubblica prodotto</Button>
            <button style={{ position: 'relative', border: 0, background: 'transparent', cursor: 'pointer', display: 'inline-flex', padding: '6px' }}><Lucide name="bell" size={20} color="var(--ink-600)" /><span style={{ position: 'absolute', top: '2px', right: '2px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--secondary-600)' }} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{store.initials}</span>
              <div style={{ lineHeight: 1.1 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>{store.name}</p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--ink-400)' }}>{store.area}</p>
              </div>
            </div>
          </div>
        </header>
        <main style={{ flex: 1, padding: '28px', maxWidth: '1100px', width: '100%', boxSizing: 'border-box' }}>{children}</main>
      </div>
    </div>
  );
}

// ===== Dashboard =====
function Dashboard({ onNav, onNewProduct }) {
  const k = window.SC_KPI, store = window.SC_STORE;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* hero */}
      <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-2xl)', background: 'linear-gradient(135deg, var(--primary-700), var(--primary-600) 55%, var(--secondary-700))', color: '#fff', boxShadow: 'var(--shadow-warm-lg)' }}>
        <div aria-hidden style={{ position: 'absolute', top: '-60px', right: '-40px', width: '260px', height: '260px', borderRadius: '50%', background: 'rgba(255,255,255,.1)', filter: 'blur(40px)' }} />
        <div style={{ position: 'relative', padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{ width: '60px', height: '60px', borderRadius: 'var(--radius-xl)', background: 'rgba(255,255,255,.18)', border: '3px solid rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 800 }}>{store.initials}</span>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,.75)' }}>Bentornato</p>
              <h1 style={{ margin: '2px 0 0', fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 800, color: '#fff' }}>{store.name}</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '12px', fontWeight: 600, background: 'rgba(90,124,66,.9)', color: '#fff', borderRadius: '999px', padding: '3px 10px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff' }} /> Negozio attivo</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button variant="secondary" icon="plus" onClick={onNewProduct}>Pubblica prodotto</Button>
              <button style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', fontWeight: 600, padding: '10px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '14px' }}><Lucide name="external-link" size={16} /> Vetrina</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '22px' }}>
            {[['Oggi', k.revenueToday, `${k.ordersToday} articoli`], ['7 giorni', k.revenue7, `${k.orders7} articoli`], ['30 giorni', k.revenue30, `${k.orders30} articoli`]].map(([l, v, s]) => (
              <div key={l} style={{ borderRadius: 'var(--radius-xl)', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', padding: '14px 16px' }}>
                <p style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,.7)', fontWeight: 700 }}>{l}</p>
                <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 800, lineHeight: 1 }}>{fmt(v)}</p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(255,255,255,.6)' }}>{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <KpiCard icon="trending-up" tone="olive" value={fmt(k.revenueTotal)} label="Fatturato totale" hint={`${k.itemsSold} articoli venduti`} />
        <KpiCard icon="package" tone="primary" value={k.productsAvailable} label="Prodotti in vendita" hint={`su ${k.productsTotal} totali`} />
        <KpiCard icon="star" tone="accent" value={`${k.avgRating.toFixed(1).replace('.', ',')} ★`} label="Valutazione media" hint={`${k.reviewCount} recensioni`} />
        <KpiCard icon="receipt" tone="secondary" value={k.itemsSold} label="Articoli venduti" hint="Dall'inizio" />
      </div>

      {/* hub */}
      <NavGroup title="Vendite" hint="Catalogo, ordini, marketing">
        <NavTile icon="package" title="Prodotti" desc="Catalogo e disponibilità" meta={`${window.SC_KPI.productsAvailable} in vendita`} onClick={() => onNav('products')} />
        <NavTile icon="receipt" title="Ordini" desc="Prepara e gestisci" onClick={() => onNav('orders')} />
        <NavTile icon="tag" title="Promozioni" desc="Sconti e offerte" onClick={() => onNav('promotions')} />
        <NavTile icon="bar-chart-3" title="Analisi" desc="Andamento e insight" onClick={() => onNav('analytics')} />
      </NavGroup>

      {/* health + tips */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        <Card variant="bordered" padding="lg">
          <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)', display: 'flex', alignItems: 'center', gap: '8px' }}><Lucide name="activity" size={19} color="var(--olive-600)" /> Salute del negozio</h2>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--ink-500)' }}>Più è alto, più sei visibile nel marketplace.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Ring value={store.healthScore} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[['Catalogo completo', true], ['Risposte alle recensioni', true], ['Promo attiva', true], ['Foto di qualità', false]].map(([t, ok]) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: ok ? 'var(--ink-700)' : 'var(--ink-400)' }}>
                  <Lucide name={ok ? 'check-circle-2' : 'circle'} size={15} color={ok ? 'var(--olive-600)' : 'var(--ink-300)'} /> {t}
                </span>
              ))}
            </div>
          </div>
        </Card>
        <Card variant="bordered" padding="lg">
          <h2 style={{ margin: '0 0 6px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)', display: 'flex', alignItems: 'center', gap: '8px' }}><Lucide name="megaphone" size={19} color="var(--accent-600)" /> Fai crescere le vendite</h2>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--ink-500)' }}>Tre mosse semplici per più clienti.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <TipRow icon="tag" title="Lancia una promo" desc="Uno sconto a tempo crea urgenza." onClick={() => onNav('promotions')} />
            <TipRow icon="camera" title="Pubblica una storia" desc="Le storie (24h) portano clienti." onClick={() => onNav('products')} />
            <TipRow icon="share-2" title="Condividi la vetrina" desc="Manda il link a clienti e amici." onClick={() => onNav('dashboard')} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ icon, tone, value, label, hint }) {
  const [bg, fg] = TINT[tone];
  return (
    <Card variant="bordered" padding="md">
      <span style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Lucide name={icon} size={20} stroke={2.2} color={fg} /></span>
      <p style={{ margin: '12px 0 0', fontSize: '24px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{value}</p>
      <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--ink-600)' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-400)' }}>{hint}</p>
    </Card>
  );
}
function NavGroup({ title, hint, children }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{title}</h2>
        <span style={{ fontSize: '13px', color: 'var(--ink-400)' }}>{hint}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>{children}</div>
    </section>
  );
}
function NavTile({ icon, title, desc, meta, onClick }) {
  const [h, setH] = React.useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ textAlign: 'left', display: 'flex', gap: '12px', background: 'var(--surface-0)', border: `1px solid ${h ? 'var(--primary-200)' : 'var(--cream-300)'}`, borderRadius: 'var(--radius-xl)', padding: '14px', cursor: 'pointer', boxShadow: h ? 'var(--shadow-warm)' : 'none', transition: 'box-shadow var(--dur-base), border-color var(--dur-base)', fontFamily: 'var(--font-sans)' }}>
      <span style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', background: 'var(--primary-100)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name={icon} size={21} stroke={2.2} color="var(--primary-700)" /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)', fontSize: '15px' }}>{title}</p>
          <Lucide name="arrow-right" size={16} color={h ? 'var(--primary-600)' : 'var(--ink-300)'} />
        </div>
        <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)', lineHeight: 1.35 }}>{desc}</p>
        {meta && <p style={{ margin: '6px 0 0', fontSize: '12px', fontWeight: 600, color: 'var(--ink-400)' }}>{meta}</p>}
      </div>
    </button>
  );
}
function TipRow({ icon, title, desc, onClick }) {
  return (
    <button onClick={onClick} style={{ textAlign: 'left', display: 'flex', gap: '12px', alignItems: 'center', background: 'transparent', border: 0, borderRadius: 'var(--radius-md)', padding: '8px', cursor: 'pointer', fontFamily: 'var(--font-sans)', width: '100%' }}>
      <span style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', background: 'var(--accent-100)', color: 'var(--accent-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name={icon} size={18} stroke={2.2} color="var(--accent-700)" /></span>
      <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{title}</p><p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)' }}>{desc}</p></div>
      <Lucide name="arrow-right" size={15} color="var(--ink-300)" />
    </button>
  );
}
function Ring({ value }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  return (
    <div style={{ position: 'relative', width: '88px', height: '88px', flexShrink: 0 }}>
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--cream-200)" strokeWidth="8" />
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--olive-500)" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 44 44)" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--ink-900)' }}>{value}</span>
        <span style={{ fontSize: '10px', color: 'var(--ink-400)' }}>/ 100</span>
      </div>
    </div>
  );
}

// ===== Orders (grouped + detail drawer with status advancement) =====
const SC_NEXT = { NEW: 'ACCEPTED', ACCEPTED: 'READY', READY: 'ASSIGNED' };
const SC_NEXT_LABEL = { NEW: 'Accetta ordine', ACCEPTED: 'Segna come pronto', READY: 'Assegna al rider' };
const SC_GROUPS = [
  { label: 'Da fare', statuses: ['NEW', 'ACCEPTED', 'READY'] },
  { label: 'In consegna', statuses: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
  { label: 'Completati', statuses: ['DELIVERED', 'CANCELED'] },
];

function Orders({ orders, onAdvance }) {
  const [sel, setSel] = React.useState(null);
  const groups = SC_GROUPS.map((g) => ({ ...g, items: orders.filter((o) => g.statuses.includes(o.status)) }));
  return (
    <div>
      <PageTitle title="Ordini ricevuti" sub="Prepara, conferma e affida gli ordini ai rider"
        action={<div style={{ display: 'flex', gap: '8px' }}>{groups.map((g) => <span key={g.label} style={{ fontSize: '12px', background: 'var(--cream-100)', color: 'var(--ink-600)', borderRadius: '999px', padding: '5px 12px' }}>{g.label}: <strong style={{ color: 'var(--ink-900)' }}>{g.items.length}</strong></span>)}</div>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
        {groups.map((g) => g.items.length === 0 ? null : (
          <section key={g.label}>
            <h2 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: 'var(--ink-700)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{g.label}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {g.items.map((o) => {
                const count = o.items.reduce((s, i) => s + i.q, 0);
                return (
                  <button key={o.id} onClick={() => setSel(o)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink-400)' }}>#{o.id}</span>
                        <span style={{ color: 'var(--ink-300)' }}>·</span>
                        <span style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{o.when}</span>
                        {o.pay === 'cod' && <Badge variant="cod" icon="banknote">Contanti</Badge>}
                      </div>
                      <p style={{ margin: '3px 0 0', fontWeight: 700, color: 'var(--ink-900)' }}>{o.cust}</p>
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>{count} {count === 1 ? 'articolo' : 'articoli'} · {o.addr}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <OrderStatusBadge status={o.status} size="sm" />
                      <span style={{ fontWeight: 800, color: 'var(--ink-900)', fontSize: '16px' }}>{fmt(o.total)}</span>
                      <Lucide name="chevron-right" size={18} color="var(--ink-300)" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <OrderDrawer order={sel} onClose={() => setSel(null)} onAdvance={(o) => { onAdvance(o); setSel(null); }} />
    </div>
  );
}

function OrderDrawer({ order, onClose, onAdvance }) {
  if (!order) return null;
  const o = order;
  const next = SC_NEXT[o.status];
  return ReactDOM.createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-modal)', background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(2px)', display: 'flex', justifyContent: 'flex-end', animation: 'mc-fade-in var(--dur-fast) ease-out' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '440px', maxWidth: '92vw', height: '100%', background: 'var(--surface-0)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-warm-xl)', animation: 'mc-slide-right var(--dur-medium) var(--ease-out-quint)' }}>
        <header style={{ padding: '18px 20px', borderBottom: '1px solid var(--cream-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink-400)' }}>#{o.id}</p>
            <h2 style={{ margin: '2px 0 0', fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 700, color: 'var(--ink-900)' }}>{o.cust}</h2>
          </div>
          <button onClick={onClose} aria-label="Chiudi" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-500)' }}><Lucide name="x" size={22} /></button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <OrderStatusBadge status={o.status} />
            <span style={{ fontSize: '13px', color: 'var(--ink-500)' }}>{o.when}</span>
          </div>
          <div>
            <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink-500)' }}>Articoli</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {o.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <img src={img(it.kw, it.lock)} alt={it.name} style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                  <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{it.name}</p><p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)' }}>{fmt(it.price)} × {it.q}</p></div>
                  <span style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(it.price * it.q)}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--cream-200)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Row label="Consegna" val={o.addr} />
            <Row label="Pagamento" val={o.pay === 'cod' ? 'Contanti alla consegna' : 'Carta (online)'} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 800, color: 'var(--ink-900)', marginTop: '4px' }}><span>Totale</span><span>{fmt(o.total)}</span></div>
          </div>
          {o.pay === 'cod' && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--olive-50)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: '13px', color: 'var(--olive-800)' }}><Lucide name="banknote" size={16} color="var(--olive-700)" /> Il rider incassa <strong>{fmt(o.total)}</strong> in contanti.</div>}
        </div>
        <footer style={{ padding: '16px 20px', borderTop: '1px solid var(--cream-200)', display: 'flex', gap: '8px' }}>
          {next ? <Button variant="primary" size="lg" fullWidth iconRight="arrow-right" onClick={() => onAdvance(o)}>{SC_NEXT_LABEL[o.status]}</Button>
            : <div style={{ flex: 1, textAlign: 'center', fontSize: '14px', color: 'var(--ink-500)', padding: '10px' }}>{o.status === 'DELIVERED' ? 'Ordine consegnato ✓' : o.status === 'CANCELED' ? 'Ordine annullato' : 'In gestione al rider'}</div>}
          {o.status === 'NEW' && <Button variant="danger" size="lg" icon="x">Rifiuta</Button>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
function Row({ label, val }) { return <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px' }}><span style={{ color: 'var(--ink-500)' }}>{label}</span><span style={{ fontWeight: 600, color: 'var(--ink-800)', textAlign: 'right' }}>{val}</span></div>; }

// ===== Products (catalogue table + new-product modal) =====
function Products({ products, onNewProduct, onToggle }) {
  const [filter, setFilter] = React.useState('all');
  const tabs = [['all', 'Tutti'], ['available', 'In vendita'], ['soldout', 'Esauriti'], ['draft', 'Bozze']];
  const list = products.filter((p) => filter === 'all' || p.status === filter);
  const STATUS = { available: ['var(--olive-50)', 'var(--olive-700)', 'In vendita'], soldout: ['var(--secondary-50)', 'var(--secondary-600)', 'Esaurito'], draft: ['var(--surface-100)', 'var(--ink-500)', 'Bozza'] };
  return (
    <div>
      <PageTitle title="Prodotti" sub={`${products.length} prodotti a catalogo`}
        action={<div style={{ display: 'flex', gap: '8px' }}><Button variant="secondary" icon="upload">Importa CSV</Button><Button variant="primary" icon="plus" onClick={onNewProduct}>Nuovo prodotto</Button></div>} />
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{ border: 0, background: filter === id ? 'var(--primary-700)' : 'var(--surface-0)', color: filter === id ? '#fff' : 'var(--ink-600)', fontWeight: 600, fontSize: '13px', padding: '8px 14px', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontFamily: 'var(--font-sans)', boxShadow: filter === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)' }}>{label}</button>
        ))}
      </div>
      <Card variant="bordered" padding="none">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
            <thead>
              <tr style={{ background: 'var(--cream-50)', borderBottom: '1px solid var(--cream-300)' }}>
                {['Prodotto', 'Prezzo', 'Stock', 'Venduti', 'Stato', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: i > 0 && i < 5 ? 'right' : 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink-500)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const [bg, fg, lbl] = STATUS[p.status];
                const fp = p.discount > 0 ? p.price * (1 - p.discount / 100) : p.price;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--cream-200)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img src={img(p.kw, p.lock)} alt={p.name} style={{ width: '44px', height: '44px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                        <div><p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{p.name}</p><p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-400)' }}>{p.cat}</p></div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(fp)}</span>
                      {p.discount > 0 && <span style={{ display: 'block', fontSize: '11px', color: 'var(--secondary-600)', fontWeight: 600 }}>-{p.discount}%</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)' }}>{p.stock}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--ink-600)' }}>{p.sold}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}><span style={{ fontSize: '12px', fontWeight: 600, background: bg, color: fg, padding: '3px 10px', borderRadius: '999px' }}>{lbl}</span></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button title="Modifica" style={iconBtn}><Lucide name="pencil" size={16} color="var(--ink-500)" /></button>
                      <button title="Altro" style={iconBtn}><Lucide name="more-horizontal" size={16} color="var(--ink-500)" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
const iconBtn = { border: 0, background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: 'var(--radius-md)', display: 'inline-flex' };

function NewProductModal({ open, onClose, onSave }) {
  return (
    <Modal open={open} onClose={onClose} title="Nuovo prodotto" description="Pubblica un articolo nella tua vetrina" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Annulla</Button><Button variant="primary" icon="check" onClick={onSave}>Pubblica prodotto</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          <div style={{ width: '88px', height: '88px', borderRadius: 'var(--radius-lg)', border: '1.5px dashed var(--cream-400)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-400)', flexShrink: 0, cursor: 'pointer' }}><Lucide name="camera" size={22} color="var(--ink-400)" /><span style={{ fontSize: '10px', marginTop: '4px' }}>Foto</span></div>
          <div style={{ flex: 1 }}><Input label="Nome prodotto" placeholder="Es. Coppa Piacentina DOP 200g" /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Input label="Prezzo (€)" type="number" placeholder="8,90" />
          <Input label="Stock disponibile" type="number" placeholder="12" />
        </div>
        <Select label="Categoria" defaultValue="Salumi">
          <option>Salumi</option><option>Formaggi</option><option>Conserve</option><option>Pasta fresca</option><option>Vini</option>
        </Select>
        <div>
          <label style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink-700)', display: 'block', marginBottom: '5px' }}>Descrizione</label>
          <textarea rows="3" placeholder="Racconta il prodotto: origine, stagionatura, abbinamenti…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: '15px', fontFamily: 'var(--font-sans)', resize: 'vertical', outline: 'none' }} />
        </div>
        <Checkbox label="Spedizione gratuita per questo prodotto" />
      </div>
    </Modal>
  );
}

// ===== Analytics =====
function Analytics() {
  const rev = window.SC_REVENUE_7D;
  const max = Math.max(...rev);
  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const top = window.SC_PRODUCTS.slice().sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = top[0].sold;
  return (
    <div>
      <PageTitle title="Analisi" sub="Andamento delle vendite e prodotti migliori" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
        {[['Fatturato 7gg', fmt(window.SC_KPI.revenue7), '+12%', 'olive'], ['Ordini 7gg', window.SC_KPI.orders7, '+8%', 'primary'], ['Scontrino medio', fmt(23.9), '+3%', 'accent'], ['Tasso reso', '1,4%', '−0,2%', 'secondary']].map(([l, v, d, t]) => (
        <Card key={l} variant="bordered" padding="md">
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)', fontWeight: 600 }}>{l}</p>
          <p style={{ margin: '6px 0 0', fontSize: '24px', fontWeight: 800, color: 'var(--ink-900)' }}>{v}</p>
          <span style={{ fontSize: '12px', fontWeight: 700, color: TINT[t][1] }}>{d} vs settimana scorsa</span>
        </Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '20px', alignItems: 'start' }}>
        <Card variant="bordered" padding="lg">
          <h2 style={{ margin: '0 0 18px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Fatturato · ultimi 7 giorni</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '180px' }}>
            {rev.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div title={fmt(v)} style={{ width: '100%', height: `${(v / max) * 100}%`, background: 'linear-gradient(180deg, var(--primary-500), var(--primary-700))', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', minHeight: '6px' }} />
                </div>
                <span style={{ fontSize: '11px', color: 'var(--ink-500)' }}>{days[i]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card variant="bordered" padding="lg">
          <h2 style={{ margin: '0 0 16px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Prodotti più venduti</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {top.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--ink-300)', width: '16px' }}>{i + 1}</span>
                <img src={img(p.kw, p.lock)} alt="" style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</p>
                  <div style={{ height: '5px', background: 'var(--cream-200)', borderRadius: '3px', marginTop: '4px', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(p.sold / maxSold) * 100}%`, background: 'var(--olive-500)' }} /></div>
                </div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink-700)' }}>{p.sold}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ===== Earnings (COD + Stripe payouts) =====
function Earnings() {
  const [period, setPeriod] = React.useState('30d');
  const periods = [['7d', '7 giorni'], ['30d', '30 giorni'], ['90d', '90 giorni'], ['all', 'Tutto']];
  const payouts = window.SC_PAYOUTS;
  const held = payouts.filter((p) => p.status === 'HELD').reduce((s, p) => s + p.net, 0);
  const paid = payouts.filter((p) => p.status === 'TRANSFERRED').reduce((s, p) => s + p.net, 0);
  const codCollected = window.SC_ORDERS.filter((o) => o.pay === 'cod' && o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
  const rev = window.SC_REVENUE_7D; const max = Math.max(...rev);
  const STATUS = { HELD: ['var(--accent-100)', 'var(--accent-800)', 'In attesa'], TRANSFERRED: ['var(--olive-100)', 'var(--olive-800)', 'Pagato'] };
  return (
    <div>
      <PageTitle title="Guadagni" sub="Incassi reali e stato dei bonifici" />
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {periods.map(([k, l]) => <button key={k} onClick={() => setPeriod(k)} style={{ border: 0, background: period === k ? 'var(--primary-700)' : 'var(--surface-0)', color: period === k ? '#fff' : 'var(--ink-700)', fontWeight: 600, fontSize: '13px', padding: '7px 16px', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontFamily: 'var(--font-sans)', boxShadow: period === k ? 'none' : 'inset 0 0 0 1px var(--cream-300)' }}>{l}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
        <EStat label="Fatturato lordo" value={fmt(window.SC_KPI.revenue30)} hint={`${window.SC_KPI.orders30} ordini`} tone="primary" />
        <EStat label="Commissione MyCity" value={'− ' + fmt(window.SC_KPI.revenue30 * 0.1)} hint="10% sul venduto" tone="secondary" />
        <EStat label="Incassato" value={fmt(paid)} hint={`${fmt(held)} in arrivo dopo la consegna`} tone="olive" highlight />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '20px', alignItems: 'start' }}>
        <Card variant="bordered" padding="lg">
          <h2 style={{ margin: '0 0 16px', fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Andamento ultimi 7 giorni</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', height: '130px' }}>
            {rev.map((v, i) => <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}><div title={fmt(v)} style={{ width: '100%', height: `${(v / max) * 100}%`, background: 'linear-gradient(180deg, var(--primary-400), var(--secondary-600))', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', minHeight: '5px' }} /></div>)}
          </div>
        </Card>
        <Card variant="flat" padding="lg" style={{ background: 'var(--olive-50)', border: '1px solid var(--olive-200)' }}>
          <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-serif)', fontSize: '17px', fontWeight: 700, color: 'var(--olive-900)', display: 'flex', alignItems: 'center', gap: '8px' }}><Lucide name="banknote" size={19} color="var(--olive-700)" /> Contanti (COD)</h2>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--olive-800)', lineHeight: 1.5 }}>Gli ordini pagati alla consegna li incassa il rider e ti vengono accreditati a fine giornata.</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: 'var(--olive-900)' }}>{fmt(codCollected)}</p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--olive-700)' }}>incassati in contanti questo periodo</p>
        </Card>
      </div>

      <Card variant="bordered" padding="none" style={{ marginTop: '20px' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream-200)' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '17px', fontWeight: 700, color: 'var(--ink-900)' }}>Storico pagamenti</h2>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>Stato del bonifico per ogni ordine carta</p>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
          <thead><tr style={{ background: 'var(--cream-50)' }}>{['Ordine', 'Data', 'Netto', 'Stato'].map((h, i) => <th key={h} style={{ textAlign: i >= 2 ? 'right' : 'left', padding: '10px 18px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-500)' }}>{h}</th>)}</tr></thead>
          <tbody>
            {payouts.map((p) => { const [bg, fg, lbl] = STATUS[p.status]; return (
              <tr key={p.id} style={{ borderTop: '1px solid var(--cream-200)' }}>
                <td style={{ padding: '12px 18px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ink-700)' }}>#{p.id}</td>
                <td style={{ padding: '12px 18px', fontSize: '13px', color: 'var(--ink-500)' }}>{p.when}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: 'var(--olive-700)' }}>{fmt(p.net)}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right' }}><span style={{ fontSize: '12px', fontWeight: 600, background: bg, color: fg, padding: '3px 10px', borderRadius: '999px' }}>{p.status === 'TRANSFERRED' ? `Pagato ${p.paidOn}` : lbl}</span></td>
              </tr>
            ); })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
function EStat({ label, value, hint, tone, highlight }) {
  const [bg, fg] = TINT[tone];
  return (
    <div style={{ background: bg, border: `1.5px solid ${highlight ? 'var(--olive-300)' : 'transparent'}`, borderRadius: 'var(--radius-xl)', padding: '18px', boxShadow: highlight ? '0 0 0 3px rgba(124,139,90,.18)' : 'none' }}>
      <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink-500)' }}>{label}</p>
      <p style={{ margin: '8px 0 0', fontSize: '28px', fontWeight: 800, color: fg }}>{value}</p>
      {hint && <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>{hint}</p>}
    </div>
  );
}

// ===== Promotions · Reviews · Customers =====
function Promotions({ onNew }) {
  const promos = window.SC_PROMOS;
  return (
    <div>
      <PageTitle title="Promozioni" sub="Sconti e offerte a tempo per i tuoi prodotti"
        action={<Button variant="primary" icon="plus" onClick={onNew}>Nuova promo</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {promos.map((p) => (
          <Card key={p.id} variant="bordered" padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <span style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', background: p.active ? 'var(--secondary-100)' : 'var(--surface-100)', color: p.active ? 'var(--secondary-600)' : 'var(--ink-400)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name={p.type === 'shipping' ? 'truck' : 'tag'} size={22} stroke={2.2} color={p.active ? 'var(--secondary-600)' : 'var(--ink-400)'} /></span>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)', fontSize: '15px' }}>{p.name}</p>
                  {p.active ? <Badge variant="new">Attiva</Badge> : <span style={{ fontSize: '12px', color: 'var(--ink-400)', fontWeight: 600 }}>Terminata</span>}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>{p.product} · scade il {p.ends}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--secondary-600)' }}>{p.type === 'shipping' ? 'Sped. gratis' : `-${p.value}%`}</p>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-400)' }}>{p.used} utilizzi</p>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                <span style={{ position: 'relative', width: '40px', height: '23px', borderRadius: '999px', background: p.active ? 'var(--olive-500)' : 'var(--cream-400)', transition: 'background var(--dur-base)' }}>
                  <span style={{ position: 'absolute', top: '2px', left: p.active ? '19px' : '2px', width: '19px', height: '19px', borderRadius: '50%', background: '#fff', transition: 'left var(--dur-base)', boxShadow: 'var(--shadow-sm)' }} />
                </span>
              </label>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Reviews() {
  const reviews = window.SC_REVIEWS;
  const avg = window.SC_STORE.rating;
  return (
    <div>
      <PageTitle title="Recensioni" sub="Reputazione e feedback dei clienti" />
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '24px', alignItems: 'start' }}>
        <Card variant="flat" padding="lg">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '46px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{avg.toFixed(1).replace('.', ',')}</div>
            <div style={{ margin: '8px 0' }}><Stars value={avg} size={18} /></div>
            <div style={{ fontSize: '13px', color: 'var(--ink-500)' }}>{window.SC_STORE.reviews} recensioni</div>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[[5, 82], [4, 13], [3, 3], [2, 1], [1, 1]].map(([s, pct]) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ink-500)' }}>
                <span style={{ width: '8px' }}>{s}</span><Lucide name="star" size={11} color="var(--accent-500)" />
                <span style={{ flex: 1, height: '6px', background: 'var(--cream-200)', borderRadius: '3px', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--accent-500)' }} /></span>
                <span style={{ width: '28px', textAlign: 'right' }}>{pct}%</span>
              </div>
            ))}
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {reviews.map((r, i) => (
            <Card key={i} variant="bordered" padding="md">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--cream-200)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px' }}>{initials(r.who)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><strong style={{ fontSize: '14px', color: 'var(--ink-900)' }}>{r.who}</strong><Stars value={r.rating} size={13} /></div>
                  <span style={{ fontSize: '12px', color: 'var(--ink-400)' }}>{r.when} · {r.product}</span>
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '14px', lineHeight: 1.55, color: 'var(--ink-700)' }}>{r.text}</p>
              {r.reply
                ? <div style={{ background: 'var(--cream-50)', borderLeft: '3px solid var(--primary-400)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '8px 12px' }}><p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: 'var(--primary-700)' }}>La tua risposta</p><p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-600)' }}>{r.reply}</p></div>
                : <Button variant="ghost" size="sm" icon="reply">Rispondi</Button>}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Customers() {
  const custs = window.SC_CUSTOMERS;
  return (
    <div>
      <PageTitle title="Clienti" sub="Chi compra dal tuo negozio" />
      <Card variant="bordered" padding="none">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
          <thead><tr style={{ background: 'var(--cream-50)', borderBottom: '1px solid var(--cream-300)' }}>{['Cliente', 'Ordini', 'Speso', 'Ultimo'].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '12px 18px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-500)' }}>{h}</th>)}</tr></thead>
          <tbody>
            {custs.map((c) => (
              <tr key={c.name} style={{ borderBottom: '1px solid var(--cream-200)' }}>
                <td style={{ padding: '12px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.initials}</span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{c.name}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--ink-700)' }}>{c.orders}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(c.spent)}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--ink-500)', fontSize: '13px' }}>{c.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ===== Seller app shell (view state + toasts) =====
function App() {
  const [view, setView] = React.useState('dashboard');
  const [orders, setOrders] = React.useState(window.SC_ORDERS);
  const [newProd, setNewProd] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);

  function showToast(text) { setToast(text); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 2600); }
  function nav(v) { setView(v); window.scrollTo(0, 0); }
  function advance(o) {
    const next = SC_NEXT[o.status];
    if (!next) return;
    setOrders((list) => list.map((x) => x.id === o.id ? { ...x, status: next } : x));
    showToast(`Ordine #${o.id} → ${next === 'ACCEPTED' ? 'accettato' : next === 'READY' ? 'pronto' : 'assegnato al rider'}`);
  }
  function saveProduct() { setNewProd(false); showToast('Prodotto pubblicato in vetrina'); }

  return (
    <SellerShell view={view} onNav={nav} onNewProduct={() => setNewProd(true)}>
      {view === 'dashboard' && <Dashboard onNav={nav} onNewProduct={() => setNewProd(true)} />}
      {view === 'orders' && <Orders orders={orders} onAdvance={advance} />}
      {view === 'products' && <Products products={window.SC_PRODUCTS} onNewProduct={() => setNewProd(true)} />}
      {view === 'promotions' && <Promotions onNew={() => showToast('Editor promo (demo)')} />}
      {view === 'analytics' && <Analytics />}
      {view === 'customers' && <Customers />}
      {view === 'reviews' && <Reviews />}
      {view === 'earnings' && <Earnings />}
      <NewProductModal open={newProd} onClose={() => setNewProd(false)} onSave={saveProduct} />
      {toast && ReactDOM.createPortal(
        <div style={{ position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 'var(--z-toast)', display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--ink-900)', color: '#fff', padding: '12px 18px', borderRadius: 'var(--radius-full)', boxShadow: 'var(--shadow-warm-xl)', animation: 'mc-pop-in var(--dur-medium) var(--ease-out-quint)', fontSize: '14px', fontWeight: 500 }}>
          <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--olive-600)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Lucide name="check" size={15} stroke={3} color="#fff" /></span>
          {toast}
        </div>, document.body)}
    </SellerShell>
  );
}

// ===== Bootstrap — mounts ONLY after index.html grants permission (window.__MC_ALLOW_MOUNT).
// _ds_bundle.js concatenates this file; its embedded copy runs during bundle-eval BEFORE the
// flag is set → bails. The real <script src="app.js"> runs AFTER the flag → mounts. Uses a
// fresh flag name so a stale bundle's old boot (pre-set & neutralized in index.html) can't interfere. =====
(function mcMount(){
  if (!window.__MC_ALLOW_MOUNT) return;
  if (window.__sellerReady) return;
  var ns = window.MyCityDesignSystem_105480;
  if (typeof App === 'undefined' || !ns || !ns.Button || !window.SC_ORDERS) return setTimeout(mcMount, 30);
  window.__sellerReady = true;
  var root = document.getElementById('root');
  if (root) root.style.display = 'none';
  var mount = document.getElementById('mc-app');
  if (!mount) { mount = document.createElement('div'); mount.id = 'mc-app'; document.body.appendChild(mount); }
  ReactDOM.createRoot(mount).render(React.createElement(App));
})();
