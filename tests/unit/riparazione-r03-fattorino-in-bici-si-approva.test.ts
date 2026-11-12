import { describe, it, expect } from 'vitest';
import { COLONNE_PER_APPROVARE, motivoPerNonApprovare } from '@/lib/admin/regole-approvazione';

/**
 * R03-024 — Il fattorino in bici si può approvare senza patente di guida e polizza RC.
 *
 * La regola chiedeva sempre documento, selfie, patente e polizza, qualunque fosse il mezzo
 * (e il mezzo non lo leggeva nemmeno). Si consegna in bici fino a 5 km
 * (logistica.bici-consegna) e la RC della bici arriva dopo il lancio per scelta di Nicola
 * (rischi.scelti-al-lancio): chi consegna in bici non arrivava mai all'approvazione.
 */

const OGGI = '2026-11-12';
const DOCUMENTO = { kyc_id_doc_front_url: 'doc.jpg', kyc_selfie_url: 'selfie.jpg' };

describe('R03-024 — i documenti del fattorino dipendono dal mezzo', () => {
  it('in bici con documento e selfie si approva, senza patente né polizza', () => {
    expect(motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'BIKE', ...DOCUMENTO }, 'approve', OGGI)).toBeNull();
    expect(motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'EBIKE', ...DOCUMENTO }, 'approve', OGGI)).toBeNull();
  });

  it('in bici senza documento o selfie non si approva', () => {
    expect(motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'BIKE', kyc_selfie_url: 'selfie.jpg' }, 'approve', OGGI)).toMatch(/documento/);
  });

  it('in auto la patente serve ancora, con la sua scadenza', () => {
    expect(motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'CAR', ...DOCUMENTO, rider_insurance_url: 'rc.pdf', rider_insurance_expires_on: '2027-01-01' }, 'approve', OGGI)).toMatch(/patente/);
    expect(motivoPerNonApprovare({
      role: 'rider', rider_vehicle_type: 'SCOOTER', ...DOCUMENTO,
      rider_license_url: 'p.jpg', rider_license_expires_on: '2026-10-31', rider_insurance_url: 'rc.pdf', rider_insurance_expires_on: '2027-01-01',
    }, 'approve', OGGI)).toMatch(/patente scaduta/);
  });

  it('in bici con una polizza caricata ma scaduta non si approva (un documento dato si guarda)', () => {
    expect(motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'BIKE', ...DOCUMENTO, rider_insurance_url: 'rc.pdf', rider_insurance_expires_on: '2026-01-01' }, 'approve', OGGI)).toMatch(/polizza RC scaduta/);
  });

  it('senza mezzo dichiarato si chiede tutto, come prima; la rotta legge il mezzo', () => {
    expect(motivoPerNonApprovare({ role: 'rider', ...DOCUMENTO }, 'approve', OGGI)).toMatch(/patente/);
    expect(COLONNE_PER_APPROVARE).toContain('rider_vehicle_type');
  });
});
