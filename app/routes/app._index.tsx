/**
 * AirBridge — pantalla principal: asistente de conexión en 4 pasos + panel de control.
 *
 * Paso 1: pegar el token de Airtable
 * Paso 2: elegir base y tabla (o "créamela")
 * Paso 3: revisar el mapeo propuesto por la IA
 * Paso 4: activar → sync inicial → panel con actividad
 */
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import * as airtable from "../services/airtable.server";
import { aiMapping, defaultTableSchema } from "../services/mapping.server";
import {
  fullSyncShopifyToAirtable,
  syncAirtableToShopify,
} from "../services/sync.server";
import { SHOPIFY_PRODUCT_FIELDS } from "../services/fields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const conn = await prisma.airtableConnection.findUnique({
    where: { shop },
    include: { syncConfig: true },
  });

  let bases: { id: string; name: string }[] = [];
  let tables: { id: string; name: string }[] = [];
  if (conn?.token) {
    try {
      bases = (await airtable.listBases(conn.token)).map((b) => ({ id: b.id, name: b.name }));
      if (conn.baseId) {
        tables = (await airtable.listTables(conn.token, conn.baseId)).map((t) => ({
          id: t.id,
          name: t.name,
        }));
      }
    } catch {
      // token caducado/revocado: el UI mostrará el paso 1 de nuevo
    }
  }

  const logs = await prisma.syncLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  return json({
    shop,
    hasToken: Boolean(conn?.token),
    baseId: conn?.baseId ?? null,
    tableId: conn?.tableId ?? null,
    tableName: conn?.tableName ?? null,
    enabled: conn?.syncConfig?.enabled ?? false,
    direction: conn?.syncConfig?.direction ?? "both",
    fieldMap: conn?.syncConfig ? JSON.parse(conn.syncConfig.fieldMapJson) : [],
    lastFullSync: conn?.syncConfig?.lastFullSync ?? null,
    bases,
    tables,
    logs: logs.map((l) => ({
      when: l.createdAt.toISOString().replace("T", " ").slice(0, 19),
      direction: l.direction === "s2a" ? "Shopify → Airtable" : "Airtable → Shopify",
      action: l.action,
      ok: l.ok,
      message: l.message ?? "",
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
    switch (intent) {
      case "save-token": {
        const token = String(form.get("token") ?? "").trim();
        if (!token.startsWith("pat")) {
          return json({ error: "Eso no parece un token de Airtable (empiezan por 'pat...')." });
        }
        await airtable.listBases(token); // valida el token de verdad
        await prisma.airtableConnection.upsert({
          where: { shop },
          update: { token, baseId: null, tableId: null, tableName: null },
          create: { shop, token },
        });
        return json({ ok: "Token válido. Conexión con Airtable establecida." });
      }

      case "choose-base": {
        const baseId = String(form.get("baseId"));
        await prisma.airtableConnection.update({
          where: { shop },
          data: { baseId, tableId: null, tableName: null },
        });
        return json({ ok: "Base seleccionada." });
      }

      case "choose-table": {
        const conn = await prisma.airtableConnection.findUniqueOrThrow({ where: { shop } });
        const tableId = String(form.get("tableId"));
        const tables = await airtable.listTables(conn.token, conn.baseId!);
        const table = tables.find((t) => t.id === tableId);
        if (!table) return json({ error: "Tabla no encontrada." });

        // IA: proponer el mapeo con las columnas reales del usuario
        const sample = await airtable
          .listRecords(conn.token, conn.baseId!, tableId)
          .then((r) => r.slice(0, 3).map((x) => x.fields))
          .catch(() => []);
        const suggestions = await aiMapping(table.fields, sample);

        await prisma.airtableConnection.update({
          where: { shop },
          data: { tableId, tableName: table.name },
        });
        await prisma.syncConfig.upsert({
          where: { shop },
          update: { fieldMapJson: JSON.stringify(suggestions) },
          create: {
            shop,
            connectionId: conn.id,
            fieldMapJson: JSON.stringify(suggestions),
          },
        });
        return json({ ok: `Tabla "${table.name}" elegida. La IA ha propuesto el mapeo.` });
      }

      case "create-table": {
        const conn = await prisma.airtableConnection.findUniqueOrThrow({ where: { shop } });
        const schema = defaultTableSchema();
        const table = await airtable.createTable(
          conn.token,
          conn.baseId!,
          schema.name,
          schema.fields,
        );
        await prisma.airtableConnection.update({
          where: { shop },
          data: { tableId: table.id, tableName: table.name },
        });
        await prisma.syncConfig.upsert({
          where: { shop },
          update: { fieldMapJson: JSON.stringify(schema.mapping) },
          create: { shop, connectionId: conn.id, fieldMapJson: JSON.stringify(schema.mapping) },
        });
        return json({ ok: `Tabla "${table.name}" creada en tu Airtable, con el mapeo listo.` });
      }

      case "set-direction": {
        await prisma.syncConfig.update({
          where: { shop },
          data: { direction: String(form.get("direction")) },
        });
        return json({ ok: "Dirección de sincronización guardada." });
      }

      case "enable-and-sync": {
        await prisma.syncConfig.update({ where: { shop }, data: { enabled: true } });
        const stats = await fullSyncShopifyToAirtable(
          (q, o) => admin.graphql(q, o),
          shop,
        );
        return json({
          ok: `Sincronización activada. Primera pasada: ${stats.created} creados, ${stats.updated} actualizados, ${stats.skipped} sin cambios${stats.errors ? `, ${stats.errors} errores` : ""}.`,
        });
      }

      case "pull-airtable": {
        const stats = await syncAirtableToShopify((q, o) => admin.graphql(q, o), shop);
        return json({
          ok: `Cambios de Airtable aplicados: ${stats.updated} actualizados, ${stats.skipped} sin cambios${stats.errors ? `, ${stats.errors} errores` : ""}.`,
        });
      }

      case "disable": {
        await prisma.syncConfig.update({ where: { shop }, data: { enabled: false } });
        return json({ ok: "Sincronización pausada." });
      }
    }
    return json({ error: "Acción desconocida." });
  } catch (e) {
    return json({ error: `Algo falló: ${String(e).slice(0, 300)}` });
  }
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [token, setToken] = useState("");
  const [baseId, setBaseId] = useState(data.baseId ?? "");
  const [tableId, setTableId] = useState(data.tableId ?? "");

  const busy = fetcher.state !== "idle";
  const result = fetcher.data as { ok?: string; error?: string } | undefined;

  const step = !data.hasToken ? 1 : !data.baseId ? 2 : !data.tableId ? 2.5 : !data.enabled ? 3 : 4;

  const fieldLabel = (key: string) =>
    SHOPIFY_PRODUCT_FIELDS.find((f) => f.key === key)?.label ?? key;

  return (
    <Page title="AirBridge — Shopify ↔ Airtable">
      <Layout>
        {result?.ok && (
          <Layout.Section>
            <Banner tone="success">{result.ok}</Banner>
          </Layout.Section>
        )}
        {result?.error && (
          <Layout.Section>
            <Banner tone="critical">{result.error}</Banner>
          </Layout.Section>
        )}

        {/* PASO 1: token */}
        {step === 1 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Paso 1 de 3 — Conecta tu Airtable</Text>
                <Text as="p" tone="subdued">
                  Crea un token en airtable.com/create/tokens con permisos
                  data.records (read/write) y schema.bases (read/write), y pégalo aquí.
                  Solo se usa para tu sincronización.
                </Text>
                <TextField
                  label="Token personal de Airtable"
                  value={token}
                  onChange={setToken}
                  autoComplete="off"
                  placeholder="pat..."
                />
                <InlineStack>
                  <Button
                    variant="primary"
                    loading={busy}
                    onClick={() =>
                      fetcher.submit({ intent: "save-token", token }, { method: "post" })
                    }
                  >
                    Conectar
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* PASO 2: base y tabla */}
        {(step === 2 || step === 2.5) && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Paso 2 de 3 — Elige dónde sincronizar</Text>
                <Select
                  label="Base de Airtable"
                  options={[
                    { label: "— elige una base —", value: "" },
                    ...data.bases.map((b) => ({ label: b.name, value: b.id })),
                  ]}
                  value={baseId}
                  onChange={(v) => {
                    setBaseId(v);
                    if (v) fetcher.submit({ intent: "choose-base", baseId: v }, { method: "post" });
                  }}
                />
                {data.baseId && (
                  <BlockStack gap="300">
                    <Select
                      label="Tabla"
                      options={[
                        { label: "— elige una tabla existente —", value: "" },
                        ...data.tables.map((t) => ({ label: t.name, value: t.id })),
                      ]}
                      value={tableId}
                      onChange={(v) => {
                        setTableId(v);
                        if (v)
                          fetcher.submit({ intent: "choose-table", tableId: v }, { method: "post" });
                      }}
                    />
                    <InlineStack gap="200">
                      <Text as="p" tone="subdued">¿No tienes tabla preparada?</Text>
                      <Button
                        loading={busy}
                        onClick={() => fetcher.submit({ intent: "create-table" }, { method: "post" })}
                      >
                        Créamela lista para usar
                      </Button>
                    </InlineStack>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* PASO 3: revisar mapeo y activar */}
        {step === 3 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Paso 3 de 3 — Revisa el mapeo (propuesto por la IA)
                </Text>
                <Text as="p" tone="subdued">
                  Tabla: {data.tableName}. Esto es lo que se sincronizará; cada fila explica
                  por qué la IA lo ha emparejado así.
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Campo de Shopify", "Columna de Airtable", "Por qué"]}
                  rows={(data.fieldMap as any[]).map((m) => [
                    fieldLabel(m.shopifyField),
                    m.airtableField,
                    m.reason ?? "",
                  ])}
                />
                <Select
                  label="Dirección de la sincronización"
                  options={[
                    { label: "En ambos sentidos (recomendado)", value: "both" },
                    { label: "Solo Shopify → Airtable", value: "shopify_to_airtable" },
                    { label: "Solo Airtable → Shopify", value: "airtable_to_shopify" },
                  ]}
                  value={data.direction}
                  onChange={(v) =>
                    fetcher.submit({ intent: "set-direction", direction: v }, { method: "post" })
                  }
                />
                <InlineStack>
                  <Button
                    variant="primary"
                    loading={busy}
                    onClick={() => fetcher.submit({ intent: "enable-and-sync" }, { method: "post" })}
                  >
                    Activar y hacer la primera sincronización
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* PASO 4: panel */}
        {step === 4 && (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Sincronización activa</Text>
                    <Badge tone="success">En marcha</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Tabla: {data.tableName} · Última pasada completa:{" "}
                    {data.lastFullSync ? String(data.lastFullSync).slice(0, 19).replace("T", " ") : "—"}
                    {" "}· Los cambios en Shopify se replican al momento (webhooks).
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      loading={busy}
                      onClick={() => fetcher.submit({ intent: "pull-airtable" }, { method: "post" })}
                    >
                      Traer cambios de Airtable ahora
                    </Button>
                    <Button
                      loading={busy}
                      onClick={() => fetcher.submit({ intent: "enable-and-sync" }, { method: "post" })}
                    >
                      Re-sincronizar todo
                    </Button>
                    <Button
                      tone="critical"
                      variant="plain"
                      loading={busy}
                      onClick={() => fetcher.submit({ intent: "disable" }, { method: "post" })}
                    >
                      Pausar
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Actividad reciente</Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Cuándo", "Dirección", "Acción", "Estado"]}
                    rows={data.logs.map((l) => [
                      l.when,
                      l.direction,
                      l.action,
                      l.ok ? "✓ OK" : `✗ ${l.message.slice(0, 60)}`,
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
