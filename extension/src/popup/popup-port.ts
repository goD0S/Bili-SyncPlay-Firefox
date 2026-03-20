import type {
  BackgroundPopupState,
  BackgroundPopupStateMessage,
  BackgroundToPopupMessage,
} from "../shared/messages";

export async function queryPopupState(): Promise<BackgroundPopupState> {
  const response = (await chrome.runtime.sendMessage({
    type: "popup:get-state",
  })) as BackgroundToPopupMessage;
  if (response.type !== "background:state") {
    throw new Error("Unexpected popup state response");
  }
  return (response as BackgroundPopupStateMessage).payload;
}

export function connectPopupStatePort(args: {
  onState: (state: BackgroundPopupState) => void;
  onDisconnect?: () => void;
}): chrome.runtime.Port {
  const port = chrome.runtime.connect({ name: "popup-state" });
  port.onMessage.addListener((message: BackgroundToPopupMessage) => {
    if (message.type !== "background:state") {
      return;
    }
    args.onState(message.payload);
  });
  port.onDisconnect.addListener(() => {
    args.onDisconnect?.();
  });
  return port;
}
