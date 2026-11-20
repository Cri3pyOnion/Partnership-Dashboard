// Inline stylesheet for the partner page and its error pages. Mobile-first; no external assets.
export const PARTNER_CSS = `
:root{--bg:#f4f5f7;--card:#fff;--ink:#1d2330;--muted:#5f6b7a;--line:#e3e6eb;--brand:#b3261e;--brand-ink:#fff;
--ok:#1f7a4d;--ok-bg:#e6f4ec;--warn:#8a5a00;--warn-bg:#fff4d6;--off:#9aa3ae;--wa:#1a8f4c}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--ink:#e8ebef;--muted:#9aa4b1;--line:#2d333c;
--brand:#e0574f;--ok:#5cc28d;--ok-bg:#183326;--warn:#f0c45a;--warn-bg:#3a2f12;--off:#5d6672;--wa:#2bb168}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}
main{max-width:640px;margin:0 auto;padding:16px 16px 40px}
h1{font-size:20px;margin:0 0 2px}
h2{font-size:16px;margin:24px 0 10px}
small,.en{color:var(--muted);font-size:12px;font-weight:400}
.top{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.top .brand{color:var(--brand);font-weight:600;font-size:13px;margin:0 0 6px}
.top .co{margin:0;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin:10px 0 0;font-size:13px}
.meta b{font-weight:600}
.upd{margin:8px 0 0;font-size:12px;color:var(--muted)}
.note{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:var(--warn-bg);color:var(--warn);font-size:14px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.tile .n{display:block;font-size:22px;font-weight:700;margin-top:2px}
.tile .l{font-size:13px;color:var(--muted)}
.case{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px}
.case.cx{opacity:.75}
.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--muted)}
.hd b{color:var(--ink);font-weight:600}
.client{font-size:16px;font-weight:600;margin:6px 0 0}
.lic{margin:0;color:var(--muted);font-size:14px}
.badge{display:inline-block;margin:8px 0 0;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;background:var(--ok-bg);color:var(--ok)}
.badge.cxl{background:var(--line);color:var(--muted)}
.missing{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:var(--warn-bg);color:var(--warn);font-weight:600;font-size:14px;border-left:4px solid var(--warn)}
.tl{list-style:none;margin:12px 0 0;padding:0}
.tl li{position:relative;padding:0 0 8px 28px;font-size:14px;color:var(--off)}
.tl li:before{content:"";position:absolute;left:4px;top:6px;width:10px;height:10px;border-radius:50%;border:2px solid var(--off);background:var(--card)}
.tl li:after{content:"";position:absolute;left:10px;top:19px;bottom:-1px;width:2px;background:var(--line)}
.tl li:last-child{padding-bottom:0}
.tl li:last-child:after{display:none}
.tl li.done{color:var(--ink)}
.tl li.done:before{background:var(--ok);border-color:var(--ok)}
.tl li.now{color:var(--ink);font-weight:700}
.tl li.now:before{background:var(--brand);border-color:var(--brand);box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--brand)}
.comm{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;margin:12px 0 0;padding:10px 0 0;border-top:1px solid var(--line);font-size:14px}
.comm .amt{font-weight:700}
.empty{color:var(--muted);background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:16px;text-align:center}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;font-size:14px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:13px}
td.r,th.r{text-align:right}
tr:last-child td{border-bottom:0}
.wa{display:block;margin:24px 0 0;padding:14px 16px;border-radius:12px;background:var(--wa);color:#fff;text-align:center;font-weight:700;text-decoration:none}
.wa .en{color:#e6f7ee}
.foot{margin:24px 0 0;text-align:center;font-size:12px;color:var(--muted)}
.msg{max-width:420px;margin:20vh auto 0;padding:24px 16px;text-align:center}
.msg h1{font-size:20px}
.msg p{color:var(--muted)}
@media (min-width:560px){.tiles{grid-template-columns:repeat(4,1fr)}}
`;
