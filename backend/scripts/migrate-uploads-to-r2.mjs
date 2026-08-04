#!/usr/bin/env node
// Migração dos anexos que já estão no DISCO do servidor para o Cloudflare R2.
//
// Roda UMA vez, em produção, DEPOIS do deploy do código que fala com o R2 (a
// camada nova lê do bucket e cai no disco quando o objeto ainda não subiu, então
// no intervalo entre o deploy e esta migração nada quebra). Ver docs/R2.md para
// a ordem completa dos passos.
//
//   node backend/scripts/migrate-uploads-to-r2.mjs --backup=/caminho/uploads_x.tar.gz
//   node backend/scripts/migrate-uploads-to-r2.mjs --backup=... --apply
//
// ---------------------------------------------------------------------------
// AS QUATRO GARANTIAS
// ---------------------------------------------------------------------------
// 1. NÃO RODA SEM BACKUP. `--backup=` apontando um .tar.gz recente de
//    `backup-uploads.sh`, ou `--skip-backup --sem-rede` (barulhento, e o motivo
//    fica gravado no relatório).
// 2. DRY-RUN POR PADRÃO. Sem `--apply` o script não escreve em lugar nenhum —
//    nem no bucket, nem no banco, nem no disco — e imprime o plano inteiro.
// 3. NUNCA APAGA O DISCO. Não existe uma única chamada de remoção aqui. O disco
//    continua sendo a rede de segurança E o fallback de leitura da camada nova
//    (`services/storage/index.js`, `getPrivateStream`). Esvaziar `src/data/
//    uploads` é DECISÃO HUMANA, depois de semanas de bucket no ar — ver o passo
//    8 de docs/R2.md.
// 4. IDEMPOTENTE E RETOMÁVEL. Objeto que já está no bucket com o mesmo tamanho e
//    o mesmo MD5 é pulado. URL já reescrita não casa mais com `/uploads/…`, então
//    a segunda passada não a toca. Rodar de novo depois de uma falha no meio
//    continua exatamente de onde parou.
// ---------------------------------------------------------------------------
// COMO O DONO DE CADA ARQUIVO É DESCOBERTO (nunca pelo nome do arquivo)
// ---------------------------------------------------------------------------
// O disco é PLANO e COMPARTILHADO entre todas as clínicas (pendência #7 de
// docs/PENDENCIAS.md) — o nome não diz nada. Quem diz é o banco:
//
//   PRIVADO  `private_files` vive DENTRO do schema `tenant_<id>`. O arquivo é da
//            clínica em cujo `private_files` a linha aparece. A chave sai de
//            tenant + `purpose` + filename, e é exatamente a mesma que
//            `GET /api/private-files/:filename` reconstrói na leitura — por isso
//            arquivo privado NÃO precisa de reescrita no banco.
//   PÚBLICO  varre TODA coluna de texto/JSON dos schemas das clínicas em busca
//            de `/uploads/<arquivo>`. A clínica em cujo schema a referência
//            aparece é a dona. A coluna que referencia define a CATEGORIA.
//   ÓRFÃO    arquivo em disco que nenhuma linha referencia. Vai para
//            `orfaos/<arquivo>` no bucket PRIVADO — sem dono conhecido, não pode
//            ser servido publicamente, mas também não some do mundo.
//
// A convenção de chaves NÃO é reescrita aqui: `buildKey` é importado de
// `services/storage/keys.js`, o mesmo módulo que a aplicação usa para gravar e
// para ler. É isso que garante que o PDF de termo (purpose `digital_term`, pasta
// `termos`) caia na chave que a rota de leitura procura.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HeadObjectCommand } from "@aws-sdk/client-s3";

import { pool } from "../src/database/connection.js";
import {
  R2_BUCKET_PRIVATE,
  R2_BUCKET_PUBLIC,
  R2_PUBLIC_BASE_URL,
  privateUploadsDir,
  r2Enabled,
  uploadsDir
} from "../src/config/index.js";
import { createR2Client, createStorage } from "../src/services/storage/index.js";
import {
  DEFAULT_PUBLIC_CATEGORY,
  ORPHAN_PREFIX,
  PLATFORM_PREFIX,
  buildKey,
  folderForPurpose,
  sanitizeFilename
} from "../src/services/storage/keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..");
const BACKUPS_DIR = path.join(BACKEND_DIR, "backups");
const LEDGER_PATH = path.join(BACKUPS_DIR, "migracao-r2-ledger.jsonl");

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const options = {
  apply: flag("apply"),
  backup: value("backup"),
  skipBackup: flag("skip-backup"),
  semRede: flag("sem-rede"),
  maxBackupAgeHours: Number(value("max-backup-age-hours", "24")),
  onlyTenant: value("only-tenant") ? Number(value("only-tenant")) : null,
  scanAllColumns: flag("scan-all-columns"),
  flatCategory: flag("flat-category"),
  concurrency: Math.max(1, Math.min(16, Number(value("concurrency", "4")) || 4)),
  report: value("report"),
  // Onde os anexos estão DE VERDADE. O padrão é o que `config/index.js` calcula
  // (backend/src/data/...), mas em produção esses diretórios podem ser um volume
  // Docker montado em outro lugar — e é o mesmo par de flags que permite
  // exercitar o dry-run contra um cenário descartável, sem chegar perto do
  // diretório real.
  uploadsDir: value("uploads-dir"),
  privateUploadsDir: value("private-uploads-dir"),
  help: flag("help") || flag("h")
};

const USAGE = `
Migra os anexos do disco para o Cloudflare R2.

  --backup=<arquivo.tar.gz>   OBRIGATÓRIO. Backup gerado por backup-uploads.sh.
  --skip-backup --sem-rede    Dispensa o backup. Exige as DUAS flags e fica
                              registrado no relatório. Não faça isso.
  --apply                     Escreve de verdade. SEM ela é dry-run (padrão).
  --max-backup-age-hours=N    Idade máxima aceita do backup (padrão: 24).
  --only-tenant=<id>          Migra só uma clínica (útil para o primeiro apply).
  --scan-all-columns          Varre TODA coluna de texto/JSON, não só as de nome
                              sugestivo. Mais lento, pega coluna esquecida.
  --flat-category             Joga todo público em <tenant>/geral/ em vez de
                              usar joias/catalogo/banners/logo. Ver nota sobre
                              routes/uploads.js:16 em docs/R2.md.
  --concurrency=N             Uploads simultâneos (padrão: 4, máx: 16).
  --report=<arquivo.json>     Onde gravar o relatório (padrão: backend/backups/).
  --uploads-dir=<dir>         Origem dos públicos (padrão: backend/src/data/uploads).
  --private-uploads-dir=<dir> Origem dos privados (padrão: .../private-uploads).
`;

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const PUBLIC_DIR = options.uploadsDir ? path.resolve(options.uploadsDir) : uploadsDir;
const PRIVATE_DIR = options.privateUploadsDir ? path.resolve(options.privateUploadsDir) : privateUploadsDir;

// ---------------------------------------------------------------------------
// Categoria do bucket público a partir da coluna que referencia o arquivo.
//
// A categoria é uma propriedade de USO, não do arquivo: a mesma imagem
// referenciada como foto de joia e como banner é copiada para as DUAS chaves, e
// cada coluna passa a apontar para a sua. Custa alguns KB duplicados e evita a
// pergunta "de quem é esta imagem, afinal" para sempre.
// ---------------------------------------------------------------------------
const CATEGORY_BY_COLUMN = {
  "jewelry_inventory.photo_url": "joias",
  "jewelry_inventory.image_url": "joias",
  "jewelry_inventory.gallery_urls": "joias",
  "product_images.image_url": "joias",
  "product_visual_hashes.image_url": "joias",
  "catalog_banners.image_url": "banners",
  "catalog_banners.mobile_image_url": "banners",
  "catalog_banners.original_image_url": "banners",
  "catalog_featured_categories.banner_url": "banners",
  "catalog_featured_categories.image_url": "catalogo",
  "catalog_sections.media_url": "catalogo",
  "catalog_theme.logo_url": "logo"
  // Qualquer outra coluna cai em DEFAULT_PUBLIC_CATEGORY ("geral"):
  // professionals.photo_url, financial_entries.attachment_url, e o que aparecer.
};

// Colunas que casam com o filtro de nome mas NUNCA guardam caminho de arquivo
// local. Ficam de fora da varredura só por economia — o filtro real é o valor
// conter `/uploads/`, então incluí-las não causaria dano, apenas trabalho.
//
//   digital_terms.signature_data_url  data: URL base64 da assinatura (enorme)
//   error_logs.url                    rota do frontend onde o erro aconteceu
//   payment_intents.invoice_url       link da fatura no Asaas
//   payment_intents.qr_code_url       QR do PIX vindo do gateway
const SKIP_COLUMNS = new Set([
  "digital_terms.signature_data_url",
  "error_logs.url",
  "payment_intents.invoice_url",
  "payment_intents.qr_code_url"
]);

// Nomes de coluna que valem a pena varrer por padrão. `--scan-all-columns`
// ignora este filtro e varre tudo que for texto/JSON.
const COLUMN_NAME_FILTER = "(url|urls|image|images|photo|logo|banner|media|attachment|content|conteudo)";

// Extrai `/uploads/<arquivo>`. O conjunto de caracteres é o mesmo que
// `sanitizeFilename` preserva — o que casa aqui atravessa `buildKey` intacto.
const UPLOAD_REF_REGEX = "/uploads/([A-Za-z0-9._-]+)";

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);

function abort(message) {
  console.error(`\nERRO: ${message}\n`);
  process.exitCode = 1;
  throw new AbortError(message);
}
class AbortError extends Error {}

/** Identificador SQL seguro. Nome de tabela/coluna vem do information_schema,
 *  mas interpolar sem conferir é como se ensina a injetar SQL. */
function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(name))) {
    throw new Error(`Identificador SQL inesperado: ${name}`);
  }
  return `"${name}"`;
}

/** Escapa metacaracteres para uso dentro de um padrão de regexp_replace. */
function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** Escapa a STRING DE SUBSTITUIÇÃO do regexp_replace do Postgres, onde `\` e
 *  `&` têm significado próprio (`&` = o trecho casado inteiro). */
function escapeReplacement(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/&/g, "\\&");
}

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}
function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Executa `worker` sobre `items` com no máximo `limit` em voo. */
async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// 1. Backup: sem ele, não se começa
// ---------------------------------------------------------------------------
async function requireBackup() {
  if (options.skipBackup) {
    if (!options.semRede) {
      abort(
        "--skip-backup exige TAMBÉM --sem-rede. São duas flags de propósito: pular o backup dos anexos antes de mexer em produção é uma decisão que ninguém deve tomar por acidente de linha de comando. Gere o backup com: npm --prefix backend run backup:uploads"
      );
    }
    warn("");
    warn("  ############################################################");
    warn("  #  SEM BACKUP.                                             #");
    warn("  #  Se algo der errado nesta execução, não existe para onde #");
    warn("  #  voltar além do que estiver no disco neste instante.     #");
    warn("  #  Isto fica registrado no relatório final.                #");
    warn("  ############################################################");
    warn("");
    return { skipped: true, reason: "--skip-backup --sem-rede" };
  }

  if (!options.backup) {
    abort(
      "faltou --backup=<arquivo.tar.gz>. Gere um com `npm --prefix backend run backup:uploads` e passe o caminho impresso no fim. (Se souber o que está fazendo: --skip-backup --sem-rede.)"
    );
  }

  const backupPath = path.resolve(options.backup);
  let stat;
  try {
    stat = await fsp.stat(backupPath);
  } catch {
    abort(`backup não encontrado: ${backupPath}`);
  }
  if (!stat.isFile()) abort(`o caminho do backup não é um arquivo: ${backupPath}`);
  if (stat.size === 0) abort(`o backup está vazio (0 byte): ${backupPath}`);

  const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
  if (ageHours > options.maxBackupAgeHours) {
    abort(
      `o backup tem ${ageHours.toFixed(1)}h (limite: ${options.maxBackupAgeHours}h). Um backup velho não cobre o que entrou no disco desde então — gere outro. (Ou aumente com --max-backup-age-hours=N, sabendo o que isso significa.)`
    );
  }

  // O `backup-uploads.sh` já validou o conteúdo com `tar -tzf`; aqui a checagem
  // é da assinatura gzip (1f 8b) — barata e suficiente para pegar o caso de
  // alguém apontar para o arquivo errado ou para um .tar não comprimido.
  const head = Buffer.alloc(2);
  const handle = await fsp.open(backupPath, "r");
  try {
    await handle.read(head, 0, 2, 0);
  } finally {
    await handle.close();
  }
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    abort(`o arquivo não parece um .tar.gz (assinatura gzip ausente): ${backupPath}`);
  }

  log(`Backup aceito: ${backupPath}`);
  log(`  ${(stat.size / 1048576).toFixed(1)}MB, gerado há ${ageHours.toFixed(1)}h`);
  return {
    skipped: false,
    path: backupPath,
    bytes: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    ageHours: Number(ageHours.toFixed(2))
  };
}

// ---------------------------------------------------------------------------
// 2. Inventário do disco
// ---------------------------------------------------------------------------
async function readDir(dir) {
  const files = new Map();
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue; // .gitkeep, .DS_Store
    const full = path.join(dir, entry.name);
    const stat = await fsp.stat(full);
    files.set(entry.name, { name: entry.name, path: full, bytes: stat.size });
  }
  return files;
}

// ---------------------------------------------------------------------------
// 3. Varredura do banco
// ---------------------------------------------------------------------------
async function listCandidateColumns(client, schema) {
  const nameFilter = options.scanAllColumns ? "" : `AND c.column_name ~ '${COLUMN_NAME_FILTER}'`;
  const { rows } = await client.query(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema
        AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = $1
        AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
        ${nameFilter}
      ORDER BY c.table_name, c.column_name`,
    [schema]
  );
  return rows
    .map((row) => ({
      table: row.table_name,
      column: row.column_name,
      dataType: row.data_type,
      ref: `${row.table_name}.${row.column_name}`
    }))
    .filter((col) => !SKIP_COLUMNS.has(col.ref));
}

/**
 * Lê de uma coluna:
 *   `filenames` os `/uploads/<arquivo>` ainda POR migrar (+ `rows`, quantas
 *               linhas seriam tocadas);
 *   `migrated`  os arquivos que a coluna JÁ referencia pelo CDN.
 *
 * O segundo conjunto existe por causa da segunda execução. Depois de uma
 * migração bem-sucedida nenhuma linha aponta mais para `/uploads/…` — e sem
 * esta checagem o script concluiria que TODO arquivo do disco virou órfão e
 * despejaria o parque inteiro em `orfaos/`, duplicando objetos que já estão na
 * chave certa. "Ninguém referencia por /uploads/" não é o mesmo que "ninguém
 * referencia".
 *
 * Puramente leitura: roda igual em dry-run e em apply.
 */
async function scanColumn(client, schema, col) {
  const qualified = `${quoteIdent(schema)}.${quoteIdent(col.table)}`;
  const column = quoteIdent(col.column);
  const asText = col.dataType === "json" || col.dataType === "jsonb" ? `${column}::text` : column;

  const { rows: countRows } = await client.query(
    `SELECT
       count(*) FILTER (WHERE ${asText} LIKE '%/uploads/%')::int AS pendentes,
       count(*) FILTER (WHERE ${asText} LIKE $1)::int             AS migradas
     FROM ${qualified}`,
    [`%${R2_PUBLIC_BASE_URL}/%`]
  );
  const linhas = countRows[0]?.pendentes || 0;
  const jaMigradas = countRows[0]?.migradas || 0;

  const extract = async (pattern) => {
    const { rows } = await client.query(
      `SELECT DISTINCT m.partes[1] AS captura
         FROM ${qualified} t
         CROSS JOIN LATERAL regexp_matches(t.${asText}, $1, 'g') AS m(partes)`,
      [pattern]
    );
    return rows.map((r) => r.captura).filter(Boolean);
  };

  const filenames = linhas ? await extract(UPLOAD_REF_REGEX) : [];
  // Do lado do CDN a chave tem prefixo (`tenant_7/joias/x`): captura o caminho
  // inteiro e fica com o último segmento, que é o nome do arquivo em disco.
  const migrated = jaMigradas
    ? (await extract(`${escapeRegex(R2_PUBLIC_BASE_URL)}/([A-Za-z0-9._/-]+)`)).map((p) => p.split("/").pop())
    : [];

  return { filenames, rows: linhas, migrated };
}

// ---------------------------------------------------------------------------
// 4. Montagem do plano
// ---------------------------------------------------------------------------
function makePlan() {
  return {
    /** chave lógica "scope|key" -> objeto a subir */
    objects: new Map(),
    /** reescritas de URL agrupadas por schema */
    rewritesBySchema: new Map(),
    orphans: [],
    missing: [],
    keyCollisions: [],
    tenants: []
  };
}

function addObject(plan, entry) {
  const id = `${entry.scope}|${entry.key}`;
  const existing = plan.objects.get(id);
  if (!existing) {
    plan.objects.set(id, { ...entry, referencedBy: [entry.referencedBy].filter(Boolean) });
    return plan.objects.get(id);
  }
  // Mesma chave para arquivos de disco DIFERENTES: `sanitizeFilename` reduziu
  // dois nomes ao mesmo. Não pode acontecer com os nomes de 32 hex do sistema,
  // mas se acontecer é perda de dado silenciosa — vira erro, não sobrescrita.
  if (existing.sourcePath !== entry.sourcePath) {
    plan.keyCollisions.push({ key: entry.key, scope: entry.scope, a: existing.sourcePath, b: entry.sourcePath });
  }
  if (entry.referencedBy) existing.referencedBy.push(entry.referencedBy);
  return existing;
}

function addRewrite(plan, schema, rewrite) {
  if (!plan.rewritesBySchema.has(schema)) plan.rewritesBySchema.set(schema, []);
  plan.rewritesBySchema.get(schema).push(rewrite);
}

async function buildPlan(client, storage, diskPublic, diskPrivate, ledger) {
  const plan = makePlan();
  const claimedPublic = new Set();
  const claimedPrivate = new Set();

  // Segunda rede contra o falso órfão: arquivo que o ledger diz já ter subido
  // sob prefixo de tenant/plataforma tem dono, mesmo que a varredura do banco
  // não o encontre (URL editada à mão, CDN trocado de domínio, coluna nova).
  // Só `orfaos/` não conta — senão órfão seria dono de si mesmo para sempre.
  for (const entry of ledger.values()) {
    if (String(entry.key).startsWith(`${ORPHAN_PREFIX}/`)) continue;
    claimedPublic.add(String(entry.key).split("/").pop());
  }

  const { rows: tenants } = await client.query(
    "SELECT id, slug, name FROM platform.tenants ORDER BY id"
  );

  for (const tenant of tenants) {
    if (options.onlyTenant && Number(tenant.id) !== options.onlyTenant) continue;
    const schema = `tenant_${tenant.id}`;
    const { rows: exists } = await client.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
      [schema]
    );
    const resumo = {
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      schema,
      schemaExists: exists.length > 0,
      // `publicos` conta OBJETOS distintos (chaves) e `referenciasPublicas`
      // conta ocorrências: a mesma imagem citada em quatro colunas é 1 objeto e
      // 4 referências. Trocar um pelo outro faz o total do plano "não fechar".
      publicos: 0,
      referenciasPublicas: 0,
      privados: 0,
      ausentes: 0,
      linhasReescritas: 0,
      colunas: []
    };
    const chavesPublicas = new Set();
    plan.tenants.push(resumo);
    if (!exists.length) {
      warn(`  [aviso] tenant ${tenant.id} (${tenant.slug}) não tem schema ${schema}. Pulado.`);
      continue;
    }

    // ---- privados: private_files é a fonte da verdade -----------------------
    const { rows: privateFiles } = await client.query(
      `SELECT filename, purpose, mime_type, original_name FROM ${quoteIdent(schema)}.private_files ORDER BY id`
    );
    for (const file of privateFiles) {
      const disk = diskPrivate.get(file.filename);
      if (!disk) {
        plan.missing.push({
          scope: "private",
          schema,
          tenantId: tenant.id,
          origem: "private_files",
          filename: file.filename,
          purpose: file.purpose
        });
        resumo.ausentes += 1;
        continue;
      }
      claimedPrivate.add(file.filename);
      const key = buildKey({
        scope: "private",
        tenantId: tenant.id,
        purpose: file.purpose,
        filename: file.filename
      });
      addObject(plan, {
        scope: "private",
        key,
        filename: file.filename,
        sourcePath: disk.path,
        bytes: disk.bytes,
        contentType: file.mime_type || "application/octet-stream",
        owner: { kind: "tenant", tenantId: tenant.id, slug: tenant.slug },
        purpose: file.purpose,
        folder: folderForPurpose(file.purpose),
        referencedBy: `private_files(${file.purpose})`
      });
      resumo.privados += 1;
    }

    // ---- públicos: varre as colunas atrás de /uploads/<arquivo> -------------
    const columns = await listCandidateColumns(client, schema);
    for (const col of columns) {
      const { filenames, rows, migrated } = await scanColumn(client, schema, col);
      // Já apontam para o CDN: não são trabalho, mas SÃO dono — impede que a
      // segunda execução os declare órfãos.
      for (const name of migrated) claimedPublic.add(name);
      if (!filenames.length) continue;

      const category = options.flatCategory
        ? DEFAULT_PUBLIC_CATEGORY
        : CATEGORY_BY_COLUMN[col.ref] || DEFAULT_PUBLIC_CATEGORY;
      const detalhe = { coluna: col.ref, categoria: category, arquivos: 0, ausentes: 0, linhas: rows };

      for (const filename of filenames) {
        const disk = diskPublic.get(filename);
        if (!disk) {
          plan.missing.push({
            scope: "public",
            schema,
            tenantId: tenant.id,
            origem: col.ref,
            filename
          });
          detalhe.ausentes += 1;
          resumo.ausentes += 1;
          continue;
        }
        claimedPublic.add(filename);
        const key = buildKey({ scope: "public", tenantId: tenant.id, category, filename });
        addObject(plan, {
          scope: "public",
          key,
          filename,
          sourcePath: disk.path,
          bytes: disk.bytes,
          contentType: guessContentType(filename, disk.path),
          owner: { kind: "tenant", tenantId: tenant.id, slug: tenant.slug },
          category,
          referencedBy: `${schema}.${col.ref}`
        });
        addRewrite(plan, schema, {
          table: col.table,
          column: col.column,
          dataType: col.dataType,
          filename,
          objectId: `public|${key}`,
          oldUrl: `/uploads/${filename}`,
          newUrl: storage.publicUrl(key)
        });
        detalhe.arquivos += 1;
        resumo.referenciasPublicas += 1;
        chavesPublicas.add(key);
      }
      resumo.linhasReescritas += rows;
      resumo.colunas.push(detalhe);
    }
    resumo.publicos = chavesPublicas.size;
  }

  // ---- schema `platform` ---------------------------------------------------
  //
  // Duas fontes, e elas NÃO têm o mesmo dono:
  //
  //   platform.tenants.logo_url       a linha CARREGA o id da clínica. É o logo
  //                                   DELA — vai para tenant_<id>/logo/, não
  //                                   para plataforma/. (Ver docs/R2.md.)
  //   platform.landing_sections.content  landing da Monitence, de clínica
  //                                   nenhuma — prefixo `plataforma/`, categoria
  //                                   "geral", a mesma que routes/landing.js
  //                                   grava hoje em upload novo.
  if (!options.onlyTenant) {
    const { rows: logosMigrados } = await client.query(
      "SELECT logo_url FROM platform.tenants WHERE logo_url LIKE $1",
      [`%${R2_PUBLIC_BASE_URL}/%`]
    );
    for (const row of logosMigrados) claimedPublic.add(String(row.logo_url).split("/").pop());

    const { rows: logos } = await client.query(
      "SELECT id, slug, logo_url FROM platform.tenants WHERE logo_url LIKE '%/uploads/%' ORDER BY id"
    );
    for (const row of logos) {
      const filename = String(row.logo_url).match(new RegExp(UPLOAD_REF_REGEX))?.[1];
      if (!filename) continue;
      const disk = diskPublic.get(filename);
      if (!disk) {
        plan.missing.push({ scope: "public", schema: "platform", origem: "tenants.logo_url", filename });
        continue;
      }
      claimedPublic.add(filename);
      const key = buildKey({ scope: "public", tenantId: row.id, category: "logo", filename });
      addObject(plan, {
        scope: "public",
        key,
        filename,
        sourcePath: disk.path,
        bytes: disk.bytes,
        contentType: guessContentType(filename, disk.path),
        owner: { kind: "tenant", tenantId: row.id, slug: row.slug },
        category: "logo",
        referencedBy: "platform.tenants.logo_url"
      });
      addRewrite(plan, "platform", {
        table: "tenants",
        column: "logo_url",
        dataType: "text",
        filename,
        objectId: `public|${key}`,
        oldUrl: `/uploads/${filename}`,
        newUrl: storage.publicUrl(key)
      });
    }

    const landing = await scanColumn(client, "platform", {
      table: "landing_sections",
      column: "content",
      dataType: "jsonb"
    });
    for (const name of landing.migrated) claimedPublic.add(name);
    for (const filename of landing.filenames) {
      const disk = diskPublic.get(filename);
      if (!disk) {
        plan.missing.push({ scope: "public", schema: "platform", origem: "landing_sections.content", filename });
        continue;
      }
      claimedPublic.add(filename);
      const key = buildKey({ scope: "public", tenantId: null, category: DEFAULT_PUBLIC_CATEGORY, filename });
      addObject(plan, {
        scope: "public",
        key,
        filename,
        sourcePath: disk.path,
        bytes: disk.bytes,
        contentType: guessContentType(filename, disk.path),
        owner: { kind: "platform" },
        category: DEFAULT_PUBLIC_CATEGORY,
        referencedBy: "platform.landing_sections.content"
      });
      addRewrite(plan, "platform", {
        table: "landing_sections",
        column: "content",
        dataType: "jsonb",
        filename,
        objectId: `public|${key}`,
        oldUrl: `/uploads/${filename}`,
        newUrl: storage.publicUrl(key)
      });
    }
  }

  // ---- órfãos: está no disco e ninguém reclamou ---------------------------
  //
  // Vão para o bucket PRIVADO, em `orfaos/`. Sem dono conhecido não dá para
  // colocar sob o prefixo de clínica nenhuma, e servir publicamente um arquivo
  // de origem desconhecida é o pior dos dois mundos — pode ser foto clínica.
  // O disco não é tocado: a URL antiga (se existir em algum lugar que a
  // varredura não alcança) continua respondendo pelo /uploads estático.
  //
  // Com --only-tenant a varredura é PARCIAL, então "órfão" ainda não quer dizer
  // nada: nesse modo os órfãos são só listados, nunca migrados.
  const parcial = Boolean(options.onlyTenant);
  for (const [name, disk] of diskPublic) {
    if (claimedPublic.has(name)) continue;
    const key = buildKey({ scope: "private", tenantId: null, filename: name });
    plan.orphans.push({ origem: "uploads", filename: name, bytes: disk.bytes, key, migrado: !parcial });
    if (parcial) continue;
    addObject(plan, {
      scope: "private",
      key,
      filename: name,
      sourcePath: disk.path,
      bytes: disk.bytes,
      contentType: guessContentType(name, disk.path),
      owner: { kind: "orphan" },
      referencedBy: null
    });
  }
  for (const [name, disk] of diskPrivate) {
    if (claimedPrivate.has(name)) continue;
    const key = buildKey({ scope: "private", tenantId: null, filename: name });
    plan.orphans.push({ origem: "private-uploads", filename: name, bytes: disk.bytes, key, migrado: !parcial });
    if (parcial) continue;
    addObject(plan, {
      scope: "private",
      key,
      filename: name,
      sourcePath: disk.path,
      bytes: disk.bytes,
      contentType: guessContentType(name, disk.path),
      owner: { kind: "orphan" },
      referencedBy: null
    });
  }

  return plan;
}

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml"
};

/** Content-Type do objeto. Os uploads do sistema são 32 hex SEM extensão, então
 *  a extensão quase nunca ajuda: o sniff dos primeiros bytes é o que resolve. */
function guessContentType(filename, diskPath) {
  const ext = path.extname(filename).toLowerCase();
  if (CONTENT_TYPES[ext]) return CONTENT_TYPES[ext];
  try {
    const head = Buffer.alloc(12);
    const fd = fs.openSync(diskPath, "r");
    try {
      fs.readSync(fd, head, 0, 12, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (head.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
    if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (["GIF87a", "GIF89a"].includes(head.subarray(0, 6).toString("ascii"))) return "image/gif";
    if (head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") {
      return "image/webp";
    }
  } catch {
    // Arquivo ilegível vira octet-stream — a migração não morre por causa disso.
  }
  return "application/octet-stream";
}

// ---------------------------------------------------------------------------
// 5. Upload com verificação byte a byte
// ---------------------------------------------------------------------------
async function loadLedger() {
  const done = new Map();
  try {
    const raw = await fsp.readFile(LEDGER_PATH, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        done.set(`${entry.scope}|${entry.key}`, entry);
      } catch {
        // Linha truncada (processo morto no meio da escrita): ignorada. O
        // head-check no bucket é a verificação de verdade; o ledger é atalho.
      }
    }
  } catch {
    // Sem ledger: primeira execução.
  }
  return done;
}

async function appendLedger(entry) {
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
  await fsp.appendFile(LEDGER_PATH, `${JSON.stringify(entry)}\n`);
}

/**
 * Confere o objeto no bucket contra o arquivo local.
 *
 * Tamanho é o piso. O ETag do R2, para um PutObject simples (que é sempre o
 * caso aqui — a camada de storage envia o buffer inteiro num comando só), é o
 * MD5 hex do corpo: comparar com o MD5 do arquivo local é verificação byte a
 * byte de verdade, sem baixar o objeto de volta. Se o ETag vier no formato
 * multipart (`<hash>-<n>`), o MD5 não se aplica e sobra o tamanho — o caso é
 * marcado no relatório em vez de ser silenciosamente aceito como igual.
 */
async function headAndVerify(client, bucket, key, localBytes, localMd5) {
  let head;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const name = error?.name || error?.Code || "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return { exists: false };
    throw error;
  }
  const remoteBytes = Number(head.ContentLength);
  const etag = String(head.ETag || "").replace(/^"|"$/g, "");
  const multipart = /-\d+$/.test(etag);
  const sizeOk = remoteBytes === localBytes;
  const hashOk = multipart ? null : etag.toLowerCase() === localMd5;
  return {
    exists: true,
    remoteBytes,
    etag,
    sizeOk,
    hashOk,
    verified: sizeOk && hashOk !== false,
    metodo: multipart ? "tamanho (ETag multipart)" : "tamanho + MD5"
  };
}

async function migrateObjects(plan, storage, r2client, results, ledger) {
  const objects = [...plan.objects.values()];
  let done = 0;

  await mapLimit(objects, options.concurrency, async (obj) => {
    const id = `${obj.scope}|${obj.key}`;
    const bucket = obj.scope === "private" ? R2_BUCKET_PRIVATE : R2_BUCKET_PUBLIC;
    const registro = {
      escopo: obj.scope,
      chave: obj.key,
      arquivo: obj.filename,
      origemDisco: obj.sourcePath,
      bytes: obj.bytes,
      dono: obj.owner,
      referenciadoPor: obj.referencedBy,
      status: "pendente"
    };
    results.files.push(registro);

    try {
      const buffer = await fsp.readFile(obj.sourcePath);
      const localMd5 = md5(buffer);
      registro.md5 = localMd5;
      registro.sha256 = sha256(buffer);
      if (buffer.length !== obj.bytes) registro.bytes = buffer.length;

      // Idempotência: o objeto já pode estar lá de uma execução anterior que
      // morreu antes de reescrever o banco. Head primeiro, sempre — o ledger
      // acelera, mas quem manda é o bucket.
      const antes = await headAndVerify(r2client, bucket, obj.key, buffer.length, localMd5);
      if (antes.exists && antes.verified) {
        registro.status = "ja-existia";
        registro.verificacao = antes.metodo;
        plan.objects.get(id).migrated = true;
        if (!ledger.has(id)) await appendLedger({ scope: obj.scope, key: obj.key, md5: localMd5, bytes: buffer.length, at: new Date().toISOString(), via: "head" });
        return;
      }
      if (antes.exists && !antes.verified) {
        // Objeto lá com conteúdo diferente: upload anterior truncado, ou —
        // muito pior — outro arquivo na mesma chave. Sobrescrever é o certo
        // (o disco é a verdade), mas fica registrado.
        registro.observacao = `objeto existente divergia (remoto ${antes.remoteBytes}B, local ${buffer.length}B); sobrescrito a partir do disco`;
      }

      if (obj.scope === "private") {
        await storage.putPrivate(obj.key, buffer, { contentType: obj.contentType });
      } else {
        await storage.putPublic(obj.key, buffer, { contentType: obj.contentType });
      }

      const depois = await headAndVerify(r2client, bucket, obj.key, buffer.length, localMd5);
      if (!depois.exists) throw new Error("objeto não encontrado no bucket logo após o upload");
      if (!depois.verified) {
        throw new Error(
          `verificação falhou (local ${buffer.length}B/${localMd5}, remoto ${depois.remoteBytes}B/${depois.etag})`
        );
      }
      registro.status = "migrado";
      registro.verificacao = depois.metodo;
      plan.objects.get(id).migrated = true;
      await appendLedger({ scope: obj.scope, key: obj.key, md5: localMd5, bytes: buffer.length, at: new Date().toISOString(), via: "upload" });
    } catch (error) {
      registro.status = "falhou";
      registro.erro = String(error?.message || error);
      results.failures.push({ chave: obj.key, escopo: obj.scope, arquivo: obj.filename, erro: registro.erro });
      // NÃO relança: um arquivo ilegível não pode abortar a migração inteira. A
      // consequência é local — a URL dele simplesmente não é reescrita, continua
      // apontando para /uploads/ e continua funcionando pelo disco.
    } finally {
      done += 1;
      if (done % 50 === 0 || done === objects.length) {
        log(`  ... ${done}/${objects.length} objetos`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 6. Reescrita das URLs — uma transação POR SCHEMA
// ---------------------------------------------------------------------------
//
// Por schema, e não uma transação só para o banco inteiro, por dois motivos:
// uma transação gigante segura lock em tabela de todas as clínicas ao mesmo
// tempo, e uma falha na clínica 12 não deve desfazer as 11 que já deram certo
// (elas já estão consistentes: objeto no bucket + URL apontando para ele).
//
// A substituição usa `regexp_replace` com lookahead negativo, e não `replace`:
// `replace(valor, '/uploads/abc', ...)` também casaria dentro de
// `/uploads/abcdef` e corromperia a URL do vizinho. O `(?![A-Za-z0-9._-])` exige
// que o nome termine ali.
async function rewriteUrls(plan, results) {
  for (const [schema, rewrites] of plan.rewritesBySchema) {
    // Só o que subiu E foi verificado. Arquivo que falhou mantém `/uploads/…`:
    // continua sendo servido pelo disco, e reaparece na próxima execução.
    const aplicaveis = rewrites.filter((r) => plan.objects.get(r.objectId)?.migrated);
    const pulados = rewrites.length - aplicaveis.length;
    if (!aplicaveis.length) {
      if (pulados) warn(`  ${schema}: nenhuma reescrita aplicável (${pulados} aguardando objeto que falhou).`);
      continue;
    }

    const client = await pool.connect();
    let linhas = 0;
    try {
      await client.query("BEGIN");
      for (const r of aplicaveis) {
        const qualified = `${quoteIdent(schema)}.${quoteIdent(r.table)}`;
        const column = quoteIdent(r.column);
        const json = r.dataType === "json" || r.dataType === "jsonb";
        const asText = json ? `${column}::text` : column;
        const pattern = `${escapeRegex(`/uploads/${r.filename}`)}(?![A-Za-z0-9._-])`;
        const replacement = escapeReplacement(r.newUrl);
        const expr = `regexp_replace(${asText}, $1, $2, 'g')`;
        const setExpr = json ? `${expr}::${r.dataType}` : expr;
        const { rowCount } = await client.query(
          `UPDATE ${qualified}
              SET ${column} = ${setExpr}
            WHERE ${asText} LIKE $3`,
          [pattern, replacement, `%/uploads/${r.filename}%`]
        );
        linhas += rowCount || 0;
      }
      await client.query("COMMIT");
      results.rewrites.push({ schema, colunas: aplicaveis.length, linhas, adiadas: pulados });
      log(`  ${schema}: ${linhas} linha(s) reescrita(s)${pulados ? ` (${pulados} adiada(s))` : ""}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const msg = String(error?.message || error);
      results.failures.push({ schema, etapa: "reescrita", erro: msg });
      // Rollback deixou o schema exatamente como estava. Os objetos já subiram e
      // serão pulados na próxima execução; a reescrita é retomada do zero, sem
      // meia-reescrita para ninguém consertar à mão.
      warn(`  ${schema}: reescrita revertida (ROLLBACK). ${msg}`);
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Impressão do plano (dry-run) e relatório
// ---------------------------------------------------------------------------
function printPlan(plan, storage) {
  const objects = [...plan.objects.values()];
  const publicos = objects.filter((o) => o.scope === "public");
  const privados = objects.filter((o) => o.scope === "private" && o.owner.kind === "tenant");
  const orfaos = objects.filter((o) => o.owner.kind === "orphan");
  const bytes = objects.reduce((sum, o) => sum + o.bytes, 0);

  log("");
  log("=".repeat(78));
  log("PLANO DE MIGRAÇÃO");
  log("=".repeat(78));
  log("");
  log(`  Objetos a subir ......... ${objects.length}  (${(bytes / 1048576).toFixed(1)}MB)`);
  log(`    públicos (com dono) ... ${publicos.length}`);
  log(`    privados (com dono) ... ${privados.length}`);
  log(`    órfãos ................ ${orfaos.length}  -> ${ORPHAN_PREFIX}/ no bucket privado`);
  log(`  Referências sem arquivo . ${plan.missing.length}  (linha no banco aponta para arquivo que não existe em disco)`);
  log("");

  log("-".repeat(78));
  log("POR CLÍNICA");
  log("-".repeat(78));
  for (const t of plan.tenants) {
    if (!t.schemaExists) {
      log(`  [${t.schema}] ${t.slug}: SCHEMA AUSENTE — pulado`);
      continue;
    }
    log(`  [${t.schema}] ${t.slug}`);
    log(`      objetos públicos: ${t.publicos} (${t.referenciasPublicas} referência(s))   privados: ${t.privados}   sem arquivo em disco: ${t.ausentes}`);
    for (const c of t.colunas) {
      log(`      - ${c.coluna} -> categoria "${c.categoria}": ${c.arquivos} arquivo(s), ${c.linhas} linha(s) a reescrever${c.ausentes ? `, ${c.ausentes} ausente(s)` : ""}`);
    }
  }
  log("");

  log("-".repeat(78));
  log("AMOSTRA DAS CHAVES (até 15)");
  log("-".repeat(78));
  for (const o of objects.slice(0, 15)) {
    const destino = o.scope === "public" ? storage.publicUrl(o.key) : `(privado) ${o.key}`;
    log(`  ${o.filename}`);
    log(`      -> [${o.scope}] ${o.key}`);
    if (o.scope === "public") log(`      -> ${destino}`);
    const vias = (o.referencedBy || []).filter(Boolean);
    log(`      dono: ${describeOwner(o.owner)}${vias.length ? `  via ${vias.join(", ")}` : ""}`);
  }
  if (objects.length > 15) log(`  ... e mais ${objects.length - 15}. Lista completa no relatório.`);
  log("");

  let linhas = 0;
  log("-".repeat(78));
  log("REESCRITAS DE URL NO BANCO");
  log("-".repeat(78));
  for (const [schema, rewrites] of plan.rewritesBySchema) {
    const porColuna = new Map();
    for (const r of rewrites) {
      const ref = `${r.table}.${r.column}`;
      porColuna.set(ref, (porColuna.get(ref) || 0) + 1);
    }
    log(`  ${schema} (transação própria):`);
    for (const [ref, count] of porColuna) log(`      ${ref}: ${count} arquivo(s) distintos`);
    linhas += rewrites.length;
  }
  if (!linhas) log("  (nenhuma)");
  log("");
  log(`  Total: ${linhas} par(es) (coluna, arquivo) a substituir.`);
  log("  Arquivos PRIVADOS não entram aqui de propósito: a chave é derivada de");
  log("  tenant + purpose + filename, e a rota GET /api/private-files reconstrói");
  log("  a mesma chave na leitura. Só precisam ser copiados.");
  log("");

  if (plan.orphans.length) {
    log("-".repeat(78));
    log(`ÓRFÃOS (${plan.orphans.length}) — em disco, sem linha que os referencie`);
    log("-".repeat(78));
    for (const o of plan.orphans.slice(0, 10)) {
      log(`  ${o.origem}/${o.filename} (${o.bytes}B) -> ${o.key}${o.migrado ? "" : "  [NÃO migrado: varredura parcial]"}`);
    }
    if (plan.orphans.length > 10) log(`  ... e mais ${plan.orphans.length - 10}. Lista completa no relatório.`);
    log("");
  }

  if (plan.missing.length) {
    log("-".repeat(78));
    log(`REFERÊNCIAS QUEBRADAS (${plan.missing.length}) — não é erro fatal`);
    log("-".repeat(78));
    log("  Linha do banco aponta para arquivo que não está no disco. A URL NÃO é");
    log("  reescrita (continuaria quebrada, só que apontando para o CDN). Fica");
    log("  como estava, listada no relatório para alguém decidir o que fazer.");
    for (const m of plan.missing.slice(0, 10)) log(`  ${m.schema}.${m.origem}: ${m.filename}`);
    if (plan.missing.length > 10) log(`  ... e mais ${plan.missing.length - 10}.`);
    log("");
  }

  if (plan.keyCollisions.length) {
    log("!".repeat(78));
    log(`COLISÃO DE CHAVE (${plan.keyCollisions.length}) — dois arquivos diferentes na mesma chave`);
    for (const c of plan.keyCollisions) log(`  ${c.key}: ${c.a} vs ${c.b}`);
    log("!".repeat(78));
    log("");
  }
}

function describeOwner(owner) {
  if (owner.kind === "tenant") return `tenant ${owner.tenantId} (${owner.slug})`;
  if (owner.kind === "platform") return `plataforma (${PLATFORM_PREFIX}/)`;
  return "SEM DONO (órfão)";
}

async function writeReport(results) {
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = options.report
    ? path.resolve(options.report)
    : path.join(BACKUPS_DIR, `migracao-r2-${results.meta.modo}-${stamp}.json`);
  const csvPath = jsonPath.replace(/\.json$/i, "") + ".csv";

  await fsp.writeFile(jsonPath, `${JSON.stringify(results, null, 2)}\n`);

  // CSV do mapeamento arquivo -> chave: é o que alguém abre no dia em que
  // precisa achar UM arquivo específico, e `grep` resolve.
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["escopo,chave,arquivo,bytes,dono,referenciado_por,status,verificacao,erro"];
  for (const f of results.files) {
    lines.push(
      [
        f.escopo,
        f.chave,
        f.arquivo,
        f.bytes,
        describeOwner(f.dono),
        Array.isArray(f.referenciadoPor) ? f.referenciadoPor.join(" | ") : f.referenciadoPor,
        f.status,
        f.verificacao,
        f.erro
      ]
        .map(escape)
        .join(",")
    );
  }
  await fsp.writeFile(csvPath, `${lines.join("\n")}\n`);
  return { jsonPath, csvPath };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const startedAt = new Date();
  log("");
  log(`Migração de anexos -> Cloudflare R2  [${options.apply ? "APLICANDO" : "DRY-RUN"}]`);
  log("");

  if (!options.apply) {
    log("  Modo dry-run: NADA é escrito. Nem no bucket, nem no banco, nem no disco.");
    log("  Para valer, repita o comando com --apply.");
    log("");
  }

  const backup = await requireBackup();

  // Configuração do R2. Em dry-run as variáveis precisam existir (é delas que
  // saem as chaves e as URLs do plano), mas nenhuma chamada de rede acontece.
  const faltando = [
    ["R2_BUCKET_PUBLIC", R2_BUCKET_PUBLIC],
    ["R2_BUCKET_PRIVATE", R2_BUCKET_PRIVATE],
    ["R2_PUBLIC_BASE_URL", R2_PUBLIC_BASE_URL]
  ]
    .filter(([, v]) => !v)
    .map(([n]) => n);
  if (faltando.length) {
    abort(
      `faltam variáveis de ambiente: ${faltando.join(", ")}. Sem elas não dá nem para calcular a chave de destino de cada arquivo. Ver docs/R2.md, passo 2.`
    );
  }
  if (options.apply && !r2Enabled) {
    abort(
      "--apply exige a configuração COMPLETA do R2 (endpoint, credenciais e os dois buckets). Ver config/index.js e docs/R2.md, passo 2."
    );
  }

  log(`  Bucket público .. ${R2_BUCKET_PUBLIC}  (${R2_PUBLIC_BASE_URL})`);
  log(`  Bucket privado .. ${R2_BUCKET_PRIVATE}`);
  log(`  Disco público ... ${PUBLIC_DIR}`);
  log(`  Disco privado ... ${PRIVATE_DIR}`);
  if (options.onlyTenant) log(`  Recorte ......... SOMENTE tenant ${options.onlyTenant} (varredura parcial)`);
  if (options.flatCategory) log("  Categorias ...... ACHATADAS em \"geral\" (--flat-category)");
  if (options.scanAllColumns) log("  Varredura ....... TODAS as colunas de texto/JSON");
  log("");

  // O cliente só existe no modo --apply. Em dry-run nem é construído — é a
  // garantia mecânica de que o dry-run não fala com a Cloudflare.
  const r2client = options.apply ? createR2Client() : null;
  const storage = createStorage({
    client: r2client,
    publicBucket: R2_BUCKET_PUBLIC,
    privateBucket: R2_BUCKET_PRIVATE,
    publicBaseUrl: R2_PUBLIC_BASE_URL,
    publicDir: PUBLIC_DIR,
    privateDir: PRIVATE_DIR
  });
  // Em dry-run `createStorage` fica em modo disco (sem client) e `publicUrl`
  // devolveria o caminho relativo — o que esconderia justamente o que o plano
  // precisa mostrar. A URL do plano é montada com a mesma regra do modo remoto.
  const urlBuilder = options.apply
    ? storage
    : { publicUrl: (key) => `${R2_PUBLIC_BASE_URL}/${String(key).replace(/^\/+/, "")}` };

  log("Lendo o disco...");
  const diskPublic = await readDir(PUBLIC_DIR);
  const diskPrivate = await readDir(PRIVATE_DIR);
  log(`  ${diskPublic.size} arquivo(s) público(s), ${diskPrivate.size} privado(s).`);

  log("Varrendo o banco para descobrir o dono de cada arquivo...");
  const ledger = await loadLedger();
  if (ledger.size) log(`  (ledger de execuções anteriores: ${ledger.size} objeto(s) já migrado(s))`);
  const client = await pool.connect();
  let plan;
  try {
    plan = await buildPlan(client, urlBuilder, diskPublic, diskPrivate, ledger);
  } finally {
    client.release();
  }

  printPlan(plan, urlBuilder);

  const results = {
    meta: {
      modo: options.apply ? "apply" : "dry-run",
      iniciadoEm: startedAt.toISOString(),
      backup,
      bucketPublico: R2_BUCKET_PUBLIC,
      bucketPrivado: R2_BUCKET_PRIVATE,
      cdn: R2_PUBLIC_BASE_URL,
      discoPublico: PUBLIC_DIR,
      discoPrivado: PRIVATE_DIR,
      opcoes: {
        onlyTenant: options.onlyTenant,
        scanAllColumns: options.scanAllColumns,
        flatCategory: options.flatCategory,
        concurrency: options.concurrency
      },
      avisoDisco:
        "Este script NUNCA apaga arquivo do disco. O disco segue como cópia de segurança e como fallback de leitura da camada de storage. Esvaziá-lo é decisão humana posterior — ver docs/R2.md, passo 8."
    },
    resumo: {},
    tenants: plan.tenants,
    files: [],
    rewrites: [],
    orfaos: plan.orphans,
    referenciasSemArquivo: plan.missing,
    colisoesDeChave: plan.keyCollisions,
    failures: []
  };

  if (plan.keyCollisions.length) {
    abort(
      `${plan.keyCollisions.length} colisão(ões) de chave: arquivos de disco diferentes resultariam na MESMA chave no bucket, e um sobrescreveria o outro. Resolva antes (renomeie no disco e na coluna que o referencia). Detalhes acima.`
    );
  }

  if (options.apply) {
    log("Subindo os objetos (com verificação de tamanho + MD5)...");
    await migrateObjects(plan, storage, r2client, results, ledger);
    log("");
    log("Reescrevendo as URLs públicas no banco (uma transação por schema)...");
    await rewriteUrls(plan, results);
  } else {
    for (const o of plan.objects.values()) {
      results.files.push({
        escopo: o.scope,
        chave: o.key,
        arquivo: o.filename,
        origemDisco: o.sourcePath,
        bytes: o.bytes,
        dono: o.owner,
        referenciadoPor: o.referencedBy,
        status: "planejado",
        urlDestino: o.scope === "public" ? urlBuilder.publicUrl(o.key) : null
      });
    }
    for (const [schema, rewrites] of plan.rewritesBySchema) {
      results.rewrites.push({
        schema,
        pares: rewrites.length,
        exemplos: rewrites.slice(0, 3).map((r) => ({ coluna: `${r.table}.${r.column}`, de: r.oldUrl, para: r.newUrl }))
      });
    }
  }

  results.resumo = {
    objetos: plan.objects.size,
    migrados: results.files.filter((f) => f.status === "migrado").length,
    jaExistiam: results.files.filter((f) => f.status === "ja-existia").length,
    planejados: results.files.filter((f) => f.status === "planejado").length,
    falhas: results.failures.length,
    orfaos: plan.orphans.length,
    referenciasSemArquivo: plan.missing.length
  };
  results.meta.terminadoEm = new Date().toISOString();

  const { jsonPath, csvPath } = await writeReport(results);

  log("");
  log("=".repeat(78));
  log(options.apply ? "MIGRAÇÃO CONCLUÍDA" : "DRY-RUN CONCLUÍDO (nada foi escrito)");
  log("=".repeat(78));
  log(`  Relatório JSON: ${jsonPath}`);
  log(`  Relatório CSV : ${csvPath}`);
  if (options.apply) {
    log(`  Migrados: ${results.resumo.migrados}   Já existiam: ${results.resumo.jaExistiam}   Falhas: ${results.resumo.falhas}`);
    log("");
    log("  O DISCO NÃO FOI TOCADO. Continua sendo a cópia de segurança e o");
    log("  fallback de leitura. Não apague nada agora — ver docs/R2.md, passo 8.");
  } else {
    log("  Confira o plano acima e, quando estiver de acordo, repita com --apply.");
  }
  log("");

  if (results.failures.length) {
    console.error(`ATENÇÃO: ${results.failures.length} falha(s). Veja "failures" em ${jsonPath}.`);
    console.error("Rodar o script de novo retoma do ponto certo: o que já subiu é pulado.");
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof AbortError)) {
    console.error("\nFALHA:", error?.message || error);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  }
} finally {
  await pool.end().catch(() => {});
}
