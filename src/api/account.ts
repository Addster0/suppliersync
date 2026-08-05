import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { removeOrgStoragePrefix } from "../lib/storageCleanup";
import { requireSupabase } from "../lib/supabase";

async function functionInvokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const payload = (await error.context.clone().json()) as { error?: string; message?: string };
      const bodyError = payload?.error?.trim() || payload?.message?.trim();
      if (bodyError) {
        if (/delete_my_account|function.*does not exist/i.test(bodyError)) {
          return "Account deletion database migration is missing. Run migration 029 in Supabase SQL Editor.";
        }
        return bodyError;
      }
    } catch {
      // Response body was not JSON.
    }

    if (error.context.status === 404) {
      return "Account deletion is not deployed. Run ./scripts/setup-delete-account.sh.";
    }
    if (error.context.status === 401) {
      return "Sign in again to delete your account.";
    }
    if (error.context.status === 409) {
      return "Resolve workspace ownership before deleting your account.";
    }
  }

  if (error instanceof FunctionsFetchError) {
    return "Cannot reach Supabase edge functions. Check your connection and try again.";
  }

  if (error instanceof FunctionsRelayError) {
    return "Supabase could not run the account deletion function. Try again in a moment.";
  }

  if (error instanceof Error && error.message !== "Edge Function returned a non-2xx status code") {
    return error.message;
  }

  return "Account deletion failed.";
}

export async function deleteOrganization(organizationId: string): Promise<void> {
  await removeOrgStoragePrefix(organizationId);

  const { error } = await requireSupabase().rpc("delete_organization", {
    p_org_id: organizationId,
  });

  if (error) throw new Error(error.message);
}

export async function deleteAccount(): Promise<void> {
  const { error } = await requireSupabase().functions.invoke("delete-account", {
    body: {},
  });

  if (error) {
    throw new Error(await functionInvokeErrorMessage(error));
  }
}
