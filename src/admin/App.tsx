import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { api, authState, useSessionExpired } from './api';
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
  const expired = useSessionExpired();

  useEffect(() => {
    let live = true;
    api
      .get<Me>('/api/admin/me')
      .then((m) => live && setMe(m))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

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
          <span className="who">{me?.name ?? ''}</span>
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
