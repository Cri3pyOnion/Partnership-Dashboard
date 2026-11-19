import { describe, expect, it } from 'vitest';
import {
  caseFromRow, caseToRow, commissionFromRow, commissionToRow, documentFromRow, monthRange,
  partnerFromRow, partnerToRow, settingsFromRows, staffFromRow, staffToRow,
} from '../../src/worker/mapping';

describe('row mapping', () => {
  it('maps a partner row to camelCase with nulls kept', () => {
    const p = partnerFromRow({
      id: 'TSP0001', name: 'Ali', phone: '012', email: 'a@x.com', tin: null, company: 'Co', code: 'A1',
      referral_name: null, filled_by: 'IT', source: '线上', bank_name: 'MBB', bank_account: '1',
      status: '活跃', view_token: 'tok', registered_at: '2026-11-19', created_at: 'x', updated_at: 'y',
    });
    expect(p).toEqual({
      id: 'TSP0001', name: 'Ali', phone: '012', email: 'a@x.com', tin: null, company: 'Co', code: 'A1',
      referralName: null, filledBy: 'IT', source: '线上', bankName: 'MBB', bankAccount: '1',
      status: '活跃', viewToken: 'tok', registeredAt: '2026-11-19',
    });
  });

  it('maps a partner patch to a snake_case row, skipping undefined and id', () => {
    expect(partnerToRow({ id: 'X', bankName: null, referralName: 'R', status: '活跃', tin: undefined })).toEqual({
      bank_name: null, referral_name: 'R', status: '活跃',
    });
  });

  it('maps numeric strings and numbers to numbers, null to null', () => {
    const row = {
      id: 'TS-2611-001', partner_id: 'TSP0001', client_name: 'C', client_phone: null, licence_type: 'L', council: null,
      step: 2, cancelled: false, missing_docs: null, submitted_at: '2026-11-01', price: '1800.50', markup: 200, invoice_no: null,
      client_paid: true, client_paid_at: '2026-11-05', notes_internal: 'n',
    };
    const c = caseFromRow(row);
    expect(c.price).toBe(1800.5);
    expect(c.markup).toBe(200);
    expect(caseFromRow({ ...row, price: null, markup: '0.00' })).toMatchObject({ price: null, markup: 0 });
    expect(c).toMatchObject({ partnerId: 'TSP0001', clientPaid: true, clientPaidAt: '2026-11-05', step: 2 });
  });

  it('maps a case to a row, omitting undefined keys', () => {
    expect(caseToRow({ clientName: 'C', clientPaid: true, price: 10, submittedAt: '2026-11-01', council: undefined })).toEqual({
      client_name: 'C', client_paid: true, price: 10, submitted_at: '2026-11-01',
    });
  });

  it('normalises commission timestamps and amounts', () => {
    const c = commissionFromRow({
      case_id: 'TS-2611-001', code: 'B1', amount: '120.00', basis: 'b', status: '已结清',
      paid_at: '2026-11-12T03:00:00+00:00', paid_by: 'a@x.com', updated_at: 'z', cases: { partner_id: 'TSP0001' },
    });
    expect(c).toEqual({ caseId: 'TS-2611-001', code: 'B1', amount: 120, basis: 'b', status: '已结清', paidAt: '2026-11-12T03:00:00.000Z', paidBy: 'a@x.com' });
    expect(commissionToRow(c)).toEqual({
      case_id: 'TS-2611-001', code: 'B1', amount: 120, basis: 'b', status: '已结清', paid_at: '2026-11-12T03:00:00.000Z', paid_by: 'a@x.com',
    });
  });

  it('maps staff and documents', () => {
    const s = { email: 'a@x.com', name: 'A', role: 'admin' as const, team: null, active: true };
    expect(staffFromRow(staffToRow(s))).toEqual(s);
    expect(documentFromRow({
      id: 'u', case_id: 'C', storage_path: 'p', filename: 'f', kind: null, uploaded_by: null, uploaded_at: '2026-11-19T00:00:00+00:00',
    })).toEqual({ id: 'u', caseId: 'C', storagePath: 'p', filename: 'f', kind: '', uploadedBy: '', uploadedAt: '2026-11-19T00:00:00.000Z' });
  });

  it('assembles settings from key/value rows and falls back to defaults', () => {
    const s = settingsFromRows([{ key: 'inactive_days', value: 30 }, { key: 'licence_types', value: ['a'] }]);
    expect(s.inactiveDays).toBe(30);
    expect(s.licenceTypes).toEqual(['a']);
    expect(s.commissionRules.A1.threshold).toBe(1500);
  });

  it('computes month ranges and rejects bad months', () => {
    expect(monthRange('2026-11')).toEqual(['2026-11-01', '2026-12-01']);
    expect(monthRange('2026-12')).toEqual(['2026-12-01', '2027-01-01']);
    expect(() => monthRange('2026-13')).toThrow();
    expect(() => monthRange('nov')).toThrow();
  });
});
