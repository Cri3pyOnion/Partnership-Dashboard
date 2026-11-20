import { describe, expect, it } from 'vitest';
import { CASE_STEPS, STEP_CANCELLED } from '../../src/shared/status';
import { EN, acceptLanguages, english, langFromPreferences, tr } from '../../src/shared/i18n';

describe('language choice', () => {
  it('follows the browser: English only when the first language is English', () => {
    expect(langFromPreferences(['en-GB', 'zh-CN'])).toBe('en');
    expect(langFromPreferences(['EN'])).toBe('en');
    expect(langFromPreferences(['zh-CN', 'en'])).toBe('zh');
    expect(langFromPreferences(['ms-MY', 'en'])).toBe('zh');
    expect(langFromPreferences([])).toBe('zh');
  });

  it('reads Accept-Language best first, ignoring q=0 and *', () => {
    expect(acceptLanguages('zh-CN;q=0.5, en-US, *;q=0.1')).toEqual(['en-US', 'zh-CN']);
    expect(acceptLanguages('en;q=0, zh')).toEqual(['zh']);
    expect(acceptLanguages(null)).toEqual([]);
  });
});

describe('dictionary', () => {
  it('keeps surrounding spaces and leaves unknown text alone', () => {
    expect(english(' 伙伴 ')).toBe(' Partner ');
    expect(english('陈先生')).toBeNull();
    expect(tr('en', '陈先生')).toBe('陈先生');
    expect(tr('zh', '伙伴')).toBe('伙伴');
  });

  it('fills in numbers and amounts', () => {
    expect(english('请求失败（503）')).toBe('Request failed (503)');
    expect(english('伙伴价 = RM 1,800 的 80%')).toBe('Partner price = 80% of RM 1,800');
    expect(english('在 RM 1,800 上加价（客户支付 RM 2,100）')).toBe('Markup on RM 1,800 (client pays RM 2,100)');
    expect(english('营业执照 (MBPJ)')).toBe('Business licence (MBPJ)');
    expect(english('清真认证 (JAKIM)')).toBe('Halal certification (JAKIM)');
    expect(english('陈氏 (KL)')).toBeNull();
  });

  it('has English for every case stage and commission status', () => {
    for (const s of [...CASE_STEPS, STEP_CANCELLED, '待处理', '可发放', '已支付', '待付发票', '已结清']) {
      expect(EN[s], s).toBeTruthy();
    }
  });

  it('never maps to text that still has Chinese in it', () => {
    for (const [zh, en] of Object.entries(EN)) expect(/[一-鿿]/.test(en), zh).toBe(false);
  });
});
