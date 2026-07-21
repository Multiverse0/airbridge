/**
 * Funciones puras del motor de sync (sin base de datos ni red) — testeables.
 */
import crypto from "crypto";
import type { FieldMap } from "./fields";

export interface ShopifyProduct {
  id: string; // gid://shopify/Product/123
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  status?: string | null;
  tags?: string[] | null;
  handle?: string | null;
  updatedAt?: string | null;
  variants?: {
    nodes: {
      id: string;
      sku?: string | null;
      price?: string | null;
      barcode?: string | null;
      inventoryQuantity?: number | null;
    }[];
  };
  featuredMedia?: { preview?: { image?: { url?: string | null } | null } | null } | null;
}

export function getPath(obj: unknown, path: string): unknown {
  // soporta "variants[0].price" y "featuredImageUrl" (campo virtual)
  if (path === "featuredImageUrl") {
    const p = obj as ShopifyProduct;
    return p.featuredMedia?.preview?.image?.url ?? null;
  }
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return null;
    // variants es {nodes:[...]} en GraphQL
    if (part === "variants" && cur.variants?.nodes) {
      cur = cur.variants.nodes;
      continue;
    }
    cur = cur[part];
  }
  return cur ?? null;
}

export function normalizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.join(", ");
  if (v === undefined) return null;
  return v;
}

/** Convierte un producto de Shopify en la fila de Airtable según el mapeo. */
export function productToAirtableFields(
  product: ShopifyProduct,
  fieldMap: FieldMap[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const m of fieldMap) {
    fields[m.airtableField] = normalizeValue(getPath(product, m.shopifyField));
  }
  return fields;
}

/** Hash estable del contenido mapeado — la pieza anti-bucle. */
export function contentHash(fields: Record<string, unknown>): string {
  const sorted = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${JSON.stringify(fields[k] ?? null)}`)
    .join("|");
  return crypto.createHash("sha256").update(sorted).digest("hex").slice(0, 32);
}
