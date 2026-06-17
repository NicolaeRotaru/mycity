// ===== Navbar (promo ticker + terracotta bar + category bar) =====
function PromoTicker() {
  const items = [
    { icon: 'bike', t: 'Consegna in 24–48h dai negozi di Piacenza' },
    { icon: 'banknote', t: 'Paghi alla consegna — nessuna carta' },
    { icon: 'gift', t: '€5 di sconto al primo ordine' },
    { icon: 'badge-check', t: 'Solo commercianti locali verificati' },
  ];
  const run = [...items, ...items];
  return (
    <div style={{ background: 'var(--ink-900)', color: 'var(--cream-100)', fontSize: '12.5px', fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'inline-flex', gap: '40px', padding: '7px 0', animation: 'mc-marquee 32s linear infinite', willChange: 'transform' }}>
        {run.map((it, i) => <span key={i} style={{ display: 'inline-flex', gap: '7px', alignItems: 'center' }}><Lucide name={it.icon} size={14} color="var(--accent-300)" /> {it.t}</span>)}
      </div>
    </div>
  );
}

function NavIcon({ name, badge, onClick, title }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      style={{ position: 'relative', border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', padding: '8px', borderRadius: 'var(--radius-full)', display: 'inline-flex' }}>
      <Lucide name={name} size={20} />
      {badge > 0 && <span style={{ position: 'absolute', top: '-2px', right: '-2px', minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: 'var(--radius-full)', background: 'var(--accent-500)', color: 'var(--ink-900)', fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>{badge}</span>}
    </button>
  );
}

function Navbar({ cartCount, onCart, onHome, activeCat, onCat, query, onQuery, onSubmitSearch, onAccount, onFav, onNotif, notifCount = 2 }) {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 'var(--z-sticky)', boxShadow: 'var(--shadow-warm-sm)' }}>
      <PromoTicker />
      <div style={{ background: 'var(--primary-700)', color: '#fff' }}>
        <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <a onClick={onHome} style={{ cursor: 'pointer', fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 800, letterSpacing: '-0.01em', whiteSpace: 'nowrap', lineHeight: 1 }}>
            <span style={{ color: 'var(--accent-300)' }}>My</span><span style={{ color: '#fff' }}>City</span>
          </a>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,.12)', padding: '7px 12px', borderRadius: 'var(--radius-full)', fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}>
            <Lucide name="map-pin" size={15} /> Piacenza · 29121
          </span>
          <form onSubmit={(e) => { e.preventDefault(); onSubmitSearch && onSubmitSearch(); }} style={{ flex: 1, maxWidth: '560px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', pointerEvents: 'none' }}><Lucide name="search" size={18} color="var(--ink-400)" /></span>
            <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Cerca prodotti, negozi a Piacenza…"
              style={{ width: '100%', boxSizing: 'border-box', border: 0, borderRadius: 'var(--radius-full)', padding: '11px 16px 11px 42px', fontSize: '15px', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--ink-900)', outline: 'none' }} />
          </form>
          <nav style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px' }}>
            <NavIcon name="heart" title="Preferiti" badge={3} onClick={onFav} />
            <NavIcon name="bell" title="Notifiche" badge={notifCount} onClick={onNotif} />
            <button onClick={onCart} style={{ marginLeft: '6px', display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--accent-500)', color: 'var(--ink-900)', border: 0, padding: '9px 16px', borderRadius: 'var(--radius-full)', fontWeight: 700, fontSize: '14px', fontFamily: 'var(--font-sans)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Lucide name="shopping-cart" size={17} stroke={2.4} /> Carrello
              {cartCount > 0 && <span style={{ background: 'var(--ink-900)', color: 'var(--accent-400)', fontSize: '11px', fontWeight: 700, borderRadius: 'var(--radius-full)', minWidth: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{cartCount}</span>}
            </button>
            <button onClick={onAccount} title="Account" aria-label="Account" style={{ marginLeft: '8px', width: '36px', height: '36px', borderRadius: 'var(--radius-full)', background: 'var(--cream-200)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0, border: 0, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{window.MC_USER ? window.MC_USER.initials : 'L'}</button>
          </nav>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.14)' }}>
          <div className="mc-catbar" style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '0 20px', display: 'flex', gap: '2px', overflowX: 'auto' }}>
            <button onClick={() => onCat(null)} style={catBtn(!activeCat)}><Lucide name="layout-grid" size={16} stroke={2.2} color={!activeCat ? 'var(--accent-300)' : 'rgba(255,255,255,.88)'} /> Tutto</button>
            {window.MC_CATEGORIES.map((c) => {
              const on = activeCat === c.slug;
              return (
                <button key={c.slug} onClick={() => onCat(on ? null : c.slug)} style={catBtn(on)}>
                  <Lucide name={c.icon} size={16} stroke={2.2} color={on ? 'var(--accent-300)' : 'rgba(255,255,255,.88)'} /> {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
function catBtn(on) {
  return { display: 'inline-flex', alignItems: 'center', gap: '7px', whiteSpace: 'nowrap', border: 0, background: 'transparent', color: on ? 'var(--accent-300)' : 'rgba(255,255,255,.88)', padding: '12px 14px', fontSize: '13.5px', fontWeight: on ? 700 : 500, fontFamily: 'var(--font-sans)', cursor: 'pointer', borderBottom: `2px solid ${on ? 'var(--accent-400)' : 'transparent'}` };
}
