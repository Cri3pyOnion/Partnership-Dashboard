// HTML for the public partner page. Every interpolated value goes through esc().
import { rm } from '../shared/money';
import { CASE_STEPS, STEP_CANCELLED } from '../shared/status';
import { PARTNER_CSS } from './partner-page.css';
import type { PartnerView, PartnerViewCase } from './view-model';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The one HTML escape helper. Covers & < > " '. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh">
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

function tile(label: string, en: string, value: string): string {
  return `<div class="tile"><span class="l">${esc(label)} <span class="en">${esc(en)}</span></span><span class="n">${esc(value)}</span></div>`;
}

function timeline(c: PartnerViewCase): string {
  const items = CASE_STEPS.map((s, i) => {
    let cls = '';
    if (c.step !== 'cancelled') cls = i < c.step ? 'done' : i === c.step ? (i === 5 ? 'done now' : 'now') : '';
    return `<li${cls ? ` class="${esc(cls)}"` : ''}>${esc(s)}</li>`;
  }).join('');
  return `<ol class="tl" aria-label="进度 Progress">${items}</ol>`;
}

function caseCard(c: PartnerViewCase): string {
  const cancelled = c.step === 'cancelled';
  const current = cancelled ? STEP_CANCELLED : CASE_STEPS[c.step as number];
  const missing = c.missingDocs && !cancelled
    ? `<p class="missing">需补文件 Missing documents · ${esc(c.missingDocs)}</p>`
    : '';
  const amount = c.amount === null ? '–' : rm(c.amount);
  return `<article class="case${cancelled ? ' cx' : ''}">
<div class="hd"><b>${esc(c.id)}</b><span>递交 ${esc(c.submittedAt)}</span></div>
<p class="client">${esc(c.clientName)}</p>
<p class="lic">${esc(c.licence)}</p>
<span class="badge${cancelled ? ' cxl' : ''}">${esc(current)}</span>
${missing}
${timeline(c)}
<div class="comm"><span>${esc(c.amountLabel)} <span class="amt">${esc(amount)}</span></span><span>${esc(c.commissionStatus)}</span></div>
</article>`;
}

export function renderPartnerPage(v: PartnerView, updatedAt: string): string {
  const { partner: p, tiles: t } = v;
  const b1 = p.code === 'B1'
    ? `<p class="note">此客户由你直接负责 – 请把文件清单转发给客户。</p>`
    : '';
  const cases = v.cases.length
    ? v.cases.map(caseCard).join('\n')
    : `<p class="empty">暂无案件 <span class="en">No cases yet</span></p>`;
  const months = v.months.length
    ? `<table><thead><tr><th>月份 <span class="en">Month</span></th><th class="r">合计 <span class="en">Total</span></th></tr></thead><tbody>${
      v.months.map((m) => `<tr><td>${esc(m.month)}</td><td class="r">${esc(rm(m.total))}</td></tr>`).join('')
    }</tbody></table>`
    : `<p class="empty">暂无记录 <span class="en">Nothing yet</span></p>`;
  const wa = v.whatsapp
    ? `<a class="wa" href="${esc(v.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp 联系市场部 <span class="en">Contact Marketing</span></a>`
    : '';

  const body = `<main>
<header class="top">
<p class="brand">Toh's Sign 伙伴门户 <span class="en">Partner Portal</span></p>
<h1>${esc(p.name)}</h1>
${p.company ? `<p class="co">${esc(p.company)}</p>` : ''}
<p class="meta"><span>伙伴编号 <span class="en">ID</span> <b>${esc(p.id)}</b></span><span>伙伴代码 <span class="en">Code</span> <b>${esc(p.code)}</b></span></p>
<p class="upd">更新于 ${esc(updatedAt)}</p>
${b1}
</header>
<section class="tiles" aria-label="概览 Summary">
${tile('进行中案件', 'Active', String(t.active))}
${tile('已完成', 'Done', String(t.done))}
${tile(t.pendingLabel, 'Pending', rm(t.pending))}
${tile(t.paidLabel, 'Paid', rm(t.paid))}
</section>
<h2>案件 <span class="en">Cases</span></h2>
${cases}
<h2>每月合计 <span class="en">Monthly totals</span></h2>
${months}
${wa}
<p class="foot">此页面仅供你本人查看，请勿转发链接。<br><span class="en">This page is private to you. Please do not share the link.</span></p>
</main>`;
  return shell(`${p.name} · 伙伴门户`, body);
}

export function renderInvalidLink(): string {
  return shell('链接无效', `<main class="msg"><h1>链接无效</h1><p>请向 Toh's Sign 索取新的链接。<br><span class="en">This link is not valid.</span></p></main>`);
}

export function renderUnavailable(): string {
  return shell('暂时无法加载', `<main class="msg"><h1>暂时无法加载，请稍后再试</h1><p><span class="en">Temporarily unavailable. Please try again later.</span></p></main>`);
}
