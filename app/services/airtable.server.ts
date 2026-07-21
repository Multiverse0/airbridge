/**
 * Cliente de la API de Airtable.
 * Usa el token personal (PAT) que el comerciante pega en el asistente de conexión.
 * Docs: https://airtable.com/developers/web/api/introduction
 */

const API = "https://api.airtable.com/v0";

export interface AirtableFieldDef {
  id: string;
  name: string;
  type: string;
}

export interface AirtableTableDef {
  id: string;
  name: string;
  fields: AirtableFieldDef[];
}

export class AirtableError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  retries = 3,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  // Rate limit de Airtable: 5 req/s por base → back-off y reintento
  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 1200));
    return req<T>(token, path, init, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AirtableError(res.status, `Airtable ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Comprueba que el token funciona y devuelve las bases accesibles. */
export async function listBases(token: string) {
  const data = await req<{ bases: { id: string; name: string; permissionLevel: string }[] }>(
    token,
    "/meta/bases",
  );
  return data.bases;
}

/** Tablas (con sus campos) de una base — lo necesitamos para el mapeo con IA. */
export async function listTables(token: string, baseId: string): Promise<AirtableTableDef[]> {
  const data = await req<{ tables: AirtableTableDef[] }>(
    token,
    `/meta/bases/${baseId}/tables`,
  );
  return data.tables;
}

/** Crea una tabla nueva en la base (para el modo "créamelo todo"). */
export async function createTable(
  token: string,
  baseId: string,
  name: string,
  fields: { name: string; type: string; options?: Record<string, unknown> }[],
) {
  return req<AirtableTableDef>(token, `/meta/bases/${baseId}/tables`, {
    method: "POST",
    body: JSON.stringify({ name, fields }),
  });
}

/** Lee registros paginando (pageSize máx 100). */
export async function listRecords(
  token: string,
  baseId: string,
  tableId: string,
  opts: { modifiedSince?: string } = {},
) {
  const records: { id: string; fields: Record<string, unknown>; createdTime: string }[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    // Filtro incremental: solo registros modificados desde la última pasada
    if (opts.modifiedSince) {
      params.set(
        "filterByFormula",
        `IS_AFTER(LAST_MODIFIED_TIME(), '${opts.modifiedSince}')`,
      );
    }
    const data = await req<{
      records: { id: string; fields: Record<string, unknown>; createdTime: string }[];
      offset?: string;
    }>(token, `/${baseId}/${tableId}?${params}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

/** Crea registros en lotes de 10 (límite de Airtable). Devuelve los ids creados en orden. */
export async function createRecords(
  token: string,
  baseId: string,
  tableId: string,
  fieldsList: Record<string, unknown>[],
) {
  const created: { id: string }[] = [];
  for (let i = 0; i < fieldsList.length; i += 10) {
    const batch = fieldsList.slice(i, i + 10).map((fields) => ({ fields }));
    const data = await req<{ records: { id: string }[] }>(
      token,
      `/${baseId}/${tableId}`,
      { method: "POST", body: JSON.stringify({ records: batch, typecast: true }) },
    );
    created.push(...data.records);
    // margen para el rate limit
    if (i + 10 < fieldsList.length) await new Promise((r) => setTimeout(r, 250));
  }
  return created;
}

/** Actualiza registros en lotes de 10. */
export async function updateRecords(
  token: string,
  baseId: string,
  tableId: string,
  updates: { id: string; fields: Record<string, unknown> }[],
) {
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    await req(token, `/${baseId}/${tableId}`, {
      method: "PATCH",
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (i + 10 < updates.length) await new Promise((r) => setTimeout(r, 250));
  }
}

/** Borra registros en lotes de 10. */
export async function deleteRecords(
  token: string,
  baseId: string,
  tableId: string,
  recordIds: string[],
) {
  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);
    const params = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
    await req(token, `/${baseId}/${tableId}?${params}`, { method: "DELETE" });
    if (i + 10 < recordIds.length) await new Promise((r) => setTimeout(r, 250));
  }
}
