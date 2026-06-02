-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "sourceProvider" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3);
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "filePath" SET DEFAULT '';

CREATE INDEX IF NOT EXISTS "KnowledgeDocument_sourceProvider_idx" ON "KnowledgeDocument"("sourceProvider");
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_userId_sourceProvider_externalId_idx" ON "KnowledgeDocument"("userId", "sourceProvider", "externalId");

CREATE TABLE IF NOT EXISTS "SourceAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SourceAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SourceAccount_userId_provider_authMethod_key" ON "SourceAccount"("userId", "provider", "authMethod");
CREATE INDEX IF NOT EXISTS "SourceAccount_userId_idx" ON "SourceAccount"("userId");

CREATE TABLE IF NOT EXISTS "SyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cronExpr" TEXT NOT NULL DEFAULT '0 */1 * * *',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SyncJob_userId_provider_key" ON "SyncJob"("userId", "provider");
CREATE INDEX IF NOT EXISTS "SyncJob_userId_idx" ON "SyncJob"("userId");

CREATE TABLE IF NOT EXISTS "SyncTarget" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SyncTarget_syncJobId_externalId_key" ON "SyncTarget"("syncJobId", "externalId");
CREATE INDEX IF NOT EXISTS "SyncTarget_syncJobId_idx" ON "SyncTarget"("syncJobId");

CREATE TABLE IF NOT EXISTS "SyncRun" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SyncRun_syncJobId_idx" ON "SyncRun"("syncJobId");

ALTER TABLE "SourceAccount" ADD CONSTRAINT "SourceAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncTarget" ADD CONSTRAINT "SyncTarget_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
