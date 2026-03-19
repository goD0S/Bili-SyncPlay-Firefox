import type { PlaybackState, SharedVideo } from "@bili-syncplay/protocol";

export function shouldSkipBroadcastWhileHydrating(args: {
  pendingRoomStateHydration: boolean;
  now: number;
  lastUserGestureAt: number;
  userGestureGraceMs: number;
}): boolean {
  if (!args.pendingRoomStateHydration) {
    return false;
  }

  return args.now - args.lastUserGestureAt >= args.userGestureGraceMs;
}

export function shouldPauseForNonSharedBroadcast(args: {
  activeRoomCode: string | null;
  activeSharedUrl: string | null;
  normalizedCurrentVideoUrl: string | null;
  explicitNonSharedPlaybackUrl: string | null;
  playState: PlaybackState["playState"];
  lastExplicitPlaybackAction: {
    playState: "playing" | "paused";
    at: number;
  } | null;
  now: number;
  userGestureGraceMs: number;
}): boolean {
  if (
    !args.activeRoomCode ||
    !args.activeSharedUrl ||
    args.normalizedCurrentVideoUrl === args.activeSharedUrl
  ) {
    return false;
  }

  if (
    args.playState !== "playing" ||
    args.explicitNonSharedPlaybackUrl === args.normalizedCurrentVideoUrl
  ) {
    return false;
  }

  return !(
    args.lastExplicitPlaybackAction &&
    args.lastExplicitPlaybackAction.playState === "playing" &&
    args.now - args.lastExplicitPlaybackAction.at < args.userGestureGraceMs
  );
}

export function createPlaybackBroadcastPayload(args: {
  currentVideo: SharedVideo;
  currentTime: number;
  playState: PlaybackState["playState"];
  playbackRate: number;
  actorId: string;
  seq: number;
  now: number;
}): PlaybackState {
  return {
    url: args.currentVideo.url,
    currentTime: args.currentTime,
    playState: args.playState,
    playbackRate: args.playbackRate,
    updatedAt: args.now,
    serverTime: 0,
    actorId: args.actorId,
    seq: args.seq,
  };
}
