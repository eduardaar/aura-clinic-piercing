import { recordAudit } from "./audit.js";

export class ClientMergeError extends Error {
  constructor(message, status = 400, code = "client_merge_invalid") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const text = (value) => String(value ?? "").trim();
const bestText = (destination, source) => text(destination) || text(source);
const safeRelation = (destination, source, sourceId, targetId) => {
  const candidates = [destination, source].map(Number).filter(Number.isInteger);
  return candidates.find((id) => id > 0 && id !== sourceId && id !== targetId) || null;
};
const tags = (value) => {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
};

export function mergeClientData(destination, source) {
  const sourceId = Number(source.id);
  const targetId = Number(destination.id);
  const merged = {};
  for (const field of [
    "social_name", "phone", "whatsapp", "instagram", "email", "birth_date", "cpf", "tax_id",
    "preferred_contact", "postal_code", "address_line", "address_number", "address_complement",
    "neighborhood", "city", "state", "acquisition_source", "blocked_reason", "emergency_contact_name",
    "emergency_contact_phone", "guardian_relationship", "notes", "asaas_customer_id",
  ]) merged[field] = bestText(destination[field], source[field]);
  merged.referred_by_client_id = safeRelation(destination.referred_by_client_id, source.referred_by_client_id, sourceId, targetId);
  merged.guardian_client_id = safeRelation(destination.guardian_client_id, source.guardian_client_id, sourceId, targetId);
  merged.tags = [...new Set([...tags(destination.tags), ...tags(source.tags)].map((item) => text(item).toLowerCase()).filter(Boolean))];
  merged.operational_consent = Boolean(destination.operational_consent || source.operational_consent);
  merged.marketing_consent = Boolean(destination.marketing_consent || source.marketing_consent);
  return merged;
}

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const IMMUTABLE_CLIENT_REFERENCES = new Set(["privacy_audit_logs"]);

export async function mergeClients(db, { sourceId, targetId, reason, actor, req }) {
  sourceId = Number(sourceId);
  targetId = Number(targetId);
  reason = text(reason);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId <= 0 || targetId <= 0)
    throw new ClientMergeError("Selecione dois clientes válidos.");
  if (sourceId === targetId) throw new ClientMergeError("O cliente de origem e o destino devem ser diferentes.");
  if (reason.length < 5) throw new ClientMergeError("Informe um motivo com pelo menos 5 caracteres.");

  return db.transaction(async (tx) => {
    const records = await tx.all("SELECT * FROM clients WHERE id IN (?, ?) FOR UPDATE", [sourceId, targetId]);
    const source = records.find((client) => Number(client.id) === sourceId);
    const destination = records.find((client) => Number(client.id) === targetId);
    if (!source) throw new ClientMergeError("Cliente de origem não encontrado.", 404, "source_not_found");
    if (!destination) throw new ClientMergeError("Cliente de destino não encontrado.", 404, "target_not_found");
    if (source.merged_into_client_id) throw new ClientMergeError("Este cadastro já foi mesclado e é terminal.", 409, "source_already_merged");
    if (destination.merged_into_client_id) throw new ClientMergeError("O cadastro de destino já foi mesclado em outro cliente.", 409, "target_already_merged");
    if (source.deleted_at || source.anonymized_at) throw new ClientMergeError("O cadastro de origem está excluído ou anonimizado.", 409, "source_terminal");
    if (destination.deleted_at || destination.anonymized_at) throw new ClientMergeError("O cadastro de destino está excluído ou anonimizado.", 409, "target_terminal");

    const mergedData = mergeClientData(destination, source);
    const references = await tx.all(`
      SELECT DISTINCT tc.table_name,kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=current_schema()
        AND ccu.table_schema=current_schema() AND ccu.table_name='clients' AND ccu.column_name='id'
    `);
    const moved = {};
    for (const reference of references) {
      const table = String(reference.table_name);
      const column = String(reference.column_name);
      if (table === "clients" || IMMUTABLE_CLIENT_REFERENCES.has(table)) continue;
      if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) throw new ClientMergeError("Referência de cliente inválida no banco.", 500, "unsafe_reference");
      const result = await tx.run(`UPDATE "${table}" SET "${column}"=? WHERE "${column}"=?`, [targetId, sourceId]);
      if (result.changes) moved[table] = (moved[table] || 0) + Number(result.changes);
    }

    // Relacionamentos entre clientes não podem virar autorreferência no destino.
    await tx.run("UPDATE clients SET referred_by_client_id=? WHERE referred_by_client_id=? AND id NOT IN (?, ?)", [targetId, sourceId, sourceId, targetId]);
    await tx.run("UPDATE clients SET guardian_client_id=? WHERE guardian_client_id=? AND id NOT IN (?, ?)", [targetId, sourceId, sourceId, targetId]);

    await tx.run(`
      UPDATE clients SET social_name=?,phone=?,whatsapp=?,instagram=?,email=?,birth_date=?,cpf=?,tax_id=?,
        preferred_contact=?,postal_code=?,address_line=?,address_number=?,address_complement=?,neighborhood=?,city=?,state=?,
        acquisition_source=?,referred_by_client_id=?,tags=?,blocked_reason=?,operational_consent=?,marketing_consent=?,
        emergency_contact_name=?,emergency_contact_phone=?,guardian_client_id=?,guardian_relationship=?,notes=?,asaas_customer_id=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, [
      mergedData.social_name, mergedData.phone, mergedData.whatsapp, mergedData.instagram, mergedData.email,
      mergedData.birth_date, mergedData.cpf, mergedData.tax_id, mergedData.preferred_contact || "whatsapp",
      mergedData.postal_code, mergedData.address_line, mergedData.address_number, mergedData.address_complement,
      mergedData.neighborhood, mergedData.city, mergedData.state, mergedData.acquisition_source,
      mergedData.referred_by_client_id, JSON.stringify(mergedData.tags), mergedData.blocked_reason,
      mergedData.operational_consent, mergedData.marketing_consent, mergedData.emergency_contact_name,
      mergedData.emergency_contact_phone, mergedData.guardian_client_id, mergedData.guardian_relationship,
      mergedData.notes, mergedData.asaas_customer_id, targetId,
    ]);

    const mergedAt = new Date().toISOString();
    await tx.run(`
      UPDATE clients SET full_name=?,social_name='',phone='',whatsapp=?,instagram='',email='',birth_date='',cpf='',tax_id='',
        preferred_contact='whatsapp',postal_code='',address_line='',address_number='',address_complement='',neighborhood='',city='',state='',
        acquisition_source='',referred_by_client_id=NULL,tags='[]'::jsonb,lifecycle_status='inactive',blocked_reason='',
        operational_consent=false,marketing_consent=false,emergency_contact_name='',emergency_contact_phone='',guardian_client_id=NULL,
        guardian_relationship='',notes='',asaas_customer_id=NULL,deleted_at=?,anonymized_at=?,merged_into_client_id=?,merged_at=?,
        merged_by_user_id=?,merge_reason=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, [`Cliente mesclado #${sourceId}`, `mesclado-${sourceId}`, mergedAt, mergedAt, targetId, mergedAt, actor?.id || null, reason, sourceId]);

    await recordAudit(tx, {
      req, actor, module: "clients", action: "merge", entityType: "client", entityId: targetId, reason,
      before: { source_id: sourceId, target_id: targetId, source_status: source.lifecycle_status, target_status: destination.lifecycle_status },
      after: { source_id: sourceId, target_id: targetId, source_status: "merged", target_status: destination.lifecycle_status },
      metadata: { moved_records: moved, immutable_audit_references_preserved: true }, severity: "warning",
    });
    return { source_id: sourceId, target_id: targetId, merged_at: mergedAt, moved_records: moved };
  });
}
