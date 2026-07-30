BEGIN;

CREATE TYPE "NativeDeviceAuthorizationStatus" AS ENUM (
  'pending',
  'approved',
  'consumed',
  'denied'
);

CREATE TABLE "NativeDeviceAuthorization" (
  "id" TEXT NOT NULL,
  "deviceCodeHash" TEXT NOT NULL,
  "userCodeHash" TEXT NOT NULL,
  "requestFingerprintHash" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "status" "NativeDeviceAuthorizationStatus" NOT NULL DEFAULT 'pending',
  "userId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NativeDeviceAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NativeDeviceSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NativeDeviceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NativeDeviceAuthorization_deviceCodeHash_key"
ON "NativeDeviceAuthorization"("deviceCodeHash");

CREATE UNIQUE INDEX "NativeDeviceAuthorization_userCodeHash_key"
ON "NativeDeviceAuthorization"("userCodeHash");

CREATE INDEX "NativeDeviceAuthorization_requestFingerprintHash_createdAt_idx"
ON "NativeDeviceAuthorization"("requestFingerprintHash", "createdAt");

CREATE INDEX "NativeDeviceAuthorization_deviceId_createdAt_idx"
ON "NativeDeviceAuthorization"("deviceId", "createdAt");

CREATE INDEX "NativeDeviceAuthorization_userId_createdAt_idx"
ON "NativeDeviceAuthorization"("userId", "createdAt");

CREATE INDEX "NativeDeviceAuthorization_status_expiresAt_idx"
ON "NativeDeviceAuthorization"("status", "expiresAt");

CREATE UNIQUE INDEX "NativeDeviceSession_accessTokenHash_key"
ON "NativeDeviceSession"("accessTokenHash");

CREATE UNIQUE INDEX "NativeDeviceSession_refreshTokenHash_key"
ON "NativeDeviceSession"("refreshTokenHash");

CREATE INDEX "NativeDeviceSession_userId_revokedAt_refreshExpiresAt_idx"
ON "NativeDeviceSession"("userId", "revokedAt", "refreshExpiresAt");

CREATE INDEX "NativeDeviceSession_deviceId_revokedAt_idx"
ON "NativeDeviceSession"("deviceId", "revokedAt");

ALTER TABLE "NativeDeviceAuthorization"
ADD CONSTRAINT "NativeDeviceAuthorization_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NativeDeviceSession"
ADD CONSTRAINT "NativeDeviceSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
