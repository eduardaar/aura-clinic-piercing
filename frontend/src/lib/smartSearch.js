import { useEffect, useState } from "react";

export function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshtein(left, right) {
  const a = normalizeSearch(left);
  const b = normalizeSearch(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

export function smartSearchMatches(value, query) {
  const text = normalizeSearch(value);
  const wanted = normalizeSearch(query);
  if (!wanted || text.includes(wanted)) return true;
  const words = text.split(" ").filter(Boolean);
  return wanted.split(" ").filter(Boolean).every((term) =>
    words.some((word) => word.startsWith(term) || (term.length >= 4 && levenshtein(word, term) <= Math.max(1, Math.floor(term.length * 0.25))))
  );
}

export function useDebouncedValue(value, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function readRecentSearches(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(key, query) {
  const value = String(query || "").trim();
  if (value.length < 2) return readRecentSearches(key);
  const next = [value, ...readRecentSearches(key).filter((item) => normalizeSearch(item) !== normalizeSearch(value))].slice(0, 8);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* armazenamento indisponível */ }
  return next;
}
