/**
 * Capa de destinos enchufables — la pieza que hace barato el pivote.
 *
 * El motor de sync no sabe si habla con Airtable, Google Sheets o Notion:
 * habla con esta interfaz. Añadir un destino nuevo = implementar estas
 * 4 operaciones. Nada más cambia (motor, webhooks, anti-bucle, logs).
 */
import * as airtable from "./airtable.server";

export interface DestRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface SyncDestination {
  /** Identificador del tipo de destino: "airtable" | "gsheets" | "notion"... */
  kind: string;
  /** Lee registros (opcionalmente solo los modificados desde una fecha ISO). */
  listRecords(opts?: { modifiedSince?: string }): Promise<DestRecord[]>;
  /** Crea registros y devuelve sus ids en el mismo orden. */
  createRecords(fieldsList: Record<string, unknown>[]): Promise<{ id: string }[]>;
  /** Actualiza registros por id. */
  updateRecords(updates: { id: string; fields: Record<string, unknown> }[]): Promise<void>;
  /** Borra registros por id. */
  deleteRecords(recordIds: string[]): Promise<void>;
}

// ---------------------------------------------------------------------
//  Implementación: Airtable (primer destino)
// ---------------------------------------------------------------------

class AirtableDestination implements SyncDestination {
  kind = "airtable";
  constructor(
    private token: string,
    private baseId: string,
    private tableId: string,
  ) {}

  listRecords(opts: { modifiedSince?: string } = {}) {
    return airtable.listRecords(this.token, this.baseId, this.tableId, opts);
  }
  createRecords(fieldsList: Record<string, unknown>[]) {
    return airtable.createRecords(this.token, this.baseId, this.tableId, fieldsList);
  }
  updateRecords(updates: { id: string; fields: Record<string, unknown> }[]) {
    return airtable.updateRecords(this.token, this.baseId, this.tableId, updates);
  }
  deleteRecords(recordIds: string[]) {
    return airtable.deleteRecords(this.token, this.baseId, this.tableId, recordIds);
  }
}

// ---------------------------------------------------------------------
//  Fábrica: de una conexión guardada al destino correspondiente.
//  Cuando exista GSheetsDestination, aquí se decide por conn.kind.
// ---------------------------------------------------------------------

export function destinationFor(conn: {
  token: string;
  baseId: string | null;
  tableId: string | null;
}): SyncDestination {
  if (!conn.baseId || !conn.tableId) {
    throw new Error("La conexión no está completa (falta base o tabla).");
  }
  return new AirtableDestination(conn.token, conn.baseId, conn.tableId);
}
