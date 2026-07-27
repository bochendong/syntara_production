export type SlideRepairChatRole = 'user' | 'assistant';

export type SlideRepairChatStatus = 'ready' | 'pending' | 'error';

export interface SlideRepairChatMessage {
  id: string;
  role: SlideRepairChatRole;
  content: string;
  createdAt: number;
  status?: SlideRepairChatStatus;
}

export interface SlideRepairConversationTurn {
  role: SlideRepairChatRole;
  content: string;
}
