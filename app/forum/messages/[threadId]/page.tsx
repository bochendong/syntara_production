import { DirectMessageThreadClient } from '@/components/course-forum/direct-messages/direct-message-thread-client';

export default async function ForumDirectMessagePage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <DirectMessageThreadClient threadId={threadId} />;
}
