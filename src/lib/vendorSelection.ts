export function selectedVendorStorageKey(organizationId: string) {
  return `suppliersync-selected-vendor-${organizationId}`;
}

export function loadSelectedVendorId(organizationId: string): string {
  if (!organizationId) return "";
  return sessionStorage.getItem(selectedVendorStorageKey(organizationId)) ?? "";
}

export function saveSelectedVendorId(organizationId: string, vendorId: string) {
  if (!organizationId) return;
  if (vendorId) {
    sessionStorage.setItem(selectedVendorStorageKey(organizationId), vendorId);
  } else {
    sessionStorage.removeItem(selectedVendorStorageKey(organizationId));
  }
}

export function resolveSelectedVendorId(
  vendors: { id: string }[],
  current: string,
  organizationId: string
): string {
  if (current && vendors.some((vendor) => vendor.id === current)) return current;

  const stored = loadSelectedVendorId(organizationId);
  if (stored && vendors.some((vendor) => vendor.id === stored)) return stored;

  return vendors[0]?.id ?? "";
}
