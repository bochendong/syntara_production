#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireMatch(relativePath, pattern, message) {
  const source = read(relativePath);
  if (!pattern.test(source)) {
    throw new Error(`${relativePath}: ${message}`);
  }
}

function requireBefore(relativePath, earlier, later, message) {
  const source = read(relativePath);
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  if (earlierIndex < 0 || laterIndex < 0 || earlierIndex >= laterIndex) {
    throw new Error(`${relativePath}: ${message}`);
  }
}

requireMatch(
  '.env.example',
  /^DEFAULT_MODEL=gpt-5\.6-luna$/m,
  'DEFAULT_MODEL must use GPT-5.6 Luna for everyday teacher/student language tasks.',
);
requireMatch(
  '.env.example',
  /^OPENAI_MODELS=gpt-5\.6-luna,gpt-5\.6-terra,gpt-5\.6-sol$/m,
  'OPENAI_MODELS must expose Luna first, followed by Terra and Sol.',
);
requireMatch(
  '.env.example',
  /^IMAGE_OPENAI_IMAGE_MODELS=gpt-image-2,gpt-image-1\.5,gpt-image-1$/m,
  'OpenAI image models must default to GPT Image 2.',
);

requireBefore(
  'lib/ai/providers.ts',
  "id: 'gpt-5.6-sol'",
  "id: 'gpt-5.6-terra'",
  'Sol must be the first OpenAI text model.',
);
requireBefore(
  'lib/ai/providers.ts',
  "id: 'gpt-5.6-terra'",
  "id: 'gpt-5.6-luna'",
  'Terra and Luna must preserve the cost-tier ordering.',
);
for (const model of ['sol', 'terra', 'luna']) {
  requireMatch(
    'lib/ai/providers.ts',
    new RegExp(`id: 'gpt-5\\.6-${model}'[\\s\\S]*?contextWindow: 1050000`),
    `GPT-5.6 ${model} must advertise the live 1,050,000-token context window.`,
  );
}

requireMatch(
  'lib/server/system-llm-config.ts',
  /if \(!configured\) return 'gpt-5\.6-luna';/,
  'server LLM fallback must use GPT-5.6 Luna.',
);
requireMatch(
  'prisma/schema.prisma',
  /model SystemLLMConfig \{[\s\S]*?modelId\s+String\s+@default\("gpt-5\.6-luna"\)/,
  'new system LLM rows must not fall back to the legacy GPT-4o mini default.',
);
requireMatch(
  'prisma/migrations/20260811090000_update_system_llm_default_to_luna/migration.sql',
  /ALTER COLUMN "modelId" SET DEFAULT 'gpt-5\.6-luna'/,
  'the database default migration must follow the current everyday language model.',
);
requireMatch(
  'lib/ai/server-model.ts',
  /config\.providerId === 'openai' && config\.modelId\.startsWith\('gpt-5\.6'\)[\s\S]*?openai\.responses\(config\.modelId\)[\s\S]*?: openai\.chat\(config\.modelId\)/,
  'native GPT-5.6 must use Responses while older and compatible models retain Chat Completions.',
);
requireMatch(
  'lib/store/settings.ts',
  /const DEFAULT_OPENAI_MODEL_ID = 'gpt-5\.6-luna';/,
  'client text default must use GPT-5.6 Luna.',
);
requireMatch(
  'lib/store/settings.ts',
  /const DEFAULT_IMAGE_PROVIDER_ID: ImageProviderId = 'openai-image';/,
  'client image provider must default to OpenAI.',
);
requireMatch(
  'lib/store/settings.ts',
  /const DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2';/,
  'client image model must default to GPT Image 2.',
);
requireMatch(
  'lib/store/settings.ts',
  /version: 13,/,
  'persisted settings migration version must include the generation-default upgrade.',
);
requireMatch(
  'lib/store/settings.ts',
  /migrateLegacyDefaultGenerationModels\(state\);/,
  'former exact defaults must migrate without overriding custom choices.',
);

requireMatch(
  'lib/media/adapters/openai-image-adapter.ts',
  /const DEFAULT_MODEL = 'gpt-image-2';/,
  'OpenAI image adapter must default to GPT Image 2.',
);
requireMatch(
  'lib/server/provider-config.ts',
  /if \(!image\['openai-image'\] && process\.env\.OPENAI_API_KEY\)/,
  'OpenAI image generation must reuse OPENAI_API_KEY when no image-specific key is configured.',
);
requireMatch(
  'lib/media/adapters/openai-image-adapter.ts',
  /const RESPONSES_IMAGE_HOST_MODEL = 'gpt-5\.6-sol';/,
  'GPT Image 2 Responses calls must use the current flagship host model.',
);
requireMatch(
  'lib/media/adapters/openai-image-adapter.ts',
  /reasoning: \{ effort: 'none' \},/,
  'the image-tool host must not spend unnecessary reasoning tokens.',
);
requireBefore(
  'lib/media/image-providers.ts',
  "{ id: 'gpt-image-2'",
  "{ id: 'gpt-image-1.5'",
  'GPT Image 2 must be the first OpenAI image option.',
);
requireMatch(
  'lib/constants/notebook-generation-model-presets.ts',
  /NOTEBOOK_MODEL_PRESET_FULL = 'gpt-5\.6-sol';/,
  'quality-critical notebook stages must use Sol.',
);
requireMatch(
  'lib/constants/notebook-generation-model-presets.ts',
  /NOTEBOOK_MODEL_PRESET_MINI = 'gpt-5\.6-terra';/,
  'cost-sensitive notebook stages must use Terra.',
);

requireMatch(
  'components/settings/system-llm-panel.tsx',
  /日常语言模型[\s\S]*?gpt-5\.6-luna[\s\S]*?笔记本整理模型/,
  'shared teacher/student settings must expose independent Luna language and Terra notebook controls.',
);

for (const relativePath of [
  'scripts/learn/run-learn-scenarios.mjs',
  'scripts/learn/run-learn-initial-cases.mjs',
  'scripts/learn/run-learn-core-compat-checks.mjs',
  'scripts/learn/run-mat102-api-journey.mjs',
  'scripts/maintenance/test-course-chat-services.mjs',
  'scripts/maintenance/run-phase2-07-08-memory-writeback.mjs',
]) {
  requireMatch(
    relativePath,
    /(?:DEFAULT_MODEL|configured)[\s\S]{0,180}'(?:openai:)?gpt-5\.6-terra'/,
    'active API/learning harness fallback must follow the current base model.',
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      textDefault: 'gpt-5.6-luna',
      balancedNotebookModel: 'gpt-5.6-terra',
      imageDefault: 'gpt-image-2',
      persistedSettingsMigration: 13,
    },
    null,
    2,
  ),
);
