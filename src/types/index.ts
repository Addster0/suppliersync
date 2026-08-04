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

export type ContractRenewalType = "fixed_term" | "auto_renew" | "month_to_month" | "evergreen";

export type Contract = {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  renewalDate: string | null;
  renewalType: ContractRenewalType;
  noticePeriodDays: number | null;
  termMonths: number | null;
  value: number;
  status: Status;
  createdAt?: string;
  renewalHandledAt?: string | null;
  renewalHandledNote?: string | null;
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

export type Profile = {
  id: string;
  email: string;
  fullName: string;
  renewalNotificationEmail: string | null;
};

export type Organization = {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  isFounding: boolean;
  lockedMonthlyPriceCents: number | null;
  foundingEnrolledAt: string | null;
  renewalRemindersEnabled: boolean;
  monthlyDigestEnabled: boolean;
  annualDigestEnabled: boolean;
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
  /** Date used for urgency sorting and reminders (review or renewal). */
  actionDate: string;
  dateLabel: string;
  renewalType: ContractRenewalType;
  /** @deprecated use actionDate — kept for reports that reference end date */
  endDate: string;
  value: number;
  status: Status;
  daysUntilEnd: number;
  urgency: RenewalUrgency;
  renewalHandledAt?: string | null;
  renewalHandledNote?: string | null;
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

export type OutreachStage =
  | "research"
  | "contacted"
  | "replied"
  | "trial"
  | "founding"
  | "converted"
  | "not_interested"
  | "nurture";

export type OutreachFit = "high" | "medium" | "low";

export type OutreachSource = "npi" | "google" | "referral" | "linkedin" | "conference" | "other";

export type OutreachActivityType = "email" | "linkedin" | "call" | "meeting" | "note";

export type OutreachLead = {
  id: string;
  clinicName: string;
  contactName: string;
  role: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  city: string;
  specialty: string;
  source: OutreachSource;
  fit: OutreachFit;
  tags: string[];
  stage: OutreachStage;
  notes: string;
  nextActionDate: string | null;
  nextActionNote: string;
  createdAt: string;
  updatedAt: string;
};

export type OutreachActivity = {
  id: string;
  leadId: string;
  activityType: OutreachActivityType;
  summary: string;
  occurredAt: string;
  createdAt: string;
};

export type OutreachWeeklyStats = {
  researchAdded: number;
  emailsSent: number;
  linkedinSent: number;
  callsAndMeetings: number;
  totalActivities: number;
};

export type OutreachPipelineSummary = Record<OutreachStage, number>;
