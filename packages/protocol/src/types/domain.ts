import type { PlaybackPlayState, RoomCode } from "./common.js";

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
