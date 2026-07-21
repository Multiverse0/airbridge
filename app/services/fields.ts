/**
 * Catálogo de campos de Shopify disponibles para mapear.
 * Módulo compartido cliente/servidor (sin dependencias de servidor).
 */

export interface FieldMap {
  shopifyField: string; // p.ej. "title", "variants[0].price"
  airtableField: string; // nombre de la columna en Airtable
}

export const SHOPIFY_PRODUCT_FIELDS: { key: string; label: string; type: string }[] = [
  { key: "title", label: "Título del producto", type: "text" },
  { key: "descriptionHtml", label: "Descripción (HTML)", type: "longtext" },
  { key: "vendor", label: "Proveedor / marca", type: "text" },
  { key: "productType", label: "Tipo de producto", type: "text" },
  { key: "status", label: "Estado (activo/borrador)", type: "text" },
  { key: "tags", label: "Etiquetas", type: "text" },
  { key: "handle", label: "Handle (URL)", type: "text" },
  { key: "variants[0].sku", label: "SKU (1ª variante)", type: "text" },
  { key: "variants[0].price", label: "Precio (1ª variante)", type: "number" },
  { key: "variants[0].barcode", label: "Código de barras", type: "text" },
  { key: "variants[0].inventoryQuantity", label: "Stock (1ª variante)", type: "number" },
  { key: "featuredImageUrl", label: "URL imagen principal", type: "url" },
  { key: "id", label: "ID de Shopify (solo lectura)", type: "text" },
];
