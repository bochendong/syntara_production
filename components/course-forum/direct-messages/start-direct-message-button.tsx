'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { backendJson } from '@/lib/utils/backend-api';

type StartDirectMessageResponse = {
  threadId: string;
};

export function StartDirectMessageButton({
  courseId,
  recipientId,
  currentUserId,
}: {
  courseId?: string;
  recipientId: string;
  currentUserId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from');
  const returnTo = searchParams.get('returnTo');
  const [starting, setStarting] = useState(false);
  if (currentUserId && currentUserId === recipientId) return null;

  const start = async () => {
    if (starting || currentUserId === recipientId) return;
    setStarting(true);
    try {
      const payload = await backendJson<StartDirectMessageResponse>(
        courseId
          ? `/api/course-forum/${encodeURIComponent(courseId)}/direct-messages`
          : '/api/forum/direct-messages',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ recipientId }),
          timeoutMs: 20_000,
        },
      );
      if (courseId) {
        router.push(
          `/course/${encodeURIComponent(courseId)}/forum/messages/${encodeURIComponent(
            payload.threadId,
          )}${from === 'home' ? '?from=home' : ''}`,
        );
      } else {
        const forumHref = returnTo ? `/forum?returnTo=${encodeURIComponent(returnTo)}` : '/forum';
        router.push(
          `/forum/messages/${encodeURIComponent(payload.threadId)}?returnTo=${encodeURIComponent(
            forumHref,
          )}`,
        );
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <Button className="rounded-xl bg-violet-600 hover:bg-violet-700" onClick={() => void start()}>
      {starting ? (
        <Loader2 className="mr-1.5 size-4 animate-spin" />
      ) : (
        <Mail className="mr-1.5 size-4" />
      )}
      发送私信
    </Button>
  );
}
