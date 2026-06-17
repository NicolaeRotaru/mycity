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
