import type {
  PlaybackState,
  RoomState,
  SharedVideo,
} from "@bili-syncplay/protocol";
import type { SharedVideoToastPayload } from "../shared/messages";

export function createPendingShareToast(args: {
  state: RoomState;
  normalizedSharedUrl: string | null;
  now: number;
  ttlMs: number;
}): (SharedVideoToastPayload & { expiresAt: number; roomCode: string }) | null {
  if (!args.state.sharedVideo) {
    return null;
  }

  return {
    key: `${args.state.roomCode}:${args.normalizedSharedUrl ?? args.state.sharedVideo.url}:${args.now}`,
    actorId: args.state.playback?.actorId ?? null,
    title: args.state.sharedVideo.title,
    videoUrl: args.state.sharedVideo.url,
    roomCode: args.state.roomCode,
    expiresAt: args.now + args.ttlMs,
  };
}

export function getPendingShareToastFor(args: {
  pendingShareToast:
    | (SharedVideoToastPayload & { expiresAt: number; roomCode: string })
    | null;
  state: RoomState;
  normalizedPendingToastUrl: string | null;
  normalizedSharedUrl: string | null;
  now: number;
}): {
  pendingShareToast:
    | (SharedVideoToastPayload & { expiresAt: number; roomCode: string })
    | null;
  shareToast: SharedVideoToastPayload | null;
} {
  if (!args.pendingShareToast) {
    return {
      pendingShareToast: null,
      shareToast: null,
    };
  }

  if (
    args.pendingShareToast.expiresAt <= args.now ||
    args.pendingShareToast.roomCode !== args.state.roomCode
  ) {
    return {
      pendingShareToast: null,
      shareToast: null,
    };
  }

  if (args.normalizedPendingToastUrl !== args.normalizedSharedUrl) {
    return {
      pendingShareToast: args.pendingShareToast,
      shareToast: null,
    };
  }

  return {
    pendingShareToast: args.pendingShareToast,
    shareToast: {
      key: args.pendingShareToast.key,
      actorId: args.pendingShareToast.actorId,
      title: args.pendingShareToast.title,
      videoUrl: args.pendingShareToast.videoUrl,
    },
  };
}

export function flushPendingShare(args: {
  pendingSharedVideo: SharedVideo | null;
  pendingSharedPlayback: PlaybackState | null;
  connected: boolean;
  roomCode: string | null;
  memberToken: string | null;
}): {
  shouldFlush: boolean;
  video: SharedVideo | null;
  playback: PlaybackState | null;
} {
  if (
    !args.pendingSharedVideo ||
    !args.connected ||
    !args.roomCode ||
    !args.memberToken
  ) {
    return {
      shouldFlush: false,
      video: null,
      playback: null,
    };
  }

  return {
    shouldFlush: true,
    video: args.pendingSharedVideo,
    playback: args.pendingSharedPlayback,
  };
}
