import assert from "node:assert/strict";
import test from "node:test";

import { assertMigrationCliPolicy, databaseBootstrapIsDisabled } from "../src/db/migrationPolicy.js";

test("deploy com RUN_DATABASE_MIGRATIONS=false desativa bootstrap e DDL", () => {
  assert.equal(databaseBootstrapIsDisabled({ RUN_DATABASE_MIGRATIONS: "false" }), true);
  assert.equal(databaseBootstrapIsDisabled({ SKIP_DATABASE_BOOTSTRAP: "true" }), true);
  assert.equal(databaseBootstrapIsDisabled({ NODE_ENV: "production", RUN_DATABASE_MIGRATIONS: "true" }), true);
  assert.equal(databaseBootstrapIsDisabled({ NODE_ENV: "production", ALLOW_LEGACY_GLOBAL_BOOTSTRAP: "true" }), false);
  assert.equal(databaseBootstrapIsDisabled({}), false);
});

test("apply em produção sem tenant é bloqueado", () => {
  assert.throws(
    () => assertMigrationCliPolicy({ command: "apply", nodeEnv: "production" }),
    /Refusing global tenant migration in production/
  );
});

test("apply em produção permite tenant explícito", () => {
  assert.doesNotThrow(() => assertMigrationCliPolicy({
    command: "apply", tenant: "2455", nodeEnv: "production"
  }));
});

test("--all em produção exige autorização administrativa dupla", () => {
  assert.throws(() => assertMigrationCliPolicy({
    command: "apply", all: true, nodeEnv: "production", allowGlobal: "false"
  }));
  assert.doesNotThrow(() => assertMigrationCliPolicy({
    command: "apply", all: true, nodeEnv: "production", allowGlobal: "true"
  }));
});
