export type VendorTemplate = {
  id: string;
  label: string;
  category: string;
  hint: string;
};

export const VENDOR_TEMPLATES: VendorTemplate[] = [
  {
    id: "lab",
    label: "Lab / Diagnostics",
    category: "Lab",
    hint: "Upload service agreements and COI when you add contracts.",
  },
  {
    id: "it",
    label: "IT / MSP",
    category: "IT",
    hint: "Track support contracts and renewal notice windows.",
  },
  {
    id: "cleaning",
    label: "Cleaning / Janitorial",
    category: "Cleaning",
    hint: "Often annual contracts — set the end date during setup.",
  },
  {
    id: "hvac",
    label: "HVAC / Facilities",
    category: "Facilities",
    hint: "Maintenance agreements with seasonal renewals.",
  },
  {
    id: "waste",
    label: "Medical waste",
    category: "Medical waste",
    hint: "Compliance-heavy — add COI and license docs later.",
  },
  {
    id: "payroll",
    label: "Payroll / HR",
    category: "HR",
    hint: "W-9 and service terms are common here.",
  },
  {
    id: "insurance",
    label: "Insurance / COI holder",
    category: "Insurance",
    hint: "Track policy renewals and certificate expirations.",
  },
];

export function vendorTemplateById(id: string) {
  return VENDOR_TEMPLATES.find((template) => template.id === id);
}
