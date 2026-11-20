// English for the staff portal and the partner page. Chinese stays the source text: each entry maps
// the exact Chinese words shown on screen to their English. Words not listed stay in Chinese, so a
// missing entry never hides anything.
export type Lang = 'zh' | 'en';

export const LANGS: readonly Lang[] = ['zh', 'en'];

/** "Follow the browser": English when the person's first language is English, otherwise 中文. */
export function langFromPreferences(prefs: readonly string[]): Lang {
  const first = prefs.find((p) => p.trim() !== '')?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'zh';
}

/** The language list from an Accept-Language header, best first. */
export function acceptLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

export const EN: Readonly<Record<string, string>> = {
  // Shell and sign-in
  伙伴后台: 'Partner admin',
  我的账号: 'My account',
  管理员: 'Admin',
  员工: 'Staff',
  退出登录: 'Sign out',
  '确定退出登录？': 'Sign out now?',
  没有权限: 'No access',
  '你登录的电邮不在员工名单上。': 'The email you signed in with is not on the staff list.',
  '请联系管理员在「设置 → 员工」把你加入，或改用已登记的电邮登录。':
    'Ask an admin to add you under Settings → Staff, or sign in with a registered email.',
  退出并换个电邮: 'Sign out and use another email',
  '载入中…': 'Loading…',
  登录已过期: 'Your session has expired',
  '登录已过期，请刷新页面': 'Your session has expired. Please refresh the page.',
  '登录已过期，请刷新页面重新登录': 'Your session has expired. Please refresh the page and sign in again.',
  知道了: 'OK',
  '无法读取登录信息，请刷新页面': 'Could not read your sign-in. Please refresh the page.',
  关闭: 'Close',
  '出错了，请稍后再试': 'Something went wrong. Please try again later.',
  主菜单: 'Main menu',

  // Menu
  // Single words read as one item (a column, a row). Menus and page titles say the plural with data-en.
  伙伴: 'Partner',
  案件: 'Case',
  佣金: 'Commission',
  报表: 'Reports',
  设置: 'Settings',

  // Partner statuses, codes, teams, sources
  待审核: 'Pending approval',
  活跃: 'Active',
  不活跃: 'Inactive',
  'A1 仅佣金': 'A1 Commission only',
  'B1 伙伴直接对接客户': 'B1 Partner deals with the client',
  'C1 加价佣金': 'C1 Markup commission',
  '仅佣金 RM100–150': 'Commission only, RM100–150',
  '伙伴直接对接客户，自行开账单': 'Partner deals with the client and bills them',
  加价佣金: 'Markup commission',
  上门: 'Field visit',
  线上: 'Online',

  // Case steps
  洽谈中: 'In discussion',
  收集文件: 'Collecting documents',
  已递交政府部门: 'Submitted to authority',
  实地检查: 'Site inspection',
  已批准: 'Approved',
  已完成: 'Completed',
  已放弃: 'Dropped',
  '· 已放弃': '· Dropped',
  进行中: 'Active',

  // Commission statuses
  待处理: 'Pending',
  可发放: 'Ready to pay',
  已支付: 'Paid',
  待付发票: 'Invoice due',
  已结清: 'Settled',
  佣金待计算: 'Commission not yet calculated',
  "应付 Toh's Sign": "Owed to Toh's Sign",
  "B1 金额为伙伴应付 Toh's Sign 的款项": "B1 amounts are what the partner owes Toh's Sign",
  '固定推荐费 (A1)': 'Fixed referral fee (A1)',
  案件已放弃: 'Case dropped',
  加价超过上限: 'Markup is over the limit',

  // Licence types (defaults)
  营业执照: 'Business licence',
  招牌执照: 'Signboard licence',
  '清真认证 (JAKIM)': 'Halal certification (JAKIM)',
  '消防证书 (BOMBA)': 'Fire certificate (BOMBA)',
  'SSM 公司注册': 'SSM company registration',

  // Partners list
  登记新伙伴: 'Register partner',
  全部状态: 'All statuses',
  全部员工: 'All staff',
  我负责的: 'Mine',
  搜索: 'Search',
  '搜索编号、姓名、公司、电话': 'Search ID, name, company, phone',
  伙伴编号: 'Partner ID',
  姓名: 'Name',
  电话: 'Phone',
  电邮: 'Email',
  公司名称: 'Company',
  代码: 'Code',
  推荐人: 'Referred by',
  填写团队: 'Team',
  负责员工: 'Staff in charge',
  登记日期: 'Registered',
  状态: 'Status',
  没有符合条件的伙伴: 'No matching partners',
  未分配: 'Unassigned',

  // Partner form
  伙伴代码: 'Partner code',
  推荐人姓名: 'Referrer name',
  来源: 'Source',
  税号: 'Tax ID',
  电话号码: 'Phone number',
  银行名称: 'Bank name',
  银行户口: 'Bank account',
  '银行名称（仅限内部）': 'Bank name (internal only)',
  '银行户口（仅限内部）': 'Bank account (internal only)',
  '个人以 IG 开头，公司以 C 开头（LHDN 税号）': 'Individuals start with IG, companies with C (LHDN tax ID)',
  新案件默认交给这位员工: 'New cases go to this staff member by default',
  未选择: 'Not selected',
  请选择: 'Please choose',
  保存: 'Save',
  取消: 'Cancel',
  清空: 'Clear',
  提交登记: 'Register',
  没有修改任何内容: 'Nothing was changed',
  请检查红色栏位: 'Please check the fields in red',
  请填写姓名: 'Please enter a name',
  电话号码格式不正确: 'Phone number is not valid',
  电邮格式不正确: 'Email is not valid',
  税号格式不正确: 'Tax ID is not valid',
  请选择伙伴代码: 'Please choose a partner code',
  请选择填写团队: 'Please choose a team',
  请选择有效的员工: 'Please choose a valid staff member',

  // Partner detail
  伙伴链接: 'Partner link',
  复制链接: 'Copy link',
  已复制: 'Copied',
  '无法复制，请手动选取链接': 'Could not copy. Please select the link by hand.',
  '发送链接 WhatsApp': 'Send link on WhatsApp',
  重置链接: 'Reset link',
  '旧链接将立即失效，确定重置？': 'The old link will stop working at once. Reset it?',
  设为不活跃: 'Mark inactive',
  '确定设为不活跃？': 'Mark this partner inactive?',
  编辑: 'Edit',
  批准: 'Approve',
  更改代码: 'Change code',
  更改负责员工: 'Change staff in charge',
  确认更改: 'Confirm change',
  确认更改负责员工: 'Confirm staff change',
  '现有案件不变，新案件交给新员工': 'Existing cases stay put; new cases go to the new staff member',
  还没有案件: 'No cases yet',
  最近链接浏览: 'Recent link views',
  还没有人打开过链接: 'Nobody has opened the link yet',
  案件编号: 'Case ID',
  客户: 'Client',
  类型: 'Type',
  进度: 'Progress',
  提交日期: 'Submitted',
  处理员工: 'Handled by',
  时间: 'Time',
  国家: 'Country',
  内部备注: 'Internal notes',

  在新分页打开伙伴页面: "Open the partner's page in a new tab",
  '· 代码': '· Code',
  '· 月份': '· Month',

  // Cases
  新增案件: 'New case',
  价格: 'Price',

  全部伙伴: 'All partners',
  全部进度: 'All stages',
  没有符合条件的案件: 'No matching cases',
  建立案件: 'Create case',
  请选择伙伴: 'Please choose a partner',
  请选择执照类型: 'Please choose a licence type',
  请填写客户姓名: "Please enter the client's name",
  金额不正确: 'Amount is not valid',
  客户姓名: 'Client name',
  客户电话: 'Client phone',
  执照类型: 'Licence type',
  州属局: 'Council',
  '价格 (RM)': 'Price (RM)',
  '加价 (RM)': 'Markup (RM)',
  发票号码: 'Invoice no.',
  伙伴尚未批准: 'The partner is not approved yet',

  // Case detail
  '发送进度 WhatsApp': 'Send progress on WhatsApp',
  放弃案件: 'Drop case',
  '确定放弃此案件？': 'Drop this case?',
  恢复案件: 'Restore case',
  更改: 'Change',
  缺少文件: 'Missing documents',
  保存缺少文件: 'Save missing documents',
  付款: 'Payment',
  保存付款资料: 'Save payment details',
  客户已付款: 'Client has paid',
  付款日期: 'Payment date',
  伙伴已结清: 'Partner has settled',
  价格不是有效金额: 'Price is not a valid amount',
  加价不是有效金额: 'Markup is not a valid amount',
  没有需要保存的更改: 'There are no changes to save',
  保存备注: 'Save notes',
  文件: 'Documents',
  文件类型: 'Document type',
  选择文件: 'Choose file',
  上传: 'Upload',
  请先选择文件: 'Please choose a file first',
  '图片会先缩小再上传；每个文件不能超过 10 MB。': 'Images are shrunk before upload; each file must be under 10 MB.',
  还没有文件: 'No documents yet',
  进度记录: 'Progress history',
  还没有记录: 'No history yet',
  租约: 'Tenancy agreement',
  店面照片: 'Shop photo',
  其他: 'Other',
  只接受图片或PDF: 'Only images or PDF',
  '只接受图片或 PDF': 'Only images or PDF',
  '文件不能超过 10 MB': 'Files must be under 10 MB',
  伙伴电话号码无效: "The partner's phone number is not valid",

  // Commissions
  按状态合计: 'Totals by status',
  依据: 'Basis',
  金额: 'Amount',
  标记已支付: 'Mark paid',
  查看结单: 'View statement',
  这个月没有佣金记录: 'No commissions this month',
  按新规则: 'New rules',
  '佣金规则已更改，此金额按现行规则计算': 'The commission rules changed; this amount uses the current rules',
  月份: 'Month',

  // Reports and statement
  每月伙伴报表: 'Monthly partner report',
  案件数: 'Cases',
  营业额: 'Revenue',
  结单: 'Statement',
  合计: 'Total',
  这个月没有案件: 'No cases this month',
  不活跃伙伴: 'Inactive partners',
  '活跃伙伴很久没有新案件时会列在这里。': 'Active partners with no new case for a long time are listed here.',
  没有需要联系的伙伴: 'No partners to follow up',
  电话无效: 'Invalid phone',
  月结单: 'Monthly statement',
  '打印 / 保存为 PDF': 'Print / save as PDF',
  返回佣金: 'Back to commissions',
  已支付佣金: 'Commission paid to partner',
  '待发佣金（待处理 + 可发放）': 'Commission pending (Pending + Ready to pay)',
  "伙伴应付 Toh's Sign · 已结清": "Owed to Toh's Sign · Settled",
  "伙伴应付 Toh's Sign · 待付（待付发票）": "Owed to Toh's Sign · Due (Invoice due)",

  // Settings
  佣金规则: 'Commission rules',
  'A1 门槛 (RM)': 'A1 threshold (RM)',
  'A1 低于门槛 (RM)': 'A1 below threshold (RM)',
  'A1 达到门槛 (RM)': 'A1 at or above threshold (RM)',
  'B1 伙伴价 (% 价格)': 'B1 partner price (% of price)',
  'C1 加价上限 (RM，留空 = 不设上限)': 'C1 markup limit (RM, blank = no limit)',
  谁可以标记已支付: 'Who can mark as paid',
  仅管理员: 'Admins only',
  所有员工: 'All staff',
  'B1 案件需先结清才能递交': 'B1 cases must be settled before submission',
  '新规则只会在案件下次更新时生效，已支付的佣金不会改变。':
    'New rules apply when a case is next updated; paid commissions never change.',
  每行一个执照类型: 'One licence type per line',
  不活跃天数: 'Inactive after (days)',
  多少天没有新案件算不活跃: 'Days without a new case before a partner counts as inactive',
  保存设置: 'Save settings',
  已保存: 'Saved',
  新增员工: 'Add staff',
  角色: 'Role',
  团队: 'Team',
  启用: 'Active',
  停用: 'Deactivate',
  已停用: 'Deactivated',
  '确定停用？': 'Deactivate this staff member?',
  保存员工: 'Save staff',
  无: 'None',

  // Server messages
  未登录: 'Not signed in',
  '数据库暂时无法连接，请稍后再试': 'The database is not reachable right now. Please try again later.',
  '文件服务暂时无法连接，请稍后再试': 'File storage is not reachable right now. Please try again later.',
  '服务器出错了，请稍后再试': 'Server error. Please try again later.',
  请求来源不正确: 'Request came from the wrong place',
  请求格式不正确: 'The request is not valid',
  '请求格式必须是 JSON': 'The request must be JSON',
  找不到伙伴: 'Partner not found',
  找不到案件: 'Case not found',
  找不到佣金: 'Commission not found',
  找不到文件: 'Document not found',
  不可修改: 'Cannot be changed',
  内容过长: 'Too long',
  格式不正确: 'Not valid',
  状态不正确: 'Status is not valid',
  不能改为此状态: 'Cannot change to this status',
  伙伴已是活跃状态: 'The partner is already active',
  请先批准伙伴: 'Please approve the partner first',
  '旧链接清除失败，请再试一次': 'Could not clear the old link. Please try again.',
  系统设置不完整: 'System settings are incomplete',
  来源格式不正确: 'Source is not valid',
  没有需要更新的栏位: 'Nothing to update',
  日期格式不正确: 'Date is not valid',
  月份格式不正确: 'Month is not valid',
  步骤不正确: 'Stage is not valid',
  只有C1伙伴可以加价: 'Only C1 partners can add a markup',
  '只有 C1 伙伴可以加价': 'Only C1 partners can add a markup',
  '金额已变更，请刷新后再确认': 'The amount has changed. Refresh and confirm again.',
  佣金尚未可发放: 'This commission is not ready to pay yet',
  此佣金不能标记为已支付: 'This commission cannot be marked as paid',
  文件不能为空: 'The file is empty',
  无法确定文件大小: 'Could not tell the file size',
  文件类型不正确: 'Document type is not valid',
  请填写文件名: 'Please give a file name',
  团队不正确: 'Team is not valid',
  不能停用自己的账号: 'You cannot deactivate your own account',
  不能降级自己的账号: 'You cannot downgrade your own account',
  至少需要一位管理员: 'There must be at least one admin',
  '请填写 1 到 30 个不重复的执照类型（每个不超过 50 字）':
    'Enter 1 to 30 different licence types (each up to 50 characters)',
  '请填写 1 到 365': 'Enter a number from 1 to 365',

  // Partner page
  "Toh's Sign 伙伴门户": "Toh's Sign Partner Portal",
  '更新于': 'Updated',
  推荐案件: 'Total referred',
  有效率: 'Active pipeline rate',
  待发佣金: 'Pending commission',
  已发佣金: 'Paid commission',
  "待付给 Toh's Sign": "Owed to Toh's Sign",
  "已与 Toh's Sign 结清": "Settled with Toh's Sign",
  你的佣金: 'Your commission',
  '递交': 'Submitted',
  暂无案件: 'No cases yet',
  暂无记录: 'No records yet',
  案件概览: 'Case summary',
  每月合计: 'Monthly totals',
  '此客户由你直接负责 – 请把文件清单转发给客户。':
    'You handle this client directly – please forward the document list to them.',
  '此页面仅供你本人查看，请勿转发链接。': 'This page is for you only. Please do not forward the link.',
  链接无效: 'This link is not valid',
  "请向 Toh's Sign 索取新的链接。": "Please ask Toh's Sign for a new link.",
  暂时无法加载: 'Cannot load right now',
  '暂时无法加载，请稍后再试': 'Cannot load right now. Please try again later.',
  'WhatsApp 联系 Marketing': 'WhatsApp Marketing',
  '联系 Marketing': 'Contact Marketing',
};

/** Patterns for text with numbers or names inside. Checked after the exact list. */
const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^请求失败（(\d+)）$/, (m) => `Request failed (${m[1]})`],
  [/^上传失败（(\d+)）$/, (m) => `Upload failed (${m[1]})`],
  [/^伙伴价 = (RM[\s\d,.]+) 的 ([\d.]+)%$/, (m) => `Partner price = ${m[2]}% of ${m[1]}`],
  [/^在 (RM[\s\d,.]+) 上加价（客户支付 (RM[\s\d,.]+)）$/, (m) => `Markup on ${m[1]} (client pays ${m[2]})`],
  [/^更新于 (.+)$/, (m) => `Updated ${m[1]}`],
  [/^递交 (.+)$/, (m) => `Submitted ${m[1]}`],
  // A licence type followed by its council: 营业执照 (MBPJ)
  [/^(.+?) \(([^()]+)\)$/, (m) => (EN[m[1]] ? `${EN[m[1]]} (${m[2]})` : m[0])],
];

/** The English for one piece of Chinese text, keeping its surrounding spaces; null when there is none. */
export function english(text: string): string | null {
  const core = text.trim();
  if (!core) return null;
  let en: string | undefined = EN[core];
  if (en === undefined) {
    for (const [re, fn] of PATTERNS) {
      const m = core.match(re);
      // A pattern that hands back the text unchanged had nothing to translate.
      if (m && fn(m) !== m[0]) {
        en = fn(m);
        break;
      }
    }
  }
  if (en === undefined) return null;
  const start = text.indexOf(core);
  return text.slice(0, start) + en + text.slice(start + core.length);
}

/** `text` in `lang`: English when there is an entry, otherwise the Chinese as written. */
export function tr(lang: Lang, text: string): string {
  return lang === 'en' ? (english(text) ?? text) : text;
}
