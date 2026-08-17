// Camada de armazenamento (Cloudflare R2) — pendência 7.
//
// Três coisas precisam ser verdade, e nenhuma delas dá para verificar olhando:
//
//   1. A CHAVE separa as clínicas. Era exatamente isso que o diretório único
//      em disco não fazia: comprovante de pagamento e PDF de anamnese de todas
//      as clínicas no mesmo lugar, distinguidos só pelo nome aleatório.
//   2. A LEITURA cai no disco quando o objeto não está no bucket. A produção
//      tem arquivo em disco e a migração roda DEPOIS do deploy — sem fallback,
//      todo anexo já existente quebraria no instante em que o R2 ligasse.
//   3. A VALIDAÇÃO de conteúdo continua recusando arquivo que mente sobre o
//      que é. Ela mudou de disco para buffer nesta troca, e é o que impede
//      subir um executável renomeado para .png.
//
// Nenhuma chamada real ao R2 acontece aqui: o cliente S3 é um dublê, no mesmo
// espírito do gateway falso de subscriptionSync.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buildKey, createStorage, folderForPurpose } from "../src/services/storage/index.js";
import { validateFileContents } from "../src/middleware/upload.js";

// PNG 1x1 de verdade (o mesmo que a suíte usa como assinatura digital).
const PNG_VALIDO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const GIF_VALIDO = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const PDF_MINIMO_VALIDO = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

/**
 * Dublê do cliente S3. Guarda os comandos recebidos porque metade do que
 * precisa ser provado é o que NÃO foi chamado (não pode haver escrita em
 * bucket nenhum quando o modo é disco).
 */
function clienteFalso({ objetos = new Map() } = {}) {
  const chamadas = { put: [], get: [], delete: [] };
  return {
    chamadas,
    objetos,
    async send(command) {
      const nome = command.constructor.name;
      const input = command.input;
      const endereco = `${input.Bucket}/${input.Key}`;
      if (nome === "PutObjectCommand") {
        chamadas.put.push(input);
        objetos.set(endereco, Buffer.from(input.Body));
        return {};
      }
      if (nome === "GetObjectCommand") {
        chamadas.get.push(input);
        const corpo = objetos.get(endereco);
        if (!corpo) {
          const erro = new Error(`NoSuchKey: ${endereco}`);
          erro.name = "NoSuchKey";
          erro.$metadata = { httpStatusCode: 404 };
          throw erro;
        }
        return { Body: Readable.from([corpo]), ContentType: "application/pdf", ContentLength: corpo.length };
      }
      if (nome === "DeleteObjectCommand") {
        chamadas.delete.push(input);
        objetos.delete(endereco);
        return {};
      }
      throw new Error(`Comando inesperado no dublê do R2: ${nome}`);
    }
  };
}

async function diretorioTemporario() {
  return fs.mkdtemp(path.join(os.tmpdir(), "aura-storage-"));
}

test("Storage: a chave separa as clínicas", async (t) => {
  await t.test("mesmo nome de arquivo em duas clínicas não colide", () => {
    const a = buildKey({ scope: "private", tenantId: 7, purpose: "payment_proof", filename: "comprovante" });
    const b = buildKey({ scope: "private", tenantId: 8, purpose: "payment_proof", filename: "comprovante" });
    assert.equal(a, "tenant_7/payment_proof/comprovante");
    assert.equal(b, "tenant_8/payment_proof/comprovante");
    assert.notEqual(a, b, "duas clínicas com o mesmo nome de arquivo TÊM de ocupar chaves distintas");
  });

  await t.test("público usa categoria; sem clínica é a landing da plataforma", () => {
    assert.equal(buildKey({ scope: "public", tenantId: 7, category: "geral", filename: "foto" }), "tenant_7/geral/foto");
    assert.equal(buildKey({ scope: "public", tenantId: 7, category: "joias", filename: "foto" }), "tenant_7/joias/foto");
    // Categoria fora da lista fechada não inventa pasta nova: cai em "geral".
    assert.equal(buildKey({ scope: "public", tenantId: 7, category: "inventada", filename: "foto" }), "tenant_7/geral/foto");
    assert.equal(buildKey({ scope: "public", tenantId: null, filename: "banner" }), "plataforma/geral/banner");
  });

  await t.test("privado sem dono identificável vai para orfaos/", () => {
    assert.equal(buildKey({ scope: "private", tenantId: null, purpose: "medical_record", filename: "x" }), "orfaos/x");
  });

  await t.test("o termo digital tem pasta própria, e o apelido mora num lugar só", () => {
    assert.equal(folderForPurpose("digital_term"), "termos");
    assert.equal(
      buildKey({ scope: "private", tenantId: 3, purpose: "digital_term", filename: "termo-digital-9.pdf" }),
      "tenant_3/termos/termo-digital-9.pdf"
    );
  });

  await t.test("nome e purpose maliciosos não escapam do prefixo da clínica", () => {
    const chave = buildKey({ scope: "private", tenantId: 7, purpose: "../../outro", filename: "../../../etc/passwd" });
    assert.ok(chave.startsWith("tenant_7/"), `a chave saiu do prefixo: ${chave}`);
    assert.ok(!chave.includes(".."), `a chave manteve travessia de diretório: ${chave}`);
    // O saneamento é feito ANTES de conferir a lista de categorias: "../joias"
    // vira "joias" (categoria válida) e o caminho não sobrevive de jeito nenhum.
    const publica = buildKey({ scope: "public", tenantId: 7, category: "../joias", filename: "a/b/c.png" });
    assert.equal(publica, "tenant_7/joias/c.png");
  });

  await t.test("id de tenant inválido nunca vira prefixo de clínica", () => {
    assert.equal(buildKey({ scope: "private", tenantId: "7; DROP", purpose: "p", filename: "x" }), "orfaos/x");
    assert.equal(buildKey({ scope: "public", tenantId: 0, filename: "x" }), "plataforma/geral/x");
  });
});

test("Storage: leitura cai no disco quando o objeto não está no bucket", async (t) => {
  const publicDir = await diretorioTemporario();
  const privateDir = await diretorioTemporario();
  const cliente = clienteFalso();
  const storage = createStorage({
    client: cliente,
    publicBucket: "aura-public",
    privateBucket: "aura-private",
    publicBaseUrl: "https://cdn.exemplo.com",
    publicDir,
    privateDir
  });

  t.after(async () => {
    await fs.rm(publicDir, { recursive: true, force: true });
    await fs.rm(privateDir, { recursive: true, force: true });
  });

  await t.test("objeto que está no bucket vem do bucket", async () => {
    const chave = buildKey({ scope: "private", tenantId: 5, purpose: "digital_term", filename: "termo-digital-1.pdf" });
    await storage.putPrivate(chave, Buffer.from("%PDF-1.4 no bucket"), { contentType: "application/pdf" });
    assert.equal(cliente.chamadas.put.at(-1).Bucket, "aura-private", "privado não pode ir para o bucket público");
    assert.equal(cliente.chamadas.put.at(-1).Key, chave);

    const objeto = await storage.getPrivateStream(chave);
    assert.ok(objeto, "o objeto acabou de ser gravado");
    assert.equal(objeto.source, "r2");
    const conteudo = await text(objeto.body);
    assert.equal(conteudo, "%PDF-1.4 no bucket");
  });

  await t.test("objeto ainda não migrado é lido do disco local", async () => {
    // Cenário exato do deploy: o arquivo existe em disco, plano, e a chave nova
    // ainda não existe no bucket.
    const chave = buildKey({ scope: "private", tenantId: 5, purpose: "public_booking", filename: "legado123" });
    await fs.writeFile(path.join(privateDir, "legado123"), "comprovante antigo");

    const objeto = await storage.getPrivateStream(chave);
    assert.ok(objeto, "sem fallback, todo anexo anterior à migração viraria 404");
    assert.equal(objeto.source, "disco");
    assert.equal(await text(objeto.body), "comprovante antigo");
    assert.equal(cliente.chamadas.get.at(-1).Key, chave, "o bucket é consultado ANTES do disco");
  });

  await t.test("arquivo que não existe em lugar nenhum devolve null (vira 404 na rota)", async () => {
    const chave = buildKey({ scope: "private", tenantId: 5, purpose: "medical_record", filename: "naoexiste" });
    assert.equal(await storage.getPrivateStream(chave), null);
  });

  await t.test("upload público devolve a URL completa do domínio próprio", async () => {
    const chave = buildKey({ scope: "public", tenantId: 5, category: "joias", filename: "abc123" });
    const resultado = await storage.putPublic(chave, PNG_VALIDO, { contentType: "image/png" });
    assert.equal(resultado.url, "https://cdn.exemplo.com/tenant_5/joias/abc123");
    const escrita = cliente.chamadas.put.at(-1);
    assert.equal(escrita.Bucket, "aura-public");
    assert.equal(escrita.ContentType, "image/png");
  });
});

test("Storage: sem R2 configurado o sistema continua no disco, sem tocar em bucket", async (t) => {
  const publicDir = await diretorioTemporario();
  const privateDir = await diretorioTemporario();
  const storage = createStorage({ publicDir, privateDir });

  t.after(async () => {
    await fs.rm(publicDir, { recursive: true, force: true });
    await fs.rm(privateDir, { recursive: true, force: true });
  });

  assert.equal(storage.mode, "disco");
  assert.equal(storage.isRemote, false);

  const chave = buildKey({ scope: "public", tenantId: 9, category: "geral", filename: "arquivo1" });
  const resultado = await storage.putPublic(chave, PNG_VALIDO, { contentType: "image/png" });
  // O contrato antigo continua de pé para quem clona o projeto sem bucket.
  assert.equal(resultado.url, "/uploads/arquivo1");
  const gravado = await fs.readFile(path.join(publicDir, "arquivo1"));
  assert.deepEqual(gravado, PNG_VALIDO);

  const privada = buildKey({ scope: "private", tenantId: 9, purpose: "postcare_photo", filename: "arquivo2" });
  await storage.putPrivate(privada, Buffer.from("foto"), { contentType: "image/png" });
  const lida = await storage.getPrivateStream(privada);
  assert.equal(lida.source, "disco");
  assert.equal(await text(lida.body), "foto");
});

test("Upload: conteúdo que mente sobre o que é continua sendo recusado", async (t) => {
  await t.test("executável renomeado para imagem não passa", async () => {
    // "MZ" é o cabeçalho de um .exe. O mimetype declarado é do navegador.
    const arquivo = { mimetype: "image/png", buffer: Buffer.from("MZ\x90\x00binário qualquer") };
    await assert.rejects(() => validateFileContents(arquivo));
  });

  await t.test("PDF sem assinatura %PDF- não passa", async () => {
    await assert.rejects(() => validateFileContents({ mimetype: "application/pdf", buffer: Buffer.from("<html>oi</html>") }));
    await assert.rejects(() => validateFileContents({ mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7\n truncado") }));
    await validateFileContents({ mimetype: "application/pdf", buffer: PDF_MINIMO_VALIDO });
  });

  await t.test("GIF só passa com GIF87a/GIF89a", async () => {
    await assert.rejects(() => validateFileContents({ mimetype: "image/gif", buffer: Buffer.from("GIF00a resto") }));
    await assert.rejects(() => validateFileContents({ mimetype: "image/gif", buffer: Buffer.from("GIF89a resto") }));
    await validateFileContents({ mimetype: "image/gif", buffer: GIF_VALIDO });
  });

  await t.test("arquivo vazio não passa", async () => {
    await assert.rejects(() => validateFileContents({ mimetype: "image/png", buffer: Buffer.alloc(0) }));
    await assert.rejects(() => validateFileContents({ mimetype: "image/png" }));
  });

  await t.test("imagem de verdade passa", async () => {
    await validateFileContents({ mimetype: "image/png", buffer: PNG_VALIDO });
  });
});

async function text(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
