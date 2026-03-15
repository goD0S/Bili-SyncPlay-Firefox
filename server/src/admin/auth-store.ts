import type { AdminSession } from "./types.js";

export type AuthStore = {
  save: (tokenId: string, session: AdminSession) => void;
  get: (tokenId: string) => AdminSession | null;
  delete: (tokenId: string) => void;
};

export function createInMemoryAuthStore(): AuthStore {
  const sessions = new Map<string, AdminSession>();

  return {
    save(tokenId, session) {
      sessions.set(tokenId, { ...session });
    },
    get(tokenId) {
      const session = sessions.get(tokenId);
      return session ? { ...session } : null;
    },
    delete(tokenId) {
      sessions.delete(tokenId);
    }
  };
}
