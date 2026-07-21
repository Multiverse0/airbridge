/**
 * Mapeo asistido por IA — la ventaja de AirBridge.
 *
 * Problema que resuelve: configurar qué columna de Airtable corresponde a qué
 * campo de Shopify es lo más farragoso de estas apps (y lo más criticado en
 * las reseñas de la competencia). Aquí lo hace la máquina:
 *
 *  1. Heurística (gratis, siempre disponible): nombres parecidos + tipos compatibles.
 *  2. LLM (si hay ANTHROPIC_API_KEY): resuelve los casos ambiguos y explica
 *     cada decisión en lenguaje llano para que el comerciante confirme.
 */

import { SHOPIFY_PRODUCT_FIELDS, type FieldMap } from "./fields";
import type { AirtableFieldDef } from "./airtable.server";

export interface MappingSuggestion extends FieldMap {
  confidence: "alta" | "media" | "baja";
  reason: string;
}

// ---------- 1. Heurística ----------

const SYNONYMS: Record<string, string[]> = {
  title: ["title", "titulo", "título", "nombre", "name", "producto", "product"],
  descriptionHtml: ["description", "descripcion", "descripción", "desc", "detalle", "body"],
  vendor: ["vendor", "marca", "brand", "proveedor", "fabricante", "supplier"],
  productType: ["type", "tipo", "categoria", "categoría", "category"],
  status: ["status", "estado", "activo", "active"],
  tags: ["tags", "etiquetas", "labels"],
  handle: ["handle", "slug", "url"],
  "variants[0].sku": ["sku", "referencia", "ref", "codigo", "código"],
  "variants[0].price": ["price", "precio", "pvp", "importe", "amount"],
  "variants[0].barcode": ["barcode", "ean", "upc", "gtin", "codigo de barras"],
  "variants[0].inventoryQuantity": ["stock", "inventory", "inventario", "cantidad", "qty", "unidades", "existencias"],
  featuredImageUrl: ["image", "imagen", "foto", "photo", "picture", "img"],
  id: ["shopify id", "id shopify", "shopifyid", "gid"],
};

const TYPE_COMPAT: Record<string, string[]> = {
  text: ["singleLineText", "multilineText", "richText", "singleSelect", "email", "phoneNumber"],
  longtext: ["multilineText", "richText", "singleLineText"],
  number: ["number", "currency", "percent", "singleLineText"],
  url: ["url", "singleLineText", "multipleAttachments"],
};

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

export function heuristicMapping(airtableFields: AirtableFieldDef[]): MappingSuggestion[] {
  const suggestions: MappingSuggestion[] = [];
  const used = new Set<string>();

  for (const sf of SHOPIFY_PRODUCT_FIELDS) {
    const syns = (SYNONYMS[sf.key] ?? [norm(sf.label)]).map(norm);
    let best: { field: AirtableFieldDef; score: number } | null = null;

    for (const af of airtableFields) {
      if (used.has(af.id)) continue;
      const name = norm(af.name);
      let score = 0;
      if (syns.includes(name)) score = 3; // nombre exacto
      else if (syns.some((s) => name.includes(s) || s.includes(name))) score = 2; // parcial
      if (score === 0) continue;
      // bonus por tipo compatible
      const compat = TYPE_COMPAT[sf.type] ?? [];
      if (compat.includes(af.type)) score += 1;
      if (!best || score > best.score) best = { field: af, score };
    }

    if (best && best.score >= 2) {
      used.add(best.field.id);
      suggestions.push({
        shopifyField: sf.key,
        airtableField: best.field.name,
        confidence: best.score >= 4 ? "alta" : best.score === 3 ? "media" : "baja",
        reason:
          best.score >= 3
            ? `La columna "${best.field.name}" coincide con "${sf.label}".`
            : `El nombre de "${best.field.name}" se parece a "${sf.label}" — revísalo.`,
      });
    }
  }
  return suggestions;
}

// ---------- 2. LLM (refina la heurística si hay clave) ----------

export async function aiMapping(
  airtableFields: AirtableFieldDef[],
  sampleRecords: Record<string, unknown>[] = [],
): Promise<MappingSuggestion[]> {
  const base = heuristicMapping(airtableFields);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return base;

  try {
    const prompt = `Eres el asistente de configuración de una app que sincroniza Shopify con Airtable.

Columnas de la tabla de Airtable del usuario (nombre y tipo):
${airtableFields.map((f) => `- "${f.name}" (${f.type})`).join("\n")}

${sampleRecords.length ? `Ejemplos de filas reales (para deducir qué contiene cada columna):\n${JSON.stringify(sampleRecords.slice(0, 3), null, 2)}\n` : ""}

Campos de Shopify disponibles:
${SHOPIFY_PRODUCT_FIELDS.map((f) => `- ${f.key}: ${f.label} (${f.type})`).join("\n")}

Propuesta preliminar por heurística:
${JSON.stringify(base, null, 2)}

Devuelve SOLO un JSON array de objetos {shopifyField, airtableField, confidence: "alta"|"media"|"baja", reason} con el mejor mapeo posible. La "reason" debe estar en español, en una frase llana que un comerciante sin conocimientos técnicos entienda. No mapees columnas que claramente no correspondan a ningún campo. No inventes columnas.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return base;
    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1) return base;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as MappingSuggestion[];

    // Validación: solo campos y columnas que existen de verdad
    const validShopify = new Set(SHOPIFY_PRODUCT_FIELDS.map((f) => f.key));
    const validAirtable = new Set(airtableFields.map((f) => f.name));
    const clean = parsed.filter(
      (m) => validShopify.has(m.shopifyField) && validAirtable.has(m.airtableField),
    );
    return clean.length ? clean : base;
  } catch {
    return base; // ante cualquier fallo del LLM, la heurística manda
  }
}

/** Esquema de tabla nueva "lista para usar" si el usuario no tiene nada montado. */
export function defaultTableSchema() {
  return {
    name: "Productos Shopify",
    fields: [
      { name: "Título", type: "singleLineText" },
      { name: "Descripción", type: "multilineText" },
      { name: "Marca", type: "singleLineText" },
      { name: "Tipo", type: "singleLineText" },
      { name: "Estado", type: "singleLineText" },
      { name: "Etiquetas", type: "singleLineText" },
      { name: "SKU", type: "singleLineText" },
      { name: "Precio", type: "number", options: { precision: 2 } },
      { name: "Stock", type: "number", options: { precision: 0 } },
      { name: "Imagen", type: "url" },
      { name: "Shopify ID", type: "singleLineText" },
    ],
    mapping: [
      { shopifyField: "title", airtableField: "Título" },
      { shopifyField: "descriptionHtml", airtableField: "Descripción" },
      { shopifyField: "vendor", airtableField: "Marca" },
      { shopifyField: "productType", airtableField: "Tipo" },
      { shopifyField: "status", airtableField: "Estado" },
      { shopifyField: "tags", airtableField: "Etiquetas" },
      { shopifyField: "variants[0].sku", airtableField: "SKU" },
      { shopifyField: "variants[0].price", airtableField: "Precio" },
      { shopifyField: "variants[0].inventoryQuantity", airtableField: "Stock" },
      { shopifyField: "featuredImageUrl", airtableField: "Imagen" },
      { shopifyField: "id", airtableField: "Shopify ID" },
    ] as FieldMap[],
  };
}
