/**
 * Webhooks de productos: Shopify nos avisa en tiempo real de cada
 * creación/cambio/borrado y lo replicamos en Airtable.
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  syncOneProductToAirtable,
  deleteProductFromAirtable,
  type ShopifyProduct,
} from "../services/sync.server";

/** Convierte el payload REST del webhook al formato que usa el motor. */
function webhookPayloadToProduct(payload: any): ShopifyProduct {
  return {
    id: payload.admin_graphql_api_id ?? `gid://shopify/Product/${payload.id}`,
    title: payload.title,
    descriptionHtml: payload.body_html,
    vendor: payload.vendor,
    productType: payload.product_type,
    status: payload.status?.toUpperCase?.() ?? payload.status,
    tags: typeof payload.tags === "string"
      ? payload.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
      : payload.tags,
    handle: payload.handle,
    updatedAt: payload.updated_at,
    variants: {
      nodes: (payload.variants ?? []).map((v: any) => ({
        id: v.admin_graphql_api_id ?? `gid://shopify/ProductVariant/${v.id}`,
        sku: v.sku,
        price: v.price,
        barcode: v.barcode,
        inventoryQuantity: v.inventory_quantity,
      })),
    },
    featuredMedia: payload.image?.src
      ? { preview: { image: { url: payload.image.src } } }
      : null,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  try {
    switch (topic) {
      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE":
        await syncOneProductToAirtable(shop, webhookPayloadToProduct(payload));
        break;
      case "PRODUCTS_DELETE":
        await deleteProductFromAirtable(
          shop,
          `gid://shopify/Product/${(payload as any).id}`,
        );
        break;
    }
  } catch (e) {
    // Nunca devolver 5xx en cascada: Shopify reintenta solo. Registramos y 200.
    console.error(`[webhook ${topic}] ${shop}:`, e);
  }

  return new Response();
};
