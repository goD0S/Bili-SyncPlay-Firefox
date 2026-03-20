declare const chrome: any;

declare namespace chrome {
  namespace runtime {
    interface Port {
      onMessage: {
        addListener(listener: (...args: any[]) => void): void;
      };
      onDisconnect: {
        addListener(listener: (...args: any[]) => void): void;
      };
      postMessage(message: any): void;
      disconnect(): void;
      name: string;
    }

    interface MessageSender {
      tab?: chrome.tabs.Tab;
      url?: string;
      origin?: string;
      id?: string;
    }
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }
  }
}
