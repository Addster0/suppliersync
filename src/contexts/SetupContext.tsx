import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchUpcomingRenewals, fetchVendors } from "../api/vendors";
import {
  buildSetupSteps,
  countCompletedSetupSteps,
  documentSkippedKey,
  firstIncompleteSetupStep,
  isSetupComplete,
  type SetupStep,
} from "../lib/onboarding";
import type { RenewalItem, Vendor } from "../types";
import { useOrganization } from "./OrganizationContext";

type SetupContextValue = {
  vendors: Vendor[];
  renewals: RenewalItem[];
  loading: boolean;
  steps: SetupStep[];
  completedCount: number;
  totalSteps: number;
  isComplete: boolean;
  currentStep: SetupStep | null;
  documentSkipped: boolean;
  setupOpen: boolean;
  openSetup: () => void;
  closeSetup: () => void;
  refreshSetup: () => Promise<void>;
  skipDocumentStep: () => void;
};

const SetupContext = createContext<SetupContextValue | null>(null);

function autoOpenKey(organizationId: string) {
  return `setup-auto-opened-${organizationId}`;
}

export function SetupProvider({ children }: { children: ReactNode }) {
  const { activeMembership, canWrite } = useOrganization();
  const organizationId = activeMembership?.organizationId ?? "";
  const workspaceName = activeMembership?.organization.name;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [renewals, setRenewals] = useState<RenewalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [documentSkipped, setDocumentSkipped] = useState(false);
  const setupFetchGenRef = useRef(0);

  useEffect(() => {
    if (!organizationId) {
      setDocumentSkipped(false);
      return;
    }
    setDocumentSkipped(localStorage.getItem(documentSkippedKey(organizationId)) === "1");
  }, [organizationId]);

  const refreshSetup = useCallback(async () => {
    if (!organizationId) {
      setVendors([]);
      setRenewals([]);
      setLoading(false);
      return;
    }

    const fetchGen = ++setupFetchGenRef.current;
    setLoading(true);
    try {
      const [vendorData, renewalData] = await Promise.all([
        fetchVendors(organizationId),
        fetchUpcomingRenewals(organizationId),
      ]);
      if (fetchGen !== setupFetchGenRef.current) return;
      setVendors(vendorData);
      setRenewals(renewalData);
    } catch {
      if (fetchGen !== setupFetchGenRef.current) return;
      setVendors([]);
      setRenewals([]);
    } finally {
      if (fetchGen === setupFetchGenRef.current) {
        setLoading(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    void refreshSetup();
  }, [refreshSetup]);

  const steps = useMemo(
    () => buildSetupSteps(workspaceName, vendors, documentSkipped),
    [workspaceName, vendors, documentSkipped]
  );

  const completedCount = countCompletedSetupSteps(steps);
  const totalSteps = steps.length;
  const complete = isSetupComplete(steps);
  const currentStep = firstIncompleteSetupStep(steps);

  useEffect(() => {
    if (!canWrite || loading || !organizationId || complete) return;
    if (vendors.length > 0) return;
    if (localStorage.getItem(autoOpenKey(organizationId)) === "1") return;
    setSetupOpen(true);
    localStorage.setItem(autoOpenKey(organizationId), "1");
  }, [canWrite, loading, organizationId, complete, vendors.length]);

  const openSetup = useCallback(() => setSetupOpen(true), []);
  const closeSetup = useCallback(() => setSetupOpen(false), []);

  const skipDocumentStep = useCallback(() => {
    if (!organizationId) return;
    localStorage.setItem(documentSkippedKey(organizationId), "1");
    setDocumentSkipped(true);
  }, [organizationId]);

  const value = useMemo(
    () => ({
      vendors,
      renewals,
      loading,
      steps,
      completedCount,
      totalSteps,
      isComplete: complete,
      currentStep,
      documentSkipped,
      setupOpen,
      openSetup,
      closeSetup,
      refreshSetup,
      skipDocumentStep,
    }),
    [
      vendors,
      renewals,
      loading,
      steps,
      completedCount,
      totalSteps,
      complete,
      currentStep,
      documentSkipped,
      setupOpen,
      openSetup,
      closeSetup,
      refreshSetup,
      skipDocumentStep,
    ]
  );

  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}

export function useSetup() {
  const context = useContext(SetupContext);
  if (!context) {
    throw new Error("useSetup must be used within SetupProvider.");
  }
  return context;
}

export function useSetupOptional() {
  return useContext(SetupContext);
}
