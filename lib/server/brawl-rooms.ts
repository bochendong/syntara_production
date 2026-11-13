import { randomBytes, randomUUID } from 'node:crypto';

/**
 * 沙盒期末战联机房间：最多 4 人，房间码加入，服务器只做转发。
 * 房间放在进程内存里（测试服是单实例），重启后房间消失，正在打的局会断开。
 * 每个人拿到一个私密 key（发消息、收消息用）和一个公开 id（别人看到的）。
 */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const BRAWL_MAX_PLAYERS = 4;
const MAX_ROOMS = 300;
const PEER_TIMEOUT_MS = 20_000;
const ROOM_IDLE_MS = 30 * 60_000;
const MAX_POSTS_PER_SECOND = 40;

type Stream = ReadableStreamDefaultController<Uint8Array>;
type Peer = {
  id: string;
  key: string;
  name: string;
  hero: string;
  skin: string;
  seen: number;
  streams: Set<Stream>;
  bucket: { at: number; n: number };
};
type Room = {
  code: string;
  host: string;
  peers: Map<string, Peer>;
  started: boolean;
  touched: number;
};
type PublicPeer = { id: string; name: string; hero: string; skin: string };
export type BrawlRoomView = { code: string; host: string; started: boolean; players: PublicPeer[] };

const store = globalThis as typeof globalThis & { __brawlRooms?: Map<string, Room> };
const rooms: Map<string, Room> = (store.__brawlRooms ??= new Map());
const encoder = new TextEncoder();

export class BrawlRoomError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const clean = (value: unknown, max: number, fallback = '') =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f<>]/g, '')
        .trim()
        .slice(0, max) || fallback
    : fallback;

function newCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = randomBytes(4);
    const code = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (!rooms.has(code)) return code;
  }
  throw new BrawlRoomError(503, 'busy', '房间太多了，稍后再试');
}

function view(room: Room): BrawlRoomView {
  return {
    code: room.code,
    host: room.host,
    started: room.started,
    players: [...room.peers.values()].map(({ id, name, hero, skin }) => ({ id, name, hero, skin })),
  };
}

function write(stream: Stream, payload: string) {
  try {
    stream.enqueue(encoder.encode(payload));
  } catch {
    // 连接已经关了，下次清理时会移除。
  }
}

function emit(peer: Peer, event: unknown) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const stream of peer.streams) write(stream, payload);
}

function broadcastRoom(room: Room) {
  const event = { t: 'room', room: view(room) };
  for (const peer of room.peers.values()) emit(peer, event);
}

function closeRoom(room: Room, reason: string) {
  rooms.delete(room.code);
  for (const peer of room.peers.values()) {
    emit(peer, { t: 'closed', reason });
    for (const stream of peer.streams) {
      try {
        stream.close();
      } catch {
        // 已关闭
      }
    }
  }
}

function removePeer(room: Room, id: string, reason: string) {
  room.peers.delete(id);
  if (id === room.host || room.peers.size === 0) closeRoom(room, reason);
  else broadcastRoom(room);
}

/** 清掉掉线的人和长时间没动静的房间。每次请求顺手跑一遍。 */
export function sweepBrawlRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    if (now - room.touched > ROOM_IDLE_MS) {
      closeRoom(room, '房间太久没人动，已经关闭');
      continue;
    }
    for (const peer of [...room.peers.values()]) {
      if (peer.streams.size === 0 && now - peer.seen > PEER_TIMEOUT_MS) {
        removePeer(room, peer.id, peer.id === room.host ? '房主掉线了' : '');
        if (!rooms.has(room.code)) break;
      }
    }
  }
}

function addPeer(room: Room, name: string, hero: string, skin: string): Peer {
  const peer: Peer = {
    id: randomBytes(4).toString('hex'),
    key: randomUUID(),
    name,
    hero,
    skin,
    seen: Date.now(),
    streams: new Set(),
    bucket: { at: Date.now(), n: 0 },
  };
  room.peers.set(peer.id, peer);
  room.touched = Date.now();
  return peer;
}

function find(codeValue: unknown, keyValue: unknown): { room: Room; peer: Peer } {
  const code = clean(codeValue, 8).toUpperCase();
  const key = clean(keyValue, 64);
  const room = rooms.get(code);
  if (!room) throw new BrawlRoomError(404, 'no_room', '房间不存在或已经关闭');
  const peer = [...room.peers.values()].find((p) => p.key === key);
  if (!peer) throw new BrawlRoomError(403, 'not_in_room', '你已经不在这个房间里了');
  peer.seen = Date.now();
  room.touched = peer.seen;
  return { room, peer };
}

function rateLimit(peer: Peer) {
  const now = Date.now();
  if (now - peer.bucket.at > 1000) peer.bucket = { at: now, n: 0 };
  if (++peer.bucket.n > MAX_POSTS_PER_SECOND)
    throw new BrawlRoomError(429, 'too_fast', '发得太快了');
}

export function createBrawlRoom(body: Record<string, unknown>) {
  sweepBrawlRooms();
  if (rooms.size >= MAX_ROOMS) throw new BrawlRoomError(503, 'busy', '房间太多了，稍后再试');
  const room: Room = {
    code: newCode(),
    host: '',
    peers: new Map(),
    started: false,
    touched: Date.now(),
  };
  const peer = addPeer(
    room,
    clean(body.name, 12, '同学'),
    clean(body.hero, 24),
    clean(body.skin, 32),
  );
  room.host = peer.id;
  rooms.set(room.code, room);
  return { code: room.code, id: peer.id, key: peer.key, room: view(room) };
}

export function joinBrawlRoom(body: Record<string, unknown>) {
  sweepBrawlRooms();
  const room = rooms.get(clean(body.code, 8).toUpperCase());
  if (!room) throw new BrawlRoomError(404, 'no_room', '没有这个房间码');
  if (room.started) throw new BrawlRoomError(409, 'started', '这局已经开始了');
  if (room.peers.size >= BRAWL_MAX_PLAYERS)
    throw new BrawlRoomError(409, 'full', '房间满了，最多 4 人');
  const peer = addPeer(
    room,
    clean(body.name, 12, '同学'),
    clean(body.hero, 24),
    clean(body.skin, 32),
  );
  broadcastRoom(room);
  return { code: room.code, id: peer.id, key: peer.key, room: view(room) };
}

export function updateBrawlPeer(body: Record<string, unknown>) {
  const { room, peer } = find(body.code, body.key);
  rateLimit(peer);
  if (body.name !== undefined) peer.name = clean(body.name, 12, peer.name);
  if (body.hero !== undefined) peer.hero = clean(body.hero, 24, peer.hero);
  if (body.skin !== undefined) peer.skin = clean(body.skin, 32);
  broadcastRoom(room);
  return { room: view(room) };
}

/** 房主开局：之后不能再加人。 */
export function startBrawlRoom(body: Record<string, unknown>) {
  const { room, peer } = find(body.code, body.key);
  if (peer.id !== room.host) throw new BrawlRoomError(403, 'not_host', '只有房主能开局');
  room.started = true;
  const event = { t: 'start', from: peer.id, m: body.m ?? null, room: view(room) };
  for (const p of room.peers.values()) emit(p, event);
  return { room: view(room) };
}

/** 房主回到大厅（一局打完），大家可以再开一局。 */
export function resetBrawlRoom(body: Record<string, unknown>) {
  const { room, peer } = find(body.code, body.key);
  if (peer.id !== room.host) throw new BrawlRoomError(403, 'not_host', '只有房主能回大厅');
  room.started = false;
  broadcastRoom(room);
  return { room: view(room) };
}

/** 转发一条消息给房间里其他人；to 指定时只发给那个人。 */
export function sendBrawlMessage(body: Record<string, unknown>) {
  const { room, peer } = find(body.code, body.key);
  rateLimit(peer);
  const to = typeof body.to === 'string' ? body.to : '';
  const event = { t: 'm', from: peer.id, m: body.m ?? null };
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const p of room.peers.values()) {
    if (p.id === peer.id || (to && p.id !== to)) continue;
    for (const stream of p.streams) write(stream, payload);
  }
  return { ok: true };
}

export function leaveBrawlRoom(body: Record<string, unknown>) {
  const { room, peer } = find(body.code, body.key);
  removePeer(room, peer.id, peer.id === room.host ? '房主离开了房间' : '');
  return { ok: true };
}

/** 打开一条 SSE 连接，收房间里的消息。 */
export function openBrawlStream(
  code: string | null,
  key: string | null,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  sweepBrawlRooms();
  const { room, peer } = find(code, key);
  let ping: ReturnType<typeof setInterval> | undefined;
  let self: Stream | undefined;
  const detach = () => {
    if (ping) clearInterval(ping);
    if (self) peer.streams.delete(self);
    peer.seen = Date.now();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      self = controller;
      peer.streams.add(controller);
      write(
        controller,
        `retry: 2000\n\ndata: ${JSON.stringify({ t: 'room', room: view(room), you: peer.id })}\n\n`,
      );
      ping = setInterval(() => {
        peer.seen = Date.now();
        write(controller, ': ping\n\n');
      }, 15_000);
      signal.addEventListener('abort', () => {
        detach();
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      });
    },
    cancel() {
      detach();
    },
  });
}
