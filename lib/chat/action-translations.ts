/**
 * Map SSE status strings to i18n keys under `actions.status.*`
 */
export const actionStatusKeyMap: Record<string, string> = {
  'input-streaming': 'inputStreaming',
  'input-available': 'inputAvailable',
  'output-available': 'outputAvailable',
  'output-error': 'outputError',
  'output-denied': 'outputDenied',
  running: 'running',
  result: 'result',
  error: 'error',
};

/**
 * Resolve an action name to its i18n display name.
 * Falls back to the raw actionName if no translation exists.
 */
export function getActionDisplayName(t: (key: string) => string, actionName: string): string {
  const translated = t(`actions.names.${actionName}`);
  // t() returns the key itself when translation is missing
  return translated === `actions.names.${actionName}` ? actionName : translated;
}

/**
 * Extract text parts from a message
 */
export function getMessageTextParts(message: {
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>;
}) {
  if (!message.parts || message.parts.length === 0) {
    return [];
  }
  return message.parts.filter((part) => part.type === 'text' || part.type === 'step-start');
}

/**
 * Extract action parts from a message
 */
export function getMessageActionParts(message: {
  parts?: Array<{ type: string; [key: string]: unknown }>;
}) {
  if (!message.parts || message.parts.length === 0) {
    return [];
  }
  return message.parts.filter((part) => part.type && part.type.startsWith('action-'));
}
