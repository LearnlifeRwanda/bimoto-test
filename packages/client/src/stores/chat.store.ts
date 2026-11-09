import { create } from 'zustand';
import type { Message } from '@bimoto/shared';

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) =>
      state.messages.some((m) => m.id === message.id)
        ? state
        : { messages: [...state.messages, message] },
    ),
  setLoading: (isLoading) => set({ isLoading }),
}));
