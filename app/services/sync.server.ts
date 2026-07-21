/**
 * Motor de sincronización AirBridge.
 *
 * Principios (de aquí salen las reseñas de 5 estrellas):
 *  1. NUNCA corromper datos: cada cambio se aplica solo si sabemos de dónde viene.
 *  2. Anti-bucle: guardamos un hash de lo último sincronizado; si el contenido
 *     no cambió de verdad, no se toca nada (evita ping-pong Shopify↔Airtable).
 *  3. Todo queda registrado en SyncLog (transparencia para el comerciante).
 */

import prisma from "../db.server";
import { destinationFor } from "./destination.server";
import { SHOPIFY_PRODUCT_FIELDS, type FieldMap } from "./fields";
import {
  contentHash,
  normalizeValue,
  productToAirtableFields,
  type ShopifyProduct,
} from "./core.server";

export { SHOPIFY_PRODUCT_FIELDS, type FieldMap };
export { contentHash, productToAirtableFields, type ShopifyProduct };

// Campos que aceptamos escribir de vuelta en Shopify (lista blanca de seguridad)
const WRITABLE_TO_SHOPIFY = new Set([
  "title",
  "descriptionHtml",
  "vendor",
  "productType",
  "tags",
  "variants[0].price",
  "variants[0].sku",
  "variants[0].barcode",
]);

async function log(
  shop: string,
  direction: "s2a" | "a2s",
  entityId: string,
  action: string,
  ok = true,
  message?: string,
) {
  await prisma.syncLog.create({
    data: { shop, direction, resource: "products", entityId, action, ok, message },
  });
}

// ---------- Shopify → Airtable ----------

const PRODUCTS_QUERY = `#graphql
  query AirbridgeProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title descriptionHtml vendor productType status tags handle updatedAt
        featuredMedia { preview { image { url } } }
        variants(first: 5) {
          nodes { id sku price barcode inventoryQuantity }
        }
      }
    }
  }
`;

/**
 * Sincronización completa Shopify → Airtable (primera pasada o "re-sync").
 * Crea o actualiza cada producto en Airtable y apunta el espejo en SyncRecord.
 */
export async function fullSyncShopifyToAirtable(
  adminGraphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>,
  shop: string,
): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  const conn = await prisma.airtableConnection.findUnique({
    where: { shop },
    include: { syncConfig: true },
  });
  if (!conn?.syncConfig || !conn.baseId || !conn.tableId) {
    throw new Error("Configura la conexión con Airtable antes de sincronizar.");
  }
  const fieldMap: FieldMap[] = JSON.parse(conn.syncConfig.fieldMapJson);
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 };

  // 1. Traer todos los productos de Shopify paginando
  const products: ShopifyProduct[] = [];
  let cursor: string | null = null;
  do {
    const res = await adminGraphql(PRODUCTS_QUERY, { variables: { cursor } });
    const body = await res.json();
    const page = body.data.products;
    products.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  // 2. Upsert por producto con hash anti-trabajo-inútil
  const toCreate: { product: ShopifyProduct; fields: Record<string, unknown>; hash: string }[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown>; shopifyId: string; hash: string }[] = [];

  for (const product of products) {
    try {
      const fields = productToAirtableFields(product, fieldMap);
      const hash = contentHash(fields);
      const existing = await prisma.syncRecord.findUnique({
        where: { shop_resource_shopifyId: { shop, resource: "products", shopifyId: product.id } },
      });
      if (!existing) {
        toCreate.push({ product, fields, hash });
      } else if (existing.lastSyncedHash !== hash) {
        toUpdate.push({ id: existing.airtableRecordId, fields, shopifyId: product.id, hash });
      } else {
        stats.skipped++;
      }
    } catch (e) {
      stats.errors++;
      await log(shop, "s2a", product.id, "update", false, String(e));
    }
  }

  // 3. Ejecutar en lotes (vía destino enchufable)
  const dest = destinationFor(conn);
  if (toCreate.length) {
    const created = await dest.createRecords(toCreate.map((c) => c.fields));
    for (let i = 0; i < created.length; i++) {
      await prisma.syncRecord.create({
        data: {
          shop,
          resource: "products",
          shopifyId: toCreate[i].product.id,
          airtableRecordId: created[i].id,
          lastSyncedHash: toCreate[i].hash,
        },
      });
      await log(shop, "s2a", toCreate[i].product.id, "create");
      stats.created++;
    }
  }

  if (toUpdate.length) {
    await dest.updateRecords(toUpdate.map((u) => ({ id: u.id, fields: u.fields })));
    for (const u of toUpdate) {
      await prisma.syncRecord.update({
        where: { shop_resource_shopifyId: { shop, resource: "products", shopifyId: u.shopifyId } },
        data: { lastSyncedHash: u.hash },
      });
      await log(shop, "s2a", u.shopifyId, "update");
      stats.updated++;
    }
  }

  await prisma.syncConfig.update({
    where: { shop },
    data: { lastFullSync: new Date() },
  });

  return stats;
}

/**
 * Sincroniza UN producto (lo llama el webhook products/update y products/create).
 */
export async function syncOneProductToAirtable(shop: string, product: ShopifyProduct) {
  const conn = await prisma.airtableConnection.findUnique({
    where: { shop },
    include: { syncConfig: true },
  });
  if (!conn?.syncConfig?.enabled || !conn.baseId || !conn.tableId) return;
  if (conn.syncConfig.direction === "airtable_to_shopify") return;

  const fieldMap: FieldMap[] = JSON.parse(conn.syncConfig.fieldMapJson);
  const fields = productToAirtableFields(product, fieldMap);
  const hash = contentHash(fields);

  const existing = await prisma.syncRecord.findUnique({
    where: { shop_resource_shopifyId: { shop, resource: "products", shopifyId: product.id } },
  });

  if (existing?.lastSyncedHash === hash) {
    // Nada nuevo (probablemente el eco de nuestro propio cambio) → anti-bucle
    await log(shop, "s2a", product.id, "skip", true, "sin cambios (anti-bucle)");
    return;
  }

  const dest = destinationFor(conn);
  if (!existing) {
    const [created] = await dest.createRecords([fields]);
    await prisma.syncRecord.create({
      data: {
        shop,
        resource: "products",
        shopifyId: product.id,
        airtableRecordId: created.id,
        lastSyncedHash: hash,
      },
    });
    await log(shop, "s2a", product.id, "create");
  } else {
    await dest.updateRecords([{ id: existing.airtableRecordId, fields }]);
    await prisma.syncRecord.update({
      where: { shop_resource_shopifyId: { shop, resource: "products", shopifyId: product.id } },
      data: { lastSyncedHash: hash },
    });
    await log(shop, "s2a", product.id, "update");
  }
}

/** Borra el registro espejo cuando se borra el producto en Shopify. */
export async function deleteProductFromAirtable(shop: string, shopifyProductId: string) {
  const conn = await prisma.airtableConnection.findUnique({
    where: { shop },
    include: { syncConfig: true },
  });
  if (!conn?.syncConfig?.enabled || !conn.baseId || !conn.tableId) return;

  const existing = await prisma.syncRecord.findUnique({
    where: {
      shop_resource_shopifyId: { shop, resource: "products", shopifyId: shopifyProductId },
    },
  });
  if (!existing) return;
  await destinationFor(conn).deleteRecords([existing.airtableRecordId]);
  await prisma.syncRecord.delete({ where: { id: existing.id } });
  await log(shop, "s2a", shopifyProductId, "delete");
}

// ---------- Airtable → Shopify ----------

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation AirbridgeProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

/**
 * Pasada Airtable → Shopify: lee registros modificados desde el último sync
 * y aplica los cambios permitidos (lista blanca) a Shopify.
 * Se ejecuta bajo demanda o con un cron ligero (Airtable no tiene webhooks en PAT básico).
 */
export async function syncAirtableToShopify(
  adminGraphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>,
  shop: string,
): Promise<{ updated: number; skipped: number; errors: number }> {
  const conn = await prisma.airtableConnection.findUnique({
    where: { shop },
    include: { syncConfig: true },
  });
  const stats = { updated: 0, skipped: 0, errors: 0 };
  if (!conn?.syncConfig?.enabled || !conn.baseId || !conn.tableId) return stats;
  if (conn.syncConfig.direction === "shopify_to_airtable") return stats;

  const fieldMap: FieldMap[] = JSON.parse(conn.syncConfig.fieldMapJson);
  const writableMaps = fieldMap.filter((m) => WRITABLE_TO_SHOPIFY.has(m.shopifyField));
  if (!writableMaps.length) return stats;

  const since = conn.syncConfig.lastFullSync?.toISOString() ?? new Date(0).toISOString();
  const records = await destinationFor(conn).listRecords({ modifiedSince: since });

  for (const record of records) {
    try {
      const mirror = await prisma.syncRecord.findFirst({
        where: { shop, resource: "products", airtableRecordId: record.id },
      });
      if (!mirror) {
        stats.skipped++; // registro creado a mano en Airtable: MVP no crea productos nuevos
        continue;
      }

      // ¿Cambió de verdad respecto a lo último sincronizado?
      const mappedNow: Record<string, unknown> = {};
      for (const m of fieldMap) mappedNow[m.airtableField] = normalizeValue(record.fields[m.airtableField] ?? null);
      const hash = contentHash(mappedNow);
      if (hash === mirror.lastSyncedHash) {
        stats.skipped++; // eco de nuestro propio sync → anti-bucle
        continue;
      }

      // Construir la mutación solo con campos de la lista blanca
      const productInput: Record<string, unknown> = { id: mirror.shopifyId };
      for (const m of writableMaps) {
        const val = record.fields[m.airtableField];
        if (val === undefined) continue;
        if (m.shopifyField === "tags") {
          productInput.tags = String(val ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        } else if (m.shopifyField.startsWith("variants[0].")) {
          // Las variantes van en otra mutación; MVP: se omiten aquí y se
          // gestionan en la fase 3.1 (productVariantsBulkUpdate).
          continue;
        } else {
          productInput[m.shopifyField] = val;
        }
      }

      if (Object.keys(productInput).length <= 1) {
        stats.skipped++;
        continue;
      }

      const res = await adminGraphql(PRODUCT_UPDATE_MUTATION, {
        variables: { product: productInput },
      });
      const body = await res.json();
      const errs = body.data?.productUpdate?.userErrors ?? [];
      if (errs.length) {
        stats.errors++;
        await log(shop, "a2s", mirror.shopifyId, "update", false, JSON.stringify(errs));
        continue;
      }

      await prisma.syncRecord.update({
        where: { id: mirror.id },
        data: { lastSyncedHash: hash },
      });
      await log(shop, "a2s", mirror.shopifyId, "update");
      stats.updated++;
    } catch (e) {
      stats.errors++;
      await log(shop, "a2s", record.id, "update", false, String(e));
    }
  }

  return stats;
}
