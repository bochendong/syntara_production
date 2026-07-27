import { Badge } from '@/components/ui/badge';
import { actionStatusKeyMap } from '@/lib/chat/action-translations';
import type { ToolUIPart } from 'ai';
import { CheckCircleIcon, CircleIcon, ClockIcon, XCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function getLocalizedActionStatusBadge(
  t: (key: string) => string,
  state: string,
): ReactNode {
  const iconMap: Record<string, ReactNode> = {
    'input-streaming': <CircleIcon className="size-4" />,
    'input-available': <ClockIcon className="size-4 animate-pulse" />,
    'output-available': <CheckCircleIcon className="size-4 text-green-600" />,
    'output-error': <XCircleIcon className="size-4 text-red-600" />,
    'output-denied': <XCircleIcon className="size-4 text-orange-600" />,
    running: <ClockIcon className="size-4 animate-pulse" />,
    result: <CheckCircleIcon className="size-4 text-green-600" />,
    error: <XCircleIcon className="size-4 text-red-600" />,
  };

  const i18nKey = actionStatusKeyMap[state];
  const label = i18nKey ? t(`actions.status.${i18nKey}`) : state;

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {iconMap[state] || <CircleIcon className="size-4" />}
      {label}
    </Badge>
  );
}

export function getToolStatusBadge(status: ToolUIPart['state']): ReactNode {
  const labels: Record<ToolUIPart['state'], string> = {
    'input-streaming': 'Pending',
    'input-available': 'Running',
    'approval-requested': 'Awaiting Approval',
    'approval-responded': 'Responded',
    'output-available': 'Completed',
    'output-error': 'Error',
    'output-denied': 'Denied',
  };

  const icons: Record<ToolUIPart['state'], ReactNode> = {
    'input-streaming': <CircleIcon className="size-4" />,
    'input-available': <ClockIcon className="size-4 animate-pulse" />,
    'approval-requested': <ClockIcon className="size-4 text-yellow-600" />,
    'approval-responded': <CheckCircleIcon className="size-4 text-blue-600" />,
    'output-available': <CheckCircleIcon className="size-4 text-green-600" />,
    'output-error': <XCircleIcon className="size-4 text-red-600" />,
    'output-denied': <XCircleIcon className="size-4 text-orange-600" />,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
}
