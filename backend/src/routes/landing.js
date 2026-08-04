// Conteúdo editável da landing pública.
//
// Duas audiências:
//   GET  /api/landing              PÚBLICA — o que a página em "/" consome
//   .../api/platform/landing/*     super-admin, o editor do painel
//
// As rotas de plataforma NÃO passam por `withDb`: o super-admin não pertence a
// nenhuma clínica, e o conteúdo vive no schema `platform`, que é global.
import { Router } from "express";
import path from "path";
import { verifyPlatformToken } from "../middleware/auth.js";
import { upload, parseUpload } from "../middleware/upload.js";
import { isProduction } from "../config/index.js";
import {
  LandingError,
  listLandingSections,
  updateLandingSection,
  reorderLandingSections
} from "../services/landing.js";

const router = Router();

function requirePlatform(req, res, next) {
  const decoded = verifyPlatformToken(req);
  if (!decoded) {
    return res.status(401).json({ error: "Sessão de plataforma inválida ou expirada." });
  }
  req.platformUser = decoded;
  next();
}

function handleLandingError(res, error) {
  if (error instanceof LandingError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(`[landing] ${error?.message || error}`);
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

// Só os blocos LIGADOS, já ordenados. A página não precisa saber que existe
// bloco desligado, e expor isso entregaria de graça o que está sendo preparado.
router.get("/api/landing", async (_req, res) => {
  try {
    res.json({ sections: await listLandingSections({ onlyEnabled: true }) });
  } catch (error) {
    // A landing NUNCA pode ficar em branco por causa do banco: ela é a porta de
    // entrada de quem vai assinar. Devolvendo lista vazia, o front cai nos
    // valores embutidos no código e a página continua de pé.
    console.error(`[landing] falha ao ler o conteúdo público: ${error.message}`);
    res.json({ sections: [] });
  }
});

// ---------------------------------------------------------------------------
// Painel da plataforma
// ---------------------------------------------------------------------------

// TODOS os blocos, inclusive os desligados — sem eles no painel não haveria
// como religar um bloco.
router.get("/api/platform/landing", requirePlatform, async (_req, res) => {
  try {
    res.json({ sections: await listLandingSections({ onlyEnabled: false }) });
  } catch (error) {
    handleLandingError(res, error);
  }
});

router.put("/api/platform/landing/sections/:key", requirePlatform, async (req, res) => {
  try {
    const updated = await updateLandingSection(req.params.key, {
      content: req.body?.content,
      enabled: req.body?.enabled,
      userId: req.platformUser?.sub
    });
    res.json(updated);
  } catch (error) {
    handleLandingError(res, error);
  }
});

// Reordenação em lote: o painel manda a lista inteira na ordem final, em vez de
// "mova o bloco X para a posição N". Assim o resultado não depende da ordem em
// que as requisições chegam.
router.patch("/api/platform/landing/order", requirePlatform, async (req, res) => {
  try {
    const sections = await reorderLandingSections(req.body?.keys, req.platformUser?.sub);
    res.json({ sections });
  } catch (error) {
    handleLandingError(res, error);
  }
});

// Upload de imagem da landing.
//
// Rota própria porque `POST /api/uploads` passa por `withDb` e exige um tenant
// resolvido — e o super-admin não pertence a clínica nenhuma. Reusa o mesmo
// multer (limite de 6 MB e filtro de tipo já configurados lá) e grava no mesmo
// diretório servido em /uploads.
router.post("/api/platform/landing/uploads", requirePlatform, async (req, res) => {
  try {
    await parseUpload(upload.single("file"), req, res);
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
    // Em modo R2 a camada de storage já subiu o arquivo e devolve a URL do CDN;
    // em modo disco não existe `publicUrl` e o caminho relativo continua valendo.
    // Devolver o caminho relativo nos dois casos apontaria, no R2, para um disco
    // onde o arquivo não está.
    //
    // `path.basename` segue como defesa em profundidade no ramo de disco: o nome
    // é gerado pelo multer, mas nada aqui deve poder montar um caminho para fora
    // de /uploads.
    const url = req.file.publicUrl || `/uploads/${path.basename(req.file.filename)}`;
    res.status(201).json({ url });
  } catch (error) {
    handleLandingError(res, error);
  }
});

export default router;
