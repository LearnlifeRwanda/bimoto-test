import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from '../components/chat/ChatBubble';
import { i18n } from './setup';
import type { Message } from '@bimoto/shared';

const baseQuickMessage: Message = {
  id: 'm1',
  journeyId: 'j1',
  senderId: 'driver-1',
  text: 'Ndaje',
  isQuickMessage: true,
  quickMessageId: 'qm_on_my_way',
  createdAt: '2026-04-27T10:00:00.000Z',
};

describe('ChatBubble cross-locale rendering', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('renders the receiver locale (EN) regardless of the stored text', async () => {
    await i18n.changeLanguage('en');
    render(<ChatBubble message={baseQuickMessage} isMine={false} />);
    expect(screen.getByText('On my way')).toBeInTheDocument();
    expect(screen.queryByText('Ndaje')).not.toBeInTheDocument();
  });

  test('renders the receiver locale (RW) regardless of the stored text', async () => {
    await i18n.changeLanguage('rw');
    render(
      <ChatBubble
        message={{ ...baseQuickMessage, text: 'On my way' }}
        isMine={false}
      />,
    );
    expect(screen.getByText('Ndaje')).toBeInTheDocument();
    expect(screen.queryByText('On my way')).not.toBeInTheDocument();
  });

  test('renders the receiver locale (FR)', async () => {
    await i18n.changeLanguage('fr');
    render(<ChatBubble message={baseQuickMessage} isMine={false} />);
    expect(screen.getByText("J'arrive")).toBeInTheDocument();
  });

  test('falls back to message.text when quickMessageId is unknown (catalog drift)', async () => {
    await i18n.changeLanguage('en');
    render(
      <ChatBubble
        message={{ ...baseQuickMessage, quickMessageId: 'qm_unknown_id' }}
        isMine={false}
      />,
    );
    // Historical text persists rather than blanking the bubble
    expect(screen.getByText('Ndaje')).toBeInTheDocument();
  });

  test('renders message.text verbatim for free-text messages', async () => {
    await i18n.changeLanguage('en');
    const freeText: Message = {
      id: 'm2',
      journeyId: 'j1',
      senderId: 'customer-1',
      text: 'Behind the green gate',
      isQuickMessage: false,
      createdAt: '2026-04-27T10:01:00.000Z',
    };
    render(<ChatBubble message={freeText} isMine={true} />);
    expect(screen.getByText('Behind the green gate')).toBeInTheDocument();
  });
});
