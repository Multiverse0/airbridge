/**
 * Migración de base de datos para producción — sin binarios de Prisma.
 *
 * Aplica el SQL de prisma/migrations/*​/migration.sql sobre la base de datos
 * (libsql/SQLite) de forma idempotente: si una tabla ya existe, se ignora.
 * Así el arranque en el servidor no depende de `prisma migrate deploy`
 * (que necesita binarios que a veces no se pueden descargar).
 */
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL || "file:./prisma/dev.sqlite";
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const migrationsDir = join(process.cwd(), "prisma", "migrations");

function splitStatements(sql) {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const IGNORABLE = /already exists|duplicate column|duplicate index/i;

async function run() {
  let dirs = [];
  try {
    dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    console.log("[migrate] no hay carpeta de migraciones, nada que aplicar");
    return;
  }

  for (const dir of dirs) {
    let sql;
    try {
      sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    for (const stmt of splitStatements(sql)) {
      try {
        await db.execute(stmt);
      } catch (e) {
        if (IGNORABLE.test(e.message)) continue; // ya aplicado → idempotente
        console.error(`[migrate] error en (${dir}):`, e.message);
        throw e;
      }
    }
    console.log(`[migrate] aplicada: ${dir}`);
  }
  console.log("[migrate] base de datos lista ✅");
}

run().catch((e) => {
  console.error("[migrate] falló:", e);
  process.exit(1);
});
