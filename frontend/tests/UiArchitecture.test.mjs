import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

async function filesUnder(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension);
    return entry.name.endsWith(extension) ? [path] : [];
  }));
  return nested.flat();
}

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("telas não reintroduzem controles complexos nativos", async () => {
  const files = [
    ...(await filesUnder(join(SRC_ROOT, "components"), ".jsx")),
    ...(await filesUnder(join(SRC_ROOT, "features"), ".jsx")),
    ...(await filesUnder(join(SRC_ROOT, "pages"), ".jsx")),
  ];
  const violations = [];
  const forbidden = [
    [/<select\b/, "select nativo"],
    [/<dialog\b/, "dialog nativo"],
    [/<details\b/, "details nativo"],
    [/<input\b[^>]*\btype\s*=\s*["'](?:checkbox|radio)["']/, "checkbox/radio nativo"],
  ];

  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    for (const [pattern, label] of forbidden) {
      if (pattern.test(source)) violations.push(`${relative(SRC_ROOT, file)}: ${label}`);
    }
  }

  assert.deepEqual(violations, [], `Use os componentes compartilhados Radix:\n${violations.join("\n")}`);
});

test("features e páginas consomem Radix pela camada compartilhada", async () => {
  const files = [
    ...(await filesUnder(join(SRC_ROOT, "features"), ".jsx")),
    ...(await filesUnder(join(SRC_ROOT, "pages"), ".jsx")),
  ];
  const violations = [];

  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    if (/from\s+["']@radix-ui\//.test(source)) {
      violations.push(relative(SRC_ROOT, file));
    }
  }

  assert.deepEqual(violations, [], `Importe primitives por components/common:\n${violations.join("\n")}`);
});

test("folhas de estilo pertencem a uma camada da cascata", async () => {
  const files = await filesUnder(join(SRC_ROOT, "styles"), ".css");
  const violations = [];

  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    if (!/@layer\s+(?:base|legado|telas|app)\b/.test(source)) {
      violations.push(relative(SRC_ROOT, file));
    }
  }

  assert.deepEqual(violations, [], `Declare @layer no CSS:\n${violations.join("\n")}`);
});
