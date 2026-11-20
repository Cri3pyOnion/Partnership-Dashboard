import { describe, expect, it } from 'vitest';
import { forward } from '../../forwarder/index';

describe('old-address forwarder', () => {
  it('sends partner links to the same path on the new address, permanently', () => {
    const res = forward(new Request('https://partner-portal.tohssign.workers.dev/p/abc123?x=1'));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://portal.tohssign.workers.dev/p/abc123?x=1');
  });

  it('sends staff to the new login', () => {
    const res = forward(new Request('https://partner-portal.tohssign.workers.dev/admin/'));
    expect(res.headers.get('location')).toBe('https://portal.tohssign.workers.dev/admin/');
  });
});
