import { AuthProvider, useAuth } from './context/AuthContext';
import { PublicLayout } from './components/layout/PublicLayout';
import { HomePage } from './pages/public/HomePage';
import {
  AboutPage,
  ContactPage,
  FaqPage,
  FeaturesPage,
  LegalPage,
  PricingPage,
} from './pages/public/PublicSubpages';
import { CaptivePortalPage } from './pages/captive/CaptivePortalPage';
import { AuthPages } from './pages/auth/AuthPages';
import { DashboardShell } from './pages/dashboard/DashboardShell';

function AppRouter() {
  const { currentPath } = useAuth();

  if (currentPath === '/captive-portal') {
    return <CaptivePortalPage />;
  }

  if (currentPath === '/login') {
    return <AuthPages mode="login" />;
  }
  if (currentPath === '/register') {
    return <AuthPages mode="register" />;
  }
  if (currentPath === '/forgot-password') {
    return <AuthPages mode="forgot" />;
  }
  if (currentPath === '/reset-password') {
    return <AuthPages mode="reset" />;
  }

  if (currentPath.startsWith('/dashboard')) {
    return <DashboardShell />;
  }

  return (
    <PublicLayout>
      {currentPath === '/features' ? (
        <FeaturesPage />
      ) : currentPath === '/pricing' ? (
        <PricingPage />
      ) : currentPath === '/about' ? (
        <AboutPage />
      ) : currentPath === '/contact' ? (
        <ContactPage />
      ) : currentPath === '/faq' ? (
        <FaqPage />
      ) : currentPath === '/terms' ? (
        <LegalPage type="terms" />
      ) : currentPath === '/privacy' ? (
        <LegalPage type="privacy" />
      ) : (
        <HomePage />
      )}
    </PublicLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
