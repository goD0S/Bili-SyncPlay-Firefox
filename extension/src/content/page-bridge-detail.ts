export interface PageVideoCandidate {
  id?: string | number;
  ep_id?: string | number;
  epId?: string | number;
  bvid?: string;
  cid?: string | number;
  title?: string;
  long_title?: string;
}

export interface PageInitialState {
  epInfo?: PageVideoCandidate;
  sectionEpisodes?: PageVideoCandidate[];
  episodes?: PageVideoCandidate[];
  epList?: PageVideoCandidate[];
  videoInfo?: {
    bvid?: string;
    cid?: string | number;
    title?: string;
  };
}

export interface PlayerInput {
  bvid?: string;
  cid?: string | number;
  aid?: string | number;
}

export interface PagePlayInfo {
  result?: {
    arc?: {
      bvid?: string;
      cid?: string | number;
    };
    supplement?: {
      ogv_episode_info?: {
        episode_id?: string | number;
        ep_id?: string | number;
        index_title?: string;
        long_title?: string;
      };
      play_view_business_info?: {
        episode_info?: {
          ep_id?: string | number;
          cid?: string | number;
        };
      };
    };
  };
}

export function readFestivalVideoDetailFromSources(args: {
  initialState?: PageInitialState;
  playInfo?: PagePlayInfo;
  playerInput?: PlayerInput;
  activeCid?: string | null;
  activeEpId?: string | null;
  activeTitle?: string | null;
}): {
  epId?: string | number;
  bvid?: string;
  cid?: string | number;
  title?: string;
} | null {
  const {
    initialState,
    playInfo,
    playerInput,
    activeCid = null,
    activeEpId = null,
    activeTitle = null,
  } = args;

  const episodes = [
    ...(Array.isArray(initialState?.sectionEpisodes)
      ? initialState.sectionEpisodes
      : []),
    ...(Array.isArray(initialState?.episodes) ? initialState.episodes : []),
    ...(Array.isArray(initialState?.epList) ? initialState.epList : []),
  ];
  const matchedByEpId = activeEpId
    ? episodes.find(
        (episode) =>
          String(episode?.id ?? "") === activeEpId ||
          String(episode?.ep_id ?? "") === activeEpId ||
          String(episode?.epId ?? "") === activeEpId,
      )
    : null;
  const matchedByCid = activeCid
    ? episodes.find((episode) => String(episode?.cid ?? "") === activeCid)
    : null;
  const matchedByTitle =
    !matchedByEpId && !matchedByCid && activeTitle
      ? episodes.find(
          (episode) =>
            (episode?.title || "").trim() === activeTitle ||
            (episode?.long_title || "").trim() === activeTitle,
        )
      : null;

  const playInfoCandidate = readPlayInfoCandidate(playInfo);
  const playInfoEpId = playInfoCandidate
    ? (playInfoCandidate.ep_id ??
      playInfoCandidate.epId ??
      playInfoCandidate.id)
    : undefined;

  // Prefer __playinfo__ over DOM-derived / __INITIAL_STATE__ candidates.
  //
  // During SPA navigation between bangumi (e.g. from /bangumi/play/epXXX to
  // /bangumi/play/ssYYY), Bilibili refreshes `__playinfo__` together with the
  // newly loaded video, but `__INITIAL_STATE__.epInfo / epList / sectionEpisodes`
  // can stay populated with the previous bangumi's data for several hundred
  // milliseconds — long enough for the content script to broadcast playback
  // events derived from the stale ep_id. When the DOM-matched candidates
  // (which read from those stale episode arrays) disagree with `__playinfo__`,
  // trusting `__playinfo__` is the safer choice because the player only
  // populates it once it has actually loaded the new episode.
  const matched: PageVideoCandidate | null =
    (playInfoCandidate && playInfoEpId !== undefined
      ? playInfoCandidate
      : null) ??
    matchedByEpId ??
    matchedByCid ??
    matchedByTitle ??
    playInfoCandidate ??
    initialState?.epInfo ??
    playerInput ??
    initialState?.videoInfo ??
    null;
  const epId =
    typeof matched === "object" && matched !== null
      ? (matched.epId ?? matched.ep_id ?? matched.id ?? activeEpId ?? undefined)
      : undefined;
  const cid =
    typeof matched === "object" && matched !== null
      ? (matched.cid ?? activeCid ?? undefined)
      : undefined;

  if (!epId && (!matched?.bvid || cid === undefined)) {
    return null;
  }

  return {
    epId,
    bvid: matched.bvid,
    cid,
    title:
      (typeof matched === "object" &&
      matched !== null &&
      "title" in matched &&
      typeof matched.title === "string"
        ? matched.title
        : undefined) ||
      (typeof matched === "object" &&
      matched !== null &&
      "long_title" in matched &&
      typeof matched.long_title === "string"
        ? matched.long_title
        : undefined) ||
      activeTitle ||
      getPlayInfoTitle(playInfo) ||
      initialState?.epInfo?.title ||
      initialState?.epInfo?.long_title ||
      initialState?.videoInfo?.title,
  };
}

function readPlayInfoCandidate(
  playInfo: PagePlayInfo | undefined,
): PageVideoCandidate | null {
  const episodeInfo = playInfo?.result?.supplement?.ogv_episode_info;
  const businessEpisodeInfo =
    playInfo?.result?.supplement?.play_view_business_info?.episode_info;
  const arc = playInfo?.result?.arc;
  const epId =
    episodeInfo?.episode_id ?? episodeInfo?.ep_id ?? businessEpisodeInfo?.ep_id;
  const cid = arc?.cid ?? businessEpisodeInfo?.cid;

  if (!epId && (!arc?.bvid || cid === undefined)) {
    return null;
  }

  return {
    ep_id: epId,
    bvid: arc?.bvid,
    cid,
  };
}

function getPlayInfoTitle(
  playInfo: PagePlayInfo | undefined,
): string | undefined {
  const episodeInfo = playInfo?.result?.supplement?.ogv_episode_info;
  const parts = [episodeInfo?.index_title, episodeInfo?.long_title]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}
