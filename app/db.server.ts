import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

function makeClient() {
  // Producción: base de datos gestionada Turso (libsql) vía DATABASE_URL + DATABASE_AUTH_TOKEN.
  // Local: fichero SQLite (sin authToken).
  const adapter = new PrismaLibSql({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.sqlite",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return new PrismaClient({ adapter });
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = makeClient();
  }
}

const prisma = global.prismaGlobal ?? makeClient();

export default prisma;
