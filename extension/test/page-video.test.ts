import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFestivalShareUrl,
  createSharePayload,
  resolvePageSharedVideo,
  resolveSharedVideoTitle,
} from "../src/content/page-video";

test("resolves standard page video and prefers current part title", () => {
  const video = resolvePageSharedVideo({
    pageUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    pathname: "/video/BV1xx411c7mD",
    documentTitle: "Doc Title_哔哩哔哩",
    headingTitle: "Heading Title",
    currentPartTitle: "P2 Title",
    festivalSnapshot: null,
  });

  assert.deepEqual(video, {
    videoId: "BV1xx411c7mD:p2",
    url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    title: "P2 Title",
  });
});

test("resolves festival snapshot ahead of URL fallback", () => {
  const video = resolvePageSharedVideo({
    pageUrl: "https://www.bilibili.com/festival/demo",
    pathname: "/festival/demo",
    documentTitle: "Festival",
    headingTitle: null,
    currentPartTitle: null,
    festivalSnapshot: {
      videoId: "BVfestival:123",
      url: "https://www.bilibili.com/festival/demo?bvid=BVfestival&cid=123",
      title: "Festival Episode",
    },
  });

  assert.deepEqual(video, {
    videoId: "BVfestival:123",
    url: "https://www.bilibili.com/festival/demo?bvid=BVfestival&cid=123",
    title: "Festival Episode",
  });
});

test("builds share payload from video playback snapshot", () => {
  const payload = createSharePayload({
    sharedVideo: {
      videoId: "BV1xx411c7mD",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      title: "Video",
    },
    playback: {
      currentTime: 42,
      playbackRate: 1.25,
      playState: "playing",
    },
    actorId: "member-1",
    seq: 7,
    now: 99,
  });

  assert.equal(payload.playback?.seq, 7);
  assert.equal(payload.playback?.currentTime, 42);
  assert.equal(payload.playback?.actorId, "member-1");
});

test("falls back through title sources in order", () => {
  assert.equal(
    resolveSharedVideoTitle({
      currentPartTitle: null,
      headingTitle: "Heading",
      documentTitle: "Doc_哔哩哔哩",
    }),
    "Heading",
  );
  assert.equal(
    resolveSharedVideoTitle({
      currentPartTitle: null,
      headingTitle: null,
      documentTitle: "Doc_哔哩哔哩",
    }),
    "Doc",
  );
});

test("builds festival share URL with bvid and cid", () => {
  assert.equal(
    buildFestivalShareUrl(
      "https://www.bilibili.com/festival/demo?foo=1#hash",
      "BV1abc",
      "22",
    ),
    "https://www.bilibili.com/festival/demo?foo=1&bvid=BV1abc&cid=22",
  );
});
