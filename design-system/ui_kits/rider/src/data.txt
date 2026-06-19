// MyCity Rider — demo data (plain globals; loaded before app.js).
window.RD_RIDER = { name: 'Giulia Ferrari', initials: 'GF', rating: 4.8, deliveries: 312, vehicle: 'Bici elettrica', zone: 'Centro storico' };

window.RD_KPI = { todayEarned: 24.5, todayDeliveries: 5, weekEarned: 184.3, weekDeliveries: 38, avgPerDelivery: 4.85, onlineHours: 6.5 };

// Consegne. status: il flusso rider ASSIGNED→PICKED_UP→OUT_FOR_DELIVERY→DELIVERED
window.RD_ACTIVE = {
  id: 'PCD4P8', store: 'Salumeria Verdi', storeAddr: 'Via Roma 18, Centro', storeInitials: 'SV',
  cust: 'Davide Neri', custAddr: 'Stradone Farnese 22', custPhone: '+39 333 98 76 543',
  status: 'ASSIGNED', fee: 4.9, pay: 'cod', total: 35.6, items: 4, distance: '1,2 km', eta: '8 min',
};

window.RD_AVAILABLE = [
  { id: 'PCC7M2', store: 'Salumeria Verdi', storeAddr: 'Via Roma 18', cust: 'Anna Conti', custAddr: 'Via Borghetto 5, Centro', fee: 4.9, status: 'READY', distance: '0,8 km', items: 1, pay: 'card' },
  { id: 'PCJ5N3', store: 'Pasta Fresca Anita', storeAddr: 'Via Borgo 9', cust: 'Marco Galli', custAddr: 'Via Taverna 14, Centro', fee: 5.4, status: 'READY', distance: '1,5 km', items: 3, pay: 'cod' },
  { id: 'PCK8M1', store: 'Forno Borgo', storeAddr: 'Via Borgo 2', cust: 'Elena Vitali', custAddr: 'Via Alberoni 17', fee: 4.5, status: 'READY', distance: '2,1 km', items: 2, pay: 'cod' },
];

window.RD_PREP = [
  { id: 'PCB2K9', store: 'Salumeria Verdi', cust: 'Marco Rossi', custAddr: 'Via Cavour 48', fee: 4.9, status: 'ACCEPTED', distance: '1,0 km', items: 2 },
];

window.RD_HISTORY = [
  { id: 'PCF3T6', store: 'Salumeria Verdi', cust: 'Paolo Ferri', when: 'Oggi 13:20', fee: 4.9, pay: 'cod' },
  { id: 'PCG8W4', store: 'Pasta Fresca Anita', cust: 'Sara Galli', when: 'Oggi 12:05', fee: 5.4, pay: 'card' },
  { id: 'PCH2A1', store: 'Forno Borgo', cust: 'Luca Moretti', when: 'Oggi 11:10', fee: 4.5, pay: 'cod' },
  { id: 'PCK19B', store: 'Salumeria Verdi', cust: 'Anna Conti', when: 'Ieri 19:40', fee: 4.9, pay: 'card' },
  { id: 'PCK08C', store: 'Cantina Pace', cust: 'Davide Neri', when: 'Ieri 18:15', fee: 5.8, pay: 'cod' },
];

window.RD_EARN_7D = [18.5, 24.0, 12.5, 28.4, 22.0, 31.5, 24.5];
window.RD_ZONES = [
  { name: 'Centro storico', on: true }, { name: 'Borgo', on: true },
  { name: 'Farnesiana', on: false }, { name: 'Besurica', on: false },
];
