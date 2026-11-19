import { describe, expect, it } from 'vitest';
import { caseUpdateMessage, inactiveMessage, whatsappLink } from '../../src/shared/whatsapp';

describe('caseUpdateMessage', () => {
  const c = { id: 'TS-2611-014', clientName: 'Kedai Kopi Ah Seng', step: 2 as const, cancelled: false };

  it('uses the exact format with the step name and the link', () => {
    expect(caseUpdateMessage(c, 'https://x.my/p/abc')).toBe(
      '案件 TS-2611-014（Kedai Kopi Ah Seng）进度更新：已递交政府部门。查看：https://x.my/p/abc',
    );
  });

  it('says 已取消 for a cancelled case', () => {
    expect(caseUpdateMessage({ ...c, cancelled: true }, 'L')).toContain('进度更新：已取消。');
  });
});

describe('inactiveMessage', () => {
  it('greets the partner by name', () => {
    expect(inactiveMessage({ name: 'Ali' })).toBe("您好 Ali，好久不见！Toh's Sign 最近有新服务，欢迎随时联系我们。");
  });
});

describe('whatsappLink', () => {
  it('keeps digits only', () => {
    expect(whatsappLink('+60 12-338', 'hi')).toBe('https://wa.me/6012338?text=hi');
  });
});
