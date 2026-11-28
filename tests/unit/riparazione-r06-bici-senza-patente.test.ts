import { describe, it, expect } from 'vitest';
import {
  COLONNE_PER_APPROVARE,
  RC_OBBLIGATORIA_PER_LA_BICI,
  documentiObbligatoriDelFattorino,
  motivoPerNonApprovare,
} from '@/lib/admin/regole-approvazione';

/**
 * R06 (27/11/2026) — Il fattorino in bici si approva senza patente né polizza RC; chi va a
 * motore no.
 *
 * La regola giusta c'è già (lib/admin/regole-approvazione.ts, documentiObbligatoriDelFattorino):
 * questa prova la fissa su tutta la tabella dei mezzi, comprese le righe che le prove di prima
 * non guardavano (scooter e auto senza polizza, bici sospesa da riattivare). La data è fissa:
 * niente orologio vero.
 */

const OGGI = '2026-11-27';
const DOCUMENTO = { kyc_id_doc_front_url: 'kyc/fronte.jpg', kyc_selfie_url: 'kyc/selfie.jpg' };
const PATENTE = { rider_license_url: 'kyc/patente.jpg', rider_license_expires_on: '2030-01-31' };
const POLIZZA = { rider_insurance_url: 'kyc/rc.pdf', rider_insurance_expires_on: '2027-06-30' };

describe('i documenti del fattorino dipendono dal mezzo', () => {
  it('in bici, normale o elettrica, bastano documento e selfie: niente patente, niente polizza', () => {
    for (const mezzo of ['BIKE', 'EBIKE']) {
      const profilo = {
        role: 'rider',
        approval_status: 'pending',
        rider_vehicle_type: mezzo,
        ...DOCUMENTO,
        rider_license_url: null,
        rider_insurance_url: null,
      };
      expect(motivoPerNonApprovare(profilo, 'approve', OGGI), mezzo).toBeNull();
      expect(documentiObbligatoriDelFattorino(mezzo).map((d) => d.colonna), mezzo).toEqual([
        'kyc_id_doc_front_url',
        'kyc_selfie_url',
      ]);
    }
    // L'interruttore della polizza della bici resta spento finché Nicola non la rimette.
    expect(RC_OBBLIGATORIA_PER_LA_BICI).toBe(false);
  });

  it('in bici senza documento o senza selfie non si approva', () => {
    expect(
      motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'BIKE', kyc_selfie_url: 'kyc/selfie.jpg' }, 'approve', OGGI),
    ).toMatch(/documento d'identità/);
    expect(
      motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: 'EBIKE', kyc_id_doc_front_url: 'kyc/fronte.jpg' }, 'approve', OGGI),
    ).toMatch(/selfie/);
  });

  it('a motore (scooter o auto) senza patente non si approva', () => {
    for (const mezzo of ['SCOOTER', 'CAR']) {
      const motivo = motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: mezzo, ...DOCUMENTO, ...POLIZZA }, 'approve', OGGI);
      expect(motivo, mezzo).toMatch(/patente/);
      expect(motivo, mezzo).not.toMatch(/polizza/);
    }
  });

  it('a motore (scooter o auto) senza polizza RC non si approva', () => {
    for (const mezzo of ['SCOOTER', 'CAR']) {
      const motivo = motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: mezzo, ...DOCUMENTO, ...PATENTE }, 'approve', OGGI);
      expect(motivo, mezzo).toMatch(/polizza RC/);
      expect(motivo, mezzo).not.toMatch(/patente/);
    }
  });

  it('a motore con patente e polizza valide si approva; con una scaduta no', () => {
    for (const mezzo of ['SCOOTER', 'CAR']) {
      expect(
        motivoPerNonApprovare({ role: 'rider', rider_vehicle_type: mezzo, ...DOCUMENTO, ...PATENTE, ...POLIZZA }, 'approve', OGGI),
        mezzo,
      ).toBeNull();
      expect(
        motivoPerNonApprovare(
          { role: 'rider', rider_vehicle_type: mezzo, ...DOCUMENTO, ...PATENTE, ...POLIZZA, rider_insurance_expires_on: '2026-11-26' },
          'approve',
          OGGI,
        ),
        mezzo,
      ).toMatch(/polizza RC scaduta il 26\/11\/2026/);
    }
  });

  it('senza mezzo dichiarato si chiede tutto, come prima (via prudente), e la rotta legge il mezzo', () => {
    expect(motivoPerNonApprovare({ role: 'rider', approval_status: 'pending', ...DOCUMENTO }, 'approve', OGGI)).toMatch(
      /patente, polizza RC/,
    );
    expect(COLONNE_PER_APPROVARE.split(',').map((c) => c.trim())).toContain('rider_vehicle_type');
  });

  it('il fattorino in bici sospeso dallo staff si riattiva senza patente né polizza', () => {
    expect(
      motivoPerNonApprovare(
        { role: 'rider', approval_status: 'suspended', approved_by: 'staff-1', rider_vehicle_type: 'BIKE', ...DOCUMENTO },
        'reactivate',
        OGGI,
      ),
    ).toBeNull();
  });

  it('le regole del negozio non cambiano: senza partita IVA non si approva', () => {
    expect(motivoPerNonApprovare({ role: 'seller', rider_vehicle_type: 'BIKE' }, 'approve', OGGI)).toMatch(/partita IVA/);
    expect(motivoPerNonApprovare({ role: 'buyer', rider_vehicle_type: 'BIKE' }, 'approve', OGGI)).toBeNull();
  });
});
