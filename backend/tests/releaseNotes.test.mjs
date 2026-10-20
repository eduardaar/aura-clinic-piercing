import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceDigest, validateRelease } from "../scripts/release-notes.mjs";

const announcement = {
  slug: "contas-a-pagar",
  title: "Controle as contas do estúdio",
  summary: "Acompanhe os vencimentos.",
  content: "Em Contas a Pagar, escolha Registrar pagamento para informar a data e a forma utilizadas.",
};
test("a conferência da versão é igual em Windows e Linux e preserva bytes das imagens", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aura-release-digest-"));
  const directory = path.join(root, "frontend", "public");
  fs.mkdirSync(directory, { recursive: true });
  const text = path.join(directory, "CREDITS.md");
  const binary = path.join(directory, "pixel.png");
  try {
    fs.writeFileSync(text, "Créditos\nImagem licenciada\n");
    fs.writeFileSync(binary, Buffer.from([0, 13, 10, 255]));
    const lf = sourceDigest(root);
    fs.writeFileSync(text, "Créditos\r\nImagem licenciada\r\n");
    assert.equal(sourceDigest(root), lf);
    fs.writeFileSync(binary, Buffer.from([0, 10, 255]));
    assert.notEqual(sourceDigest(root), lf);
  } finally {
    fs.unlinkSync(text);
    fs.unlinkSync(binary);
    fs.rmdirSync(directory);
    fs.rmdirSync(path.join(root, "frontend"));
    fs.rmdirSync(root);
  }
});
test("publicação exige anúncio completo e escrito para os usuários", () => {
  assert.equal(validateRelease({ id: "2026-10-20-melhorias", announcements: [announcement] }).announcements.length, 1);
  assert.throws(() => validateRelease({ id: "2026-10-20-melhorias", announcements: [] }));
  assert.throws(() =>
    validateRelease({ id: "2026-10-20-melhorias", announcements: [{ ...announcement, summary: "" }] }),
  );
  assert.throws(() => validateRelease({ id: "2026-10-20-melhorias", announcements: [announcement, announcement] }));
  assert.throws(() =>
    validateRelease({
      id: "2026-10-20-melhorias",
      announcements: [{ ...announcement, content: "Alterado endpoint de API no backend." }],
    }),
  );
});
