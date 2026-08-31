import { INTERNAL_APP_PAGES } from "./appPages.js";

const PAGE_BY_ID = new Map(INTERNAL_APP_PAGES.map((page) => [page.id, page]));
const PAGE_BY_PATH = new Map(/** @type {[string, string][]} */ (INTERNAL_APP_PAGES.flatMap((page) => [
  [page.path, page.id],
  ...(page.aliases || []).map((alias) => [alias, page.id])
])));

export function appPathForPage(page) {
  return PAGE_BY_ID.get(page)?.path || PAGE_BY_ID.get("dashboard").path;
}

export function pageForAppPath(pathname = window.location.pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  return PAGE_BY_PATH.get(normalized) || null;
}

export function isAppPath(pathname = window.location.pathname) {
  return String(pathname || "").startsWith("/app");
}
