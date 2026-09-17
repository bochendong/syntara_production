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
  /^DEFAULT_MODEL=gpt-5\.6-sol$/m,
  'DEFAULT_MODEL must use GPT-5.6 Sol as the shared fallback.',
);
requireMatch(
  '.env.example',
  /^OPENAI_MODELS=gpt-6-astra,gpt-5\.6-sol,gpt-5\.6-terra,gpt-5\.6-luna$/m,
  'OPENAI_MODELS must expose the configured high, medium, notebook, and low models.',
);
requireMatch(
  '.env.example',
  /^IMAGE_OPENAI_IMAGE_MODELS=gpt-image-2\.5-flare,gpt-image-2\.5-sunburst,gpt-image-2$/m,
  'OpenAI image models must default to GPT Image 2.5 Flare.',
);

requireMatch(
  'lib/ai/system-model-policy.ts',
  /SYSTEM_OPENAI_FALLBACK_MODEL = 'gpt-5\.6-sol'/,
  'non-chat OpenAI calls must fall back to Sol.',
);
requireMatch(
  'lib/ai/system-model-policy.ts',
  /SYSTEM_OPENAI_LECTURE_MODEL = 'gpt-5\.6-sol'/,
  'lecture and notebook generation must use Sol.',
);
requireMatch(
  'lib/ai/system-model-policy.ts',
  /low: 'gpt-5\.6-luna',\s*medium: 'gpt-5\.6-sol',\s*high: 'gpt-6-astra'/,
  'chat response strength tiers must map low to Luna, medium to Sol, and high to Astra.',
);

requireBefore(
  'lib/ai/providers.ts',
  "id: 'gpt-6-astra'",
  "id: 'gpt-5.6-sol'",
  'Astra must be the first OpenAI text model.',
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
  /if \(!configured\) return SYSTEM_OPENAI_FALLBACK_MODEL;/,
  'server LLM fallback must use GPT-5.6 Sol.',
);
requireMatch(
  'prisma/schema.prisma',
  /model SystemLLMConfig \{[\s\S]*?modelId\s+String\s+@default\("gpt-5\.6-sol"\)/,
  'new system LLM rows must default to GPT-5.6 Sol.',
);
requireMatch(
  'prisma/migrations/20260917120000_update_system_llm_default_to_sol/migration.sql',
  /ALTER COLUMN "modelId" SET DEFAULT 'gpt-5\.6-sol'/,
  'the database default migration must follow the current fallback model.',
);
requireMatch(
  'lib/ai/server-model.ts',
  /config\.providerId === 'openai' &&\s*\(config\.modelId\.startsWith\('gpt-5\.6'\) \|\| config\.modelId\.startsWith\('gpt-6'\)\)[\s\S]*?openai\.responses\(config\.modelId\)[\s\S]*?: openai\.chat\(config\.modelId\)/,
  'native GPT-5.6 and GPT-6 must use Responses while older and compatible models retain Chat Completions.',
);
requireMatch(
  'lib/ai/chat-response-strength.ts',
  /low:[\s\S]*?modelId: SYSTEM_CHAT_MODEL_BY_STRENGTH\.low[\s\S]*?medium:[\s\S]*?modelId: SYSTEM_CHAT_MODEL_BY_STRENGTH\.medium[\s\S]*?high:[\s\S]*?modelId: SYSTEM_CHAT_MODEL_BY_STRENGTH\.high/,
  'chat response strength tiers must read from the shared OpenAI policy.',
);
requireMatch(
  'lib/store/settings.ts',
  /const DEFAULT_OPENAI_MODEL_ID = 'gpt-5\.6-sol';/,
  'client text default must use GPT-5.6 Sol.',
);
requireMatch(
  'lib/store/settings.ts',
  /const DEFAULT_IMAGE_PROVIDER_ID: ImageProviderId = 'openai-image';/,
  'client image provider must default to OpenAI.',
);
requireMatch(
  'lib/store/settings.ts',
  /const DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2.5-flare';/,
  'client image model must default to GPT Image 2.5 Flare.',
);
requireMatch(
  'lib/store/settings.ts',
  /version: 15,/,
  'persisted settings migration version must include the Sol fallback upgrade.',
);
requireMatch(
  'lib/store/settings.ts',
  /migrateLegacyDefaultGenerationModels\(state\);/,
  'former exact defaults must migrate without overriding custom choices.',
);

requireMatch(
  'lib/media/adapters/openai-image-adapter.ts',
  /const DEFAULT_MODEL = 'gpt-image-2.5-flare';/,
  'OpenAI image adapter must default to GPT Image 2.5 Flare.',
);
requireMatch(
  'lib/server/provider-config.ts',
  /if \(!image\['openai-image'\] && process\.env\.OPENAI_API_KEY\)/,
  'OpenAI image generation must reuse OPENAI_API_KEY when no image-specific key is configured.',
);
requireMatch(
  'lib/media/adapters/openai-image-adapter.ts',
  /const RESPONSES_IMAGE_HOST_MODEL = 'gpt-5\.6-sol';/,
  'GPT Image 2.5 Flare Responses calls must use the current flagship host model.',
);
requireMatch(
  'lib/media/adapters/openai-image-adapter.ts',
  /reasoning: \{ effort: 'none' \},/,
  'the image-tool host must not spend unnecessary reasoning tokens.',
);
requireBefore(
  'lib/media/image-providers.ts',
  "{ id: 'gpt-image-2.5-flare'",
  "{ id: 'gpt-image-1.5'",
  'GPT Image 2.5 Flare must be the first OpenAI image option.',
);
requireMatch(
  'lib/constants/notebook-generation-model-presets.ts',
  /NOTEBOOK_MODEL_PRESET_FULL = SYSTEM_OPENAI_LECTURE_MODEL;/,
  'quality-critical notebook stages must use Sol.',
);
requireMatch(
  'lib/constants/notebook-generation-model-presets.ts',
  /NOTEBOOK_MODEL_PRESET_MINI = SYSTEM_OPENAI_LECTURE_MODEL;/,
  'cost-sensitive notebook stages must also use Sol.',
);

requireMatch(
  'components/settings/system-llm-panel.tsx',
  /日常语言模型[\s\S]*?GPT-5\.6 Sol[\s\S]*?笔记本整理模型[\s\S]*?GPT-5\.6 Sol/,
  'shared teacher/student settings must expose Sol for both language fallback and notebook generation.',
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
    /(?:DEFAULT_MODEL|configured)[\s\S]{0,180}'(?:openai:)?gpt-5\.6-sol'/,
    'active API/learning harness fallback must follow the current base model.',
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      textDefault: 'gpt-5.6-sol',
      responseStrength: {
        low: 'gpt-5.6-luna',
        medium: 'gpt-5.6-sol',
        high: 'gpt-6-astra',
      },
      lectureModel: 'gpt-5.6-sol',
      fallbackModel: 'gpt-5.6-sol',
      imageDefault: 'gpt-image-2.5-flare',
      persistedSettingsMigration: 15,
    },
    null,
    2,
  ),
);
