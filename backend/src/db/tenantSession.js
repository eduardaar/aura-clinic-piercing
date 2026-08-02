// Acesso ao schema de uma clínica FORA do ciclo de requisição autenticada.
//
// O `withDb` resolve o tenant a partir do token/header — o que não existe num
// webhook: o Asaas posta sem sessão, sem X-Tenant e sem saber o que é um
// tenant. Este helper cobre esse caso (e servirá a jobs/workers), preservando
// as mesmas garantias que tornam o isolamento confiável:
//
//   - o schema vem SEMPRE de "tenant_" + id inteiro do banco, nunca de input;
//   - o formato é revalidado antes de entrar no SET search_path;
//   - o search_path é resetado no finally, e o client é DESTRUÍDO se o reset
//     falhar — devolver um client "sujo" ao pool vazaria dados entre clínicas.
import { pool } from "../database/connection.js";
import { createDb } from "./postgres.js";

const TENANT_SCHEMA_REGEX = /^tenant_\d+$/;

/**
 * Executa `fn(db)` com o search_path fixado no schema da clínica.
 * @param {number} tenantId id em platform.tenants
 * @param {(db: ReturnType<typeof createDb>) => Promise<any>} fn
 */
export async function withTenantSchema(tenantId, fn) {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Id de clínica inválido: ${tenantId}`);
  }
  const schema = `tenant_${id}`;
  if (!TENANT_SCHEMA_REGEX.test(schema)) {
    throw new Error(`Schema de clínica inválido: ${schema}`);
  }

  const client = await pool.connect();
  let db;
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    db = createDb(client);
    return await fn(db);
  } catch (error) {
    // Mesma rede de segurança do withDb: dentro de uma transação abortada
    // nenhuma query passa, então desfazer vem antes de qualquer outra coisa.
    if (db) await db.abortOpenTransaction();
    throw error;
  } finally {
    try {
      if (db?.inTransaction()) {
        console.error("Transação deixada aberta; desfazendo antes de devolver o client.");
        await db.abortOpenTransaction();
      }
      await client.query("SET search_path TO public");
      client.release();
    } catch {
      client.release(true);
    }
  }
}
