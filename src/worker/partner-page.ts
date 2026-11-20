// HTML for the public partner page. Every interpolated value goes through esc().
import { type Lang, tr } from '../shared/i18n';
import { rm } from '../shared/money';
import { CASE_STEPS, STEP_CANCELLED } from '../shared/status';
import { PARTNER_CSS } from './partner-page.css';
import type { MoneyKind, PartnerView, PartnerViewCase } from './view-model';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The one HTML escape helper. Covers & < > " '. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
}

function shell(title: string, body: string, lang: Lang = 'zh'): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${PARTNER_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** A label: Chinese with small English after it, or English alone on the English page. */
function both(lang: Lang, zh: string, en: string): string {
  return lang === 'en' ? esc(en) : `${esc(zh)} <span class="en">${esc(en)}</span>`;
}

/** EN | 中文 at the top right; each link reloads the page in that language and remembers it. */
function langSwitch(lang: Lang): string {
  const a = (l: Lang, text: string) =>
    l === lang ? `<b aria-current="true">${text}</b>` : `<a href="?lang=${l}" hreflang="${l}">${text}</a>`;
  return `<nav class="lang" aria-label="Language / 语言">${a('en', 'EN')} <span aria-hidden="true">|</span> ${a('zh', '中文')}</nav>`;
}

function tile(lang: Lang, label: string, en: string, value: string, cls = ''): string {
  return `<div class="tile${cls ? ` ${cls}` : ''}"><span class="l">${both(lang, label, en)}</span><span class="n">${esc(value)}</span></div>`;
}

function timeline(c: PartnerViewCase, lang: Lang): string {
  const items = CASE_STEPS.map((s, i) => {
    let cls = '';
    if (c.step !== 'cancelled') cls = i < c.step ? 'done' : i === c.step ? (i === 5 ? 'done now' : 'now') : '';
    return `<li${cls ? ` class="${esc(cls)}"` : ''}>${esc(tr(lang, s))}</li>`;
  }).join('');
  return `<ol class="tl" aria-label="${lang === 'en' ? 'Progress' : '进度 Progress'}">${items}</ol>`;
}

function caseCard(c: PartnerViewCase, lang: Lang): string {
  const cancelled = c.step === 'cancelled';
  const current = cancelled ? STEP_CANCELLED : CASE_STEPS[c.step as number];
  const missing = c.missingDocs && !cancelled
    ? `<p class="missing">${lang === 'en' ? 'Missing documents' : '需补文件 Missing documents'} · ${esc(c.missingDocs)}</p>`
    : '';
  const amount = c.amount === null ? '–' : rm(c.amount);
  return `<article class="case${cancelled ? ' cx' : ''}">
<div class="hd"><b>${esc(c.id)}</b><span>${lang === 'en' ? 'Submitted' : '递交'} ${esc(c.submittedAt)}</span></div>
<p class="client">${esc(c.clientName)}</p>
<p class="lic">${esc(tr(lang, c.licence))}</p>
<span class="badge${cancelled ? ' cxl' : ''}">${esc(tr(lang, current))}</span>
${missing}
${timeline(c, lang)}
<div class="comm"><span>${esc(tr(lang, c.amountLabel))} <span class="amt">${esc(amount)}</span></span><span>${esc(tr(lang, c.commissionStatus))}</span></div>
</article>`;
}

export function renderPartnerPage(v: PartnerView, updatedAt: string, lang: Lang = 'zh'): string {
  const { partner: p, tiles: t } = v;
  const en = lang === 'en';
  const b1 = p.code === 'B1'
    ? `<p class="note">${en ? 'You handle this client directly – please forward the document list to them.' : '此客户由你直接负责 – 请把文件清单转发给客户。'}</p>`
    : '';
  const cases = v.cases.length
    ? v.cases.map((c) => caseCard(c, lang)).join('\n')
    : `<p class="empty">${both(lang, '暂无案件', 'No cases yet')}</p>`;
  // One column per kind of money; A1/C1 commission and B1 amounts owed are never added together.
  const heads: Record<MoneyKind, string> = {
    commission: both(lang, '佣金', 'Commission'),
    b1: en ? esc("Owed to Toh's Sign") : `${esc("应付 Toh's Sign")} <span class="en">Owed</span>`,
  };
  const kinds = v.monthKinds;
  const head = kinds.length > 1
    ? kinds.map((k) => `<th class="r">${heads[k]}</th>`).join('')
    : `<th class="r">${both(lang, '合计', 'Total')}</th>`;
  const months = v.months.length
    ? `<table><thead><tr><th>${both(lang, '月份', 'Month')}</th>${head}</tr></thead><tbody>${
      v.months.map((m) => `<tr><td>${esc(m.month)}</td>${kinds.map((k) => `<td class="r">${esc(rm(m[k]))}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`
    : `<p class="empty">${both(lang, '暂无记录', 'Nothing yet')}</p>`;
  const wa = v.whatsapp
    ? `<a class="wa" href="${esc(v.whatsapp)}" target="_blank" rel="noopener noreferrer">${
      en ? 'Contact Marketing on WhatsApp' : 'WhatsApp 联系 Marketing <span class="en">Contact Marketing</span>'
    }</a>`
    : '';
  // Money tiles: in English the tile's own label is the English for the Chinese one.
  const moneyTile = (zh: string, enWord: string, value: number) =>
    tile(lang, zh, en ? tr(lang, zh) : enWord, rm(value));

  const body = `<main>
${langSwitch(lang)}
<header class="top">
<p class="brand">${en ? "Toh's Sign Partner Portal" : "Toh's Sign 伙伴门户 <span class=\"en\">Partner Portal</span>"}</p>
<h1>${esc(p.name)}</h1>
${p.company ? `<p class="co">${esc(p.company)}</p>` : ''}
<p class="meta"><span>${en ? 'Partner ID' : '伙伴编号 <span class="en">ID</span>'} <b>${esc(p.id)}</b></span><span>${en ? 'Code' : '伙伴代码 <span class="en">Code</span>'} <b>${esc(p.code)}</b></span></p>
<p class="upd">${en ? 'Updated' : '更新于'} ${esc(updatedAt)}</p>
${b1}
</header>
<section class="tiles five" aria-label="${en ? 'Case summary' : '案件概览 Case summary'}">
${tile(lang, '推荐案件', 'Total referred', String(t.total))}
${tile(lang, '进行中', 'Active', String(t.active))}
${tile(lang, '已完成', 'Done', String(t.done))}
${tile(lang, '已放弃', 'Dropped', String(t.dropped))}
${tile(lang, '有效率', 'Active pipeline rate', t.pipelineRate === null ? '—' : `${t.pipelineRate}%`, 'rate')}
</section>
<section class="tiles" aria-label="${en ? 'Money summary' : '佣金概览 Money summary'}">
${t.money.map((m) => `${moneyTile(m.pendingLabel, 'Pending', m.pending)}\n${moneyTile(m.paidLabel, 'Paid', m.paid)}`).join('\n')}
</section>
<h2>${both(lang, '案件', 'Cases')}</h2>
${cases}
<h2>${both(lang, '每月合计', 'Monthly totals')}</h2>
${months}
${wa}
<p class="foot">${
    en
      ? 'This page is private to you. Please do not share the link.'
      : '此页面仅供你本人查看，请勿转发链接。<br><span class="en">This page is private to you. Please do not share the link.</span>'
  }</p>
</main>`;
  return shell(en ? `${p.name} · Partner Portal` : `${p.name} · 伙伴门户`, body, lang);
}

export function renderInvalidLink(lang: Lang = 'zh'): string {
  if (lang === 'en') {
    return shell(
      'Link not valid',
      `<main class="msg">${langSwitch(lang)}<h1>This link is not valid</h1><p>Please ask Toh's Sign for a new link.</p></main>`,
      lang,
    );
  }
  return shell('链接无效', `<main class="msg">${langSwitch(lang)}<h1>链接无效</h1><p>请向 Toh's Sign 索取新的链接。<br><span class="en">This link is not valid.</span></p></main>`);
}

export function renderUnavailable(lang: Lang = 'zh'): string {
  if (lang === 'en') {
    return shell(
      'Temporarily unavailable',
      `<main class="msg">${langSwitch(lang)}<h1>Temporarily unavailable</h1><p>Please try again later.</p></main>`,
      lang,
    );
  }
  return shell('暂时无法加载', `<main class="msg">${langSwitch(lang)}<h1>暂时无法加载，请稍后再试</h1><p><span class="en">Temporarily unavailable. Please try again later.</span></p></main>`);
}
