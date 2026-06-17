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
