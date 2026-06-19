export type Status = "active" | "inactive" | "pending" | "expired";
export type LedgerType = "payment" | "credit" | "adjustment";
export type OrgRole = "owner" | "admin" | "member" | "viewer";

export type Contact = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
};

export type FileAttachment = {
  fileName: string;
  fileSize: number;
  fileUrl: string;
  mimeType: string;
};

export type Contract = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  value: number;
  status: Status;
  file?: FileAttachment;
};

export type LedgerEntry = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: LedgerType;
  source?: "manual" | "imported" | "estimated";
};

export type DocumentDocType = "general" | "coi" | "w9" | "license";

export type DocumentItem = {
  id: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  fileUrl: string;
  docType: DocumentDocType;
  expiresAt?: string;
};

export type EvaluationRecommendation = "preferred" | "acceptable" | "under_review" | "do_not_renew";

export type EvaluationCriteria = Partial<
  Record<"quality" | "responsiveness" | "value" | "compliance" | "reliability", number>
>;

export type Evaluation = {
  id: string;
  date: string;
  score: number;
  criteria: EvaluationCriteria;
  recommendation: EvaluationRecommendation;
  reviewerName: string;
  notes: string;
};

export type Experiment = {
  id: string;
  title: string;
  description: string;
  status: "idea" | "testing" | "keeper";
};

export type Vendor = {
  id: string;
  directoryId?: string;
  name: string;
  category: string;
  status: Status;
  notes: string;
  notesLocked?: boolean;
  address: string;
  createdAt?: string;
  contacts: Contact[];
  contracts: Contract[];
  ledger: LedgerEntry[];
  documents: DocumentItem[];
  evaluations: Evaluation[];
  experiments: Experiment[];
};

export type Organization = {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  isFounding: boolean;
  lockedMonthlyPriceCents: number | null;
  foundingEnrolledAt: string | null;
  renewalRemindersEnabled: boolean;
  weeklyDigestEnabled: boolean;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  role: OrgRole;
  organization: Organization;
};

export type RenewalUrgency = "overdue" | "soon" | "upcoming";

export type RenewalItem = {
  contractId: string;
  contractName: string;
  vendorId: string;
  vendorName: string;
  endDate: string;
  value: number;
  status: Status;
  daysUntilEnd: number;
  urgency: RenewalUrgency;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
};

export type SearchResult = {
  entityType: string;
  entityId: string;
  vendorId: string;
  vendorName: string;
  title: string;
  subtitle: string;
};

export type VendorMaturity = "emerging" | "established";

export type DirectoryListing = {
  id: string;
  name: string;
  category: string;
  location: string;
  description: string;
  maturity: VendorMaturity;
  yearsInBusiness: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
};
