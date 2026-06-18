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
