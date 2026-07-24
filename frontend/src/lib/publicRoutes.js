const TENANT_KEYS = ["t", "tenant", "clinic"];
const CATALOG_STATE_KEYS = ["category", "q", "material", "color", "stone", "size", "topSize", "available", "sort"];

export function publicTenant(search = window.location.search) {
  const params = new URLSearchParams(search);
  return TENANT_KEYS.map((key) => params.get(key)).find(Boolean) || "";
}

export function publicUrl(path, values = {}, { preserveCatalogState = false } = {}) {
  const current = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const tenant = publicTenant(window.location.search);
  if (tenant) params.set("t", tenant);
  if (preserveCatalogState) {
    CATALOG_STATE_KEYS.forEach((key) => {
      const value = current.get(key);
      if (value) params.set(key, value);
    });
  }
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export function catalogUrl(path = "/catalogo", values = {}) {
  return publicUrl(path, values, { preserveCatalogState: true });
}

export function replaceCatalogState(values = {}) {
  const params = new URLSearchParams(window.location.search);
  CATALOG_STATE_KEYS.forEach((key) => params.delete(key));
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== false) {
      params.set(key, String(value));
    }
  });
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
}
