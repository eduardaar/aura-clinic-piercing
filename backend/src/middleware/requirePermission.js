import { hasPermission } from "../services/permissionService.js";

export function authorizePermission(req, res, permission) {
  if (!hasPermission(req.user, permission)) {
    res.status(403).json({ error: "Você não tem permissão para esta ação." });
    return false;
  }
  return true;
}

// Middleware Express disponível para novas rotas; rotas legadas dentro de
// withDb usam authorizePermission enquanto a migração incremental acontece.
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!authorizePermission(req, res, permission)) return;
    next();
  };
}
