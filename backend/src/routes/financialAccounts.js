import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { P } from "../config/permissions.js";
import { FinancialRuleError } from "../services/finance.js";
import {
  financialAccounts,
  createFinancialAccount,
  accountUnallocated,
  allocateAccountSource,
  accountMovements,
  createAccountMovement,
  reverseAccountMovement,
  syncAccountSources,
} from "../services/financialAccounts.js";
import { recordAudit } from "../services/audit.js";

const router = Router();
const route = (permission, handler) =>
  withFeature("basic_finance", async (req, res, db) => {
    if (!authorizePermission(req, res, permission)) return;
    try {
      await handler(req, res, db);
    } catch (error) {
      if (error instanceof FinancialRuleError) return res.status(error.status || 400).json({ error: error.message });
      if (error.code === "23505")
        return res
          .status(409)
          .json({ error: "Este cadastro ou identificação já existe. Atualize a tela e confira o registro." });
      throw error;
    }
  });
router.get(
  "/api/finance/accounts/options",
  withFeature("basic_finance", async (req, res, db) => {
    if (
      ![P.CASH_VIEW, P.FINANCE_VIEW, P.CASH_RECEIVE_PAYMENT].some((permission) => hasPermission(req.user, permission))
    )
      return res.status(403).json({ error: "Sem permissão para consultar contas." });
    res.json(await db.all("SELECT id,name,kind,is_active FROM financial_accounts ORDER BY is_active DESC,lower(name)"));
  }),
);
router.get(
  "/api/finance/accounts",
  route(P.CASH_VIEW, async (_req, res, db) => { await syncAccountSources(db); res.json(await financialAccounts(db)); }),
);
router.post(
  "/api/finance/accounts",
  route(P.FINANCE_EDIT, async (req, res, db) =>
    res.status(201).json(await createFinancialAccount(db, req.body || {}, req)),
  ),
);
router.patch(
  "/api/finance/accounts/:id",
  route(P.FINANCE_EDIT, async (req, res, db) => {
    const after = await db.transaction(async (tx) => {
      const before = await tx.get("SELECT * FROM financial_accounts WHERE id=? FOR UPDATE", [req.params.id]);
      if (!before) throw new FinancialRuleError("Conta não encontrada.", 404);
      const name = String(req.body.name ?? before.name).trim();
      if (!name || name.length > 120 || ("is_active" in req.body && typeof req.body.is_active !== "boolean"))
        throw new FinancialRuleError("Informe nome e situação válidos.");
      if (["opening_balance", "opening_date", "kind"].some((key) => req.body[key] !== undefined))
        throw new FinancialRuleError(
          "Saldo inicial, data e tipo são preservados. Registre um ajuste com motivo para corrigir o saldo.",
        );
      await tx.run("UPDATE financial_accounts SET name=?,is_active=? WHERE id=?", [
        name,
        req.body.is_active ?? before.is_active,
        before.id,
      ]);
      const updated = await tx.get("SELECT * FROM financial_accounts WHERE id=?", [before.id]);
      await recordAudit(tx, {
        req,
        module: "finance",
        action: "update",
        entityType: "financial_account",
        entityId: before.id,
        reason: "Conta financeira alterada",
        before,
        after: updated,
      });
      return updated;
    });
    res.json(after);
  }),
);
router.get(
  "/api/finance/accounts/unallocated",
  route(P.CASH_VIEW, async (req, res, db) => { await syncAccountSources(db); res.json(await accountUnallocated(db, req.query)); }),
);
router.post(
  "/api/finance/accounts/allocate",
  route(P.FINANCE_EDIT, async (req, res, db) => res.json(await allocateAccountSource(db, req.body || {}, req))),
);
router.get(
  "/api/finance/account-movements",
  route(P.CASH_VIEW, async (req, res, db) => res.json(await accountMovements(db, req.query))),
);
router.post(
  "/api/finance/account-movements",
  route(P.FINANCE_EDIT, async (req, res, db) =>
    res.status(201).json(await createAccountMovement(db, req.body || {}, req)),
  ),
);
router.post(
  "/api/finance/account-movements/:id/reverse",
  route(P.FINANCE_EDIT, async (req, res, db) =>
    res.json(await reverseAccountMovement(db, req.params.id, req.body || {}, req)),
  ),
);
export default router;
