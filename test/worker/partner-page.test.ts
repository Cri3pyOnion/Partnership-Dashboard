import { describe, expect, it } from 'vitest';
import { CASE_STEPS } from '../../src/shared/status';
import { esc, renderInvalidLink, renderPartnerPage, renderUnavailable } from '../../src/worker/partner-page';
import { buildPartnerView } from '../../src/worker/view-model';
import { demoCases, demoCommissions, demoPartner } from '../fixtures/demo';

function page(code: 'A1' | 'B1' | 'C1' = 'C1', wa = '60123456789') {
  const cases = demoCases();
  cases[0] = { ...cases[0], clientName: 'Lim & Co. <Accounting>' };
  const v = buildPartnerView(demoPartner({ code }), cases, demoCommissions(cases, code), wa);
  return renderPartnerPage(v, '2026-11-19 14:05');
}

describe('esc', () => {
  it('escapes & < > " \'', () => {
    expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });
});

describe('renderPartnerPage', () => {
  it('escapes the client name', () => {
    const html = page();
    expect(html).toContain('Lim &amp; Co. &lt;Accounting&gt;');
    expect(html).not.toContain('<Accounting>');
  });

  it('contains 更新于, all six steps, a wa.me link and the robots meta', () => {
    const html = page();
    expect(html).toContain('更新于 2026-11-19 14:05');
    for (const s of CASE_STEPS) expect(html).toContain(s);
    expect(html).toContain('href="https://wa.me/60123456789?text=');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<html lang="zh">');
  });

  it('shows money with rm(), the missing docs highlighted, and no script', () => {
    const html = page();
    expect(html).toContain('RM 300');
    expect(html).toMatch(/class="missing"[^>]*>[^<]*缺少：租约/);
    expect(html).not.toMatch(/<script/i);
    expect(new TextEncoder().encode(html).length).toBeLessThan(30 * 1024);
  });

  it('shows the B1 line only for B1 partners', () => {
    const line = '此客户由你直接负责 – 请把文件清单转发给客户。';
    expect(page('B1')).toContain(line);
    expect(page('B1')).toContain('应付 Toh&#39;s Sign');
    expect(page('C1')).not.toContain(line);
  });

  it('omits the WhatsApp button when there is no number', () => {
    expect(page('C1', '')).not.toContain('wa.me');
  });

  it('a mixed-code partner sees both tile pairs and two monthly columns', () => {
    const cases = demoCases();
    const comms = [...demoCommissions(cases.slice(0, 3), 'C1'), ...demoCommissions(cases.slice(3), 'B1')];
    const html = renderPartnerPage(buildPartnerView(demoPartner({ code: 'B1' }), cases, comms, ''), '2026-11-19 14:05');
    for (const label of ['待发佣金', '已发佣金', '待付给 Toh&#39;s Sign', '已与 Toh&#39;s Sign 结清']) expect(html).toContain(label);
    expect(html).toContain('<th class="r">佣金 <span class="en">Commission</span></th>');
    expect(html).toContain('<th class="r">应付 Toh&#39;s Sign <span class="en">Owed</span></th>');
    expect(html).not.toContain('合计 <span class="en">Total</span>');
  });

  it('a single-code partner sees one tile pair and one total column', () => {
    const html = page('C1');
    expect(html).toContain('待发佣金');
    expect(html).not.toContain('待付给 Toh');
    expect(html).toContain('合计 <span class="en">Total</span>');
  });

  it('shows an en dash for a missing amount', () => {
    const html = renderPartnerPage(buildPartnerView(demoPartner(), [demoCases()[0]], [], ''), '2026-11-19 14:05');
    expect(html).toContain('<span class="amt">–</span>');
    expect(html).not.toContain('—');
  });

  it('shows 已取消 for a cancelled case', () => {
    const cases = [{ ...demoCases()[0], cancelled: true }];
    const html = renderPartnerPage(buildPartnerView(demoPartner(), cases, [], ''), '2026-11-19 14:05');
    expect(html).toContain('已取消');
  });
});

describe('error pages', () => {
  it('invalid link and unavailable pages', () => {
    for (const [html, text] of [[renderInvalidLink(), '链接无效'], [renderUnavailable(), '暂时无法加载，请稍后再试']]) {
      expect(html).toContain(text);
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('<meta name="referrer" content="no-referrer">');
      expect(html).toContain('<html lang="zh">');
    }
  });
});
