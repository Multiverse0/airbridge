-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "AirtableConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "baseId" TEXT,
    "tableId" TEXT,
    "tableName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "resource" TEXT NOT NULL DEFAULT 'products',
    "direction" TEXT NOT NULL DEFAULT 'both',
    "fieldMapJson" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastFullSync" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncConfig_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AirtableConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "airtableRecordId" TEXT NOT NULL,
    "lastSyncedHash" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AirtableConnection_shop_key" ON "AirtableConnection"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConfig_shop_key" ON "SyncConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConfig_connectionId_key" ON "SyncConfig"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRecord_shop_resource_shopifyId_key" ON "SyncRecord"("shop", "resource", "shopifyId");

-- CreateIndex
CREATE INDEX "SyncRecord_shop_airtableRecordId_idx" ON "SyncRecord"("shop", "airtableRecordId");

-- CreateIndex
CREATE INDEX "SyncLog_shop_createdAt_idx" ON "SyncLog"("shop", "createdAt");
