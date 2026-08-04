import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { requireSupabase } from "../lib/supabase";
import type { OrganizationMembership, OrgRole } from "../types";
import { useAuth } from "./AuthContext";

type OrganizationContextValue = {
  memberships: OrganizationMembership[];
  activeMembership: OrganizationMembership | null;
  loading: boolean;
  canWrite: boolean;
  setActiveOrganizationId: (organizationId: string) => void;
  createOrganization: (name: string) => Promise<{ error: string | null }>;
  refreshMemberships: () => Promise<void>;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

const WRITE_ROLES: OrgRole[] = ["owner", "admin", "member"];

const ORG_SELECT_BASE = `
  id,
  name,
  plan,
  subscription_status,
  is_founding,
  locked_monthly_price_cents,
  founding_enrolled_at,
  renewal_reminders_enabled
`;

/** Tried in order until one succeeds (027 drops weekly_digest_enabled; 013 adds trial_ends_at). */
const ORG_SELECT_VARIANTS = [
  `${ORG_SELECT_BASE.trim()}, monthly_digest_enabled, annual_digest_enabled, trial_ends_at`,
  `${ORG_SELECT_BASE.trim()}, weekly_digest_enabled, trial_ends_at`,
  `${ORG_SELECT_BASE.trim()}, monthly_digest_enabled, annual_digest_enabled`,
  `${ORG_SELECT_BASE.trim()}, weekly_digest_enabled`,
  ORG_SELECT_BASE.trim(),
];

type OrganizationRow = {
  id: string;
  name: string;
  plan: string;
  subscription_status: string;
  trial_ends_at?: string | null;
  is_founding: boolean;
  locked_monthly_price_cents: number | null;
  founding_enrolled_at: string | null;
  renewal_reminders_enabled: boolean;
  weekly_digest_enabled?: boolean;
  monthly_digest_enabled?: boolean;
  annual_digest_enabled?: boolean;
};

function isMissingColumnError(error: { code?: string; message?: string }) {
  return error.code === "42703" || /column .+ does not exist/i.test(error.message ?? "");
}

function memberSelect(orgFields: string) {
  return `
    id,
    role,
    organization_id,
    organizations (${orgFields})
  `;
}

async function fetchMembershipRows(userId: string) {
  const client = requireSupabase();

  for (const orgFields of ORG_SELECT_VARIANTS) {
    const { data, error } = await client
      .from("organization_members")
      .select(memberSelect(orgFields))
      .eq("user_id", userId);

    if (!error) return { data: data ?? [], error: null };
    if (!isMissingColumnError(error)) return { data: null, error };
  }

  return { data: null, error: { message: "Could not load workspace columns." } };
}

function mapMembershipRows(data: unknown[]) {
  return data.flatMap((row) => {
    const member = row as {
      id: string;
      role: string;
      organization_id: string;
      organizations: OrganizationRow | OrganizationRow[] | null;
    };

    const org = member.organizations;
    const organization = Array.isArray(org) ? org[0] : org;
    if (!organization) {
      console.warn("Membership row missing organization (check organizations RLS):", member.organization_id);
      return [];
    }

    const legacyWeeklyDigest = organization.weekly_digest_enabled ?? true;

    return [
      {
        id: member.id,
        organizationId: member.organization_id,
        role: member.role as OrgRole,
        organization: {
          id: organization.id,
          name: organization.name,
          plan: organization.plan,
          subscriptionStatus: organization.subscription_status,
          trialEndsAt: organization.trial_ends_at ?? null,
          isFounding: organization.is_founding,
          lockedMonthlyPriceCents: organization.locked_monthly_price_cents,
          foundingEnrolledAt: organization.founding_enrolled_at,
          renewalRemindersEnabled: organization.renewal_reminders_enabled ?? true,
          monthlyDigestEnabled: organization.monthly_digest_enabled ?? legacyWeeklyDigest,
          annualDigestEnabled: organization.annual_digest_enabled ?? legacyWeeklyDigest,
        },
      },
    ];
  });
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMemberships = useCallback(async () => {
    if (!user) {
      setMemberships([]);
      setActiveOrganizationId(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data, error } = await fetchMembershipRows(user.id);

    if (error) {
      console.error("Failed to load workspaces:", error);
      setMemberships([]);
      setLoading(false);
      return;
    }

    const mapped: OrganizationMembership[] = mapMembershipRows(data);

    setMemberships(mapped);

    const savedOrgId = localStorage.getItem("active-organization-id");
    const nextActive =
      mapped.find((item) => item.organizationId === savedOrgId)?.organizationId ??
      mapped[0]?.organizationId ??
      null;

    setActiveOrganizationId(nextActive);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refreshMemberships();
  }, [refreshMemberships]);

  const setActiveOrganizationIdPersisted = useCallback((organizationId: string) => {
    setActiveOrganizationId(organizationId);
    localStorage.setItem("active-organization-id", organizationId);
  }, []);

  const createOrganization = useCallback(
    async (name: string) => {
      if (!user) return { error: "You must be signed in." };

      const client = requireSupabase();
      const { data: orgId, error: orgError } = await client.rpc("create_organization", {
        p_name: name.trim(),
      });

      if (orgError || !orgId) {
        return { error: orgError?.message ?? "Could not create workspace." };
      }

      await refreshMemberships();
      setActiveOrganizationIdPersisted(orgId);
      return { error: null };
    },
    [user, refreshMemberships, setActiveOrganizationIdPersisted]
  );

  const activeMembership =
    memberships.find((item) => item.organizationId === activeOrganizationId) ?? memberships[0] ?? null;

  const canWrite = activeMembership ? WRITE_ROLES.includes(activeMembership.role) : false;

  const value = useMemo(
    () => ({
      memberships,
      activeMembership,
      loading,
      canWrite,
      setActiveOrganizationId: setActiveOrganizationIdPersisted,
      createOrganization,
      refreshMemberships,
    }),
    [
      memberships,
      activeMembership,
      loading,
      canWrite,
      setActiveOrganizationIdPersisted,
      createOrganization,
      refreshMemberships,
    ]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization must be used within OrganizationProvider");
  }
  return context;
}
