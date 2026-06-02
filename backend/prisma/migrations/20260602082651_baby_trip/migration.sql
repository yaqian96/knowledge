-- AlterTable
ALTER TABLE "DocumentVector" ALTER COLUMN "embedding" SET DATA TYPE TEXT;

-- AlterTable (restore columns that existed)
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "sourceProvider" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3);
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "filePath" SET DEFAULT '';

-- Restore tables (IF NOT EXISTS since they might still exist from previous migration)
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

-- Restore foreign keys
ALTER TABLE "SourceAccount" ADD CONSTRAINT "SourceAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncTarget" ADD CONSTRAINT "SyncTarget_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restore indexes
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_sourceProvider_idx" ON "KnowledgeDocument"("sourceProvider");
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_userId_sourceProvider_externalId_idx" ON "KnowledgeDocument"("userId", "sourceProvider", "externalId");

-- Create new tables for baby trip
CREATE TABLE IF NOT EXISTS "BabyTripTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "spotIds" JSONB,
    "traceId" TEXT,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "BabyTripTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BabyTripTrace" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reasoningSteps" JSONB NOT NULL,
    "toolCalls" JSONB NOT NULL,
    "finalOutput" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalDuration" INTEGER,
    "tokenUsage" JSONB,
    CONSTRAINT "BabyTripTrace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Spot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "distance" DOUBLE PRECISION,
    "category" TEXT NOT NULL,
    "ageRange" TEXT,
    "ticketPrice" TEXT,
    "parkingFee" TEXT,
    "transport" TEXT,
    "description" TEXT,
    "rating" DOUBLE PRECISION,
    "images" JSONB,
    "visitedAt" TIMESTAMP(3),
    "experience" TEXT,
    "weather" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Spot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMsg" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "BabyTripTask_userId_idx" ON "BabyTripTask"("userId");
CREATE INDEX IF NOT EXISTS "BabyTripTask_status_idx" ON "BabyTripTask"("status");
CREATE INDEX IF NOT EXISTS "BabyTripTask_createdAt_idx" ON "BabyTripTask"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "BabyTripTrace_taskId_key" ON "BabyTripTrace"("taskId");
CREATE INDEX IF NOT EXISTS "BabyTripTrace_userId_idx" ON "BabyTripTrace"("userId");
CREATE INDEX IF NOT EXISTS "BabyTripTrace_startedAt_idx" ON "BabyTripTrace"("startedAt");
CREATE INDEX IF NOT EXISTS "Spot_userId_idx" ON "Spot"("userId");
CREATE INDEX IF NOT EXISTS "Spot_category_idx" ON "Spot"("category");
CREATE INDEX IF NOT EXISTS "Spot_visitedAt_idx" ON "Spot"("visitedAt");
CREATE INDEX IF NOT EXISTS "EmailLog_userId_idx" ON "EmailLog"("userId");
CREATE INDEX IF NOT EXISTS "EmailLog_status_idx" ON "EmailLog"("status");
CREATE INDEX IF NOT EXISTS "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");

-- Foreign keys
ALTER TABLE "BabyTripTask" ADD CONSTRAINT "BabyTripTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BabyTripTrace" ADD CONSTRAINT "BabyTripTrace_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BabyTripTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Spot" ADD CONSTRAINT "Spot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
