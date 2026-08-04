import type { SupabaseClient } from "@supabase/supabase-js";
import { ORG_FILES_BUCKET } from "./storage";
import { requireSupabase } from "./supabase";
import { getStoragePathFromFileUrl, normalizeStorageFileUrl } from "./utils";

async function listStorageObjectPaths(
  client: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  const paths: string[] = [];

  async function walk(currentPath: string) {
    let offset = 0;
    const limit = 100;

    while (true) {
      const { data, error } = await client.storage.from(ORG_FILES_BUCKET).list(currentPath, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) {
        console.warn(`Could not list storage at "${currentPath}":`, error.message);
        return;
      }

      if (!data?.length) break;

      for (const item of data) {
        const fullPath = currentPath ? `${currentPath}/${item.name}` : item.name;
        if (item.id === null) {
          await walk(fullPath);
        } else {
          paths.push(fullPath);
        }
      }

      if (data.length < limit) break;
      offset += limit;
    }
  }

  await walk(normalized);
  return paths;
}

export async function removeOrgStoragePaths(
  client: SupabaseClient,
  paths: string[]
): Promise<void> {
  if (!paths.length) return;

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await client.storage.from(ORG_FILES_BUCKET).remove(batch);
    if (error) {
      console.warn("Could not remove storage files:", error.message);
    }
  }
}

export async function removeOrgStoragePrefixWithClient(
  client: SupabaseClient,
  prefix: string
): Promise<void> {
  const paths = await listStorageObjectPaths(client, prefix);
  await removeOrgStoragePaths(client, paths);
}

export async function removeOrgStoragePrefix(prefix: string): Promise<void> {
  await removeOrgStoragePrefixWithClient(requireSupabase(), prefix);
}

export async function removeOrgStorageFileFromUrl(
  fileUrl: string | null | undefined
): Promise<void> {
  if (!fileUrl?.trim()) return;

  const normalized = normalizeStorageFileUrl(fileUrl);
  if (!normalized.startsWith("sb://")) return;

  try {
    const path = getStoragePathFromFileUrl(normalized);
    await removeOrgStoragePaths(requireSupabase(), [path]);
  } catch (error) {
    console.warn(
      "Could not remove storage file:",
      error instanceof Error ? error.message : error
    );
  }
}
