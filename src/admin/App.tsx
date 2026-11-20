import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ApiError, api, authState, useSessionExpired } from './api';
import { type Me, MeContext } from './me';
import { CaseDetail } from './pages/CaseDetail';
import { CaseForm } from './pages/CaseForm';
import { Cases } from './pages/Cases';
import { Commissions } from './pages/Commissions';
import { PartnerDetail } from './pages/PartnerDetail';
import { PartnerNew } from './pages/PartnerForm';
import { Partners } from './pages/Partners';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Statement } from './pages/Statement';

/** Cloudflare Access ends the session for this site at this address (works on any hostname it guards). */
export const SIGN_OUT_URL = '/cdn-cgi/access/logout';

const ROLE_LABEL: Record<Me['role'], string> = { admin: '管理员', staff: '员工' };

function Profile({ me }: { me: Me | null }) {
  if (!me) return <span className="who" />;
  return (
    <section className="who" aria-label="我的账号">
      <span className="who-name">{me.name}</span>
      <span className="who-email">{me.email}</span>
      <span className="who-role">
        {ROLE_LABEL[me.role]}
        {me.team ? ` · ${me.team}` : ''}
      </span>
      <a
        className="btn sign-out"
        href={SIGN_OUT_URL}
        onClick={(e) => {
          if (!window.confirm('确定退出登录？')) e.preventDefault();
        }}
      >
        退出登录
      </a>
    </section>
  );
}

const MENU = [
  { to: '/partners', label: '伙伴', adminOnly: false },
  { to: '/cases', label: '案件', adminOnly: false },
  { to: '/commissions', label: '佣金', adminOnly: false },
  { to: '/reports', label: '报表', adminOnly: false },
  { to: '/settings', label: '设置', adminOnly: true },
];

function Layout() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  // Signed in with Cloudflare, but the email is not an active staff member (the portal's list decides).
  const [denied, setDenied] = useState(false);
  const expired = useSessionExpired();

  useEffect(() => {
    let live = true;
    api
      .get<Me>('/api/admin/me')
      .then((m) => live && setMe(m))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setDenied(true);
        else setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (denied) {
    return (
      <main className="denied" role="alert">
        <h1>没有权限</h1>
        <p>你登录的电邮不在员工名单上。</p>
        <p className="muted">请联系管理员在「设置 → 员工」把你加入，或改用已登记的电邮登录。</p>
        <a className="btn primary" href={SIGN_OUT_URL}>
          退出并换个电邮
        </a>
      </main>
    );
  }

  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <header className="topbar">
          <span className="brand">Toh&apos;s Sign 伙伴后台</span>
          <nav className="menu" aria-label="主菜单">
            {MENU.filter((m) => !m.adminOnly || me?.role === 'admin').map((m) => (
              <NavLink key={m.to} to={m.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {m.label}
              </NavLink>
            ))}
          </nav>
          <Profile me={me} />
        </header>
        <main className="content">
          {expired && (
            <div className="banner error" role="alert">
              登录已过期，请刷新页面
              <button type="button" className="link" onClick={() => authState.reset()}>
                知道了
              </button>
            </div>
          )}
          {failed && !expired && <div className="banner error">无法读取登录信息，请刷新页面</div>}
          {me ? <Outlet /> : !failed && <p className="muted">载入中…</p>}
        </main>
      </div>
    </MeContext.Provider>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/partners" replace />} />
        <Route path="partners" element={<Partners />} />
        <Route path="partners/new" element={<PartnerNew />} />
        <Route path="partners/:id" element={<PartnerDetail />} />
        <Route path="cases" element={<Cases />} />
        <Route path="cases/new" element={<CaseForm />} />
        <Route path="cases/:id" element={<CaseDetail />} />
        <Route path="commissions" element={<Commissions />} />
        <Route path="statements/:partnerId/:month" element={<Statement />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/partners" replace />} />
      </Route>
    </Routes>
  );
}
