import type { RedirectRecord } from '../types/redirect';

export interface MessageMap {
  'redirect-inspector:get-log': {
    request: Record<string, never>;
    response: {
      log: RedirectRecord[];
      pending: RedirectRecord[];
      error?: string;
    };
  };
  'redirect-inspector:clear-log': {
    request: Record<string, never>;
    response: {
      success: boolean;
      error?: string;
    };
  };
  'redirect-inspector:open-side-panel': {
    request: Record<string, never>;
    response: undefined;
  };
}

export type MessageType = keyof MessageMap;

export interface Message<T extends MessageType = MessageType> {
  type: T;
  payload?: MessageMap[T]['request'];
}

export type MessageResponse<T extends MessageType> = MessageMap[T]['response'];
