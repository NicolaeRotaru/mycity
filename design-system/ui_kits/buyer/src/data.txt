// MyCity marketplace — catalogue (plain globals, loaded before app.jsx).
// Images: LoremFlickr, keyword-matched + locked seed → coherent & stable.
const LF = (k, lock) => `https://loremflickr.com/640/640/${k}?lock=${lock}`;

window.MC_CATEGORIES = [
  { slug: 'alimentari',    label: 'Alimentari',     icon: 'apple' },
  { slug: 'gastronomia',   label: 'Gastronomia',    icon: 'utensils' },
  { slug: 'cantina',       label: 'Vini & Cantina', icon: 'wine' },
  { slug: 'casa',          label: 'Casa & Cucina',  icon: 'lamp' },
  { slug: 'abbigliamento', label: 'Abbigliamento',  icon: 'shirt' },
];

// Stores — first-class entities (vetrina, orari, recensioni).
window.MC_STORES = [
  { id: 's1', name: 'Salumeria Verdi', cat: 'Gastronomia', area: 'Centro storico', rating: 4.9, reviews: 214, verified: true,
    cover: LF('salami', 7), closeAt: '19:30', deliveryToday: true, since: 1962,
    blurb: 'Salumi e formaggi piacentini selezionati, tagliati a mano ogni giorno nel cuore del centro storico.' },
  { id: 's2', name: 'Cantina Pace', cat: 'Vini & Cantina', area: 'Colli Piacentini', rating: 4.8, reviews: 98, verified: true,
    cover: LF('wine', 7), closeAt: '20:00', deliveryToday: true, since: 1978,
    blurb: 'I vini dei Colli Piacentini, dal Gutturnio all’Ortrugo. Produzione propria e piccoli vignaioli del territorio.' },
  { id: 's3', name: 'Pasta Fresca Anita', cat: 'Gastronomia', area: 'Borgo', rating: 5.0, reviews: 176, verified: true,
    cover: LF('pasta', 15), closeAt: '14:30', deliveryToday: true, since: 1995,
    blurb: 'Pasta fresca fatta a mano ogni mattina: pisarei, tortelli, anolini. La tradizione piacentina come una volta.' },
  { id: 's4', name: 'Bottega Emilia', cat: 'Gastronomia', area: 'Centro', rating: 4.7, reviews: 132, verified: true,
    cover: LF('ravioli', 3), closeAt: '19:00', deliveryToday: false, since: 2008,
    blurb: 'Gastronomia con piatti pronti, pasta ripiena e specialità emiliane da asporto.' },
  { id: 's5', name: 'Ceramiche del Po', cat: 'Casa & Cucina', area: 'Lungo Po', rating: 4.7, reviews: 64, verified: true,
    cover: LF('pottery', 3), closeAt: '18:30', deliveryToday: false, since: 1989,
    blurb: 'Ceramiche tornite e smaltate a mano nel laboratorio sul lungo Po. Ogni pezzo è unico.' },
  { id: 's6', name: 'Filo & Trama', cat: 'Abbigliamento', area: 'Centro', rating: 4.6, reviews: 41, verified: false,
    cover: LF('scarf', 7), closeAt: '19:30', deliveryToday: true, since: 2015,
    blurb: 'Maglieria e tessuti naturali tessuti su telaio tradizionale. Lana merino, lino, tinte naturali.' },
  { id: 's7', name: 'Forno Borgo', cat: 'Alimentari', area: 'Borgo', rating: 4.8, reviews: 156, verified: true,
    cover: LF('bread', 3), closeAt: '13:30', deliveryToday: true, since: 1971,
    blurb: 'Pane a lievito madre, focacce e dolci da forno cotti nel forno a legna.' },
];

const S = Object.fromEntries(window.MC_STORES.map((s) => [s.name, s.id]));

window.MC_PRODUCTS = [
  { id: 'p1', name: 'Coppa Piacentina DOP 200g', price: 8.9, discountPercent: 20, store: 'Salumeria Verdi', cat: 'gastronomia',
    freeShipping: true, stock: 12, rating: 4.8, reviews: 56, tags: ['DOP', 'Taglio a mano'], kw: 'salami', galleryLocks: [7, 15, 3],
    desc: 'Stagionata 90 giorni nei nostri scaffali in centro storico. Taglio a mano, sottovuoto fresco di giornata. Dolce, profumata, da gustare con un calice di Gutturnio.' },
  { id: 'p2', name: 'Gutturnio dei Colli DOC 2021', price: 12.5, store: 'Cantina Pace', cat: 'cantina',
    stock: 2, rating: 4.7, reviews: 38, tags: ['DOC', 'Colli Piacentini'], kw: 'wine', galleryLocks: [7, 3, 15],
    desc: 'Il rosso dei colli piacentini, vivace e schietto. Perfetto con i salumi e i pisarei. Servire a 16–18°C.' },
  { id: 'p3', name: 'Pisarei e fasò freschi 500g', price: 6.4, store: 'Pasta Fresca Anita', cat: 'gastronomia',
    isNew: true, stock: 20, rating: 5.0, reviews: 91, tags: ['Fresco', 'Fatto a mano'], kw: 'pasta', galleryLocks: [15, 7, 3],
    desc: 'Fatti a mano ogni mattina come vuole la tradizione: pasta e pangrattato, con il ragù di fagioli borlotti. Pronti in 8 minuti.' },
  { id: 'p4', name: 'Tortelli con la coda 500g', price: 9.0, store: 'Bottega Emilia', cat: 'gastronomia',
    stock: 0, rating: 4.6, reviews: 44, tags: ['Fresco'], kw: 'ravioli', galleryLocks: [3, 7, 15],
    desc: 'Ripieno di ricotta e spinaci, chiusi a treccia con la caratteristica “coda”. La domenica piacentina, burro e salvia.' },
  { id: 'p5', name: 'Grana Padano DOP 18 mesi 1kg', price: 18.9, discountPercent: 10, store: 'Salumeria Verdi', cat: 'alimentari',
    freeShipping: true, stock: 8, rating: 4.9, reviews: 73, tags: ['DOP', '18 mesi'], kw: 'cheese', galleryLocks: [3, 15, 7],
    desc: 'Petalo o pezzo intero, tagliato al momento. Latte dei caseifici della bassa, stagionatura 18 mesi: granuloso, saporito.' },
  { id: 'p6', name: 'Mostarda di frutta artigianale 250g', price: 7.2, store: 'Bottega Emilia', cat: 'alimentari',
    isNew: true, stock: 15, rating: 4.5, reviews: 22, tags: ['Artigianale'], kw: 'marmalade', galleryLocks: [7, 3, 15],
    desc: 'Senape e frutta candita, ricetta di famiglia. Da provare con i bolliti e i formaggi stagionati.' },
  { id: 'p7', name: 'Set 2 tazze in ceramica fatta a mano', price: 24.0, store: 'Ceramiche del Po', cat: 'casa',
    freeShipping: true, stock: 5, rating: 4.8, reviews: 31, tags: ['Fatto a mano', 'Pezzo unico'], kw: 'pottery', galleryLocks: [3, 7, 15],
    desc: 'Tornite e smaltate a mano nel laboratorio sul lungo Po. Smalto reattivo: ogni tazza ha sfumature uniche.' },
  { id: 'p8', name: 'Sciarpa in lana merino', price: 32.0, discountPercent: 15, store: 'Filo & Trama', cat: 'abbigliamento',
    stock: 3, rating: 4.7, reviews: 18, tags: ['Lana merino'], kw: 'scarf', galleryLocks: [7, 3, 15],
    desc: 'Tessuta su telaio tradizionale. Lana merino morbidissima, tinta naturale. Calda e leggera.' },
  { id: 'p9', name: 'Pane a lievito madre 750g', price: 4.5, store: 'Forno Borgo', cat: 'alimentari',
    isNew: true, stock: 18, rating: 4.8, reviews: 64, tags: ['Lievito madre'], kw: 'bread', galleryLocks: [3, 7, 15],
    desc: 'Lievito madre, farine macinate a pietra, 24h di lievitazione. Crosta croccante, mollica alveolata.' },
  { id: 'p10', name: 'Salame nostrano stagionato 300g', price: 11.5, store: 'Salumeria Verdi', cat: 'gastronomia',
    stock: 6, rating: 4.9, reviews: 47, tags: ['Stagionato'], kw: 'prosciutto', galleryLocks: [3, 7, 15],
    desc: 'Carne suina dei nostri allevamenti, concia tradizionale, stagionatura naturale in cantina. Insaccato a mano.' },
];

// Recensioni — pool condiviso, indicizzato per prodotto.
window.MC_REVIEWS = {
  p1: [
    { who: 'Marco B.', rating: 5, when: '2 settimane fa', text: 'La vera coppa piacentina, come quella di mio nonno. Taglio perfetto, arrivata freschissima.' },
    { who: 'Giulia R.', rating: 5, when: '1 mese fa', text: 'Profumatissima. La pago volentieri, si sente che è artigianale.' },
    { who: 'Anna T.', rating: 4, when: '1 mese fa', text: 'Ottima, magari un filo più di stagionatura. Consegna puntuale, pagato al rider.' },
  ],
  p3: [
    { who: 'Davide P.', rating: 5, when: '1 settimana fa', text: 'Pisarei come al ristorante. Anita è una garanzia, il ragù di fasò è spettacolare.' },
    { who: 'Sara M.', rating: 5, when: '3 settimane fa', text: 'Freschi, pronti in 8 minuti come scritto. Comodissimo pagare alla consegna.' },
  ],
  p5: [
    { who: 'Luca F.', rating: 5, when: '5 giorni fa', text: 'Grana stagionato il giusto, granuloso e saporito. Tagliato al momento, ottimo.' },
    { who: 'Elena V.', rating: 4, when: '2 mesi fa', text: 'Buono, confezione sottovuoto perfetta. Lo ricomprerò.' },
  ],
};

// "Spesso comprati insieme" — abbinamenti curati.
window.MC_PAIRINGS = { p1: ['p2', 'p5', 'p9'], p2: ['p1', 'p10', 'p5'], p3: ['p2', 'p5'], p5: ['p2', 'p9'], p9: ['p1', 'p10'], p10: ['p2', 'p9'] };

// ---- Account / sessione utente (demo) -------------------------------------
window.MC_USER = { name: 'Lucia Bianchi', email: 'lucia.bianchi@email.it', phone: '+39 333 12 45 678', initials: 'LB', since: 2024 };

window.MC_ADDRESSES = [
  { id: 'a1', label: 'Casa', name: 'Lucia Bianchi', street: 'Via Roma 12', city: '29121 Piacenza (PC)', phone: '+39 333 12 45 678', def: true },
  { id: 'a2', label: 'Ufficio', name: 'Lucia Bianchi', street: 'Via Cavour 48', city: '29121 Piacenza (PC)', phone: '+39 333 12 45 678', def: false },
];

// Slot di consegna (oggi/domani × fasce).
window.MC_SLOTS = [
  { id: 'today-pm', day: 'Oggi', time: '18:00 – 19:30', fee: 3.5, label: 'In giornata' },
  { id: 'tom-am', day: 'Domani', time: '9:00 – 12:00', fee: 0, label: null },
  { id: 'tom-pm', day: 'Domani', time: '15:00 – 18:30', fee: 0, label: 'Consigliato' },
];

// Ordini passati (per /orders). status usa gli 8 stati di OrderStatusBadge.
window.MC_ORDERS = [
  { id: 'PC-2461', date: '14 giu 2026', status: 'OUT_FOR_DELIVERY', total: 27.4, store: 'Salumeria Verdi',
    lines: [{ id: 'p1', q: 2 }, { id: 'p5', q: 1 }] },
  { id: 'PC-2390', date: '2 giu 2026', status: 'DELIVERED', total: 18.9, store: 'Pasta Fresca Anita',
    lines: [{ id: 'p3', q: 2 }, { id: 'p2', q: 1 }] },
  { id: 'PC-2274', date: '21 mag 2026', status: 'DELIVERED', total: 32.0, store: 'Filo & Trama',
    lines: [{ id: 'p8', q: 1 }] },
  { id: 'PC-2188', date: '8 mag 2026', status: 'CANCELED', total: 9.0, store: 'Bottega Emilia',
    lines: [{ id: 'p4', q: 1 }] },
];

window.MC_FAVORITES = ['p2', 'p7', 'p8', 'p9'];

window.MC_NOTIFICATIONS = [
  { id: 'n1', icon: 'truck', tone: 'primary', title: 'Il tuo ordine è in consegna', body: 'PC-2461 · il rider arriva tra ~20 min', when: '5 min fa', unread: true },
  { id: 'n2', icon: 'tag', tone: 'secondary', title: '-20% sulla Coppa Piacentina', body: 'Salumeria Verdi · solo per oggi', when: '2 ore fa', unread: true },
  { id: 'n3', icon: 'sparkles', tone: 'accent', title: 'Nuovi arrivi da Forno Borgo', body: 'Pane a lievito madre appena sfornato', when: 'Ieri', unread: false },
  { id: 'n4', icon: 'check-circle-2', tone: 'olive', title: 'Ordine consegnato', body: 'PC-2390 · com’è andata? Lascia una recensione', when: '2 giorni fa', unread: false },
];

window.MC_THREADS = [
  { id: 't1', store: 'Salumeria Verdi', last: 'Certo! Le taglio la coppa più sottile, nessun problema.', when: '10:24', unread: 1,
    msgs: [
      { me: true, text: 'Buongiorno, è possibile avere la coppa tagliata più sottile?', when: '10:21' },
      { me: false, text: 'Buongiorno Lucia! Certo, gliela preparo io.', when: '10:23' },
      { me: false, text: 'Certo! Le taglio la coppa più sottile, nessun problema.', when: '10:24' },
    ] },
  { id: 't2', store: 'Pasta Fresca Anita', last: 'I pisarei sono pronti per la consegna di domani 👍', when: 'Ieri', unread: 0,
    msgs: [
      { me: true, text: 'A che ora sono pronti i pisarei per domani?', when: 'Ieri' },
      { me: false, text: 'I pisarei sono pronti per la consegna di domani', when: 'Ieri' },
    ] },
];
