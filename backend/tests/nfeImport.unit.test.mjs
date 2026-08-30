import assert from "node:assert/strict";
import test from "node:test";
import { NfeImportError, parseNfeXml, previewNfeImport } from "../src/services/nfeImport.js";

const KEY = "35260812345678000123550010000001231000001234";

function xml({ status = "100", extra = "" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc><NFe><infNFe Id="NFe${KEY}"><ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-08-30T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000123</CNPJ><xNome>Fornecedor Teste</xNome><IE>123</IE></emit>
  <det nItem="1"><prod><cProd>AG-01</cProd><cEAN>7891234567890</cEAN><xProd>Agulha</xProd><NCM>9018</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>2.50</vUnCom><vProd>25.00</vProd></prod></det>
  <total><ICMSTot><vProd>25.00</vProd><vFrete>5.00</vFrete><vDesc>2.00</vDesc><vNF>28.00</vNF></ICMSTot></total>
  <cobr><dup><nDup>001</nDup><dVenc>2026-09-30</dVenc><vDup>28.00</vDup></dup></cobr>
  <pag><detPag><tPag>17</tPag><vPag>28.00</vPag></detPag></pag>${extra}</infNFe></NFe>
  <protNFe><infProt><chNFe>${KEY}</chNFe><cStat>${status}</cStat><nProt>135260000000001</nProt></infProt></protNFe></nfeProc>`;
}

test("interpreta NF-e autorizada sem confirmar compra", () => {
  const parsed = parseNfeXml(xml());
  assert.equal(parsed.access_key, KEY);
  assert.equal(parsed.purchase_date, "2026-08-30");
  assert.equal(parsed.issuer.document, "12345678000123");
  assert.equal(parsed.items[0].gtin, "7891234567890");
  assert.equal(parsed.payment_method, "Pix");
  assert.deepEqual(parsed.totals, { products: 25, freight: 5, discount: 2, invoice: 28 });
});

test("recusa nota não autorizada e entidades externas", () => {
  assert.throws(() => parseNfeXml(xml({ status: "110" })), NfeImportError);
  assert.throws(() => parseNfeXml(`<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${xml()}`), /declaração externa/);
});

test("prévia localiza fornecedor e item sem gravar dados", async () => {
  let writes = 0;
  const db = {
    get: async (sql) => sql.includes("purchase_fiscal_documents") ? null : { id: 7, name: "Fornecedor Teste" },
    all: async () => [{ item_type: "consumable", consumable_id: 9, name: "Agulha" }],
    run: async () => { writes += 1; }
  };
  const preview = await previewNfeImport(db, xml());
  assert.equal(preview.supplier.id, 7);
  assert.equal(preview.items[0].match.consumable_id, 9);
  assert.equal(preview.requires_review, false);
  assert.equal(writes, 0);
  assert.equal(Object.hasOwn(preview, "xml"), false);
});
