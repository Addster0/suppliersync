import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { OrganizationProvider, useOrganization } from "./contexts/OrganizationContext";
import { isSubscriptionActive } from "./lib/stripe";
import { isSupabaseConfigured } from "./lib/supabase";
import {
  ConfigRequiredPage,
  CreateOrganizationPage,
  LoginPage,
  SignupPage,
  SubscriptionBlockedPage,
} from "./pages/AuthPages";
import { AccountPage } from "./pages/AccountPage";
import { AppLayout } from "./pages/AppLayout";
import { BillingPage } from "./pages/BillingPage";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";
import { RenewalsPage } from "./pages/RenewalsPage";
import { VendorWorkspace } from "./VendorWorkspace";

function LoadingScreen() {
  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <p className="muted">Loading…</p>
      </div>
    </div>
  );
}

function isBillingPath(pathname: string) {
  return pathname === "/app/billing" || pathname.endsWith("/app/billing");
}

function isAccountPath(pathname: string) {
  return pathname === "/app/account" || pathname.endsWith("/app/account");
}

function isSubscriptionExemptPath(pathname: string) {
  return isBillingPath(pathname) || isAccountPath(pathname);
}

function AuthenticatedGate() {
  const { activeMembership, loading, memberships } = useOrganization();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!memberships.length) return <CreateOrganizationPage />;
  if (!activeMembership) return <LoadingScreen />;

  const subscriptionOk = isSubscriptionActive(activeMembership.organization.subscriptionStatus);
  if (!subscriptionOk && !isSubscriptionExemptPath(location.pathname)) {
    return <SubscriptionBlockedPage />;
  }

  return <Outlet />;
}

function ProtectedApp() {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return (
    <OrganizationProvider>
      <AuthenticatedGate />
    </OrganizationProvider>
  );
}

function AppRoutes() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/" element={session ? <Navigate to="/app" replace /> : <HomePage />} />
      <Route path="/login" element={session ? <Navigate to="/app" replace /> : <LoginPage />} />
      <Route path="/signup" element={session ? <Navigate to="/app" replace /> : <SignupPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/app" element={<ProtectedApp />}>
        <Route element={<AppLayout />}>
          <Route index element={<VendorWorkspace />} />
          <Route path="renewals" element={<RenewalsPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  if (!isSupabaseConfigured) {
    return <ConfigRequiredPage />;
  }

  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
