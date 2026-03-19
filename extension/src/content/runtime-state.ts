import type { PlaybackState } from "@bili-syncplay/protocol";

export interface FestivalVideoSnapshot {
  videoId: string;
  url: string;
  title: string;
  updatedAt: number;
}

export interface ExplicitPlaybackAction {
  playState: "playing" | "paused";
  at: number;
}

export interface SuppressedRemotePlayback {
  until: number;
  url: string;
  playState: PlaybackState["playState"];
  currentTime: number;
  playbackRate: number;
}

export interface RecentRemotePlayingIntent {
  until: number;
  url: string;
  currentTime: number;
}

export interface ContentRuntimeState {
  localMemberId: string | null;
  activeSharedUrl: string | null;
  activeRoomCode: string | null;
  hydrationReady: boolean;
  hasReceivedInitialRoomState: boolean;
  pendingRoomStateHydration: boolean;
  intendedPlayState: PlaybackState["playState"];
  lastLocalIntentAt: number;
  lastLocalIntentPlayState: PlaybackState["playState"] | null;
  lastUserGestureAt: number;
  lastExplicitPlaybackAction: ExplicitPlaybackAction | null;
  explicitNonSharedPlaybackUrl: string | null;
  pauseHoldUntil: number;
  pendingPlaybackApplication: PlaybackState | null;
  suppressedRemotePlayback: SuppressedRemotePlayback | null;
  recentRemotePlayingIntent: RecentRemotePlayingIntent | null;
  festivalSnapshot: FestivalVideoSnapshot | null;
}

export function createContentRuntimeState(): ContentRuntimeState {
  return {
    localMemberId: null,
    activeSharedUrl: null,
    activeRoomCode: null,
    hydrationReady: false,
    hasReceivedInitialRoomState: false,
    pendingRoomStateHydration: true,
    intendedPlayState: "paused",
    lastLocalIntentAt: 0,
    lastLocalIntentPlayState: null,
    lastUserGestureAt: 0,
    lastExplicitPlaybackAction: null,
    explicitNonSharedPlaybackUrl: null,
    pauseHoldUntil: 0,
    pendingPlaybackApplication: null,
    suppressedRemotePlayback: null,
    recentRemotePlayingIntent: null,
    festivalSnapshot: null,
  };
}
