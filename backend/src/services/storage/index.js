// Camada única de acesso a arquivo (Cloudflare R2, S3-compatível).
//
// Regra de ouro: NENHUM outro módulo importa `@aws-sdk/*`. Quem precisa de
// arquivo fala `putPublic` / `putPrivate` / `getPrivateStream` / `deleteObject`
// e não sabe se por baixo há bucket ou disco. Trocar o provedor um dia deve
// custar este arquivo, não uma varredura no projeto inteiro.
//
// Dois modos, escolhidos pela configuração (ver config/index.js):
//
//   "r2"    — escreve no bucket. LEITURA tenta o bucket e, se o objeto não
//             estiver lá, cai no disco local. Esse fallback não é elegância:
//             a produção já tem arquivo no disco e a migração roda DEPOIS do
//             deploy; sem ele, todo anexo existente quebraria no instante em
//             que o R2 fosse ligado.
//   "disco" — comportamento histórico, arquivo plano em src/data/uploads e
//             src/data/private-uploads. É o que roda em qualquer clone do
//             projeto sem credencial de bucket.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  R2_ACCESS_KEY_ID,
  R2_BUCKET_PRIVATE,
  R2_BUCKET_PUBLIC,
  R2_ENDPOINT,
  R2_PUBLIC_BASE_URL,
  R2_SECRET_ACCESS_KEY,
  privateUploadsDir,
  r2Enabled,
  uploadsDir
} from "../../config/index.js";
import { buildKey, sanitizeFilename } from "./keys.js";

export {
  buildKey,
  folderForPurpose,
  sanitizeFilename,
  PUBLIC_CATEGORIES,
  PLATFORM_PREFIX,
  ORPHAN_PREFIX,
  tenantPrefix
} from "./keys.js";

/**
 * Cliente S3 apontado para o R2.
 *
 * `region: "auto"` porque o R2 não tem região (o SDK exige o campo mesmo
 * assim) e `forcePathStyle: true` porque o endpoint do R2 é
 * `<conta>.r2.cloudflarestorage.com/<bucket>` — no estilo virtual-host o SDK
 * montaria `<bucket>.<conta>...`, que não resolve.
 */
export function createR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
}

// Objeto ausente tem muitos nomes conforme o comando e a versão do SDK; o que
// interessa é distinguir "não existe" (cai no disco) de "o bucket está fora do
// ar" (tem de estourar, senão um incidente de rede viraria 404 silencioso).
function isNotFound(error) {
  const name = error?.name || error?.Code || "";
  const status = error?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function toStream(body) {
  if (Buffer.isBuffer(body)) return Readable.from([body]);
  if (body && typeof body.pipe === "function") return body;
  if (body && typeof body.transformToWebStream === "function") return Readable.fromWeb(body.transformToWebStream());
  return Readable.from([Buffer.from(body || "")]);
}

/**
 * Instância da camada de storage.
 *
 * É uma factory (e não um módulo com estado global) para que os testes possam
 * injetar um cliente de mentira, exatamente como a suíte do Asaas faz — nenhum
 * teste deste projeto pode falar com o R2 de verdade.
 *
 * @param {object} [options]
 * @param {{ send: Function }|null} [options.client] cliente S3 (ou dublê)
 * @param {string} [options.publicBucket]
 * @param {string} [options.privateBucket]
 * @param {string} [options.publicBaseUrl] domínio na frente do bucket público
 * @param {string} [options.publicDir]  diretório de fallback/escrita em disco
 * @param {string} [options.privateDir] idem, para arquivos privados
 */
export function createStorage({
  client = null,
  publicBucket = "",
  privateBucket = "",
  publicBaseUrl = "",
  publicDir = uploadsDir,
  privateDir = privateUploadsDir
} = {}) {
  const remote = Boolean(client && publicBucket && privateBucket);

  const bucketOf = (scope) => (scope === "private" ? privateBucket : publicBucket);
  const dirOf = (scope) => (scope === "private" ? privateDir : publicDir);
  // No disco tudo é plano: o nome do arquivo é o último segmento da chave.
  // É assim que o parque antigo está gravado, e é o que o fallback procura.
  const diskPathOf = (scope, key) => path.join(dirOf(scope), sanitizeFilename(key));

  /** URL pública de uma chave. No modo disco, o caminho servido por /uploads. */
  function publicUrl(key) {
    if (!key) return "";
    if (!remote || !publicBaseUrl) return `/uploads/${sanitizeFilename(key)}`;
    return `${publicBaseUrl}/${String(key).replace(/^\/+/, "")}`;
  }

  async function put(scope, key, body, { contentType = "application/octet-stream", cacheControl = null } = {}) {
    const buffer = await bodyToBuffer(body);
    if (!remote) {
      const target = diskPathOf(scope, key);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer);
      return { key, bytes: buffer.length, mode: "disco" };
    }
    await client.send(
      new PutObjectCommand({
        Bucket: bucketOf(scope),
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {})
      })
    );
    return { key, bytes: buffer.length, mode: "r2" };
  }

  /**
   * Grava no bucket público e devolve a URL completa que o frontend consome.
   * @returns {Promise<{ key: string, url: string, bytes: number, mode: string }>}
   */
  async function putPublic(key, body, options = {}) {
    // Imagem pública é imutável (o nome é aleatório): cache longo no CDN.
    const result = await put("public", key, body, { cacheControl: "public, max-age=31536000, immutable", ...options });
    return { ...result, url: publicUrl(key) };
  }

  /** Grava no bucket privado. Não existe URL pública para isto, de propósito. */
  async function putPrivate(key, body, options = {}) {
    return put("private", key, body, options);
  }

  /**
   * Lê um objeto privado. Tenta o R2; se o objeto não estiver lá, cai no disco
   * local (arquivo ainda não migrado). Devolve `null` quando não existe em
   * lugar nenhum — quem chama traduz isso em 404.
   *
   * @returns {Promise<{ body: import("node:stream").Readable, contentType: string|null,
   *   contentLength: number|null, source: "r2"|"disco" }|null>}
   */
  async function getPrivateStream(key) {
    if (remote) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: privateBucket, Key: key }));
        return {
          body: toStream(response.Body),
          contentType: response.ContentType || null,
          contentLength: Number(response.ContentLength) || null,
          source: "r2"
        };
      } catch (error) {
        if (!isNotFound(error)) throw error;
        // Segue para o disco: arquivo de antes da migração.
      }
    }
    const target = diskPathOf("private", key);
    try {
      const stat = await fsp.stat(target);
      if (!stat.isFile()) return null;
      return {
        body: fs.createReadStream(target),
        contentType: null,
        contentLength: stat.size,
        source: "disco"
      };
    } catch {
      return null;
    }
  }

  /** Mesma lógica de leitura, mas devolvendo o conteúdo inteiro em memória. */
  async function getPrivateBuffer(key) {
    const result = await getPrivateStream(key);
    if (!result) return null;
    return { ...result, buffer: await bodyToBuffer(result.body) };
  }

  /** Remove o objeto do bucket (e a cópia em disco, se ainda houver). */
  async function deleteObject(scope, key) {
    if (remote) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucketOf(scope), Key: key }));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    await fsp.unlink(diskPathOf(scope, key)).catch(() => {});
  }

  return {
    mode: remote ? "r2" : "disco",
    isRemote: remote,
    buildKey,
    publicUrl,
    putPublic,
    putPrivate,
    getPrivateStream,
    getPrivateBuffer,
    deleteObject
  };
}

// Instância padrão do processo, montada a partir do ambiente.
export const storage = createStorage(
  r2Enabled
    ? {
        client: createR2Client(),
        publicBucket: R2_BUCKET_PUBLIC,
        privateBucket: R2_BUCKET_PRIVATE,
        publicBaseUrl: R2_PUBLIC_BASE_URL
      }
    : {}
);

/** Uma linha no boot dizendo onde os arquivos estão indo parar de verdade. */
export function describeStorageMode() {
  if (storage.isRemote) {
    return `[storage] Cloudflare R2 ATIVO (público: ${R2_BUCKET_PUBLIC} em ${R2_PUBLIC_BASE_URL}, privado: ${R2_BUCKET_PRIVATE}). Escrita vai só para o bucket; leitura cai no disco local quando o objeto ainda não foi migrado.`;
  }
  return "[storage] R2 desligado: arquivos gravados no DISCO LOCAL (src/data/uploads e src/data/private-uploads), compartilhado entre todas as clínicas. Configure R2_BUCKET_PUBLIC/R2_BUCKET_PRIVATE para separar por clínica.";
}

// Modo de armazenamento é decisão de infraestrutura que muda o comportamento do
// sistema inteiro — nunca pode ser descoberto por acidente meses depois.
if (storage.isRemote) console.log(describeStorageMode());
else console.warn(describeStorageMode());

// Fachada de módulo: quem não precisa da factory importa a função direto.
export const putPublic = (...args) => storage.putPublic(...args);
export const putPrivate = (...args) => storage.putPrivate(...args);
export const getPrivateStream = (...args) => storage.getPrivateStream(...args);
export const getPrivateBuffer = (...args) => storage.getPrivateBuffer(...args);
export const deleteObject = (...args) => storage.deleteObject(...args);
export const publicUrl = (...args) => storage.publicUrl(...args);
