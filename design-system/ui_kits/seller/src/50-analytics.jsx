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
