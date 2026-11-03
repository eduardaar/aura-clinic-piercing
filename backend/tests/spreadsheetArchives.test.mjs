import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
const excelRequire = createRequire(require.resolve("exceljs/package.json"));
const archiver = excelRequire("archiver");
const unzipper = excelRequire("unzipper");

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

test("dependências de planilhas preservam glob, diretórios e leitura de ZIP", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aura-archive-test-"));
  try {
    await mkdir(path.join(directory, "nested"));
    await writeFile(path.join(directory, "joias.txt"), "Titânio e argolas");
    await writeFile(path.join(directory, "nested", "estoque.txt"), "5");
    const archive = archiver("zip");
    const buffer = collect(archive);
    archive.glob("*.txt", { cwd: directory }, { prefix: "selecao" });
    archive.directory(path.join(directory, "nested"), "estoque");
    await archive.finalize();
    const zip = await unzipper.Open.buffer(await buffer);
    const files = zip.files.filter((file) => file.type === "File");
    assert.deepEqual(files.map((file) => file.path).sort(), ["estoque/estoque.txt", "selecao/joias.txt"]);
    assert.equal((await files.find((file) => file.path === "selecao/joias.txt").buffer()).toString(), "Titânio e argolas");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ExcelJS grava por streaming e reabre a planilha sem perder texto, números ou centavos", async () => {
  const stream = new PassThrough();
  const buffer = collect(stream);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useSharedStrings: true });
  const sheet = workbook.addWorksheet("Estoque");
  sheet.addRow(["Produto", "Quantidade", "Preço"]).commit();
  sheet.addRow(["Argola de titânio", 5, 79.9]).commit();
  await workbook.commit();
  const reader = new ExcelJS.Workbook();
  await reader.xlsx.load(await buffer);
  const rows = [];
  reader.getWorksheet("Estoque").eachRow((row) => rows.push(row.values.slice(1)));
  assert.deepEqual(rows, [["Produto", "Quantidade", "Preço"], ["Argola de titânio", 5, 79.9]]);
});
