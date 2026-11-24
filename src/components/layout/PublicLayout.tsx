import React from 'react';
import { useAuth, roleToDashboardPath } from '../../context/AuthContext';

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { currentPath, navigate, user } = useAuth();

  const navItems = [
    { label: 'Features', path: '/features' },
    { label: 'Pricing', path: '/pricing' },
    { label: 'Captive Portal', path: '/captive-portal' },
    { label: 'About', path: '/about' },
    { label: 'Contact', path: '/contact' },
  ];

  const primaryCtaLabel = user ? 'Open Console' : 'Operator Portal';
  const primaryCtaTarget = user ? roleToDashboardPath(user.role) : '/login';

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      <header className="sticky top-0 z-40 bg-[#F8FAFC]/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded"
          >
            XCLOUD.NET
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            {navItems.map((item) => {
              const active = currentPath === item.path;
              return (
                <a
                  key={item.path}
                  href={item.path}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(item.path);
                  }}
                  className={`whitespace-nowrap shrink-0 transition-colors duration-150 pb-0.5 border-b-2 ${
                    active
                      ? 'text-slate-900 border-blue-700'
                      : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate(primaryCtaTarget)}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
            >
              {primaryCtaLabel}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="font-display text-base font-bold tracking-tight text-slate-900 mb-3">
              XCLOUD.NET
            </div>
            <p className="text-sm text-slate-600 leading-relaxed max-w-xs">
              Cloud hotspot billing, MikroTik &amp; Omada automation, FreeRADIUS accounting, and DaliPay mobile money settlement.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-900 mb-3">Platform</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" onClick={() => navigate('/features')} className="hover:text-slate-900 cursor-pointer">
                  Features &amp; Integrations
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate('/pricing')} className="hover:text-slate-900 cursor-pointer">
                  Operator Pricing
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate('/captive-portal')} className="hover:text-slate-900 cursor-pointer">
                  WiFi Captive Portal
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-900 mb-3">Portals</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" onClick={() => navigate('/login')} className="hover:text-slate-900 cursor-pointer">
                  Sign In
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate('/register')} className="hover:text-slate-900 cursor-pointer">
                  Create Partner Account
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate('/faq')} className="hover:text-slate-900 cursor-pointer">
                  Technical FAQ
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-900 mb-3">Company &amp; Legal</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" onClick={() => navigate('/about')} className="hover:text-slate-900 cursor-pointer">
                  About XCLOUD.NET
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate('/contact')} className="hover:text-slate-900 cursor-pointer">
                  Contact NOC &amp; Sales
                </button>
              </li>
              <li className="flex items-center gap-3 pt-1">
                <button type="button" onClick={() => navigate('/terms')} className="hover:text-slate-900 cursor-pointer">
                  Terms
                </button>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <button type="button" onClick={() => navigate('/privacy')} className="hover:text-slate-900 cursor-pointer">
                  Privacy
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} XCLOUD.NET Tanzania. All rights reserved.</span>
            <span>Dar es Salaam NOC · MikroTik RouterOS · TP-Link Omada · FreeRADIUS · DaliPay</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
