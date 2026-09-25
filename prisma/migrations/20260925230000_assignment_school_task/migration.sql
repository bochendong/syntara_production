ALTER TABLE "CourseAssignment"
ADD COLUMN "schoolTaskText" TEXT,
ADD COLUMN "schoolFileName" VARCHAR(255),
ADD COLUMN "schoolMimeType" VARCHAR(120),
ADD COLUMN "schoolFileData" BYTEA,
ADD COLUMN "schoolFileText" TEXT;
