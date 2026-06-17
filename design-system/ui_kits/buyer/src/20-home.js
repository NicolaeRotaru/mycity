// ===== Home =====
function pImg(p, i = 0) { return imgUrl(p.kw, p.galleryLocks[i % p.galleryLocks.length]); }

function ProductGridCard({ p, onOpen, onAdd, onStore }) {
  return (
    <div onClick={() => onOpen(p)} style={{ cursor: 'pointer', height: '100%' }}>
      <ProductCard name={p.name} price={p.price} discountPercent={p.discountPercent}
        storeName={p.store} image={pImg(p)} isNew={p.isNew} freeShipping={p.freeShipping} stock={p.stock}
        onAdd={() => onAdd(p)} />
    </div>
  );
}

function Hero({ onExplore, onStore }) {
  const featured = storeBy('Salumeria Verdi');
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg, var(--surface-0), var(--surface-100))' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-80px', right: '-80px', width: '500px', height: '500px', borderRadius: '50%', background: 'rgba(245,197,182,.4)', filter: 'blur(80px)' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: '-120px', left: '-80px', width: '420px', height: '420px', borderRadius: '50%', background: 'rgba(251,216,145,.4)', filter: 'blur(80px)' }} />
      <div style={{ position: 'relative', maxWidth: 'var(--container-max)', margin: '0 auto', padding: '44px 20px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '40px', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--primary-100)', color: 'var(--primary-800)', padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 600, boxShadow: 'inset 0 0 0 1px var(--primary-200)' }}>
            <Lucide name="sparkles" size={14} color="var(--primary-800)" /> Il marketplace dei negozi di Piacenza
          </span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '54px', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.01em', color: 'var(--ink-900)' }}>
            I negozi <span style={{ color: 'var(--primary-700)', fontStyle: 'italic' }}>veri</span> di Piacenza,<br />ora a casa tua.
          </h1>
          <p style={{ margin: 0, fontSize: '18px', lineHeight: 1.6, color: 'var(--ink-600)', maxWidth: '34em' }}>
            Alimentari, gastronomia, vini, casa: ordini dai commercianti della tua via in pochi tap e <strong style={{ color: 'var(--ink-900)' }}>paghi alla consegna</strong>. A casa in 24–48h.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <Button variant="primary" size="lg" shape="pill" iconRight="arrow-right" onClick={onExplore}>Inizia a esplorare</Button>
            <Button variant="secondary" size="lg" shape="pill" icon="store" onClick={() => onStore(featured)}>Esplora i negozi</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '14px', color: 'var(--ink-600)' }}>
            {['Paghi alla consegna', 'Oggi se disponibile · 24–48h', 'Account solo per confermare'].map((t) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Lucide name="check" size={16} stroke={2.4} color="var(--olive-600)" /> {t}</span>
            ))}
          </div>
        </div>
        <div onClick={() => onStore(featured)} style={{ cursor: 'pointer', background: '#fff', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-warm-lg)', overflow: 'hidden' }} className="mc-card-hover">
          <div style={{ position: 'relative', height: '180px' }}>
            <img src={featured.cover} alt={featured.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <span style={{ position: 'absolute', top: '12px', left: '12px' }}><OpenPill store={featured} dark /></span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '19px', fontWeight: 700, color: 'var(--ink-900)' }}>{featured.name}</h3>
              <Lucide name="badge-check" size={18} color="var(--primary-600)" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ink-500)' }}>
              <Stars value={featured.rating} /> <strong style={{ color: 'var(--ink-800)' }}>{String(featured.rating).replace('.', ',')}</strong> · {featured.reviews} recensioni · {featured.area}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
              <Badge variant="local">Negozio locale</Badge>
              <Badge variant="free" icon="truck">Consegna oggi</Badge>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, icon: 'store', tone: 'primary', t: 'Scegli', d: 'Sfoglia i negozi e i prodotti di Piacenza, dai commercianti della tua via.' },
    { n: 2, icon: 'shopping-bag', tone: 'accent', t: 'Ordina', d: 'Aggiungi al carrello e inserisci l’indirizzo. L’account serve solo per confermare.' },
    { n: 3, icon: 'banknote', tone: 'olive', t: 'Ricevi e paghi alla consegna', d: 'Te lo portiamo a casa in 24–48h. Paghi al rider quando arriva: zero rischi.' },
  ];
  const TONE = { primary: ['var(--primary-100)', 'var(--primary-700)'], accent: ['var(--accent-100)', 'var(--accent-700)'], olive: ['var(--olive-100)', 'var(--olive-700)'] };
  return (
    <section style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '28px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: '22px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--primary-700)' }}>Semplice e senza pensieri</span>
        <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontSize: '30px', fontWeight: 700, color: 'var(--ink-900)' }}>Come funziona, in 3 passi</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        {steps.map((s) => (
          <Card key={s.n} variant="elevated" padding="lg" as="article">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <span style={{ position: 'relative', width: '48px', height: '48px', borderRadius: 'var(--radius-full)', background: TONE[s.tone][0], color: TONE[s.tone][1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Lucide name={s.icon} size={22} stroke={2.2} color={TONE[s.tone][1]} />
                <span style={{ position: 'absolute', top: '-6px', right: '-6px', width: '24px', height: '24px', borderRadius: '50%', background: 'var(--ink-900)', color: '#fff', fontSize: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px #fff', fontFamily: 'var(--font-sans)' }}>{s.n}</span>
              </span>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>{s.t}</h3>
            </div>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--ink-600)' }}>{s.d}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ProductRail({ products, onOpen, onAdd, onStore, title, eyebrow, onSeeAll }) {
  return (
    <section style={{ background: '#fff', borderTop: '1px solid var(--cream-300)', borderBottom: '1px solid var(--cream-300)', padding: '28px 0' }}>
      <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--primary-700)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}><Lucide name="heart" size={14} color="var(--primary-700)" /> {eyebrow}</span>
            <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontSize: '28px', fontWeight: 700, color: 'var(--ink-900)' }}>{title}</h2>
          </div>
          <a onClick={onSeeAll} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--primary-700)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>Vedi tutto <Lucide name="arrow-right" size={16} color="var(--primary-700)" /></a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {products.map((p) => <ProductGridCard key={p.id} p={p} onOpen={onOpen} onAdd={onAdd} onStore={onStore} />)}
        </div>
      </div>
    </section>
  );
}

function StoresRail({ stores, onStore }) {
  return (
    <section style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '18px' }}>
        <div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--primary-700)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}><Lucide name="store" size={14} color="var(--primary-700)" /> Vicino a te</span>
          <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--font-serif)', fontSize: '28px', fontWeight: 700, color: 'var(--ink-900)' }}>Negozi in evidenza</h2>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {stores.map((s) => (
          <div key={s.id} onClick={() => onStore(s)} className="mc-card-hover" style={{ cursor: 'pointer', background: '#fff', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-2xl)', overflow: 'hidden' }}>
            <div style={{ position: 'relative', height: '120px' }}>
              <img src={s.cover} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {s.deliveryToday && <span style={{ position: 'absolute', bottom: '8px', left: '8px' }}><Badge variant="free" icon="truck">Consegna oggi</Badge></span>}
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 700, color: 'var(--ink-900)' }}>{s.name}</h3>
                {s.verified && <Lucide name="badge-check" size={15} color="var(--primary-600)" />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--ink-500)', marginTop: '5px' }}>
                <Stars value={s.rating} size={13} /> <strong style={{ color: 'var(--ink-800)' }}>{String(s.rating).replace('.', ',')}</strong> · {s.cat} · {s.area}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrustRow() {
  const items = [
    { icon: 'banknote', tone: ['var(--olive-100)', 'var(--olive-700)'], t: 'Paghi alla consegna', d: 'Niente carta: l’account serve solo per confermare.' },
    { icon: 'home', tone: ['var(--primary-100)', 'var(--primary-700)'], t: '100% commercianti locali', d: 'Solo negozi verificati di Piacenza.' },
    { icon: 'truck', tone: ['var(--accent-100)', 'var(--accent-700)'], t: 'Consegna in 24–48h', d: 'Rider del territorio, percorsi brevi.' },
    { icon: 'rotate-ccw', tone: ['var(--secondary-100)', 'var(--secondary-600)'], t: 'Reso entro 14 giorni', d: 'Cambi idea? Ti rimborsiamo senza domande.' },
  ];
  return (
    <section style={{ background: 'var(--cream-50)', borderTop: '1px solid var(--cream-300)', borderBottom: '1px solid var(--cream-300)' }}>
      <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '28px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {items.map((v) => (
          <div key={v.t} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0, width: '44px', height: '44px', borderRadius: 'var(--radius-full)', background: v.tone[0], color: v.tone[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Lucide name={v.icon} size={20} stroke={2.2} color={v.tone[1]} /></span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: 'var(--ink-900)' }}>{v.t}</p>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-600)', lineHeight: 1.45 }}>{v.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SellerCta() {
  return (
    <section style={{ background: 'var(--ink-900)', color: '#fff' }}>
      <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '22px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ flexShrink: 0, width: '40px', height: '40px', borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Lucide name="shield-check" size={18} stroke={2.4} color="var(--accent-400)" /></span>
          <p style={{ margin: 0, fontSize: '17px' }}><span style={{ fontFamily: 'var(--font-serif)', fontWeight: 700 }}>Hai un negozio a Piacenza?</span> <span style={{ color: 'var(--ink-300)' }}>Vendi online con zero commissioni.</span></p>
        </div>
        <Button variant="accent" shape="pill" icon="store">Diventa venditore</Button>
      </div>
    </section>
  );
}

function Footer({ onAuth }) {
  const cols = [
    ['MyCity', ['Chi siamo', 'Come funziona', 'Lavora con noi', 'Contatti']],
    ['Acquista', ['Categorie', 'Negozi', 'Offerte', 'Novità']],
    ['Vendi', ['Diventa venditore', 'Zero commissioni', 'Centro venditori', 'Diventa rider']],
    ['Aiuto', ['FAQ', 'Resi e rimborsi', 'Privacy', 'Cookie']],
  ];
  return (
    <footer style={{ background: 'var(--cream-200)', borderTop: '1px solid var(--cream-300)', color: 'var(--ink-700)' }}>
      <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto', padding: '36px 20px', display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 1fr)', gap: '28px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 800 }}><span style={{ color: 'var(--accent-500)' }}>My</span><span style={{ color: 'var(--ink-900)' }}>City</span></div>
          <p style={{ margin: '10px 0 0', fontSize: '13px', lineHeight: 1.6, maxWidth: '24em', color: 'var(--ink-500)' }}>Il marketplace dei negozi locali di Piacenza. Consegna a domicilio, pagamento alla consegna.</p>
        </div>
        {cols.map(([h, links]) => (
          <div key={h}>
            <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: 'var(--ink-900)' }}>{h}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {links.map((l) => <li key={l}><a style={{ fontSize: '13px', color: 'var(--ink-600)', cursor: 'pointer' }}>{l}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--cream-300)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--ink-500)' }}>
        <span>© 2026 MyCity Piacenza · P.IVA 0000000000 · Tutti i diritti riservati</span>
        {onAuth && <a onClick={onAuth} style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--primary-700)' }}>Accedi / Registrati</a>}
      </div>
    </footer>
  );
}

function Home({ products, stores, onOpen, onAdd, onStore, onExplore }) {
  return (
    <>
      <Hero onExplore={onExplore} onStore={onStore} />
      <HowItWorks />
      <ProductRail products={products.slice(0, 4)} onOpen={onOpen} onAdd={onAdd} onStore={onStore} eyebrow="I più amati" title="Prodotti che vanno forte" onSeeAll={onExplore} />
      <StoresRail stores={stores.slice(0, 4)} onStore={onStore} />
      <TrustRow />
      <ProductRail products={products.slice(4, 8)} onOpen={onOpen} onAdd={onAdd} onStore={onStore} eyebrow="Novità" title="Appena arrivati dai negozi" onSeeAll={onExplore} />
      <SellerCta />
    </>
  );
}
