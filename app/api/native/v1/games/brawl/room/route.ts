import { NextRequest, NextResponse } from 'next/server';
import {
  BrawlRoomError,
  createBrawlRoom,
  joinBrawlRoom,
  leaveBrawlRoom,
  openBrawlStream,
  resetBrawlRoom,
  sendBrawlMessage,
  startBrawlRoom,
  updateBrawlPeer,
} from '@/lib/server/brawl-rooms';

// 沙盒期末战联机：POST 建房 / 加入 / 发消息，GET 是收消息的 SSE 长连接。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 64 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

function fail(error: unknown) {
  if (error instanceof BrawlRoomError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: NO_STORE },
    );
  }
  console.error('[brawl-room] request failed', error);
  return NextResponse.json({ error: '联机服务出错了' }, { status: 500, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
      throw new BrawlRoomError(413, 'too_large', '消息太大了');
    }
    const text = await request.text();
    if (text.length > MAX_BODY) throw new BrawlRoomError(413, 'too_large', '消息太大了');
    const body = (JSON.parse(text || '{}') ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || Array.isArray(body))
      throw new BrawlRoomError(400, 'bad_request', '请求格式不对');
    const ops = {
      create: createBrawlRoom,
      join: joinBrawlRoom,
      hello: updateBrawlPeer,
      start: startBrawlRoom,
      reset: resetBrawlRoom,
      send: sendBrawlMessage,
      leave: leaveBrawlRoom,
    } as const;
    const op = typeof body.op === 'string' && body.op in ops ? (body.op as keyof typeof ops) : null;
    if (!op) throw new BrawlRoomError(400, 'bad_request', '不认识的操作');
    return NextResponse.json(ops[op](body), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SyntaxError)
      return fail(new BrawlRoomError(400, 'bad_request', '请求格式不对'));
    return fail(error);
  }
}

export function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const stream = openBrawlStream(params.get('code'), params.get('key'), request.signal);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return fail(error);
  }
}
