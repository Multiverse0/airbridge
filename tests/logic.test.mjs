/**
 * Tests de la lógica crítica: anti-bucle (hash), mapeo producto→fila,
 * y la heurística de mapeo IA. Ejecutar:
 *   node --experimental-strip-types --test tests/logic.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productToAirtableFields,
  contentHash,
} from "../app/services/core.server.ts";
import { heuristicMapping } from "../app/services/mapping.server.ts";

const PRODUCT = {
  id: "gid://shopify/Product/123",
  title: "Camiseta básica",
  descriptionHtml: "<p>Algodón 100%</p>",
  vendor: "MiMarca",
  productType: "Ropa",
  status: "ACTIVE",
  tags: ["verano", "rebajas"],
  handle: "camiseta-basica",
  variants: {
    nodes: [
      { id: "gid://shopify/ProductVariant/1", sku: "CAM-001", price: "19.90", barcode: "84000123", inventoryQuantity: 42 },
    ],
  },
  featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/x.jpg" } } },
};

const MAP = [
  { shopifyField: "title", airtableField: "Título" },
  { shopifyField: "variants[0].price", airtableField: "Precio" },
  { shopifyField: "variants[0].inventoryQuantity", airtableField: "Stock" },
  { shopifyField: "tags", airtableField: "Etiquetas" },
  { shopifyField: "featuredImageUrl", airtableField: "Imagen" },
];

test("mapea producto → fila de Airtable (incl. variantes, tags e imagen)", () => {
  const fields = productToAirtableFields(PRODUCT, MAP);
  assert.equal(fields["Título"], "Camiseta básica");
  assert.equal(fields["Precio"], "19.90");
  assert.equal(fields["Stock"], 42);
  assert.equal(fields["Etiquetas"], "verano, rebajas"); // array → texto
  assert.equal(fields["Imagen"], "https://cdn.shopify.com/x.jpg");
});

test("anti-bucle: mismo contenido → mismo hash; contenido distinto → hash distinto", () => {
  const f1 = productToAirtableFields(PRODUCT, MAP);
  const f2 = productToAirtableFields(PRODUCT, MAP);
  assert.equal(contentHash(f1), contentHash(f2));

  const cambiado = { ...PRODUCT, title: "Camiseta premium" };
  const f3 = productToAirtableFields(cambiado, MAP);
  assert.notEqual(contentHash(f1), contentHash(f3));
});

test("anti-bucle: el orden de las claves no cambia el hash", () => {
  const a = { X: 1, Y: "dos" };
  const b = { Y: "dos", X: 1 };
  assert.equal(contentHash(a), contentHash(b));
});

test("producto sin variantes no revienta (devuelve null)", () => {
  const sinVariantes = { id: "gid://1", title: "Solo" };
  const fields = productToAirtableFields(sinVariantes, MAP);
  assert.equal(fields["Precio"], null);
  assert.equal(fields["Stock"], null);
  assert.equal(fields["Imagen"], null);
});

test("heurística de mapeo: columnas en español se emparejan bien", () => {
  const columns = [
    { id: "f1", name: "Nombre", type: "singleLineText" },
    { id: "f2", name: "Precio", type: "currency" },
    { id: "f3", name: "SKU", type: "singleLineText" },
    { id: "f4", name: "Existencias", type: "number" },
    { id: "f5", name: "Notas internas", type: "multilineText" },
  ];
  const sugg = heuristicMapping(columns);
  const by = Object.fromEntries(sugg.map((s) => [s.shopifyField, s.airtableField]));
  assert.equal(by["title"], "Nombre");
  assert.equal(by["variants[0].price"], "Precio");
  assert.equal(by["variants[0].sku"], "SKU");
  assert.equal(by["variants[0].inventoryQuantity"], "Existencias");
  // "Notas internas" no debe mapearse a nada
  assert.ok(!sugg.some((s) => s.airtableField === "Notas internas"));
});

test("heurística: cada columna se usa como mucho una vez", () => {
  const columns = [
    { id: "f1", name: "Precio", type: "currency" },
  ];
  const sugg = heuristicMapping(columns);
  const usos = sugg.filter((s) => s.airtableField === "Precio");
  assert.equal(usos.length, 1);
});
