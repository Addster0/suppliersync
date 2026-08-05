import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { fetchProfileTerms } from "./api/profile";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { OrganizationProvider, useOrganization } from "./contexts/OrganizationContext";
import { hasAcceptedCurrentTerms } from "./lib/legal";
import { isSubscriptionActive } from "./lib/stripe";
import {
  checkSupabaseConnection,
  isSupabaseConfigValid,
  supabaseConfigIssues,
  type SupabaseConnectionFailure,
} from "./lib/supabase";
import {
  ConfigRequiredPage,
  CreateOrganizationPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  SubscriptionBlockedPage,
  SupabaseUnreachablePage,
  TermsAcceptancePage,
} from "./pages/AuthPages";
import { AccountPage } from "./pages/AccountPage";
import { AppLayout } from "./pages/AppLayout";
import { HomePage } from "./pages/HomePage";
import { AboutPage } from "./pages/AboutPage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";
import { AdminSignupsPage } from "./pages/AdminSignupsPage";
import { RenewalsPage } from "./pages/RenewalsPage";
import { OutreachPage } from "./pages/OutreachPage";
import { VendorWorkspace } from "./VendorWorkspace";
import { OutreachChrome } from "./components/OutreachChrome";
import { fetchIsPlatformAdmin } from "./api/foundingApplication";

function LoadingScreen() {
  return (
    <div className="auth-layout auth-layout--centered">
      <div className="auth-card">
        <p className="muted">Loading…</p>
      </div>
    </div>
  );
}

function RobotsMeta() {
  const { pathname } = useLocation();
  const noindex = pathname.startsWith("/app") || pathname.startsWith("/outreach");

  useEffect(() => {
    const metaName = "robots";
    let meta = document.querySelector(`meta[name="${metaName}"]`) as HTMLMetaElement | null;

    if (noindex) {
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = metaName;
        document.head.appendChild(meta);
      }
      meta.content = "noindex, nofollow";
      return;
    }

    meta?.remove();
  }, [noindex]);

  return null;
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

function BillingRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("section", "billing");
  const query = params.toString();
  return <Navigate to={query ? `/app/account?${query}` : "/app/account?section=billing"} replace />;
}

function AuthenticatedGate() {
  const { activeMembership, loading, memberships } = useOrganization();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!memberships.length) return <CreateOrganizationPage />;
  if (!activeMembership) return <LoadingScreen />;

  const subscriptionOk = isSubscriptionActive(activeMembership.organization);
  if (!subscriptionOk && !isSubscriptionExemptPath(location.pathname)) {
    return <SubscriptionBlockedPage />;
  }

  return <Outlet />;
}

function TermsGate({ children }: { children: ReactNode }) {
  const { user, recoveryMode } = useAuth();
  const [loading, setLoading] = useState(true);
  const [needsAcceptance, setNeedsAcceptance] = useState(false);

  useEffect(() => {
    if (!user || recoveryMode) {
      setNeedsAcceptance(false);
      setLoading(false);
      return;
    }

    let mounted = true;
    void fetchProfileTerms(user.id)
      .then((status) => {
        if (mounted) {
          setNeedsAcceptance(!hasAcceptedCurrentTerms(status));
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setNeedsAcceptance(true);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [user, recoveryMode]);

  if (loading) return <LoadingScreen />;
  if (needsAcceptance) {
    return <TermsAcceptancePage onAccepted={() => setNeedsAcceptance(false)} />;
  }
  return <>{children}</>;
}

function ProtectedApp() {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return (
    <TermsGate>
      <OrganizationProvider>
        <AuthenticatedGate />
      </OrganizationProvider>
    </TermsGate>
  );
}

function OutreachProtected() {
  const { session } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) return;
    void fetchIsPlatformAdmin().then(setIsPlatformAdmin);
  }, [session]);

  if (!session) return <Navigate to="/login" replace />;
  if (isPlatformAdmin === null) return <LoadingScreen />;
  if (!isPlatformAdmin) return <Navigate to="/app" replace />;

  return (
    <TermsGate>
      <OutreachChrome>
        <Outlet />
      </OutreachChrome>
    </TermsGate>
  );
}

function AppRoutes() {
  const { session, loading, recoveryMode } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/" element={session && !recoveryMode ? <Navigate to="/app" replace /> : <HomePage />} />
      <Route path="/login" element={session && !recoveryMode ? <Navigate to="/app" replace /> : <LoginPage />} />
      <Route path="/signup" element={session && !recoveryMode ? <Navigate to="/app" replace /> : <SignupPage />} />
      <Route path="/forgot-password" element={session && !recoveryMode ? <Navigate to="/app" replace /> : <ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/outreach" element={<OutreachProtected />}>
        <Route index element={<OutreachPage />} />
      </Route>
      <Route path="/app" element={<ProtectedApp />}>
        <Route element={<AppLayout />}>
          <Route index element={<VendorWorkspace />} />
          <Route path="renewals" element={<RenewalsPage />} />
          <Route path="billing" element={<BillingRedirect />} />
          <Route path="admin/signups" element={<AdminSignupsPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function SupabaseConnectionGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [failure, setFailure] = useState<SupabaseConnectionFailure | null>(null);

  useEffect(() => {
    let mounted = true;
    void checkSupabaseConnection().then((status) => {
      if (mounted) {
        setFailure(status.ok ? null : status.reason);
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (checking) return <LoadingScreen />;
  if (failure === "invalid_key") return <ConfigRequiredPage issues={["invalid_anon_key"]} />;
  if (failure) return <SupabaseUnreachablePage reason={failure} />;
  return <>{children}</>;
}

export default function App() {
  if (supabaseConfigIssues.length > 0) {
    return <ConfigRequiredPage issues={supabaseConfigIssues} />;
  }

  if (!isSupabaseConfigValid) {
    return <ConfigRequiredPage issues={["missing"]} />;
  }

  return (
    <SupabaseConnectionGate>
      <AuthProvider>
        <RobotsMeta />
        <AppRoutes />
      </AuthProvider>
    </SupabaseConnectionGate>
  );
}
