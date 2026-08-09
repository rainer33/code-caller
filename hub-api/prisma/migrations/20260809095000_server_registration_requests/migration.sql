-- CreateEnum
CREATE TYPE "ServerRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CREDENTIAL_DELIVERED');

-- CreateEnum
CREATE TYPE "WorkerProvider" AS ENUM ('CODEX', 'CLAUDE_CODE', 'ANTIGRAVITY', 'OPENCODE', 'GEMINI');

-- CreateTable
CREATE TABLE "server_registration_requests" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "osType" "OsType" NOT NULL,
    "tailscaleIp" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "requestSecretHash" TEXT NOT NULL,
    "status" "ServerRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "serverId" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" TEXT,
    "apiKeyAuthTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profiles" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "provider" "WorkerProvider" NOT NULL,
    "profileName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_registration_requests_ownerId_status_idx" ON "server_registration_requests"("ownerId", "status");

-- CreateIndex
CREATE INDEX "server_registration_requests_fingerprint_idx" ON "server_registration_requests"("fingerprint");

-- CreateIndex
CREATE INDEX "worker_profiles_serverId_idx" ON "worker_profiles"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_serverId_provider_profileName_key" ON "worker_profiles"("serverId", "provider", "profileName");

-- AddForeignKey
ALTER TABLE "server_registration_requests" ADD CONSTRAINT "server_registration_requests_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_registration_requests" ADD CONSTRAINT "server_registration_requests_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
