// MyCity Seller — demo data (plain globals; loaded before app.js).
const LF = (k, lock) => `https://loremflickr.com/640/640/${k}?lock=${lock}`;

window.SC_STORE = { name: 'Salumeria Verdi', area: 'Centro storico', since: 1962, rating: 4.9, reviews: 214, initials: 'SV', subscription: 'active', healthScore: 86 };

window.SC_KPI = {
  revenueToday: 142.5, ordersToday: 6,
  revenue7: 980.4, orders7: 41,
  revenue30: 4120.9, orders30: 173,
  revenueTotal: 28640.0, itemsSold: 1240,
  productsAvailable: 18, productsTotal: 22,
  avgRating: 4.9, reviewCount: 214,
};

// Ordini ricevuti dal negozio (8 stati). cust = cliente, addr, items.
window.SC_ORDERS = [
  { id: 'PCA1F3', cust: 'Lucia Bianchi', addr: 'Via Roma 12', when: 'Oggi 10:24', status: 'NEW', total: 27.4, pay: 'cod',
    items: [{ kw: 'salami', lock: 7, name: 'Coppa Piacentina DOP 200g', q: 2, price: 7.12 }, { kw: 'cheese', lock: 3, name: 'Grana Padano DOP 18 mesi 1kg', q: 1, price: 17.01 }] },
  { id: 'PCB2K9', cust: 'Marco Rossi', addr: 'Via Cavour 48', when: 'Oggi 09:50', status: 'ACCEPTED', total: 23.0, pay: 'cod',
    items: [{ kw: 'prosciutto', lock: 3, name: 'Salame nostrano 300g', q: 2, price: 11.5 }] },
  { id: 'PCC7M2', cust: 'Anna Conti', addr: 'Via Borghetto 5', when: 'Oggi 09:12', status: 'READY', total: 17.8, pay: 'card',
    items: [{ kw: 'cheese', lock: 7, name: 'Grana Padano DOP 18 mesi 1kg', q: 1, price: 17.01 }] },
  { id: 'PCD4P8', cust: 'Davide Neri', addr: 'Stradone Farnese 22', when: 'Oggi 08:40', status: 'ASSIGNED', total: 35.6, pay: 'cod',
    items: [{ kw: 'salami', lock: 15, name: 'Coppa Piacentina DOP 200g', q: 4, price: 7.12 }] },
  { id: 'PCE9R1', cust: 'Sara Galli', addr: 'Via Taverna 9', when: 'Ieri 18:30', status: 'OUT_FOR_DELIVERY', total: 14.2, pay: 'card',
    items: [{ kw: 'prosciutto', lock: 7, name: 'Salame nostrano 300g', q: 1, price: 11.5 }] },
  { id: 'PCF3T6', cust: 'Paolo Ferri', addr: 'Via Genova 3', when: 'Ieri 16:10', status: 'DELIVERED', total: 42.3, pay: 'cod',
    items: [{ kw: 'cheese', lock: 15, name: 'Grana Padano DOP 18 mesi 1kg', q: 2, price: 17.01 }] },
  { id: 'PCG8W4', cust: 'Elena Vitali', addr: 'Via Alberoni 17', when: '14 giu', status: 'DELIVERED', total: 21.4, pay: 'card',
    items: [{ kw: 'salami', lock: 3, name: 'Coppa Piacentina DOP 200g', q: 3, price: 7.12 }] },
  { id: 'PCH1Z7', cust: 'Luca Moretti', addr: 'Via Scalabrini 30', when: '13 giu', status: 'CANCELED', total: 11.5, pay: 'cod',
    items: [{ kw: 'prosciutto', lock: 15, name: 'Salame nostrano 300g', q: 1, price: 11.5 }] },
];

window.SC_PRODUCTS = [
  { id: 'sp1', name: 'Coppa Piacentina DOP 200g', kw: 'salami', lock: 7, price: 8.9, discount: 20, stock: 12, status: 'available', sold: 184, cat: 'Salumi' },
  { id: 'sp2', name: 'Grana Padano DOP 18 mesi 1kg', kw: 'cheese', lock: 3, price: 18.9, discount: 10, stock: 8, status: 'available', sold: 142, cat: 'Formaggi' },
  { id: 'sp3', name: 'Salame nostrano stagionato 300g', kw: 'prosciutto', lock: 3, price: 11.5, discount: 0, stock: 6, status: 'available', sold: 97, cat: 'Salumi' },
  { id: 'sp4', name: 'Pancetta arrotolata 250g', kw: 'salami', lock: 3, price: 9.4, discount: 0, stock: 3, status: 'available', sold: 64, cat: 'Salumi' },
  { id: 'sp5', name: 'Gorgonzola DOP 200g', kw: 'cheese', lock: 15, price: 6.2, discount: 0, stock: 0, status: 'soldout', sold: 51, cat: 'Formaggi' },
  { id: 'sp6', name: 'Mostarda di Cremona 250g', kw: 'marmalade', lock: 7, price: 7.2, discount: 0, stock: 15, status: 'available', sold: 38, cat: 'Conserve' },
  { id: 'sp7', name: 'Culatello di Zibello 150g', kw: 'prosciutto', lock: 7, price: 14.0, discount: 0, stock: 4, status: 'available', sold: 29, cat: 'Salumi' },
  { id: 'sp8', name: 'Pecorino stagionato 300g', kw: 'cheese', lock: 7, price: 9.8, discount: 0, stock: 0, status: 'draft', sold: 0, cat: 'Formaggi' },
];

window.SC_CUSTOMERS = [
  { name: 'Lucia Bianchi', orders: 14, spent: 312.4, last: 'Oggi', initials: 'LB' },
  { name: 'Marco Rossi', orders: 9, spent: 198.0, last: 'Oggi', initials: 'MR' },
  { name: 'Paolo Ferri', orders: 7, spent: 164.5, last: 'Ieri', initials: 'PF' },
  { name: 'Elena Vitali', orders: 6, spent: 142.8, last: '14 giu', initials: 'EV' },
  { name: 'Sara Galli', orders: 5, spent: 98.2, last: 'Ieri', initials: 'SG' },
  { name: 'Davide Neri', orders: 4, spent: 87.6, last: 'Oggi', initials: 'DN' },
];

window.SC_REVIEWS = [
  { who: 'Marco B.', rating: 5, when: '2 giorni fa', product: 'Coppa Piacentina DOP', text: 'La vera coppa piacentina, come quella di mio nonno. Taglio perfetto, arrivata freschissima.', reply: null },
  { who: 'Giulia R.', rating: 5, when: '1 settimana fa', product: 'Grana Padano DOP', text: 'Stagionatura perfetta, granuloso e saporito. Si sente la qualità.', reply: 'Grazie Giulia! A presto 🙂' },
  { who: 'Anna T.', rating: 4, when: '1 settimana fa', product: 'Salame nostrano', text: 'Ottimo salame, magari un filo più di stagionatura. Consegna puntuale.', reply: null },
  { who: 'Paolo F.', rating: 5, when: '2 settimane fa', product: 'Coppa Piacentina DOP', text: 'Servizio impeccabile e prodotto top. Comodo pagare alla consegna.', reply: null },
];

window.SC_PROMOS = [
  { id: 'pr1', name: 'Sconto Coppa -20%', product: 'Coppa Piacentina DOP 200g', type: 'percent', value: 20, active: true, ends: '20 giu', used: 47 },
  { id: 'pr2', name: 'Grana -10%', product: 'Grana Padano DOP 18 mesi', type: 'percent', value: 10, active: true, ends: '30 giu', used: 23 },
  { id: 'pr3', name: 'Spedizione gratis weekend', product: 'Tutti i prodotti', type: 'shipping', value: 0, active: false, ends: '15 giu', used: 112 },
];

// Earnings: payout per ordine carta. cod = contanti (incassati dal rider).
window.SC_PAYOUTS = [
  { id: 'PCC7M2', when: 'Oggi', net: 15.6, status: 'HELD' },
  { id: 'PCE9R1', when: 'Ieri', net: 13.0, status: 'HELD' },
  { id: 'PCK22A', when: '13 giu', net: 38.9, status: 'TRANSFERRED', paidOn: '14 giu' },
  { id: 'PCK19B', when: '11 giu', net: 19.6, status: 'TRANSFERRED', paidOn: '12 giu' },
  { id: 'PCK08C', when: '8 giu', net: 27.2, status: 'TRANSFERRED', paidOn: '9 giu' },
];
window.SC_REVENUE_7D = [320, 410, 280, 520, 470, 610, 540]; // last 7 days gross
