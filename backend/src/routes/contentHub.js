import { Router } from "express";
import { requirePlatformAuth } from "../middleware/auth.js";
import {
  ContentHubError,
  archiveArticle,
  createArticle,
  getPublishedArticle,
  listAdminArticles,
  listPublishedArticles,
  updateArticle,
} from "../services/contentHub.js";

const router = Router();

function handleContentError(res, error) {
  if (error instanceof ContentHubError) return res.status(error.statusCode).json({ error: error.message });
  console.error(`[content] ${error?.message || error}`);
  return res.status(500).json({ error: "Não foi possível concluir a operação." });
}

router.get("/api/news", async (req, res) => {
  try {
    res.json({ articles: await listPublishedArticles("news", { limit: req.query.limit }) });
  } catch (error) {
    handleContentError(res, error);
  }
});

router.get("/api/news/:slug", async (req, res) => {
  try {
    res.json({ article: await getPublishedArticle("news", req.params.slug) });
  } catch (error) {
    handleContentError(res, error);
  }
});

router.get("/api/manual", async (_req, res) => {
  try {
    res.json({ articles: await listPublishedArticles("manual") });
  } catch (error) {
    handleContentError(res, error);
  }
});

router.get("/api/platform/content", requirePlatformAuth, async (req, res) => {
  try {
    res.json({ articles: await listAdminArticles(req.query.type) });
  } catch (error) {
    handleContentError(res, error);
  }
});

router.post("/api/platform/content", requirePlatformAuth, async (req, res) => {
  try {
    res.status(201).json({ article: await createArticle(req.body, req.platformUser?.sub) });
  } catch (error) {
    handleContentError(res, error);
  }
});

router.put("/api/platform/content/:id", requirePlatformAuth, async (req, res) => {
  try {
    res.json({ article: await updateArticle(req.params.id, req.body, req.platformUser?.sub) });
  } catch (error) {
    handleContentError(res, error);
  }
});

router.delete("/api/platform/content/:id", requirePlatformAuth, async (req, res) => {
  try {
    res.json({ article: await archiveArticle(req.params.id, req.platformUser?.sub) });
  } catch (error) {
    handleContentError(res, error);
  }
});

export default router;
