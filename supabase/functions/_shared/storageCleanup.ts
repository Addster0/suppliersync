import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const ORG_FILES_BUCKET = "organization-files";

async function listStorageObjectPaths(
  admin: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  const paths: string[] = [];

  async function walk(currentPath: string) {
    let offset = 0;
    const limit = 100;

    while (true) {
      const { data, error } = await admin.storage.from(ORG_FILES_BUCKET).list(currentPath, {
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

export async function removeOrgStoragePrefix(
  admin: SupabaseClient,
  prefix: string
): Promise<void> {
  const paths = await listStorageObjectPaths(admin, prefix);
  if (!paths.length) return;

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await admin.storage.from(ORG_FILES_BUCKET).remove(batch);
    if (error) {
      console.warn("Could not remove storage files:", error.message);
    }
  }
}
