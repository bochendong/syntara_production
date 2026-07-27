/**
 * Prompt Loader - Loads prompts from markdown files
 *
 * Supports:
 * - Loading prompts from templates/{promptId}/ directory
 * - Language-specific variants: system.zh-CN.md / system.en-US.md / user.zh-CN.md / user.en-US.md
 * - Snippet inclusion via {{snippet:name}} syntax
 * - Variable interpolation via {{variable}} syntax
 * - Caching for performance
 */

import fs from 'fs';
import path from 'path';
import type { PromptId, LoadedPrompt, PromptLanguage, SnippetId } from './types';
import { createLogger } from '@/lib/logger';
const log = createLogger('PromptLoader');

// Cache for loaded prompts and snippets
const promptCache = new Map<string, LoadedPrompt>();
const snippetCache = new Map<string, string>();
const parityWarningCache = new Set<string>();

/**
 * Get the prompts directory path
 */
function getPromptsDir(): string {
  // In Next.js, use process.cwd() for the project root
  return path.join(process.cwd(), 'lib', 'generation', 'prompts');
}

function getPromptCacheKey(promptId: PromptId, language?: PromptLanguage): string {
  return `${promptId}:${language || 'generic'}`;
}

function getTemplatePath(
  promptDir: string,
  part: 'system' | 'user',
  language?: PromptLanguage,
): string {
  return language
    ? path.join(promptDir, `${part}.${language}.md`)
    : path.join(promptDir, `${part}.md`);
}

function tryReadPromptFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function warnLocalizedPromptParity(promptId: PromptId, promptDir: string): void {
  const promptParts: Array<'system' | 'user'> = ['system', 'user'];

  for (const part of promptParts) {
    const zhPath = getTemplatePath(promptDir, part, 'zh-CN');
    const enPath = getTemplatePath(promptDir, part, 'en-US');
    const cacheKey = `${promptId}:${part}`;
    if (parityWarningCache.has(cacheKey)) continue;

    const zhExists = fs.existsSync(zhPath);
    const enExists = fs.existsSync(enPath);

    if (!zhExists && !enExists) continue;

    if (zhExists !== enExists) {
      parityWarningCache.add(cacheKey);
      log.warn(
        `Prompt localization parity warning for "${promptId}" (${part}): ${zhExists ? 'zh-CN exists but en-US is missing' : 'en-US exists but zh-CN is missing'}.`,
      );
      continue;
    }

    try {
      const zhMtime = fs.statSync(zhPath).mtimeMs;
      const enMtime = fs.statSync(enPath).mtimeMs;
      if (Math.abs(zhMtime - enMtime) > 1000) {
        parityWarningCache.add(cacheKey);
        log.warn(
          `Prompt localization parity warning for "${promptId}" (${part}): zh-CN and en-US variants have different modified times. If you changed one side, review the other side too.`,
        );
      }
    } catch (error) {
      parityWarningCache.add(cacheKey);
      log.warn(`Failed to inspect localized prompt parity for "${promptId}" (${part})`, error);
    }
  }
}

function resolvePromptLanguage(
  variables?: Record<string, unknown>,
  explicitLanguage?: PromptLanguage,
): PromptLanguage | undefined {
  if (explicitLanguage) return explicitLanguage;
  return variables?.language === 'zh-CN' || variables?.language === 'en-US'
    ? variables.language
    : undefined;
}

/**
 * Load a snippet by ID
 */
export function loadSnippet(snippetId: SnippetId): string {
  const cached = snippetCache.get(snippetId);
  if (cached) return cached;

  const snippetPath = path.join(getPromptsDir(), 'snippets', `${snippetId}.md`);

  try {
    const content = fs.readFileSync(snippetPath, 'utf-8').trim();
    snippetCache.set(snippetId, content);
    return content;
  } catch {
    log.warn(`Snippet not found: ${snippetId}`);
    return `{{snippet:${snippetId}}}`;
  }
}

/**
 * Process snippet includes in a template
 * Replaces {{snippet:name}} with actual snippet content
 */
function processSnippets(template: string): string {
  return template.replace(/\{\{snippet:(\w[\w-]*)\}\}/g, (_, snippetId) => {
    return loadSnippet(snippetId as SnippetId);
  });
}

/**
 * Load a prompt by ID
 */
export function loadPrompt(promptId: PromptId, language?: PromptLanguage): LoadedPrompt | null {
  const cacheKey = getPromptCacheKey(promptId, language);
  const cached = promptCache.get(cacheKey);
  if (cached) return cached;

  const promptDir = path.join(getPromptsDir(), 'templates', promptId);

  try {
    warnLocalizedPromptParity(promptId, promptDir);

    const systemTemplate =
      tryReadPromptFile(getTemplatePath(promptDir, 'system', language)) ??
      tryReadPromptFile(getTemplatePath(promptDir, 'system'));
    if (!systemTemplate) {
      throw new Error(`System prompt not found for ${promptId}`);
    }

    const userTemplate =
      tryReadPromptFile(getTemplatePath(promptDir, 'user', language)) ??
      tryReadPromptFile(getTemplatePath(promptDir, 'user')) ??
      '';

    const loaded: LoadedPrompt = {
      id: promptId,
      language: language || 'generic',
      systemPrompt: processSnippets(systemTemplate),
      userPromptTemplate: processSnippets(userTemplate),
    };

    promptCache.set(cacheKey, loaded);
    return loaded;
  } catch (error) {
    log.error(`Failed to load prompt ${promptId}${language ? ` for ${language}` : ''}:`, error);
    return null;
  }
}

/**
 * Interpolate variables in a template
 * Replaces {{variable}} with values from the variables object
 */
export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined) return match;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

/**
 * Build a complete prompt with variables
 */
export function buildPrompt(
  promptId: PromptId,
  variables: Record<string, unknown>,
  options?: { language?: PromptLanguage },
): { system: string; user: string } | null {
  const language = resolvePromptLanguage(variables, options?.language);
  const prompt = loadPrompt(promptId, language);
  if (!prompt) return null;

  return {
    system: interpolateVariables(prompt.systemPrompt, variables),
    user: interpolateVariables(prompt.userPromptTemplate, variables),
  };
}

/**
 * Clear all caches (useful for development/testing)
 */
export function clearPromptCache(): void {
  promptCache.clear();
  snippetCache.clear();
  parityWarningCache.clear();
}
