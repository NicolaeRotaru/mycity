/**
 * «La chat di assistenza esiste ma il cliente non ha nessun modo per aprirla» — radiografia del
 * design del 22/8, dimensione Navigazione, gravità grave.
 *
 * Il canale c'era, era nel pacchetto, e per chi compra non aveva nessuna maniglia: il pulsante
 * flottante si nascondeva ai compratori rimandando a una scheda della barra in basso che non è mai
 * stata costruita, e il menu dell'account offriva solo le FAQ.
 *
 * Questa prova ESEGUE la decisione. Cercare `isBuyer` nel componente non distinguerebbe «tolto» da
 * «spostato»: il difetto è nato proprio da una decisione presa in un posto e scritta in un altro.
 */
import { describe, it, expect } from 'vitest';
import {
  pulsanteAssistenzaVisibile,
  ruoloAssistenza,
  stradaSenzaPulsante,
  type ChiGuarda,
} from '@/lib/assistenza/porta';

const chiunque: ChiGuarda = {
  isAuthenticated: true,
  isAdmin: false,
  isSeller: false,
  isRider: false,
  isBuyer: false,
};
const compratore: ChiGuarda = { ...chiunque, isBuyer: true };
const venditore: ChiGuarda = { ...chiunque, isSeller: true };
const fattorino: ChiGuarda = { ...chiunque, isRider: true };
const amministratore: ChiGuarda = { ...chiunque, isAdmin: true };

describe('la porta dell\'assistenza', () => {
  it('chi compra la vede: è il difetto che chiudiamo', () => {
    expect(pulsanteAssistenzaVisibile(compratore, '/orders')).toBe(true);
    expect(pulsanteAssistenzaVisibile(compratore, '/')).toBe(true);
    expect(pulsanteAssistenzaVisibile(compratore, '/cart')).toBe(true);
  });

  it('chi compra si presenta come compratore, non come ripiego di qualcun altro', () => {
    expect(ruoloAssistenza(compratore)).toBe('buyer');
    expect(ruoloAssistenza(venditore)).toBe('seller');
    expect(ruoloAssistenza(fattorino)).toBe('rider');
  });

  it('chi vendeva e chi consegna continuano a vederla come prima', () => {
    expect(pulsanteAssistenzaVisibile(venditore, '/seller/orders')).toBe(true);
    expect(pulsanteAssistenzaVisibile(fattorino, '/rider/history')).toBe(true);
  });

  it('senza accesso non si apre: non ci sarebbe un thread a cui attaccarla', () => {
    expect(pulsanteAssistenzaVisibile({ ...compratore, isAuthenticated: false }, '/')).toBe(false);
  });

  it('per l\'amministratore resta nascosta', () => {
    expect(pulsanteAssistenzaVisibile(amministratore, '/admin')).toBe(false);
  });

  it('non compare durante l\'accesso né dentro un thread di messaggi', () => {
    for (const strada of ['/sign-in', '/sign-up', '/reset-password', '/auth/callback', '/messages/abc123']) {
      expect(stradaSenzaPulsante(strada)).toBe(true);
      expect(pulsanteAssistenzaVisibile(compratore, strada)).toBe(false);
    }
  });

  it('l\'elenco dei messaggi non è un thread: lì il pulsante resta', () => {
    expect(stradaSenzaPulsante('/messages')).toBe(false);
    expect(pulsanteAssistenzaVisibile(compratore, '/messages')).toBe(true);
  });
});
