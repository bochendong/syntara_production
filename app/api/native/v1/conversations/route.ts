import { NextRequest, NextResponse } from 'next/server';

import {
  handleLearnConversationsDelete,
  handleLearnConversationsGet,
  handleLearnConversationsPost,
} from '@/features/learn-conversations/server/learn-conversations-http';
import { publicApiRequestId, requireNativePlatformApi } from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** 与网页 /api/learn/conversations 相同的课程聊天读写，用 App 登录凭据鉴权。 */
async function withNativeUser(
  request: NextRequest,
  handler: (request: Request, userId: string) => Promise<Response>,
) {
  const principal = await requireNativePlatformApi(request, publicApiRequestId(request));
  if (principal instanceof NextResponse) return principal;
  return handler(request, principal.userId);
}

export async function GET(request: NextRequest) {
  return withNativeUser(request, handleLearnConversationsGet);
}

export async function POST(request: NextRequest) {
  return withNativeUser(request, handleLearnConversationsPost);
}

export async function DELETE(request: NextRequest) {
  return withNativeUser(request, handleLearnConversationsDelete);
}
