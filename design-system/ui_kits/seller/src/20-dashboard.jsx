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
