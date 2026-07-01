// Helper de validação de payload com Zod.
// A validação é PERMISSIVA por design: valida apenas presença/tipo dos campos
// obrigatórios de cada endpoint e usa .passthrough() nos schemas para não
// rejeitar os campos extras que o frontend envia. Em erro, responde 400 com
// mensagem clara. Não quebra payloads válidos.

// Formata os erros do Zod em uma mensagem única, legível.
function formatZodError(error) {
  const issues = error?.issues || [];
  const messages = issues.map((issue) => {
    const path = Array.isArray(issue.path) && issue.path.length ? issue.path.join(".") : null;
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return messages.length ? messages.join("; ") : "Dados inválidos.";
}

// Valida req.body contra o schema. Em caso de sucesso, substitui req.body pelo
// resultado parseado (mantém os campos extras por causa do .passthrough()).
// Retorna true se válido; caso contrário responde 400 e retorna false.
export function validateBody(schema, req, res) {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    res.status(400).json({ error: formatZodError(result.error) });
    return false;
  }
  req.body = result.data;
  return true;
}
