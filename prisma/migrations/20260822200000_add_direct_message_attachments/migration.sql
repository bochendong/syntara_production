CREATE TABLE "DirectMessageAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "contentSha" VARCHAR(64) NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectMessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DirectMessageAttachment_messageId_createdAt_idx"
  ON "DirectMessageAttachment"("messageId", "createdAt");
CREATE INDEX "DirectMessageAttachment_uploaderId_createdAt_idx"
  ON "DirectMessageAttachment"("uploaderId", "createdAt" DESC);

ALTER TABLE "DirectMessageAttachment"
  ADD CONSTRAINT "DirectMessageAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMessageAttachment"
  ADD CONSTRAINT "DirectMessageAttachment_uploaderId_fkey"
  FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
