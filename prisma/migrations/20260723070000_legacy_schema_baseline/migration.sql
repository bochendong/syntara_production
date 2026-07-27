-- Legacy schema baseline generated from prisma/schema.prisma before the
-- CourseSource/KnowledgeDocument/KnowledgeChunk projection was introduced.
--
-- Existing databases already containing these objects must mark this migration
-- as applied; do not execute it there. Fresh databases execute it normally.
-- See prisma/migrations/README.md for the rollout sequence.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- StudyMemoryChunk is part of the legacy schema and requires pgvector.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "CoursePurpose" AS ENUM ('research', 'university', 'daily');

-- CreateEnum
CREATE TYPE "NotebookKind" AS ENUM ('image', 'markdown');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('notebook', 'agent', 'system', 'course');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentEnvelopeType" AS ENUM ('task_dispatch', 'task_ack', 'task_wait', 'task_partial', 'task_result', 'task_error');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CreditTransactionKind" AS ENUM ('WELCOME_BONUS', 'COURSE_PURCHASE', 'NOTEBOOK_PURCHASE', 'CREATOR_COURSE_SALE', 'CREATOR_NOTEBOOK_SALE', 'TOKEN_USAGE', 'CASH_TO_COMPUTE_TRANSFER', 'CASH_TO_PURCHASE_TRANSFER', 'LESSON_REWARD', 'QUIZ_COMPLETION_REWARD', 'QUIZ_ACCURACY_BONUS', 'REVIEW_REWARD', 'DAILY_TASK_REWARD', 'STREAK_BONUS', 'CHARACTER_UNLOCK_SPEND', 'AVATAR_UNLOCK_SPEND', 'GACHA_DRAW_SPEND', 'NOTEBOOK_GENERATION_USAGE');

-- CreateEnum
CREATE TYPE "CreditAccountType" AS ENUM ('CASH', 'COMPUTE', 'PURCHASE', 'NOTEBOOK_GENERATION');

-- CreateEnum
CREATE TYPE "TopUpOrderStatus" AS ENUM ('pending', 'fulfilled', 'expired');

-- CreateEnum
CREATE TYPE "CharacterAssetType" AS ENUM ('LIVE2D', 'AVATAR');

-- CreateEnum
CREATE TYPE "LearningActionType" AS ENUM ('DAILY_SIGN_IN', 'LESSON_MILESTONE_COMPLETED', 'QUIZ_COMPLETED', 'QUIZ_ACCURACY_BONUS', 'REVIEW_COMPLETED', 'DAILY_TASK_REWARD', 'STREAK_BONUS', 'CHARACTER_UNLOCK', 'AVATAR_UNLOCK', 'CHARACTER_EQUIP', 'GACHA_DRAW');

-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('DAILY_SIGN_IN', 'DAILY_LESSON', 'DAILY_QUIZ', 'DAILY_REVIEW', 'DAILY_ALL_CLEAR', 'WEEKLY_STUDY_DAYS', 'WEEKLY_QUIZ_BATCHES');

-- CreateEnum
CREATE TYPE "NotebookProblemType" AS ENUM ('short_answer', 'choice', 'proof', 'calculation', 'code', 'fill_blank');

-- CreateEnum
CREATE TYPE "NotebookProblemStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "NotebookProblemSource" AS ENUM ('chat', 'pdf', 'manual', 'web', 'legacy_quiz_scene');

-- CreateEnum
CREATE TYPE "NotebookProblemDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "NotebookProblemAttemptKind" AS ENUM ('run', 'submit', 'answer');

-- CreateEnum
CREATE TYPE "NotebookProblemAttemptStatus" AS ENUM ('pending', 'passed', 'failed', 'partial', 'error');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "creditsBalance" INTEGER NOT NULL DEFAULT 0,
    "computeCreditsBalance" INTEGER NOT NULL DEFAULT 0,
    "purchaseCreditsBalance" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "tags" TEXT[],
    "purpose" "CoursePurpose" NOT NULL DEFAULT 'daily',
    "university" TEXT,
    "courseCode" TEXT,
    "avatarUrl" TEXT,
    "listedInCourseStore" BOOLEAN NOT NULL DEFAULT false,
    "coursePriceCents" INTEGER NOT NULL DEFAULT 0,
    "storePublishedAt" TIMESTAMP(3),
    "sourceCourseId" TEXT,
    "notebookCount" INTEGER NOT NULL DEFAULT 0,
    "sceneCount" INTEGER NOT NULL DEFAULT 0,
    "problemCount" INTEGER NOT NULL DEFAULT 0,
    "publishedProblemCount" INTEGER NOT NULL DEFAULT 0,
    "speechReadyCount" INTEGER NOT NULL DEFAULT 0,
    "speechTotalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notebook" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "avatarUrl" TEXT,
    "language" TEXT,
    "style" TEXT,
    "notebookKind" "NotebookKind" NOT NULL DEFAULT 'image',
    "listedInNotebookStore" BOOLEAN NOT NULL DEFAULT false,
    "notebookPriceCents" INTEGER NOT NULL DEFAULT 0,
    "storePublishedAt" TIMESTAMP(3),
    "sourceNotebookId" TEXT,
    "sceneCount" INTEGER NOT NULL DEFAULT 0,
    "sectionCount" INTEGER NOT NULL DEFAULT 0,
    "problemCount" INTEGER NOT NULL DEFAULT 0,
    "publishedProblemCount" INTEGER NOT NULL DEFAULT 0,
    "speechReadyCount" INTEGER NOT NULL DEFAULT 0,
    "speechTotalCount" INTEGER NOT NULL DEFAULT 0,
    "speechStatus" TEXT NOT NULL DEFAULT 'no_speech',
    "coverSlideJson" JSONB,
    "coverImagePath" TEXT,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "actions" JSONB,
    "whiteboard" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkdownNotebookSection" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "courseId" TEXT,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "summary" TEXT,
    "sourceMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkdownNotebookSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookPage" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "courseId" TEXT,
    "sourceSceneId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "contentHash" TEXT,
    "actionsHash" TEXT,
    "thumbnailJson" JSONB,
    "coverImagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookPageContent" (
    "pageId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "whiteboard" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookPageContent_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "NotebookPageActions" (
    "pageId" TEXT NOT NULL,
    "actions" JSONB,
    "speechReadyCount" INTEGER NOT NULL DEFAULT 0,
    "speechTotalCount" INTEGER NOT NULL DEFAULT 0,
    "speechStatus" TEXT NOT NULL DEFAULT 'no_speech',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookPageActions_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "NotebookImageAsset" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookPageAsset" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'image',
    "order" INTEGER NOT NULL DEFAULT 0,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookPageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookProblem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "title" TEXT NOT NULL,
    "type" "NotebookProblemType" NOT NULL,
    "status" "NotebookProblemStatus" NOT NULL DEFAULT 'draft',
    "source" "NotebookProblemSource" NOT NULL DEFAULT 'manual',
    "order" INTEGER NOT NULL,
    "problemNumber" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT[],
    "difficulty" "NotebookProblemDifficulty" NOT NULL DEFAULT 'medium',
    "publicContentJson" JSONB NOT NULL,
    "gradingJson" JSONB NOT NULL,
    "sourceMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemImportBatch" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "targetType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "sourceFileName" TEXT,
    "sourceFileMime" TEXT,
    "sourceTextHash" TEXT,
    "draftCount" INTEGER NOT NULL DEFAULT 0,
    "committedCount" INTEGER NOT NULL DEFAULT 0,
    "draftSnapshotJson" JSONB,
    "usageJson" JSONB,
    "webSearchJson" JSONB,
    "warnings" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookProblemSecret" (
    "problemId" TEXT NOT NULL,
    "secretJudgeJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookProblemSecret_pkey" PRIMARY KEY ("problemId")
);

-- CreateTable
CREATE TABLE "NotebookProblemAttempt" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotebookProblemAttemptKind" NOT NULL,
    "answerJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "score" DOUBLE PRECISION,
    "status" "NotebookProblemAttemptStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookProblemAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookProblemProgress" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "latestAttemptId" TEXT,
    "status" "NotebookProblemAttemptStatus" NOT NULL DEFAULT 'pending',
    "score" DOUBLE PRECISION,
    "attemptedCount" INTEGER NOT NULL DEFAULT 0,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookProblemProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "kind" "ConversationKind" NOT NULL,
    "targetId" TEXT,
    "title" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "senderAgentId" TEXT,
    "targetAgentId" TEXT,
    "content" JSONB NOT NULL,
    "plainText" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "sourceAgentId" TEXT,
    "targetAgentId" TEXT,
    "taskType" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'queued',
    "request" JSONB,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEnvelope" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fromAgentId" TEXT,
    "toAgentId" TEXT,
    "envelopeType" "AgentEnvelopeType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLLMConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "providerId" TEXT NOT NULL DEFAULT 'openai',
    "modelId" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "apiKey" TEXT NOT NULL,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemLLMConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "route" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelString" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMPromptLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "route" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelString" TEXT NOT NULL,
    "notebookId" TEXT,
    "notebookName" TEXT,
    "courseId" TEXT,
    "courseName" TEXT,
    "promptHash" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMPromptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "resultKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "title" TEXT,
    "summary" JSONB,
    "payload" JSONB,
    "payloadBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMemory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "targetType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reason" TEXT,
    "question" TEXT,
    "sourceReferences" JSONB,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMemoryChunk" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "targetType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDimensions" INTEGER NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyMemoryChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryFact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryFactEvent" (
    "id" TEXT NOT NULL,
    "factId" TEXT,
    "ownerId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "oldValueJson" JSONB,
    "newValueJson" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryFactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryKnowledgeCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "courseId" TEXT,
    "notebookId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "previewText" TEXT NOT NULL,
    "metadata" JSONB,
    "firstQuery" TEXT NOT NULL,
    "lastQuery" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryKnowledgeCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoursePurchase" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sourceCourseId" TEXT NOT NULL,
    "clonedCourseId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoursePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSpeechAudio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "voiceConfigHash" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "format" TEXT NOT NULL,
    "base64" TEXT NOT NULL,
    "visemes" JSONB,
    "mouthCues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSpeechAudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookPurchase" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sourceNotebookId" TEXT NOT NULL,
    "clonedNotebookId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseReview" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CreditTransactionKind" NOT NULL,
    "accountType" "CreditAccountType" NOT NULL DEFAULT 'CASH',
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEngagementProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastStudyAt" TIMESTAMP(3),
    "todayEarnedPurchaseCredits" INTEGER NOT NULL DEFAULT 0,
    "preferredCharacterId" TEXT,
    "avatarInventory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEngagementProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" "LearningActionType" NOT NULL,
    "courseId" TEXT,
    "sceneId" TEXT,
    "metadata" JSONB,
    "rewardedPurchaseCredits" INTEGER NOT NULL DEFAULT 0,
    "rewardedAffinity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" "CharacterAssetType" NOT NULL,
    "unlockCostPurchaseCredits" INTEGER NOT NULL DEFAULT 0,
    "affinityLevelRequired" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCharacterProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "isUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "fragmentCount" INTEGER NOT NULL DEFAULT 0,
    "affinityExp" INTEGER NOT NULL DEFAULT 0,
    "affinityLevel" INTEGER NOT NULL DEFAULT 1,
    "equippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCharacterProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMissionProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionType" "MissionType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "progressValue" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMissionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTopUpPrice" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "stripeProductId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditTopUpPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "packTitle" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "amountTotal" INTEGER NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "status" "TopUpOrderStatus" NOT NULL DEFAULT 'pending',
    "fulfilledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookReview" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Course_ownerId_updatedAt_idx" ON "Course"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_listedInCourseStore_updatedAt_idx" ON "Course"("listedInCourseStore", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Notebook_ownerId_updatedAt_idx" ON "Notebook"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Notebook_courseId_updatedAt_idx" ON "Notebook"("courseId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Notebook_courseId_contentVersion_idx" ON "Notebook"("courseId", "contentVersion");

-- CreateIndex
CREATE INDEX "Notebook_listedInNotebookStore_updatedAt_idx" ON "Notebook"("listedInNotebookStore", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Scene_notebookId_order_idx" ON "Scene"("notebookId", "order");

-- CreateIndex
CREATE INDEX "MarkdownNotebookSection_courseId_order_idx" ON "MarkdownNotebookSection"("courseId", "order");

-- CreateIndex
CREATE INDEX "MarkdownNotebookSection_notebookId_updatedAt_idx" ON "MarkdownNotebookSection"("notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "MarkdownNotebookSection_notebookId_order_key" ON "MarkdownNotebookSection"("notebookId", "order");

-- CreateIndex
CREATE INDEX "NotebookPage_courseId_order_idx" ON "NotebookPage"("courseId", "order");

-- CreateIndex
CREATE INDEX "NotebookPage_sourceSceneId_idx" ON "NotebookPage"("sourceSceneId");

-- CreateIndex
CREATE INDEX "NotebookPage_notebookId_updatedAt_idx" ON "NotebookPage"("notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookPage_notebookId_order_key" ON "NotebookPage"("notebookId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookImageAsset_path_key" ON "NotebookImageAsset"("path");

-- CreateIndex
CREATE INDEX "NotebookImageAsset_sha256_idx" ON "NotebookImageAsset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_path_key" ON "Asset"("path");

-- CreateIndex
CREATE INDEX "Asset_sha256_idx" ON "Asset"("sha256");

-- CreateIndex
CREATE INDEX "Asset_source_idx" ON "Asset"("source");

-- CreateIndex
CREATE INDEX "NotebookPageAsset_assetId_idx" ON "NotebookPageAsset"("assetId");

-- CreateIndex
CREATE INDEX "NotebookPageAsset_pageId_order_idx" ON "NotebookPageAsset"("pageId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookPageAsset_pageId_assetId_role_key" ON "NotebookPageAsset"("pageId", "assetId", "role");

-- CreateIndex
CREATE INDEX "NotebookProblem_courseId_order_idx" ON "NotebookProblem"("courseId", "order");

-- CreateIndex
CREATE INDEX "NotebookProblem_courseId_problemNumber_idx" ON "NotebookProblem"("courseId", "problemNumber");

-- CreateIndex
CREATE INDEX "NotebookProblem_courseId_status_order_idx" ON "NotebookProblem"("courseId", "status", "order");

-- CreateIndex
CREATE INDEX "NotebookProblem_courseId_updatedAt_idx" ON "NotebookProblem"("courseId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookProblem_notebookId_order_idx" ON "NotebookProblem"("notebookId", "order");

-- CreateIndex
CREATE INDEX "NotebookProblem_notebookId_problemNumber_idx" ON "NotebookProblem"("notebookId", "problemNumber");

-- CreateIndex
CREATE INDEX "NotebookProblem_notebookId_updatedAt_idx" ON "NotebookProblem"("notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ProblemImportBatch_ownerId_targetType_courseId_updatedAt_idx" ON "ProblemImportBatch"("ownerId", "targetType", "courseId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ProblemImportBatch_ownerId_targetType_notebookId_updatedAt_idx" ON "ProblemImportBatch"("ownerId", "targetType", "notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ProblemImportBatch_ownerId_status_updatedAt_idx" ON "ProblemImportBatch"("ownerId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookProblemAttempt_problemId_createdAt_idx" ON "NotebookProblemAttempt"("problemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookProblemAttempt_problemId_userId_createdAt_idx" ON "NotebookProblemAttempt"("problemId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookProblemAttempt_userId_createdAt_idx" ON "NotebookProblemAttempt"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookProblemProgress_userId_status_lastAttemptAt_idx" ON "NotebookProblemProgress"("userId", "status", "lastAttemptAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookProblemProgress_problemId_status_idx" ON "NotebookProblemProgress"("problemId", "status");

-- CreateIndex
CREATE INDEX "NotebookProblemProgress_userId_lastAttemptAt_idx" ON "NotebookProblemProgress"("userId", "lastAttemptAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookProblemProgress_problemId_userId_key" ON "NotebookProblemProgress"("problemId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookProblemProgress_latestAttemptId_key" ON "NotebookProblemProgress"("latestAttemptId");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_updatedAt_idx" ON "Conversation"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_courseId_updatedAt_idx" ON "Conversation"("courseId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_notebookId_updatedAt_idx" ON "Conversation"("notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Message_ownerId_createdAt_idx" ON "Message"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AgentTask_ownerId_updatedAt_idx" ON "AgentTask"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AgentTask_courseId_updatedAt_idx" ON "AgentTask"("courseId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AgentTask_notebookId_updatedAt_idx" ON "AgentTask"("notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AgentEnvelope_taskId_createdAt_idx" ON "AgentEnvelope"("taskId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AgentEnvelope_ownerId_createdAt_idx" ON "AgentEnvelope"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMUsageLog_userId_createdAt_idx" ON "LLMUsageLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMUsageLog_route_createdAt_idx" ON "LLMUsageLog"("route", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMUsageLog_createdAt_idx" ON "LLMUsageLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMPromptLog_userId_createdAt_idx" ON "LLMPromptLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMPromptLog_route_source_createdAt_idx" ON "LLMPromptLog"("route", "source", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMPromptLog_notebookId_createdAt_idx" ON "LLMPromptLog"("notebookId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LLMPromptLog_promptHash_idx" ON "LLMPromptLog"("promptHash");

-- CreateIndex
CREATE INDEX "TestResult_ownerId_testId_updatedAt_idx" ON "TestResult"("ownerId", "testId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "TestResult_ownerId_updatedAt_idx" ON "TestResult"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_ownerId_testId_resultKey_key" ON "TestResult"("ownerId", "testId", "resultKey");

-- CreateIndex
CREATE INDEX "StudyMemory_ownerId_targetType_courseId_updatedAt_idx" ON "StudyMemory"("ownerId", "targetType", "courseId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "StudyMemory_ownerId_targetType_notebookId_updatedAt_idx" ON "StudyMemory"("ownerId", "targetType", "notebookId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "StudyMemory_owner_target_platform_updated_idx" ON "StudyMemory"("ownerId", "targetType", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "StudyMemory_ownerId_scope_status_updatedAt_idx" ON "StudyMemory"("ownerId", "scope", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "StudyMemoryChunk_owner_scope_target_idx" ON "StudyMemoryChunk"("ownerId", "scope", "targetType", "courseId", "notebookId");

-- CreateIndex
CREATE INDEX "StudyMemoryChunk_embedding_hnsw_idx"
ON "StudyMemoryChunk" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE UNIQUE INDEX "StudyMemoryChunk_memory_chunk_model_idx" ON "StudyMemoryChunk"("memoryId", "chunkIndex", "embeddingModel", "embeddingDimensions");

-- CreateIndex
CREATE INDEX "MemoryFact_ownerId_scopeType_scopeId_namespace_key_status_idx" ON "MemoryFact"("ownerId", "scopeType", "scopeId", "namespace", "key", "status");

-- CreateIndex
CREATE INDEX "MemoryFact_ownerId_scopeType_scopeId_validFrom_idx" ON "MemoryFact"("ownerId", "scopeType", "scopeId", "validFrom" DESC);

-- CreateIndex
CREATE INDEX "MemoryFact_ownerId_status_updatedAt_idx" ON "MemoryFact"("ownerId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "MemoryFactEvent_ownerId_scopeType_scopeId_namespace_key_cre_idx" ON "MemoryFactEvent"("ownerId", "scopeType", "scopeId", "namespace", "key", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MemoryFactEvent_ownerId_eventType_createdAt_idx" ON "MemoryFactEvent"("ownerId", "eventType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MemoryFactEvent_factId_createdAt_idx" ON "MemoryFactEvent"("factId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "MemoryKnowledgeCache_cacheKey_key" ON "MemoryKnowledgeCache"("cacheKey");

-- CreateIndex
CREATE INDEX "MemoryKnowledgeCache_ownerId_targetType_courseId_lastAccess_idx" ON "MemoryKnowledgeCache"("ownerId", "targetType", "courseId", "lastAccessedAt" DESC);

-- CreateIndex
CREATE INDEX "MemoryKnowledgeCache_ownerId_targetType_notebookId_lastAcce_idx" ON "MemoryKnowledgeCache"("ownerId", "targetType", "notebookId", "lastAccessedAt" DESC);

-- CreateIndex
CREATE INDEX "MemoryKnowledgeCache_ownerId_sourceType_sourceId_idx" ON "MemoryKnowledgeCache"("ownerId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "MemoryKnowledgeCache_ownerId_hitCount_lastAccessedAt_idx" ON "MemoryKnowledgeCache"("ownerId", "hitCount", "lastAccessedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CoursePurchase_clonedCourseId_key" ON "CoursePurchase"("clonedCourseId");

-- CreateIndex
CREATE INDEX "CoursePurchase_buyerId_createdAt_idx" ON "CoursePurchase"("buyerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CoursePurchase_buyerId_sourceCourseId_key" ON "CoursePurchase"("buyerId", "sourceCourseId");

-- CreateIndex
CREATE INDEX "CourseEnrollment_userId_joinedAt_idx" ON "CourseEnrollment"("userId", "joinedAt" DESC);

-- CreateIndex
CREATE INDEX "CourseEnrollment_courseId_joinedAt_idx" ON "CourseEnrollment"("courseId", "joinedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrollment_userId_courseId_key" ON "CourseEnrollment"("userId", "courseId");

-- CreateIndex
CREATE INDEX "UserSpeechAudio_userId_updatedAt_idx" ON "UserSpeechAudio"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "UserSpeechAudio_userId_actionId_idx" ON "UserSpeechAudio"("userId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSpeechAudio_userId_assetKey_key" ON "UserSpeechAudio"("userId", "assetKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookPurchase_clonedNotebookId_key" ON "NotebookPurchase"("clonedNotebookId");

-- CreateIndex
CREATE INDEX "NotebookPurchase_buyerId_createdAt_idx" ON "NotebookPurchase"("buyerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookPurchase_buyerId_sourceNotebookId_key" ON "NotebookPurchase"("buyerId", "sourceNotebookId");

-- CreateIndex
CREATE INDEX "CourseReview_courseId_createdAt_idx" ON "CourseReview"("courseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CourseReview_reviewerId_createdAt_idx" ON "CourseReview"("reviewerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CourseReview_courseId_reviewerId_key" ON "CourseReview"("courseId", "reviewerId");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CreditTransaction_kind_createdAt_idx" ON "CreditTransaction"("kind", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserEngagementProfile_userId_key" ON "UserEngagementProfile"("userId");

-- CreateIndex
CREATE INDEX "UserEngagementProfile_preferredCharacterId_idx" ON "UserEngagementProfile"("preferredCharacterId");

-- CreateIndex
CREATE INDEX "LearningActionLog_userId_createdAt_idx" ON "LearningActionLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LearningActionLog_actionType_createdAt_idx" ON "LearningActionLog"("actionType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LearningActionLog_courseId_createdAt_idx" ON "LearningActionLog"("courseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LearningActionLog_sceneId_createdAt_idx" ON "LearningActionLog"("sceneId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CharacterCatalog_assetType_sortOrder_idx" ON "CharacterCatalog"("assetType", "sortOrder");

-- CreateIndex
CREATE INDEX "UserCharacterProgress_userId_equippedAt_idx" ON "UserCharacterProgress"("userId", "equippedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserCharacterProgress_userId_characterId_key" ON "UserCharacterProgress"("userId", "characterId");

-- CreateIndex
CREATE INDEX "UserMissionProgress_userId_periodKey_idx" ON "UserMissionProgress"("userId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserMissionProgress_userId_missionType_periodKey_key" ON "UserMissionProgress"("userId", "missionType", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUpPrice_stripePriceId_key" ON "CreditTopUpPrice"("stripePriceId");

-- CreateIndex
CREATE INDEX "CreditTopUpPrice_stripeProductId_idx" ON "CreditTopUpPrice"("stripeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUpPrice_packId_currency_key" ON "CreditTopUpPrice"("packId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpOrder_stripeCheckoutSessionId_key" ON "TopUpOrder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpOrder_stripePaymentIntentId_key" ON "TopUpOrder"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "TopUpOrder_userId_createdAt_idx" ON "TopUpOrder"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TopUpOrder_status_createdAt_idx" ON "TopUpOrder"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_eventType_createdAt_idx" ON "StripeWebhookEvent"("eventType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookReview_notebookId_createdAt_idx" ON "NotebookReview"("notebookId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotebookReview_reviewerId_createdAt_idx" ON "NotebookReview"("reviewerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookReview_notebookId_reviewerId_key" ON "NotebookReview"("notebookId", "reviewerId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkdownNotebookSection" ADD CONSTRAINT "MarkdownNotebookSection_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkdownNotebookSection" ADD CONSTRAINT "MarkdownNotebookSection_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPage" ADD CONSTRAINT "NotebookPage_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPage" ADD CONSTRAINT "NotebookPage_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPageContent" ADD CONSTRAINT "NotebookPageContent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "NotebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPageActions" ADD CONSTRAINT "NotebookPageActions_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "NotebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPageAsset" ADD CONSTRAINT "NotebookPageAsset_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "NotebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPageAsset" ADD CONSTRAINT "NotebookPageAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblem" ADD CONSTRAINT "NotebookProblem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblem" ADD CONSTRAINT "NotebookProblem_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemImportBatch" ADD CONSTRAINT "ProblemImportBatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemImportBatch" ADD CONSTRAINT "ProblemImportBatch_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemImportBatch" ADD CONSTRAINT "ProblemImportBatch_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblemSecret" ADD CONSTRAINT "NotebookProblemSecret_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "NotebookProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblemAttempt" ADD CONSTRAINT "NotebookProblemAttempt_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "NotebookProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblemAttempt" ADD CONSTRAINT "NotebookProblemAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblemProgress" ADD CONSTRAINT "NotebookProblemProgress_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "NotebookProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblemProgress" ADD CONSTRAINT "NotebookProblemProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookProblemProgress" ADD CONSTRAINT "NotebookProblemProgress_latestAttemptId_fkey" FOREIGN KEY ("latestAttemptId") REFERENCES "NotebookProblemAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnvelope" ADD CONSTRAINT "AgentEnvelope_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnvelope" ADD CONSTRAINT "AgentEnvelope_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMUsageLog" ADD CONSTRAINT "LLMUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMPromptLog" ADD CONSTRAINT "LLMPromptLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMemory" ADD CONSTRAINT "StudyMemory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMemory" ADD CONSTRAINT "StudyMemory_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMemory" ADD CONSTRAINT "StudyMemory_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMemoryChunk" ADD CONSTRAINT "StudyMemoryChunk_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "StudyMemory"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudyMemoryChunk" ADD CONSTRAINT "StudyMemoryChunk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudyMemoryChunk" ADD CONSTRAINT "StudyMemoryChunk_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StudyMemoryChunk" ADD CONSTRAINT "StudyMemoryChunk_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MemoryFact" ADD CONSTRAINT "MemoryFact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFactEvent" ADD CONSTRAINT "MemoryFactEvent_factId_fkey" FOREIGN KEY ("factId") REFERENCES "MemoryFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFactEvent" ADD CONSTRAINT "MemoryFactEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryKnowledgeCache" ADD CONSTRAINT "MemoryKnowledgeCache_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryKnowledgeCache" ADD CONSTRAINT "MemoryKnowledgeCache_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryKnowledgeCache" ADD CONSTRAINT "MemoryKnowledgeCache_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_sourceCourseId_fkey" FOREIGN KEY ("sourceCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_clonedCourseId_fkey" FOREIGN KEY ("clonedCourseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSpeechAudio" ADD CONSTRAINT "UserSpeechAudio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPurchase" ADD CONSTRAINT "NotebookPurchase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPurchase" ADD CONSTRAINT "NotebookPurchase_sourceNotebookId_fkey" FOREIGN KEY ("sourceNotebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookPurchase" ADD CONSTRAINT "NotebookPurchase_clonedNotebookId_fkey" FOREIGN KEY ("clonedNotebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReview" ADD CONSTRAINT "CourseReview_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReview" ADD CONSTRAINT "CourseReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEngagementProfile" ADD CONSTRAINT "UserEngagementProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningActionLog" ADD CONSTRAINT "LearningActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCharacterProgress" ADD CONSTRAINT "UserCharacterProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCharacterProgress" ADD CONSTRAINT "UserCharacterProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "CharacterCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMissionProgress" ADD CONSTRAINT "UserMissionProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpOrder" ADD CONSTRAINT "TopUpOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookReview" ADD CONSTRAINT "NotebookReview_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookReview" ADD CONSTRAINT "NotebookReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
