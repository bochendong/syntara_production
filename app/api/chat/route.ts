import type { NextRequest } from 'next/server';
import { handleStatelessChatRequest } from '@/features/chat/server';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleStatelessChatRequest(req);
}
