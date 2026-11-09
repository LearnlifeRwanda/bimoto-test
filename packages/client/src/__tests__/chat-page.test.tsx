import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ChatPage } from '../pages/shared/ChatPage';
import { useAuthStore } from '../stores/auth.store';
import { useChatStore } from '../stores/chat.store';
import { i18n } from './setup';

// Stub useSocket so the test doesn't try to open a real connection.
vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    socket: null,
    isConnected: false,
    joinJourneyRoom: vi.fn(),
    leaveJourneyRoom: vi.fn(),
  }),
}));

const renderChatPage = () =>
  render(
    <MemoryRouter initialEntries={['/journey/j-1/chat']}>
      <Routes>
        <Route path="/journey/:id/chat" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ChatPage send path', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useAuthStore.setState({
      token: 'tok',
      user: {
        id: 'u-driver',
        nickname: 'D',
        role: 'DRIVER',
        language: 'en',
        idVerified: true,
        licenseVerified: true,
        completedRides: 0,
        cancellationCount: 0,
        totalRequests: 0,
      },
      isAuthenticated: true,
      isLoading: false,
    });
    useChatStore.setState({ messages: [], isLoading: false });
  });

  test('quick-message tap POSTs isQuickMessage=true with the catalog id', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'm-new',
            journeyId: 'j-1',
            senderId: 'u-driver',
            text: 'On my way',
            isQuickMessage: true,
            quickMessageId: 'qm_on_my_way',
            createdAt: new Date().toISOString(),
          }),
        } as Response;
      }
      // GET messages
      return { ok: true, json: async () => [] } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderChatPage();

    const button = await screen.findByRole('button', { name: 'On my way' });
    await userEvent.click(button);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body).toEqual({
        text: 'On my way',
        isQuickMessage: true,
        quickMessageId: 'qm_on_my_way',
      });
    });
  });

  test('free-text submit POSTs isQuickMessage=false and no quickMessageId', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'm-free',
            journeyId: 'j-1',
            senderId: 'u-driver',
            text: 'Behind the green gate',
            isQuickMessage: false,
            createdAt: new Date().toISOString(),
          }),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderChatPage();

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'Behind the green gate');
    const sendBtn = screen.getByRole('button', { name: 'Send' });
    await userEvent.click(sendBtn);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.text).toBe('Behind the green gate');
      expect(body.isQuickMessage).toBe(false);
      expect(body.quickMessageId).toBeUndefined();
    });
  });
});
