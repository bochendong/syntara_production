-- AlterTable
ALTER TABLE "User" ADD COLUMN "nativeAppActivatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NativeActivationCode" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "note" VARCHAR(200),
    "createdBy" VARCHAR(320),
    "redeemedById" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NativeActivationCode_code_key" ON "NativeActivationCode"("code");

-- CreateIndex
CREATE INDEX "NativeActivationCode_redeemedAt_createdAt_idx" ON "NativeActivationCode"("redeemedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NativeActivationCode_redeemedById_idx" ON "NativeActivationCode"("redeemedById");

-- AddForeignKey
ALTER TABLE "NativeActivationCode" ADD CONSTRAINT "NativeActivationCode_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
