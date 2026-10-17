import {
  handleLearnConversationsDelete,
  handleLearnConversationsGet,
  handleLearnConversationsPost,
} from '@/features/learn-conversations/server/learn-conversations-http';
import { requireUserId } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireUserId({ ensureFallbackUser: false });
  if ('response' in auth) return auth.response;
  return handleLearnConversationsGet(request, auth.userId);
}

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;
  return handleLearnConversationsPost(request, auth.userId);
}

export async function DELETE(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;
  return handleLearnConversationsDelete(request, auth.userId);
}
