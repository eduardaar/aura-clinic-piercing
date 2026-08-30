import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const MAX_XML_BYTES = 900 * 1024;
const AUTHORIZED_STATUS = new Set(["100", "150"]);
const PAYMENT_METHODS = Object.freeze({
  "01": "Dinheiro",
  "03": "Cartão de crédito",
  "04": "Cartão de débito",
  "15": "Boleto",
  "17": "Pix",
  "18": "Transferência",
  "90": "Outros"
});

export class NfeImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (value) => String(value ?? "").trim();
const digits = (value) => text(value).replace(/\D/g, "");
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const decimal = (value) => {
  const number = Number(text(value).replace(",", "."));
  return Number.isFinite(number) ? number : 0;
};

function parseDate(value) {
  const normalized = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function nfeNodes(parsed) {
  const process = parsed?.nfeProc;
  const nfe = process?.NFe || parsed?.NFe;
  return { process, info: nfe?.infNFe, protocol: process?.protNFe?.infProt };
}

export function parseNfeXml(xmlInput) {
  const xml = text(xmlInput).replace(/^\uFEFF/, "");
  const size = Buffer.byteLength(xml, "utf8");
  if (!xml || size > MAX_XML_BYTES) throw new NfeImportError("O XML da NF-e deve ter no máximo 900 KB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new NfeImportError("O XML contém declaração externa não permitida.");

  let parsed;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", trimValues: true, parseTagValue: false }).parse(xml);
  } catch {
    throw new NfeImportError("Não foi possível interpretar o XML da NF-e.");
  }
  const { info, protocol } = nfeNodes(parsed);
  if (!info || !protocol) throw new NfeImportError("Envie uma NF-e processada, com protocolo de autorização.");

  const accessKey = digits(text(info["@Id"]).replace(/^NFe/i, ""));
  if (accessKey.length !== 44) throw new NfeImportError("A chave de acesso da NF-e é inválida.");
  if (digits(protocol.chNFe) !== accessKey) throw new NfeImportError("A chave da nota difere da chave do protocolo.");
  const authorizationStatus = text(protocol.cStat);
  if (!AUTHORIZED_STATUS.has(authorizationStatus)) {
    throw new NfeImportError(`A NF-e não está autorizada (status ${authorizationStatus || "ausente"}).`, 422);
  }

  const identification = info.ide || {};
  const issuer = info.emit || {};
  const totals = info.total?.ICMSTot || {};
  const installments = list(info.cobr?.dup).map((installment, index) => ({
    number: text(installment.nDup) || String(index + 1),
    due_date: parseDate(installment.dVenc),
    amount: decimal(installment.vDup)
  })).filter((installment) => installment.due_date && installment.amount > 0);
  const payments = list(info.pag?.detPag).map((payment) => ({
    code: text(payment.tPag),
    method: PAYMENT_METHODS[text(payment.tPag)] || "Outros",
    amount: decimal(payment.vPag)
  }));

  const items = list(info.det).map((detail, index) => {
    const product = detail?.prod || {};
    const traces = list(product.rastro);
    return {
      line_number: Number(detail?.["@nItem"] || index + 1),
      supplier_code: text(product.cProd),
      gtin: [text(product.cEANTrib), text(product.cEAN)].find((value) => value && value !== "SEM GTIN") || "",
      name: text(product.xProd),
      ncm: text(product.NCM),
      cfop: text(product.CFOP),
      unit: text(product.uCom),
      quantity: decimal(product.qCom),
      unit_cost: decimal(product.vUnCom),
      total: decimal(product.vProd),
      batch_code: text(traces[0]?.nLote),
      expiry_date: parseDate(traces[0]?.dVal)
    };
  });
  if (!items.length) throw new NfeImportError("A NF-e não possui itens de produto.");

  return {
    access_key: accessKey,
    number: text(identification.nNF),
    series: text(identification.serie),
    issued_at: text(identification.dhEmi || identification.dEmi),
    purchase_date: parseDate(identification.dhEmi || identification.dEmi),
    protocol: text(protocol.nProt),
    authorization_status: authorizationStatus,
    xml_hash: crypto.createHash("sha256").update(xml, "utf8").digest("hex"),
    issuer: {
      name: text(issuer.xNome),
      trade_name: text(issuer.xFant),
      document: digits(issuer.CNPJ || issuer.CPF),
      state_registration: text(issuer.IE)
    },
    totals: {
      products: decimal(totals.vProd),
      freight: decimal(totals.vFrete),
      discount: decimal(totals.vDesc),
      invoice: decimal(totals.vNF)
    },
    payment_method: payments[0]?.method || "Outros",
    payments,
    installments,
    items,
    xml
  };
}

async function matchItem(db, item) {
  const params = [item.gtin || "__none__", item.supplier_code || "__none__", item.supplier_code || "__none__"];
  const candidates = await db.all(`
    SELECT 'product' AS item_type, j.id AS product_id, NULL::integer AS consumable_id,
      NULL::integer AS product_variant_id, j.name, j.sku, j.gtin, j.supplier_item_code
      FROM jewelry_inventory j
     WHERE j.status <> 'arquivado' AND (j.gtin=? OR j.supplier_item_code=? OR j.sku=?)
    UNION ALL
    SELECT 'product', v.jewelry_id, NULL::integer, v.id, CONCAT(j.name, ' - ', COALESCE(v.variation_name,v.sku)), v.sku, v.gtin, v.supplier_item_code
      FROM jewelry_variants v JOIN jewelry_inventory j ON j.id=v.jewelry_id
     WHERE v.is_active=1 AND (v.gtin=? OR v.supplier_item_code=? OR v.sku=?)
    UNION ALL
    SELECT 'consumable', NULL::integer, c.id, NULL::integer, c.name, NULL, c.gtin, c.supplier_item_code
      FROM consumables c
     WHERE c.status='active' AND (c.gtin=? OR c.supplier_item_code=? OR c.name=?)
    LIMIT 12
  `, [...params, ...params, item.gtin || "__none__", item.supplier_code || "__none__", item.name || "__none__"]);
  return { ...item, match: candidates.length === 1 ? candidates[0] : null, candidates };
}

export async function previewNfeImport(db, xmlInput) {
  const document = parseNfeXml(xmlInput);
  const duplicate = await db.get(
    "SELECT purchase_order_id FROM purchase_fiscal_documents WHERE access_key=? OR xml_hash=? LIMIT 1",
    [document.access_key, document.xml_hash]
  );
  if (duplicate) throw new NfeImportError(`Esta NF-e já foi importada na compra #${duplicate.purchase_order_id}.`, 409);
  const supplier = document.issuer.document
    ? await db.get("SELECT id, name, document, quality_status FROM suppliers WHERE document=? AND is_active=1", [document.issuer.document])
    : null;
  const items = [];
  for (const item of document.items) items.push(await matchItem(db, item));
  const { xml: _xml, ...safeDocument } = document;
  return { ...safeDocument, supplier, items, requires_review: !supplier || items.some((item) => !item.match) };
}

export async function registerPurchaseFiscalDocument(db, purchaseId, fiscalDocument, userId = null) {
  if (!fiscalDocument) return;
  await db.run(`
    INSERT INTO purchase_fiscal_documents
      (purchase_order_id, access_key, document_number, series, protocol, authorization_status,
       xml_hash, issuer_document, original_xml, imported_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    purchaseId, fiscalDocument.access_key, fiscalDocument.number, fiscalDocument.series,
    fiscalDocument.protocol, fiscalDocument.authorization_status, fiscalDocument.xml_hash,
    fiscalDocument.issuer.document, fiscalDocument.xml, userId
  ]);
}
