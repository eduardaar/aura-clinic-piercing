// Dinheiro em NUMERIC(12,2) — pendência 13.
//
// Três coisas precisam valer ao mesmo tempo, e todas as três já quebraram em
// projeto real ao trocar DOUBLE PRECISION por NUMERIC:
//
//   1. o SOMATÓRIO feito pelo Postgres passa a ser exato (era esse o defeito);
//   2. o valor que chega ao JavaScript continua sendo `number`, porque o driver
//      `pg` devolve NUMERIC como STRING por padrão e `"10.00" + "5.00"` é
//      "10.005.00" — todo `reduce` de soma do sistema viraria concatenação;
//   3. o painel financeiro da PLATAFORMA continua recebendo string, que é o
//      contrato deliberado dele (services/platformFinance.js) e o motivo de o
//      conversor viver na camada das clínicas em vez de num parser global.
//
// O teste monta um schema descartável e aplica o schema.sql real nele: assim
// cobre também a migração idempotente (rodar duas vezes não pode falhar) sem
// tocar em nenhuma clínica de verdade.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool, query } from "../src/database/connection.js";
import { createDb, applySchemaSql } from "../src/db/postgres.js";

const SCHEMA = `qa_numeric_${Math.floor(performance.now() * 1000) % 1000000}`;

// Este arquivo é o único da suíte que abre conexão própria (os outros falam com
// o servidor por HTTP). Sem fechar o pool, o processo do `node --test` ficaria
// preso com os sockets abertos depois do último teste.
after(() => pool.end());

// Executa `fn(db, client)` com o search_path fixado num schema recém-criado,
// derrubado no fim aconteça o que acontecer.
async function comSchemaDescartavel(fn, { aplicarSchema = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    // Apenas o schema descartável no search_path, como faz o provisionamento
    // real: é o que impede os IF NOT EXISTS de serem enganados pelo "public".
    await client.query(`SET search_path TO "${SCHEMA}"`);
    if (aplicarSchema) await applySchemaSql(client);
    return await fn(createDb(client), client);
  } finally {
    try {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      client.release();
    } catch {
      client.release(true);
    }
  }
}

test("dinheiro é NUMERIC(12,2) no schema da clínica, medida física continua double", async () => {
  await comSchemaDescartavel(async (db) => {
    const colunas = await db.all(
      `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = current_schema()
        ORDER BY table_name, column_name`
    );
    const tipo = (tabela, coluna) =>
      colunas.find((c) => c.table_name === tabela && c.column_name === coluna);

    for (const [tabela, coluna] of [
      ["payments", "amount"],
      ["appointments", "total_value"],
      ["financial_entries", "paid_amount"],
      ["sales_order_items", "unit_price"],
      ["expenses", "amount"],
      ["services", "price"],
      ["coupons", "minimum_amount"]
    ]) {
      const c = tipo(tabela, coluna);
      assert.ok(c, `${tabela}.${coluna} não existe`);
      assert.equal(c.data_type, "numeric", `${tabela}.${coluna} deveria ser numeric`);
      assert.equal(Number(c.numeric_precision), 12, `${tabela}.${coluna}`);
      assert.equal(Number(c.numeric_scale), 2, `${tabela}.${coluna}`);
    }

    // Grandeza física não é dinheiro: 2 casas decimais truncariam medida real.
    for (const [tabela, coluna] of [
      ["jewelry_inventory", "weight_grams"],
      ["jewelry_inventory", "package_length_cm"],
      ["jewelry_variants", "length_mm"],
      ["inventory_suggestions", "confidence"]
    ]) {
      assert.equal(tipo(tabela, coluna)?.data_type, "double precision", `${tabela}.${coluna}`);
    }

    // Percentual que multiplica dinheiro dentro do SQL (relatório de comissão):
    // exato, mas numa faixa estreita.
    const comissao = tipo("professionals", "commission_percentage");
    assert.equal(comissao.data_type, "numeric");
    assert.equal(Number(comissao.numeric_precision), 5);
    assert.equal(Number(comissao.numeric_scale), 2);

    // Nenhuma coluna monetária pode ter sobrado em ponto flutuante.
    const dobrosRestantes = colunas
      .filter((c) => c.data_type === "double precision")
      .map((c) => `${c.table_name}.${c.column_name}`)
      .sort();
    assert.deepEqual(dobrosRestantes, [
      "clinic_settings.default_price_multiplier",
      "inventory_suggestions.confidence",
      "jewelry_inventory.package_height_cm",
      "jewelry_inventory.package_length_cm",
      "jewelry_inventory.package_width_cm",
      "jewelry_inventory.price_multiplier",
      "jewelry_inventory.top_size_mm",
      "jewelry_inventory.weight_grams",
      "jewelry_variants.length_mm",
      "jewelry_variants.price_multiplier",
      "jewelry_variants.top_size_mm"
    ]);
  });
});

test("SUM de dinheiro é exato no banco e chega ao JavaScript como number", async () => {
  await comSchemaDescartavel(async (db) => {
    const cliente = await db.run(
      "INSERT INTO clients (full_name, whatsapp) VALUES (?, ?) RETURNING id",
      ["Somatório QA", "11999999999"]
    );
    // Os três clássicos do IEEE-754: 0.1 + 0.2 e uma cauda de centavos que em
    // double precision não fecha.
    for (const valor of [0.1, 0.2, 10.05, 10.05, 10.05]) {
      await db.run(
        "INSERT INTO payments (client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, 'sinal', 'pix', 'pago', '2026-08-01 10:00:00')",
        [cliente.returnedId, valor]
      );
    }

    const soma = await db.get("SELECT SUM(amount) AS total FROM payments");
    assert.equal(typeof soma.total, "number", "a camada db converte NUMERIC para number");
    assert.equal(soma.total, 30.45, "o Postgres somou em decimal, sem resíduo de float");

    // A prova de que o ganho é do banco: a MESMA soma feita em JavaScript sobre
    // as linhas erra, e é por isso que somatório grande se faz em SQL.
    const linhas = await db.all("SELECT amount FROM payments ORDER BY id");
    const somaEmJs = linhas.reduce((acumulado, linha) => acumulado + linha.amount, 0);
    assert.notEqual(somaEmJs, 30.45, "soma em JS acumula erro — o teste protege a escolha, não a contradiz");
    assert.equal(Math.round(somaEmJs * 100) / 100, 30.45);

    // Valor individual: number, e sem surpresa de arredondamento.
    const primeiro = await db.get("SELECT amount FROM payments ORDER BY id LIMIT 1");
    assert.equal(typeof primeiro.amount, "number");
    assert.equal(primeiro.amount, 0.1);

    // Concatenação de string é o sintoma que o conversor existe para impedir.
    assert.equal(primeiro.amount + primeiro.amount, 0.2);

    // Diferença agregada (amount - paid_amount) é o coração do "a receber".
    const saldo = await db.get(
      "SELECT SUM(GREATEST(amount - 0.01, 0)) AS total FROM payments"
    );
    assert.equal(typeof saldo.total, "number");
    assert.equal(saldo.total, 30.4);
  });
});

test("o conversor de NUMERIC vale só para o schema da clínica; a plataforma continua recebendo string", async () => {
  // `query()` de database/connection.js é a porta do schema `platform`, cujo
  // painel financeiro trata dinheiro como string decimal de ponta a ponta.
  const resultado = await query("SELECT 189.80::numeric(12,2) AS valor");
  assert.equal(typeof resultado.rows[0].valor, "string");
  assert.equal(resultado.rows[0].valor, "189.80");

  // Já a camada das clínicas devolve number para a MESMA expressão.
  await comSchemaDescartavel(async (db) => {
    const linha = await db.get("SELECT 189.80::numeric(12,2) AS valor");
    assert.equal(typeof linha.valor, "number");
    assert.equal(linha.valor, 189.8);
  }, { aplicarSchema: false });

  // O resto dos tipos não pode ter sido afetado: BIGINT continua string (é
  // assim que o driver preserva 64 bits) e INTEGER continua number.
  await comSchemaDescartavel(async (db) => {
    const linha = await db.get("SELECT 9007199254740993::bigint AS grande, 7::int AS pequeno, 1.5::float8 AS medida");
    assert.equal(typeof linha.grande, "string");
    assert.equal(linha.grande, "9007199254740993");
    assert.equal(typeof linha.pequeno, "number");
    assert.equal(typeof linha.medida, "number");
  }, { aplicarSchema: false });
});

test("a migração de tipo é idempotente: aplicar o schema de novo não converte nada", async () => {
  await comSchemaDescartavel(async (db, client) => {
    // Simula a clínica legada: volta uma coluna para double precision e confere
    // que a segunda passada do schema.sql a traz de volta, com o valor intacto.
    await client.query("ALTER TABLE payments ALTER COLUMN amount TYPE double precision");
    const cliente = await db.run(
      "INSERT INTO clients (full_name, whatsapp) VALUES (?, ?) RETURNING id",
      ["Legado QA", "11988887777"]
    );
    await db.run(
      "INSERT INTO payments (client_id, amount, payment_type, method, status, paid_at) VALUES (?, 149.9, 'sinal', 'pix', 'pago', '2026-08-01 10:00:00')",
      [cliente.returnedId]
    );

    await applySchemaSql(client);
    const depois = await db.get(
      "SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='payments' AND column_name='amount'"
    );
    assert.equal(depois.data_type, "numeric", "a coluna legada foi convertida");
    const valor = await db.get("SELECT amount FROM payments ORDER BY id DESC LIMIT 1");
    assert.equal(valor.amount, 149.9, "o valor existente sobreviveu à conversão");

    // Terceira passada: nada mais a fazer, e sobretudo nada a reescrever — é o
    // que impede o boot do servidor de pegar ACCESS EXCLUSIVE em todas as
    // tabelas de todas as clínicas a cada restart.
    await applySchemaSql(client);
    const final = await db.get(
      "SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='payments' AND column_name='amount'"
    );
    assert.equal(final.data_type, "numeric");
  });
});
