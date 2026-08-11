import { requireSupabase } from "../lib/supabase";
import { normalizeStorageFileUrl } from "../lib/utils";
import type { InsuranceContract, InsurancePayer, Status } from "../types";
import { uploadOrgFile } from "./vendors";

type PayerRow = {
  id: string;
  organization_id: string;
  name: string;
  payer_type: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  notes: string;
  status: Status;
  insurance_contracts: Array<{
    id: string;
    title: string;
    policy_number: string;
    start_date: string;
    end_date: string;
    credentialing_status: string;
    notes: string;
    file_url: string | null;
    file_name: string | null;
  }> | null;
};

const payerCoreSelect = `
  id,
  organization_id,
  name,
  payer_type,
  primary_contact_name,
  primary_contact_email,
  primary_contact_phone,
  notes,
  status
`;

const payerSelect = `
  ${payerCoreSelect},
  insurance_contracts (
    id, title, policy_number, start_date, end_date, credentialing_status, notes, file_url, file_name
  )
`;

function mapPayer(row: PayerRow): InsurancePayer {
  return {
    id: row.id,
    name: row.name,
    payerType: row.payer_type,
    status: row.status,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    primaryContactPhone: row.primary_contact_phone,
    notes: row.notes,
    contracts: (row.insurance_contracts ?? []).map(
      (contract): InsuranceContract => ({
        id: contract.id,
        title: contract.title,
        policyNumber: contract.policy_number,
        startDate: contract.start_date,
        endDate: contract.end_date,
        credentialingStatus: contract.credentialing_status,
        notes: contract.notes,
        file:
          contract.file_url && contract.file_name
            ? {
                fileName: contract.file_name,
                fileSize: 0,
                fileUrl: normalizeStorageFileUrl(contract.file_url),
                mimeType: "application/octet-stream",
              }
            : undefined,
      })
    ),
  };
}

const setupHint =
  " Run supabase/migrations/032_insurance_crm.sql in Supabase SQL Editor, then refresh.";

export async function fetchPayers(organizationId: string): Promise<InsurancePayer[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("insurance_payers")
    .select(payerSelect)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    const hint =
      error.message.includes("relation") || error.message.includes("does not exist") ? setupHint : "";
    throw new Error(error.message + hint);
  }

  return (data as PayerRow[]).map(mapPayer);
}

export async function createPayer(
  organizationId: string,
  input: {
    name: string;
    payerType: string;
    primaryContactName?: string;
    primaryContactEmail?: string;
    primaryContactPhone?: string;
    notes?: string;
  }
): Promise<InsurancePayer> {
  const { data, error } = await requireSupabase()
    .from("insurance_payers")
    .insert({
      organization_id: organizationId,
      name: input.name.trim(),
      payer_type: input.payerType.trim() || "commercial",
      primary_contact_name: input.primaryContactName ?? "",
      primary_contact_email: input.primaryContactEmail ?? "",
      primary_contact_phone: input.primaryContactPhone ?? "",
      notes: input.notes ?? "",
      status: "active",
    })
    .select(payerCoreSelect)
    .single();

  if (error || !data) {
    throw new Error((error?.message ?? "Could not create payer.") + setupHint);
  }

  return mapPayer({ ...(data as PayerRow), insurance_contracts: [] });
}

export async function updatePayer(
  payerId: string,
  patch: Partial<
    Pick<
      InsurancePayer,
      | "name"
      | "payerType"
      | "status"
      | "primaryContactName"
      | "primaryContactEmail"
      | "primaryContactPhone"
      | "notes"
    >
  >
): Promise<void> {
  const { error } = await requireSupabase()
    .from("insurance_payers")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.payerType !== undefined ? { payer_type: patch.payerType } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.primaryContactName !== undefined ? { primary_contact_name: patch.primaryContactName } : {}),
      ...(patch.primaryContactEmail !== undefined ? { primary_contact_email: patch.primaryContactEmail } : {}),
      ...(patch.primaryContactPhone !== undefined ? { primary_contact_phone: patch.primaryContactPhone } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    })
    .eq("id", payerId);

  if (error) throw new Error(error.message);
}

export async function deletePayer(payerId: string): Promise<void> {
  const { error } = await requireSupabase().from("insurance_payers").delete().eq("id", payerId);
  if (error) throw new Error(error.message);
}

export async function addInsuranceContract(
  organizationId: string,
  payerId: string,
  contract: Omit<InsuranceContract, "id">
) {
  const { error } = await requireSupabase().from("insurance_contracts").insert({
    organization_id: organizationId,
    payer_id: payerId,
    title: contract.title,
    policy_number: contract.policyNumber,
    start_date: contract.startDate,
    end_date: contract.endDate,
    credentialing_status: contract.credentialingStatus,
    notes: contract.notes,
    file_url: contract.file?.fileUrl ?? null,
    file_name: contract.file?.fileName ?? null,
  });

  if (error) throw new Error(error.message);
}

export async function deleteInsuranceContract(contractId: string) {
  const { error } = await requireSupabase().from("insurance_contracts").delete().eq("id", contractId);
  if (error) throw new Error(error.message);
}

export async function uploadPayerFile(organizationId: string, payerId: string, file: File) {
  return uploadOrgFile(organizationId, payerId, file);
}

export async function seedSamplePayers(organizationId: string): Promise<void> {
  const client = requireSupabase();
  const soonEnd = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const samples = [
    {
      name: "Blue Cross Blue Shield",
      payer_type: "commercial",
      notes: "Primary commercial payer — renegotiate fee schedule before term ends.",
      contracts: [
        {
          title: "2026 participation agreement",
          policy_number: "BCBS-AMG-2026",
          start_date: "2026-01-01",
          end_date: soonEnd,
          credentialing_status: "active",
        },
      ],
    },
    {
      name: "Medicare",
      payer_type: "government",
      notes: "PTAN on file. Monitor reassignment forms.",
      contracts: [
        {
          title: "Medicare enrollment",
          policy_number: "PTAN-1234567",
          start_date: "2025-01-01",
          end_date: "2027-12-31",
          credentialing_status: "active",
        },
      ],
    },
  ];

  for (const sample of samples) {
    const { data: payer, error } = await client
      .from("insurance_payers")
      .insert({
        organization_id: organizationId,
        name: sample.name,
        payer_type: sample.payer_type,
        notes: sample.notes,
        status: "active",
      })
      .select("id")
      .single();

    if (error || !payer) throw new Error(error?.message ?? "Seed failed.");

    if (sample.contracts.length) {
      await client.from("insurance_contracts").insert(
        sample.contracts.map((contract) => ({
          organization_id: organizationId,
          payer_id: payer.id,
          ...contract,
        }))
      );
    }
  }
}
