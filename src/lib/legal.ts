export const TERMS_VERSION = "2026-08-04";
export const LEGAL_LAST_UPDATED = "August 4, 2026";
export const PRIVACY_LAST_UPDATED = "August 4, 2026";
export const LEGAL_CONTACT_EMAIL = "legal@suppliersync.org";

export function hasAcceptedCurrentTerms(status: {
  termsAcceptedAt: string | null;
  termsVersion: string | null;
}): boolean {
  if (!status.termsAcceptedAt || !status.termsVersion) return false;
  return status.termsVersion === TERMS_VERSION;
}

export type LegalSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: "1. Agreement",
    paragraphs: [
      'These Terms of Service ("Terms") govern your access to and use of SupplierSync (the "Service"), operated by the SupplierSync team ("we," "us," or "our").',
      "By creating an account or using the Service, you agree to these Terms and our Privacy Policy. If you are using the Service on behalf of a clinic or company, you represent that you have authority to bind that organization.",
    ],
  },
  {
    title: "2. The Service",
    paragraphs: [
      "SupplierSync helps private medical clinics organize vendor records, contracts, compliance documents, renewals, and related operational information in a secure workspace. Access is provided on a subscription basis.",
      "The Service is a business operations tool operated as an independent software product. It is not medical software, legal advice, accounting software, or a substitute for professional counsel. You remain responsible for your clinic's vendor decisions, contract terms, and regulatory compliance.",
    ],
  },
  {
    title: "3. Your data",
    paragraphs: [
      'You retain ownership of the information you upload or enter into your workspace, including vendor names, contacts, contracts, documents, and notes ("Clinic Data").',
      "You grant us a limited license to host, process, back up, and display Clinic Data solely to provide and improve the Service. We do not sell Clinic Data.",
      "Optional AI features (such as contract and document scanning) send PDF content to our AI subprocessors to extract fields. We do not use Clinic Data to train third-party models for our account.",
      "Each clinic workspace is logically separated. You control who can access your workspace through your account and (when available) team invitations.",
    ],
  },
  {
    title: "4. Acceptable use",
    paragraphs: ["You agree not to:"],
    bullets: [
      "Use the Service for unlawful purposes or upload content you do not have rights to use.",
      "Attempt to access another clinic's workspace without authorization.",
      "Reverse engineer, scrape, or resell the Service except as expressly permitted.",
      "Upload malware or interfere with the security or performance of the Service.",
      "Misrepresent your identity or affiliation when registering or applying for pricing programs.",
    ],
  },
  {
    title: "5. Accounts & security",
    paragraphs: [
      "You are responsible for safeguarding login credentials and for activity under your account. Notify us promptly if you suspect unauthorized access.",
      "You must provide accurate registration information and keep your contact details current.",
    ],
  },
  {
    title: "6. Subscriptions & billing",
    paragraphs: [
      "Paid plans, trials, founding pricing, and promotions are described at signup or on the Billing page. Fees are billed in advance unless stated otherwise.",
      "You may cancel according to the billing flow provided in the Service. We may suspend or terminate access for non-payment after reasonable notice where applicable.",
      "Founding or promotional pricing may be subject to eligibility review and program limits described in the product.",
    ],
  },
  {
    title: "7. Confidentiality & security",
    paragraphs: [
      "We use commercially reasonable safeguards to protect the Service and Clinic Data, including access controls and encrypted connections. No system is perfectly secure; you use the Service at your own risk.",
      "You are responsible for determining whether the Service meets your clinic's internal policies. If your clinic requires a Business Associate Agreement (BAA) under HIPAA for specific workflows, contact us before relying on the Service for protected health information.",
    ],
  },
  {
    title: "8. Disclaimers",
    paragraphs: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.',
      "We do not guarantee that renewals, compliance deadlines, or email reminders will be error-free or delivered on time. You should maintain independent records for critical contract dates.",
    ],
  },
  {
    title: "9. Limitation of liability",
    paragraphs: [
      "To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, data, or business opportunities arising from your use of the Service.",
      "Our total liability for any claim relating to the Service is limited to the greater of (a) amounts you paid us in the twelve (12) months before the claim or (b) one hundred U.S. dollars (USD $100).",
    ],
  },
  {
    title: "10. Termination",
    paragraphs: [
      "You may stop using the Service at any time. We may suspend or terminate access if you violate these Terms, create security or legal risk, or fail to pay applicable fees.",
      "Upon termination, your right to access the Service ends. Provisions that by nature should survive (including data ownership, disclaimers, and limitations of liability) will survive.",
    ],
  },
  {
    title: "11. Changes",
    paragraphs: [
      `We may update these Terms from time to time. We will post the revised Terms with an updated version date. When we make material changes, we may require you to accept the updated Terms before continuing to use the Service.`,
    ],
  },
  {
    title: "12. Contact",
    paragraphs: [`Questions about these Terms: ${LEGAL_CONTACT_EMAIL}.`],
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: "1. Overview",
    paragraphs: [
      'This Privacy Policy explains how SupplierSync ("we," "us") collects, uses, and protects information when you use our website and application (the "Service").',
      "We build tools for clinic operations. We do not sell customer data.",
    ],
  },
  {
    title: "2. Information we collect",
    paragraphs: ["We collect:"],
    bullets: [
      "Account information: name, email address, password (stored securely by our auth provider), and workspace membership.",
      "Clinic Data you enter: vendor records, contacts, contracts, documents, spend entries, and related notes.",
      "Usage information: log data, device/browser type, and product analytics needed to operate and secure the Service.",
      "Billing information: processed by our payment provider; we do not store full payment card numbers on our servers.",
    ],
  },
  {
    title: "3. How we use information",
    paragraphs: ["We use information to:"],
    bullets: [
      "Provide, maintain, and improve the Service.",
      "Authenticate users and enforce workspace access controls.",
      "Send transactional messages such as renewal reminders or vendor reports you enable.",
      "Respond to support requests and protect against abuse or security incidents.",
      "Comply with legal obligations.",
    ],
  },
  {
    title: "4. How we share information",
    paragraphs: [
      "We share information only with service providers that help us run the Service, under contracts that require appropriate protection.",
      "We may disclose information if required by law or to protect rights, safety, and security.",
      "We do not sell personal information or Clinic Data.",
    ],
  },
  {
    title: "5. Subprocessors",
    paragraphs: [
      "We use the following subprocessors to operate the Service. Each is bound by data protection terms appropriate to their role:",
    ],
    bullets: [
      "Supabase — database, authentication, and file storage.",
      "Stripe — subscription billing and payment processing.",
      "Resend — transactional email (for example, renewal reminders you enable).",
      "OpenAI — AI document extraction; PDF content is sent for contract and document scanning features.",
      "Vercel — frontend application hosting.",
    ],
  },
  {
    title: "6. AI processing & health information",
    paragraphs: [
      "When you use AI scan features, PDF files are transmitted to OpenAI to extract contract dates, amounts, document types, and similar fields. We do not store PDF content in our database for that processing; extraction results are saved as structured fields you choose to keep.",
      "Do not upload protected health information (PHI) or other regulated data unless your clinic has determined that use is appropriate and any required agreements are in place.",
      "SupplierSync is not HIPAA-certified. Clinics remain responsible for what they upload and for compliance with applicable laws. Contact us at legal@suppliersync.org for Business Associate Agreement (BAA) inquiries before relying on the Service for PHI.",
    ],
  },
  {
    title: "7. Data storage & security",
    paragraphs: [
      "Clinic Data is stored in secure cloud infrastructure with access controls. Connections to the Service use encryption in transit.",
      "You choose what to upload. Do not upload information you are not authorized to store in a third-party operations tool.",
    ],
  },
  {
    title: "8. Retention",
    paragraphs: [
      "We retain account and Clinic Data while your workspace is active.",
      "Operational logs (for example, API usage records used for abuse prevention) are retained for a short period, typically seven days, then purged automatically.",
      "When you delete your account or workspace through Account settings, we remove data from active systems within a reasonable period. Encrypted backups may retain deleted data briefly before rotation, consistent with our infrastructure provider's backup schedule.",
      "For a detailed retention reference, see our internal data retention documentation (summarized in the Privacy Policy and available on request).",
    ],
  },
  {
    title: "9. Your choices",
    paragraphs: [
      "You may access and update profile information in the app. Workspace owners control clinic records inside their workspace.",
      "Workspace owners may export workspace data (vendor records, contacts, contract and document metadata, spend, and evaluations) as JSON from Account settings.",
      "You may delete your entire account or an owned workspace from Account settings. Deletion removes data from active systems; backups may retain copies briefly as described above.",
      "You may opt out of non-essential emails where the product provides controls (for example, report email settings).",
      "Contact us at legal@suppliersync.org for additional export or deletion assistance.",
    ],
  },
  {
    title: "10. Children's privacy",
    paragraphs: ["The Service is for business use by clinics and is not directed to children under 16."],
  },
  {
    title: "11. Changes",
    paragraphs: [
      "We may update this Privacy Policy from time to time. We will post the revised policy with an updated date. Continued use after changes become effective means you accept the updated policy.",
    ],
  },
  {
    title: "12. Contact",
    paragraphs: [`Privacy questions: ${LEGAL_CONTACT_EMAIL}.`],
  },
];
