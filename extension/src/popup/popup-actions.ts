import { normalizeBilibiliUrl } from "@bili-syncplay/protocol";
import type { BackgroundToPopupMessage } from "../shared/messages";
import { getUiLanguage, t } from "../shared/i18n";
import { parseInviteValue } from "./helpers";
import { formatInviteDraft } from "./popup-render";
import {
  syncServerUrlDraft,
  updateServerUrlDraft,
  type ServerUrlDraftState,
} from "./server-url-draft";
import type { PopupRefs } from "./popup-view";

export function bindPopupActions(args: {
  refs: PopupRefs;
  leaveGuardMs: number;
  serverUrlDraft: ServerUrlDraftState;
  queryState: () => Promise<BackgroundToPopupMessage["payload"]>;
  applyActionState: (state: BackgroundToPopupMessage["payload"]) => void;
  render: () => void;
  sendPopupLog: (message: string) => Promise<void>;
  getRoomActionPending: () => boolean;
  setRoomActionPending: (pending: boolean) => void;
  applyRoomActionControlState: (refs: PopupRefs) => void;
  setRoomCodeDraft: (value: string) => void;
  getLocalStatusMessage: () => string | null;
  setLocalStatusMessage: (message: string | null) => void;
  getLastKnownRoomCode: () => string | null;
  getLastRoomEnteredAt: () => number;
  getPopupState: () => BackgroundToPopupMessage["payload"] | null;
}): void {
  const { refs } = args;

  refs.joinRoomButton.addEventListener("pointerdown", () => {
    void args.sendPopupLog(
      `Join button pointerdown disabled=${refs.joinRoomButton.disabled} pending=${args.getRoomActionPending()} inputDisabled=${refs.roomCodeInput.disabled}`,
    );
  });

  refs.leaveRoomButton.addEventListener("pointerdown", () => {
    void args.sendPopupLog(
      `Leave button pointerdown disabled=${refs.leaveRoomButton.disabled} pending=${args.getRoomActionPending()} room=${args.getLastKnownRoomCode() ?? "none"}`,
    );
  });

  refs.createRoomButton.addEventListener("click", async () => {
    if (args.getRoomActionPending()) {
      void args.sendPopupLog(
        "Create room click ignored because room action is pending",
      );
      return;
    }
    void args.sendPopupLog("Create room button clicked");
    args.setLocalStatusMessage(null);
    args.setRoomActionPending(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "popup:create-room",
      })) as BackgroundToPopupMessage;
      args.applyActionState(response.payload);
      void args.sendPopupLog("Create room message resolved");
      args.setRoomActionPending(false);
    } finally {
      if (args.getRoomActionPending()) {
        args.setRoomActionPending(false);
      }
    }
  });

  refs.joinRoomButton.addEventListener("click", async () => {
    await joinRoom({
      inviteText: refs.roomCodeInput.value.trim(),
      reasonLabel: "Join button clicked",
      resolvedLabel: "Join message resolved",
      invalidLabel: "Join click ignored because invite string is invalid",
      pendingLabel: "Join click ignored because room action is pending",
    });
  });

  refs.leaveRoomButton.addEventListener("click", async () => {
    if (args.getRoomActionPending()) {
      void args.sendPopupLog(
        "Leave click ignored because room action is pending",
      );
      return;
    }
    if (Date.now() - args.getLastRoomEnteredAt() < args.leaveGuardMs) {
      void args.sendPopupLog(
        `Leave click ignored by recent-join guard ${Date.now() - args.getLastRoomEnteredAt()}ms`,
      );
      return;
    }
    void args.sendPopupLog("Leave room button clicked");
    args.setLocalStatusMessage(null);
    args.setRoomCodeDraft(
      formatInviteDraft(
        args.getLastKnownRoomCode(),
        args.getPopupState()?.joinToken ?? null,
      ),
    );
    args.setRoomActionPending(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "popup:leave-room",
      })) as BackgroundToPopupMessage;
      args.applyActionState(response.payload);
      void args.sendPopupLog("Leave room message resolved");
      args.setRoomActionPending(false);
    } finally {
      if (args.getRoomActionPending()) {
        args.setRoomActionPending(false);
      }
    }
  });

  refs.copyRoomButton.addEventListener("click", async () => {
    const roomCode = refs.roomStatus.textContent?.trim();
    const state = await args.queryState();
    if (!roomCode || roomCode === "-" || !state.joinToken) {
      return;
    }

    await navigator.clipboard.writeText(`${roomCode}:${state.joinToken}`);
    toggleCopySuccess(refs.copyRoomButton);
  });

  refs.copyLogsButton.addEventListener("click", async () => {
    const state = await args.queryState();
    const text = state.logs
      .slice()
      .reverse()
      .map((entry) => {
        const time = new Date(entry.at).toLocaleTimeString(getUiLanguage(), {
          hour12: false,
        });
        return `[${time}] [${entry.scope}] ${entry.message}`;
      })
      .join("\n");

    await navigator.clipboard.writeText(text || t("stateNoLogs"));
    toggleCopySuccess(refs.copyLogsButton);
  });

  refs.shareCurrentVideoButton.addEventListener("click", () => {
    void handleShareCurrentVideo();
  });

  refs.sharedVideoCard.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "popup:open-shared-video" });
    window.close();
  });

  refs.roomCodeInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    await joinRoom({
      inviteText: refs.roomCodeInput.value.trim(),
      reasonLabel: "Join by Enter",
      resolvedLabel: "Join by Enter resolved",
      invalidLabel: "Join by Enter ignored because invite string is invalid",
      pendingLabel: "Join by Enter ignored because room action is pending",
      event,
    });
  });

  refs.roomCodeInput.addEventListener("input", () => {
    args.applyRoomActionControlState(refs);
    const inviteText = refs.roomCodeInput.value.trim();
    const invite = parseInviteValue(inviteText);
    args.setRoomCodeDraft(
      invite ? `${invite.roomCode}:${invite.joinToken}` : inviteText,
    );
    if (args.getLocalStatusMessage()) {
      args.setLocalStatusMessage(null);
    }
    if (invite) {
      void args.sendPopupLog(`Invite input changed room=${invite.roomCode}`);
    }
  });

  const saveServerUrl = async () => {
    args.setLocalStatusMessage(null);
    const requestedServerUrl = args.serverUrlDraft.value.trim();
    const response = (await chrome.runtime.sendMessage({
      type: "popup:set-server-url",
      serverUrl: requestedServerUrl,
    })) as BackgroundToPopupMessage;
    args.applyActionState(response.payload);
    syncServerUrlDraft(args.serverUrlDraft, response.payload.serverUrl);
    refs.serverUrlInput.value = response.payload.serverUrl;
    args.render();
  };

  refs.saveServerUrlButton.addEventListener("click", () => {
    void saveServerUrl();
  });

  refs.serverUrlInput.addEventListener("input", () => {
    updateServerUrlDraft(
      args.serverUrlDraft,
      refs.serverUrlInput.value,
      args.getPopupState()?.serverUrl ?? "",
    );
    if (args.getLocalStatusMessage()) {
      args.setLocalStatusMessage(null);
    }
  });

  refs.serverUrlInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    await saveServerUrl();
  });

  async function handleShareCurrentVideo(): Promise<void> {
    const state = args.getPopupState() ?? (await args.queryState());
    const activeVideo = await chrome.runtime.sendMessage({
      type: "popup:get-active-video",
    });
    if (!activeVideo?.ok || !activeVideo.payload?.video) {
      if (args.getPopupState()) {
        args.render();
      }
      return;
    }

    const currentVideo = activeVideo.payload.video as {
      title: string;
      url: string;
    };
    if (!state.roomCode) {
      const shouldCreateRoom = window.confirm(
        t("confirmCreateRoomBeforeShare"),
      );
      if (!shouldCreateRoom) {
        return;
      }
    } else if (
      state.roomState?.sharedVideo?.url &&
      normalizeUrl(state.roomState.sharedVideo.url) !==
        normalizeUrl(currentVideo.url)
    ) {
      const shouldReplace = window.confirm(
        t("confirmReplaceSharedVideo", {
          currentTitle: state.roomState.sharedVideo.title,
          nextTitle: currentVideo.title,
        }),
      );
      if (!shouldReplace) {
        return;
      }
    }

    await chrome.runtime.sendMessage({ type: "popup:share-current-video" });
    if (args.getPopupState()) {
      args.render();
    }
  }

  async function joinRoom(args2: {
    inviteText: string;
    reasonLabel: string;
    resolvedLabel: string;
    invalidLabel: string;
    pendingLabel: string;
    event?: KeyboardEvent;
  }): Promise<void> {
    if (args2.event) {
      if (args2.event.key !== "Enter") {
        return;
      }
      if (args.getRoomActionPending()) {
        void args.sendPopupLog(args2.pendingLabel);
        return;
      }
    } else if (args.getRoomActionPending()) {
      void args.sendPopupLog(args2.pendingLabel);
      return;
    }

    const invite = parseInviteValue(args2.inviteText);
    if (!invite) {
      args.setLocalStatusMessage(t("errorInvalidInviteFormat"));
      void args.sendPopupLog(args2.invalidLabel);
      return;
    }
    args.setLocalStatusMessage(null);
    args.setRoomCodeDraft(`${invite.roomCode}:${invite.joinToken}`);
    void args.sendPopupLog(`${args2.reasonLabel} room=${invite.roomCode}`);
    args.setRoomActionPending(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "popup:join-room",
        roomCode: invite.roomCode,
        joinToken: invite.joinToken,
      })) as BackgroundToPopupMessage;
      args.applyActionState(response.payload);
      void args.sendPopupLog(`${args2.resolvedLabel} room=${invite.roomCode}`);
      args.setRoomActionPending(false);
    } finally {
      if (args.getRoomActionPending()) {
        args.setRoomActionPending(false);
      }
    }
  }
}

const copyResetTimers = new WeakMap<HTMLButtonElement, number>();

function toggleCopySuccess(button: HTMLButtonElement): void {
  button.classList.add("success-button");
  const previousTimer = copyResetTimers.get(button);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }
  const timer = window.setTimeout(() => {
    copyResetTimers.delete(button);
    button.classList.remove("success-button");
  }, 1400);
  copyResetTimers.set(button, timer);
}

function normalizeUrl(url: string | null | undefined): string | null {
  return normalizeBilibiliUrl(url);
}
