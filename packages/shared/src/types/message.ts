export interface Message {
  id: string;
  journeyId: string;
  senderId: string;
  text: string;
  isQuickMessage: boolean;
  quickMessageId?: string;
  createdAt: string;
}
