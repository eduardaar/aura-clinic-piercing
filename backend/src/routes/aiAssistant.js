import { Router } from "express";
import { z } from "zod";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { AiAssistantError, AI_TASKS, getAiProviderStatus, runAiAssistantTask } from "../services/aiAssistant.js";

const router = Router();

const assistantSchema = z.object({
  task: z.enum(AI_TASKS, { error: "Tarefa de IA inválida." }),
  input: z.object({
    context: z.string({ error: "input.context deve ser um texto." }),
    tone: z.string({ error: "input.tone deve ser um texto." }).optional(),
    instruction: z.string({ error: "input.instruction deve ser um texto." }).optional()
  }, { error: "input deve ser um objeto." })
}).strict();

function handleAiError(res, error) {
  if (error instanceof AiAssistantError) return res.status(error.statusCode).json({ error: error.message });
  console.error(`[ai-assistant] ${error?.message || error}`);
  return res.status(502).json({ error: "Não foi possível concluir a solicitação de IA." });
}

// Status deliberadamente pequeno: revela somente se há provedor utilizável e
// quais tarefas a interface pode oferecer. Chaves, modelos e configuração de
// ambiente permanecem exclusivamente no processo do servidor.
router.get("/api/ai-assistant/status", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json(getAiProviderStatus());
}));

router.post("/api/ai-assistant", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  if (!validateBody(assistantSchema, req, res)) return;
  try {
    // Não há ferramentas nem instruções livres: o serviço aceita apenas as
    // tarefas allowlisted e retorna texto para revisão humana.
    res.json(await runAiAssistantTask(req.body));
  } catch (error) {
    handleAiError(res, error);
  }
}));

export default router;
