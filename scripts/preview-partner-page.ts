// Renders the partner page from demo data to dist/preview/partner.html for a browser check.
// Run: npm run preview:partner
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Case } from '../src/shared/types';
import { renderPartnerPage } from '../src/worker/partner-page';
import { klStamp } from '../src/worker/view-cache';
import { buildPartnerView } from '../src/worker/view-model';
import { demoCases, demoCommissions, demoPartner } from '../test/fixtures/demo';

const cancelled: Case = {
  ...demoCases()[0],
  id: 'TS-2611-016',
  clientName: 'Lim & Co. <Accounting>',
  licenceType: 'SSM 公司注册',
  council: null,
  step: 1,
  cancelled: true,
  submittedAt: '2026-11-05',
  markup: 200,
};
const cases = [...demoCases(), cancelled];
const view = buildPartnerView(demoPartner(), cases, demoCommissions(cases, 'C1'), '+60 12-345 6789');
const stamp = klStamp(new Date());
const html = renderPartnerPage(view, stamp);
const htmlEn = renderPartnerPage(view, stamp, 'en');

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'preview', 'partner.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
writeFileSync(out.replace(/\.html$/, '-en.html'), htmlEn);
console.log(`Wrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
