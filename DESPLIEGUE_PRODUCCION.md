# AirBridge — Runbook de despliegue a producción
**Doble uso:** (1) guía paso a paso para desplegar, y (2) brief listo para contratar a un freelance (Fiverr/Upwork). Cualquier desarrollador competente de Node/Shopify lo ejecuta en **2–4 horas**.

---

## 0. Qué es la app (contexto para el dev)
- **AirBridge**: app de Shopify (embedded) que sincroniza en dos sentidos productos/inventario de una tienda Shopify con Airtable, con mapeo de campos asistido por IA.
- **Stack:** Remix + Vite, Node 22, Prisma (adaptador **libsql**), Polaris, `@shopify/shopify-app-remix`. Dockerfile incluido.
- **Estado:** MVP funcional, compila limpio (`tsc` OK), tests de lógica en verde, ya probado en tienda de desarrollo con `shopify app dev`. Falta **desplegar a un servidor de producción** con dominio público estable.
- **Repo/código:** se entrega comprimido; primer paso recomendado = subirlo a un repo privado de GitHub.

---

## 1. Stack de producción recomendado (profesional, bajo mantenimiento)
| Pieza | Recomendado | Alternativas equivalentes | Coste aprox. |
|---|---|---|---|
| Código | **GitHub** (repo privado) | GitLab | 0 € |
| Hosting (always-on) | **Railway** (deploy desde repo/Docker) | Render, Fly.io | ~5–20 €/mes |
| Base de datos | **Turso** (libsql gestionada) | — (el código usa el adaptador libsql) | Free / ~5 €/mes |
| Monitorización errores | **Sentry** (opcional) | Logtail | Free |

> El host **debe ser always-on** (sin "spin-down"): la app recibe webhooks de Shopify en tiempo real. Descartar tiers gratuitos que duermen el servicio.

---

## 2. Pasos de despliegue (orden exacto)

### 2.1 Repositorio
1. Crear repo **privado** en GitHub y subir el proyecto (`git init` → commit → push).
2. Confirmar que `.env*` y `prisma/dev.sqlite` están en `.gitignore` (ya lo están).

### 2.2 Base de datos (Turso)
1. Crear cuenta en https://turso.tech y una base `airbridge-prod`.
2. Obtener **Database URL** (`libsql://...`) y un **auth token**.
3. Guardar para las variables `DATABASE_URL` y `DATABASE_AUTH_TOKEN`.

### 2.3 App de Shopify (credenciales)
1. En Shopify Partners → app **airbridge** → *API credentials*: copiar **Client ID** (`SHOPIFY_API_KEY`) y **Client secret** (`SHOPIFY_API_SECRET`).
   > Ya existe la app "airbridge" en la organización **SyncPilot**, enlazada vía `shopify.app.toml` (client_id `02424f662ac43d9828361dc9a8d28125`).

### 2.4 Desplegar en el host (Railway)
1. Nuevo proyecto en Railway → *Deploy from GitHub repo* → seleccionar el repo. Railway detecta el **Dockerfile**.
2. Configurar variables de entorno (ver `.env.production.example`):
   - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES=read_products,write_products`
   - `DATABASE_URL`, `DATABASE_AUTH_TOKEN`
   - `NODE_ENV=production`
   - `SHOPIFY_APP_URL` → **la URL pública que Railway asigna** (p. ej. `https://airbridge-production.up.railway.app`). Poner el dominio del servicio.
3. Deploy. Verificar en logs: `[migrate] base de datos lista ✅` y el servidor escuchando.

### 2.5 Conectar la URL pública con Shopify
1. En el proyecto local, editar `shopify.app.toml`:
   - `application_url = "https://<tu-dominio-de-railway>"`
   - `redirect_urls = [ "https://<tu-dominio-de-railway>/auth/callback", "https://<tu-dominio-de-railway>/auth/shopify/callback", "https://<tu-dominio-de-railway>/api/auth" ]`
2. Ejecutar `shopify app deploy` (empuja la config y las suscripciones de webhooks a Shopify).
3. Reinstalar la app en la tienda de desarrollo `syncpilot-pruebas` para que tome la nueva URL.

---

## 3. Criterios de aceptación (cómo sé que está BIEN hecho)
El trabajo está completo cuando **todo** esto se cumple y se demuestra con captura/vídeo:

- [ ] La app abre en `https://admin.shopify.com/store/syncpilot-pruebas/apps/airbridge-1` y **muestra la interfaz de AirBridge** (asistente "Paso 1 — Conecta tu Airtable"), NO el cartelito por defecto de Shopify.
- [ ] Pegando un token de Airtable, el asistente lista bases y tablas.
- [ ] La IA propone un mapeo de campos y se puede activar la sincronización.
- [ ] Al pulsar "sincronizar", los productos de prueba de la tienda **aparecen en Airtable**.
- [ ] Editar un producto en Shopify se refleja en Airtable en segundos (webhook en vivo).
- [ ] El servidor sigue vivo tras 30 min sin actividad (always-on, no spin-down).
- [ ] Logs sin errores; variables de entorno bien puestas; secretos NO en el repo.

---

## 4. Brief para el freelance (copiar/pegar en Fiverr/Upwork)
> **Título:** Deploy an existing Shopify (Remix/Node) embedded app to production
> **Descripción:** I have a finished Shopify embedded app (Remix + Vite + Prisma/libsql, Dockerfile included). I need it deployed to a production host (Railway or Render), with a managed Turso database, environment variables/secrets configured, `shopify app deploy` run to wire the production URL, and the app verified working end-to-end in a Shopify dev store. Acceptance criteria and full runbook provided. ~2–4h for an experienced Shopify/Node dev.
> **Entregables:** app en vivo en URL pública + repo desplegado + captura/vídeo cumpliendo los criterios de aceptación de la sección 3.
> **Skills:** Shopify app dev, Node/Remix, Docker, Railway/Render, Prisma.

**Perfil a buscar:** valoración ≥4.9, con reseñas concretas de "Shopify app deployment". Presupuesto orientativo: 60–200 €.

---

## 5. Reparto de responsabilidades (modelo profesional)
- **Tú (dueño):** cuentas (GitHub/Railway/Turso), presupuesto, aprobar el trabajo.
- **Yo (arquitecto):** construí la app, escribí este runbook, **reviso el trabajo del freelance** contra los criterios de aceptación antes de que pagues/aceptes, y sigo desarrollando features.
- **Freelance (manos):** ejecuta la sección 2 y demuestra la sección 3.

*Nada de esto te ata: si prefieres, lo desplegamos tú y yo por el chat siguiendo la sección 2, sin freelance.*
