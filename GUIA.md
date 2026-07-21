# AirBridge — estado del proyecto y tus 3 pasos

## Qué es
App de Shopify que sincroniza la tienda con Airtable en ambos sentidos, con
configuración asistida por IA (el mapeo de columnas se hace solo). Nuestro
ángulo contra AirPower/SyncBase: **puesta en marcha en minutos, no en horas.**

## Qué está construido y verificado (16-jul-2026)
- ✅ Proyecto sobre la plantilla oficial de Shopify (Remix + Polaris + Prisma).
- ✅ Motor de sync Shopify → Airtable: primera pasada completa + tiempo real vía webhooks (alta/cambio/borrado de productos).
- ✅ Sync inverso Airtable → Shopify (campos seguros con lista blanca).
- ✅ **Anti-bucle y anti-corrupción**: hash del último estado sincronizado; nunca aplica ecos de sus propios cambios. Testeado.
- ✅ **Mapeo asistido por IA**: heurística en español/inglés que funciona sin coste + refinado con LLM si se configura clave. Testeado.
- ✅ Asistente de 3 pasos en la interfaz (token → base/tabla → revisar mapeo → activar), incluido "créame la tabla lista para usar".
- ✅ Panel con actividad reciente (transparencia total de lo que ha hecho).
- ✅ Compila limpio (TypeScript estricto OK) y 6/6 tests de la lógica crítica pasan.

## Qué falta (siguiente tanda de trabajo)
- Edición de mapeo manual en la interfaz (hoy: aceptar lo propuesto o crear tabla estándar).
- Escritura de variantes Airtable→Shopify (precio/SKU de vuelta) — la parte
  Shopify→Airtable ya funciona; la vuelta usa otra mutación y va en la tanda 2.
- Sync automático periódico Airtable→Shopify (hoy: botón "Traer cambios ahora").
- Planes de pago (Shopify Billing API) — se activa cuando tengamos usuarios.
- Textos/capturas de la ficha para la App Store.

## Tus 3 pasos (lo único que no puedo hacer yo)
1. **Cuenta de Shopify Partners (gratis, 10 min):** entra en partners.shopify.com,
   regístrate con el correo de Evron Labs. Desde ahí se crean la "app" oficial y
   una **tienda de desarrollo** (una tienda falsa para probar sin dinero real).
2. **Cuenta de Airtable (gratis):** airtable.com — para probar la sincronización.
3. Cuando tengas la cuenta Partner, dímelo: te doy los 3 comandos exactos para
   enlazar este proyecto con tu cuenta y verlo funcionando en la tienda de prueba.

## Cómo se prueba en local (cuando tengas las cuentas)
```bash
npm install
npm run dev   # el CLI de Shopify abre la app en tu tienda de desarrollo
```

## Decisiones técnicas que conviene saber
- Base de datos: SQLite (suficiente de sobra hasta cientos de tiendas; se migra
  a Postgres cuando toque).
- Prisma en modo moderno sin binarios (adaptador libsql) → despliegue más simple.
- El token de Airtable del comerciante se guarda en su fila y nunca sale del servidor.
- La clave de IA (ANTHROPIC_API_KEY) es opcional: sin ella, el mapeo usa la
  heurística (gratis); con ella, el LLM refina los casos raros.
