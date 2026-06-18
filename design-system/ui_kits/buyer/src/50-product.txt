// ===== Product detail page (PDP) — gallery, buy box, ETA, reviews, cross-sell =====
function ProductPage({ product: p, onBack, onAdd, onOpen, onStore }) {
  const [qty, setQty] = React.useState(1);
  const [activeImg, setActiveImg] = React.useState(0);
  const store = storeBy(p.store) || {};
  const fp = finalPrice(p);
  const hasDisc = p.discountPercent > 0;
  const out = p.stock === 0;
  const low = p.stock > 0 && p.stock <= 3;
  const gallery = p.galleryLocks.map((l) => imgUrl(p.kw, l));
  const pairings = (window.MC_PAIRINGS[p.id] || []).map((id) => window.MC_PRODUCTS.find((x) => x.id === id)).filter(Boolean);
  const sameStore = window.MC_PRODUCTS.filter((x) => x.store === p.store && x.id !== p.id).slice(0, 4);
  const reviews = window.MC_REVIEWS[p.id] || [];

  React.useEffect(() => { setQty(1); setActiveImg(0); }, [p.id]);

  return (
    <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '20px' }}>
      <div style={{ fontSize: '13px', color: 'var(--ink-500)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <a onClick={onBack} style={{ cursor: 'pointer', color: 'var(--ink-500)' }}>Home</a>
        <Lucide name="chevron-right" size={13} color="var(--ink-400)" />
        <a onClick={() => onStore(store)} style={{ cursor: 'pointer', color: 'var(--ink-500)' }}>{p.store}</a>
        <Lucide name="chevron-right" size={13} color="var(--ink-400)" />
        <span style={{ color: 'var(--ink-700)' }}>{p.name}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '36px' }}>
        {/* gallery */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ position: 'relative', borderRadius: 'var(--radius-2xl)', overflow: 'hidden', border: '1px solid var(--cream-300)', aspectRatio: '1/1', background: 'var(--surface-100)' }}>
            <img src={gallery[activeImg]} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', top: '14px', left: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {hasDisc && <Badge variant="discount" size="md">-{p.discountPercent}%</Badge>}
              {p.isNew && <Badge variant="new" size="md">Nuovo</Badge>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {gallery.map((g, i) => (
              <button key={i} onClick={() => setActiveImg(i)} style={{ width: '72px', height: '72px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: `2px solid ${i === activeImg ? 'var(--primary-600)' : 'var(--cream-300)'}`, padding: 0, cursor: 'pointer', background: 'none' }}>
                <img src={g} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            ))}
          </div>
        </div>

        {/* buy box */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div onClick={() => onStore(store)} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start' }}>
            <StoreChip name={p.store} size={24} />
            {store.verified && <Lucide name="badge-check" size={16} color="var(--primary-600)" />}
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '34px', fontWeight: 700, lineHeight: 1.1, color: 'var(--ink-900)' }}>{p.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--ink-500)' }}>
            <Stars value={p.rating} size={16} /> <strong style={{ color: 'var(--ink-800)' }}>{String(p.rating).replace('.', ',')}</strong> · {p.reviews} recensioni
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '32px', fontWeight: 800, color: hasDisc ? 'var(--secondary-600)' : 'var(--ink-900)' }}>{fmt(fp)}</span>
            {hasDisc && <span style={{ fontSize: '17px', color: 'var(--ink-400)', textDecoration: 'line-through' }}>{fmt(p.price)}</span>}
            {hasDisc && <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--secondary-600)' }}>Risparmi {fmt(p.price - fp)}</span>}
          </div>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.65, color: 'var(--ink-700)' }}>{p.desc}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {(p.tags || []).map((t) => <Badge key={t} variant="local">{t}</Badge>)}
            <Badge variant="cod" icon="banknote">Paga alla consegna</Badge>
            {p.freeShipping && <Badge variant="free" icon="truck">Spedizione gratis</Badge>}
            {low && <Badge variant="lowstock" icon="flame">Ultimi {p.stock}</Badge>}
          </div>

          <div style={{ height: '1px', background: 'var(--cream-300)', margin: '4px 0' }} />

          {/* stock + qty + ETA */}
          <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', color: out ? 'var(--secondary-600)' : 'var(--olive-700)', fontWeight: 600 }}>
            <Lucide name={out ? 'x-circle' : 'check-circle-2'} size={16} color={out ? 'var(--secondary-600)' : 'var(--olive-600)'} />
            {out ? 'Momentaneamente esaurito' : `Disponibile · ${p.stock} pezzi in negozio`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-full)', overflow: 'hidden', opacity: out ? .5 : 1 }}>
              <button disabled={out} onClick={() => setQty((q) => Math.max(1, q - 1))} style={qtyBtn}><Lucide name="minus" size={16} /></button>
              <span style={{ minWidth: '36px', textAlign: 'center', fontWeight: 700, color: 'var(--ink-900)' }}>{qty}</span>
              <button disabled={out || qty >= p.stock} onClick={() => setQty((q) => Math.min(p.stock, q + 1))} style={{ ...qtyBtn, opacity: qty >= p.stock ? .4 : 1 }}><Lucide name="plus" size={16} /></button>
            </div>
            <Button variant="accent" size="lg" icon="shopping-cart" disabled={out} fullWidth onClick={() => onAdd(p, qty)}>
              {out ? 'Esaurito' : `Aggiungi · ${fmt(fp * qty)}`}
            </Button>
          </div>
          {qty >= p.stock && !out && <span style={{ fontSize: '12px', color: 'var(--ink-500)' }}>Hai raggiunto le scorte disponibili.</span>}

          {/* ETA box */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--olive-50)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: 'var(--olive-800)' }}>
              <Lucide name="truck" size={17} color="var(--olive-700)" /> {store.deliveryToday ? 'Ordina entro le 18:00 → a casa domani' : 'Consegna in 24–48h'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--olive-800)' }}>
              <Lucide name="banknote" size={16} color="var(--olive-700)" /> Paghi al rider alla consegna · contanti
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--olive-800)' }}>
              <Lucide name="rotate-ccw" size={16} color="var(--olive-700)" /> Reso gratuito entro 14 giorni
            </span>
          </div>
        </div>
      </div>

      {/* cross-sell: spesso comprati insieme */}
      {pairings.length > 0 && (
        <Section title="Spesso comprati insieme">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {pairings.map((x) => <ProductGridCard key={x.id} p={x} onOpen={onOpen} onAdd={(pp) => onAdd(pp, 1)} onStore={onStore} />)}
          </div>
        </Section>
      )}

      {/* reviews */}
      <Section title={`Recensioni · ${p.reviews}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '28px', alignItems: 'start' }}>
          <Card variant="flat" padding="lg">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '44px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{String(p.rating).replace('.', ',')}</div>
              <div style={{ margin: '8px 0 4px' }}><Stars value={p.rating} size={18} /></div>
              <div style={{ fontSize: '13px', color: 'var(--ink-500)' }}>{p.reviews} recensioni</div>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[5, 4, 3, 2, 1].map((star) => { const pct = star === 5 ? 78 : star === 4 ? 16 : star === 3 ? 4 : star === 2 ? 1 : 1; return (
                <div key={star} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ink-500)' }}>
                  <span style={{ width: '10px', textAlign: 'right' }}>{star}</span><Lucide name="star" size={11} color="var(--accent-500)" />
                  <span style={{ flex: 1, height: '6px', background: 'var(--cream-200)', borderRadius: '3px', overflow: 'hidden' }}><span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--accent-500)' }} /></span>
                </div>
              ); })}
            </div>
          </Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {reviews.length === 0
              ? <EmptyState icon="message-circle" title="Ancora nessuna recensione" description="Sii il primo a recensire questo prodotto dopo l’acquisto." />
              : reviews.map((r, i) => <ReviewItem key={i} r={r} />)}
          </div>
        </div>
      </Section>

      {/* same store */}
      {sameStore.length > 0 && (
        <Section title={`Altro da ${p.store}`} action={<a onClick={() => onStore(store)} style={{ cursor: 'pointer', color: 'var(--primary-700)', fontWeight: 600, fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Vai al negozio <Lucide name="arrow-right" size={15} color="var(--primary-700)" /></a>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {sameStore.map((x) => <ProductGridCard key={x.id} p={x} onOpen={onOpen} onAdd={(pp) => onAdd(pp, 1)} onStore={onStore} />)}
          </div>
        </Section>
      )}
    </div>
  );
}

const qtyBtn = { width: '38px', height: '40px', border: 0, background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

function Section({ title, action, children }) {
  return (
    <section style={{ marginTop: '44px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 700, color: 'var(--ink-900)' }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
