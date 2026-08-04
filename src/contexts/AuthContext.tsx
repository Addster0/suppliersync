import { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  formatSupabaseAuthError,
  getPasswordResetRedirectUrl,
  isSupabaseConfigured,
  requireSupabase,
} from "../lib/supabase";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  recoveryMode: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    terms: { version: string; acceptedAt: string }
  ) => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const client = requireSupabase();
    let mounted = true;

    client.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        if (window.location.pathname === "/reset-password" && window.location.hash.includes("type=recovery")) {
          setRecoveryMode(true);
        }
        setLoading(false);
      }
    });

    const { data: subscription } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
      }
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
      return { error: error ? formatSupabaseAuthError(error) : null };
    } catch (error) {
      return { error: formatSupabaseAuthError(error) };
    }
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      terms: { version: string; acceptedAt: string }
    ) => {
      try {
        const { error } = await requireSupabase().auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              terms_version: terms.version,
              terms_accepted_at: terms.acceptedAt,
            },
          },
        });
        return { error: error ? formatSupabaseAuthError(error) : null };
      } catch (error) {
        return { error: formatSupabaseAuthError(error) };
      }
    },
    []
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordResetRedirectUrl(),
      });
      return { error: error ? formatSupabaseAuthError(error) : null };
    } catch (error) {
      return { error: formatSupabaseAuthError(error) };
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    try {
      const { error } = await requireSupabase().auth.updateUser({ password });
      if (!error) setRecoveryMode(false);
      return { error: error ? formatSupabaseAuthError(error) : null };
    } catch (error) {
      return { error: formatSupabaseAuthError(error) };
    }
  }, []);

  const signOut = useCallback(async () => {
    setRecoveryMode(false);
    await requireSupabase().auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      recoveryMode,
      signIn,
      signUp,
      requestPasswordReset,
      updatePassword,
      signOut,
    }),
    [session, loading, recoveryMode, signIn, signUp, requestPasswordReset, updatePassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
