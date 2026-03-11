export type RoomCode = string;
export type PlaybackPlayState = "playing" | "paused" | "buffering";

export interface SharedVideo {
  videoId: string;
  url: string;
  title: string;
  sharedByMemberId?: string;
}

export interface PlaybackState {
  url: string;
  currentTime: number;
  playState: PlaybackPlayState;
  playbackRate: number;
  updatedAt: number;
  serverTime: number;
  actorId: string;
  seq: number;
}

export interface RoomMember {
  id: string;
  name: string;
}

export interface RoomState {
  roomCode: RoomCode;
  sharedVideo: SharedVideo | null;
  playback: PlaybackState | null;
  members: RoomMember[];
}

export interface ClientHelloPayload {
  displayName?: string;
}

export interface CreateRoomMessage {
  type: "room:create";
  payload?: ClientHelloPayload;
}

export interface JoinRoomMessage {
  type: "room:join";
  payload: {
    roomCode: RoomCode;
    displayName?: string;
  };
}

export interface LeaveRoomMessage {
  type: "room:leave";
}

export interface ShareVideoMessage {
  type: "video:share";
  payload: SharedVideo;
}

export interface PlaybackUpdateMessage {
  type: "playback:update";
  payload: PlaybackState;
}

export interface SyncRequestMessage {
  type: "sync:request";
}

export interface SyncPingMessage {
  type: "sync:ping";
  payload: {
    clientSendTime: number;
  };
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | ShareVideoMessage
  | PlaybackUpdateMessage
  | SyncRequestMessage
  | SyncPingMessage;

export interface RoomCreatedMessage {
  type: "room:created";
  payload: {
    roomCode: RoomCode;
    memberId: string;
  };
}

export interface RoomJoinedMessage {
  type: "room:joined";
  payload: {
    roomCode: RoomCode;
    memberId: string;
  };
}

export interface RoomStateMessage {
  type: "room:state";
  payload: RoomState;
}

export interface ErrorMessage {
  type: "error";
  payload: {
    message: string;
  };
}

export interface SyncPongMessage {
  type: "sync:pong";
  payload: {
    clientSendTime: number;
    serverReceiveTime: number;
    serverSendTime: number;
  };
}

export type ServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomStateMessage
  | ErrorMessage
  | SyncPongMessage;

const PLAYBACK_PLAY_STATES: PlaybackPlayState[] = ["playing", "paused", "buffering"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPlaybackPlayState(value: unknown): value is PlaybackPlayState {
  return isString(value) && PLAYBACK_PLAY_STATES.includes(value as PlaybackPlayState);
}

export function isClientHelloPayload(value: unknown): value is ClientHelloPayload {
  return isRecord(value) && isOptionalString(value.displayName);
}

export function isSharedVideo(value: unknown): value is SharedVideo {
  return (
    isRecord(value) &&
    isString(value.videoId) &&
    isString(value.url) &&
    isString(value.title) &&
    isOptionalString(value.sharedByMemberId)
  );
}

export function isPlaybackState(value: unknown): value is PlaybackState {
  return (
    isRecord(value) &&
    isString(value.url) &&
    isFiniteNumber(value.currentTime) &&
    isPlaybackPlayState(value.playState) &&
    isFiniteNumber(value.playbackRate) &&
    isFiniteNumber(value.updatedAt) &&
    isFiniteNumber(value.serverTime) &&
    isString(value.actorId) &&
    isFiniteNumber(value.seq)
  );
}

function isCreateRoomMessage(value: unknown): value is CreateRoomMessage {
  return isRecord(value) && value.type === "room:create" && (value.payload === undefined || isClientHelloPayload(value.payload));
}

function isJoinRoomPayload(value: unknown): value is JoinRoomMessage["payload"] {
  return isRecord(value) && isString(value.roomCode) && isOptionalString(value.displayName);
}

function isJoinRoomMessage(value: unknown): value is JoinRoomMessage {
  return isRecord(value) && value.type === "room:join" && isJoinRoomPayload(value.payload);
}

function isLeaveRoomMessage(value: unknown): value is LeaveRoomMessage {
  return isRecord(value) && value.type === "room:leave" && value.payload === undefined;
}

function isShareVideoMessage(value: unknown): value is ShareVideoMessage {
  return isRecord(value) && value.type === "video:share" && isSharedVideo(value.payload);
}

function isPlaybackUpdateMessage(value: unknown): value is PlaybackUpdateMessage {
  return isRecord(value) && value.type === "playback:update" && isPlaybackState(value.payload);
}

function isSyncRequestMessage(value: unknown): value is SyncRequestMessage {
  return isRecord(value) && value.type === "sync:request" && value.payload === undefined;
}

function isSyncPingPayload(value: unknown): value is SyncPingMessage["payload"] {
  return isRecord(value) && isFiniteNumber(value.clientSendTime);
}

function isSyncPingMessage(value: unknown): value is SyncPingMessage {
  return isRecord(value) && value.type === "sync:ping" && isSyncPingPayload(value.payload);
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "room:create":
      return isCreateRoomMessage(value);
    case "room:join":
      return isJoinRoomMessage(value);
    case "room:leave":
      return isLeaveRoomMessage(value);
    case "video:share":
      return isShareVideoMessage(value);
    case "playback:update":
      return isPlaybackUpdateMessage(value);
    case "sync:request":
      return isSyncRequestMessage(value);
    case "sync:ping":
      return isSyncPingMessage(value);
    default:
      return false;
  }
}
