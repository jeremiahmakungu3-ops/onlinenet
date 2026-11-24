import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck, UserPlus } from 'lucide-react';
import type { PublicUser } from '../../../packages/shared/types';
import { roleToDashboardPath, useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../services/api';

interface BootstrapStatus {
  envPasscodeConfigured: boolean;
  adminClaimed: boolean;
  claimedEmail: string | null;
}

export function AuthPages({ mode }: { mode: 'login' | 'register' | 'forgot' | 'reset' }) {
  const { navigate, setSession } = useAuth();
  const [bootstrap, setBootstrap] = useState<BootstrapStatus | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+25575');
  const [role, setRole] = useState<'customer' | 'agent' | 'admin'>('admin');
  const [organizationName, setOrganizationName] = useState('');

  // First-run Super Admin claim form state
  const [claimName, setClaimName] = useState('');
  const [claimEmail, setClaimEmail] = useState('');
  const [claimPassword, setClaimPassword] = useState('');

  // Reset password state
  const [resetCode, setResetCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    apiRequest<BootstrapStatus>('/api/auth/bootstrap-status')
      .then(setBootstrap)
      .catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: PublicUser; token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setSession(res.user, res.token);
      navigate(roleToDashboardPath(res.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleClaimSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: PublicUser; token: string }>('/api/auth/claim-admin', {
        method: 'POST',
        body: { name: claimName, email: claimEmail, password: claimPassword },
      });
      setSession(res.user, res.token);
      navigate(roleToDashboardPath('super-admin'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to claim Super Admin.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: PublicUser; token: string }>('/api/auth/register', {
        method: 'POST',
        body: { name, email, password, role, organizationName, phone },
      });
      setSession(res.user, res.token);
      navigate(roleToDashboardPath(res.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: { code: resetCode, newPassword: password },
      });
      setInfo(res.message);
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between">
      <div className="max-w-6xl w-full mx-auto px-6 py-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>XCLOUD.NET Home</span>
        </button>
        <div className="flex items-center gap-4 text-xs font-medium">
          <button type="button" onClick={() => navigate('/login')} className="text-slate-700 hover:text-slate-900 cursor-pointer">
            Sign In
          </button>
          <button type="button" onClick={() => navigate('/register')} className="text-blue-700 hover:text-blue-800 cursor-pointer">
            Create Account
          </button>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-8">
          {error && <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          {info && <div className="mb-4 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{info}</div>}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="mb-4">
                <h1 className="font-display text-2xl font-bold text-slate-900">Sign in to XCLOUD.NET</h1>
                <p className="text-sm text-slate-600 mt-1">Access your ISP, reseller agent, support, or subscriber console.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.co.tz"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                >
                  Forgot password?
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="mb-4">
                <h1 className="font-display text-2xl font-bold text-slate-900">Create Partner or Subscriber Account</h1>
                <p className="text-sm text-slate-600 mt-1">Register a new ISP organization, reseller agent, or WiFi subscriber profile.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                  <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Account Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'customer' | 'agent' | 'admin')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    <option value="admin">ISP / Hotspot Admin</option>
                    <option value="agent">Reseller Agent</option>
                    <option value="customer">WiFi Subscriber</option>
                  </select>
                </div>
              </div>
              {role === 'admin' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Organization / ISP Name</label>
                  <input
                    required
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Enter ISP or Venue Name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Phone Number</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password (minimum 8 characters)</label>
                <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md" />
              </div>
              <button type="submit" disabled={loading} className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
                {loading ? 'Provisioning Account...' : 'Create Account'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <h1 className="font-display text-2xl font-bold text-slate-900">Reset Operator Password</h1>
              <p className="text-sm text-slate-600">Enter your registered account email to request a 6-digit verification code.</p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.co.tz"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/reset-password')}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                >
                  Already have a reset code?
                </button>
                <button type="submit" disabled={loading} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
                  Send Reset Request
                </button>
              </div>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              <h1 className="font-display text-2xl font-bold text-slate-900">Set New Password</h1>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">6-Digit Code</label>
                <input required value={resetCode} onChange={(e) => setResetCode(e.target.value)} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">New Password (8+ chars)</label>
                <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md" />
              </div>
              <button type="submit" disabled={loading} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
                Update Password
              </button>
            </form>
          )}
        </div>

        {/* Right Side: First-Run Super Admin Claim & Onboarding Guidance */}
        <div className="lg:col-span-5 space-y-6">
          {bootstrap && !bootstrap.adminClaimed && (
            <form onSubmit={handleClaimSuperAdmin} className="bg-white border border-blue-700 rounded-lg p-6 space-y-3">
              <div className="flex items-center gap-2 text-blue-700">
                <ShieldCheck className="w-5 h-5" />
                <h2 className="font-display text-base font-bold text-slate-900">First-Run Super Admin Setup</h2>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                No platform administrator account is configured yet. Create the primary Super Admin credentials to initialize this XCLOUD.NET instance.
              </p>
              <input
                required
                value={claimName}
                onChange={(e) => setClaimName(e.target.value)}
                placeholder="Administrator Full Name"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
              <input
                type="email"
                required
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                placeholder="admin@yourdomain.co.tz"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
              <input
                type="password"
                required
                minLength={8}
                value={claimPassword}
                onChange={(e) => setClaimPassword(e.target.value)}
                placeholder="Choose Super Admin password (8+ chars)"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
              >
                Claim Super Admin Console
              </button>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900">
              <UserPlus className="w-4 h-4 text-blue-700" />
              <h2 className="font-display text-base font-bold">Operator &amp; Partner Onboarding</h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every organization on XCLOUD.NET uses authenticated, role-scoped credentials stored with salted scrypt password hashes and HMAC-signed session tokens.
            </p>
            <div className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
              <div>· ISP Admins manage sites, MikroTik/Omada NAS nodes, hotspot packages, and voucher PDF batches.</div>
              <div>· Reseller Agents issue walk-in vouchers and track TZS commissions.</div>
              <div>· Subscribers inspect active WiFi sessions and DaliPay mobile money receipts.</div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/register')}
              className="w-full py-2 px-4 text-xs font-semibold text-blue-700 border border-blue-700 hover:bg-blue-50 rounded-md cursor-pointer"
            >
              Register New Organization or Account
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl w-full mx-auto px-6 py-4 text-xs text-slate-500 text-center">
        Sessions are signed server-side and held exclusively in memory.
      </div>
    </div>
  );
}
