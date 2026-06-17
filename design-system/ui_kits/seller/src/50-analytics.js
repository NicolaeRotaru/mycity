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
