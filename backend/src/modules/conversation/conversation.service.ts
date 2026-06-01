import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, title: string) {
    return this.prisma.conversation.create({
      data: { userId, title },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async addMessage(conversationId: string, role: string, content: string, metadata?: object) {
    return this.prisma.message.create({
      data: { conversationId, role, content, metadata: metadata || {} },
    });
  }

  async delete(id: string) {
    return this.prisma.conversation.delete({ where: { id } });
  }
}
