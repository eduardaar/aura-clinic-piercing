import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.dirname(backendRoot);
const manifestPath = path.join(backendRoot, "releases/current.json");

export function validateRelease(manifest) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id || "") ||
    !Array.isArray(manifest.announcements) ||
    !manifest.announcements.length
  )
    throw new Error("A atualização precisa de anúncios em Novidades.");
  const slugs = new Set();
  for (const item of manifest.announcements) {
    if (
      !item.title?.trim() ||
      !item.summary?.trim() ||
      !item.content?.trim() ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug || "") ||
      slugs.has(item.slug)
    )
      throw new Error("Revise o título, o resumo, o texto e o endereço dos anúncios.");
    if (
      /\b(?:API|SQL|PostgreSQL|backend|frontend|migration|deploy|endpoint)\b|\.(?:jsx?|mjs|sql)\b/i.test(
        [item.title, item.summary, item.content].join(" "),
      )
    )
      throw new Error("Escreva as novidades para os usuários, sem detalhes de programação.");
    slugs.add(item.slug);
  }
  return manifest;
}

export function sourceDigest(sourceRoot = root) {
  const hash = crypto.createHash("sha256");
  function visit(file) {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) if (child !== "data") visit(path.join(file, child));
    } else {
      hash.update(path.relative(sourceRoot, file).replaceAll("\\", "/"));
      const bytes = fs.readFileSync(file);
      hash.update(
        /\.(?:[cm]?jsx?|json|sql|css|html|svg|txt|md|xml|webmanifest)$/.test(file)
          ? bytes.toString("utf8").replaceAll("\r\n", "\n")
          : bytes,
      );
    }
  }
  for (const entry of [
    "backend/src",
    "frontend/src",
    "frontend/public",
    "frontend/index.html",
    "package.json",
    "package-lock.json",
    "backend/package.json",
    "backend/package-lock.json",
    "frontend/package.json",
    "frontend/package-lock.json",
  ])
    visit(path.join(sourceRoot, entry));
  return hash.digest("hex");
}

async function main() {
  const command = process.argv[2] || "check";
  const manifest = validateRelease(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (command === "prepare") {
    manifest.source_digest = sourceDigest();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Novidades preparadas: ${manifest.id}`);
    return;
  }
  if (command === "check") {
    if (manifest.source_digest !== sourceDigest())
      throw new Error("Atualize Novidades e execute npm run release:prepare antes de publicar.");
    let previous;
    try {
      previous = JSON.parse(
        execFileSync("git", ["show", "HEAD^:backend/releases/current.json"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      /* First release manifest. */
    }
    if (previous?.id === manifest.id && previous.source_digest !== manifest.source_digest)
      throw new Error("Uma alteração publicada precisa de uma nova identificação e do anúncio correspondente.");
    console.log(`Novidades verificadas: ${manifest.announcements.length} anúncios.`);
    return;
  }
  if (command !== "publish") throw new Error("Use check, prepare ou publish.");
  if (process.env.NODE_ENV !== "production")
    throw new Error("A publicação de novidades deve ocorrer após a ativação em produção.");
  const { pool } = await import("../src/database/connection.js");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of manifest.announcements)
      await client.query(
        `INSERT INTO platform.content_articles(content_type,slug,title,summary,content,category,status,published_at)
      VALUES('news',$1,$2,$3,$4,$5,'published',now()) ON CONFLICT(content_type,slug) DO NOTHING`,
        [`${manifest.id}-${item.slug}`, item.title, item.summary, item.content, item.category || "Melhorias"],
      );
    await client.query("COMMIT");
    console.log(`Novidades publicadas: ${manifest.id}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
