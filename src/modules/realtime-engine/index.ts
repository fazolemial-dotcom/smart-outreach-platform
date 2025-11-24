import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface SocketUser {
  userId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
}

interface RealtimeEvent {
  type: string;
  userId: string;
  data: any;
  timestamp: Date;
}

export class RealTimeEngine extends EventEmitter {
  private io: Server;
  private prisma: PrismaClient;
  private connectedUsers: Map<string, SocketUser> = new Map();
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds

  constructor(httpServer?: HttpServer) {
    super();
    this.prisma = new PrismaClient();
    
    if (httpServer) {
      this.initializeSocketServer(httpServer);
    }
  }

  private initializeSocketServer(httpServer: HttpServer): void {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || [
          'http://localhost:3000',
          'http://127.0.0.1:3000'
        ],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // Handle authentication
      socket.on('authenticate', async (data: { userId: string; token?: string }) => {
        try {
          const { userId } = data;
          
          // Validate user exists
          const user = await this.prisma.user.findUnique({
            where: { id: userId }
          });

          if (!user) {
            socket.emit('auth_error', { message: 'Invalid user' });
            return;
          }

          // Store user connection
          const socketUser: SocketUser = {
            userId,
            socketId: socket.id,
            connectedAt: new Date(),
            lastActivity: new Date()
          };

          this.connectedUsers.set(socket.id, socketUser);
          
          // Add socket to user's socket set
          if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
          }
          this.userSockets.get(userId)!.add(socket.id);

          // Join user-specific room
          socket.join(`user:${userId}`);

          // Send authentication success
          socket.emit('authenticated', { 
            userId, 
            socketId: socket.id,
            connected: true 
          });

          // Send initial dashboard data
          await this.sendDashboardData(userId, socket);

          // Emit user online event
          this.emit('user_online', { userId, socketId: socket.id });

          console.log(`User ${userId} authenticated on socket ${socket.id}`);

        } catch (error) {
          console.error('Authentication error:', error);
          socket.emit('auth_error', { message: 'Authentication failed' });
        }
      });

      // Handle campaign updates
      socket.on('campaign_update', async (data) => {
        await this.handleCampaignUpdate(socket, data);
      });

      // Handle manual triggers
      socket.on('trigger_scraping', async (data: { campaignId: string }) => {
        await this.triggerScraping(socket, data.campaignId);
      });

      socket.on('trigger_email_sending', async (data: { campaignId: string }) => {
        await this.triggerEmailSending(socket, data.campaignId);
      });

      socket.on('pause_campaign', async (data: { campaignId: string }) => {
        await this.pauseCampaign(socket, data.campaignId);
      });

      socket.on('resume_campaign', async (data: { campaignId: string }) => {
        await this.resumeCampaign(socket, data.campaignId);
      });

      // Handle chat events
      socket.on('chat_message', async (data) => {
        await this.handleChatMessage(socket, data);
      });

      // Handle typing indicators
      socket.on('typing_start', (data) => {
        this.handleTypingStart(socket, data);
      });

      socket.on('typing_stop', (data) => {
        this.handleTypingStop(socket, data);
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong');
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.handleDisconnection(socket, reason);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error('Socket error:', error);
      });
    });

    // Handle connection events
    this.io.engine.on('connection_error', (err) => {
      console.error('Connection error:', err);
    });
  }

  // Public broadcasting methods
  async broadcastScrapingStarted(userId: string, data: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'scraping_started',
      userId,
      data: {
        ...data,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('scraping_started', event.data);
    this.emit('scraping_started', event);
  }

  async broadcastScrapingFinished(userId: string, data: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'scraping_finished',
      userId,
      data: {
        ...data,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('scraping_finished', event.data);
    this.emit('scraping_finished', event);
  }

  async broadcastEmailSent(userId: string, data: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'email_sent',
      userId,
      data: {
        ...data,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('email_sent', event.data);
    this.emit('email_sent', event);
  }

  async broadcastEmailBatchComplete(userId: string, data: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'email_batch_complete',
      userId,
      data: {
        ...data,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('email_batch_complete', event.data);
    this.emit('email_batch_complete', event);
  }

  async broadcastReplyReceived(userId: string, data: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'reply_received',
      userId,
      data: {
        ...data,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('reply_received', event.data);
    this.emit('reply_received', event);
  }

  async broadcastAIReplySent(userId: string, data: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'ai_reply_sent',
      userId,
      data: {
        ...data,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('ai_reply_sent', event.data);
    this.emit('ai_reply_sent', event);
  }

  async broadcastGmailConnectionStatus(userId: string, connected: boolean, email?: string): Promise<void> {
    const event: RealtimeEvent = {
      type: 'gmail_connection_status',
      userId,
      data: {
        connected,
        email,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('gmail_connection_status', event.data);
    this.emit('gmail_connection_status', event);
  }

  async broadcastMetricsUpdate(userId: string, metrics: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'metrics_update',
      userId,
      data: {
        metrics,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('metrics_update', event.data);
    this.emit('metrics_update', event);
  }

  async broadcastCampaignStatusChange(userId: string, campaignId: string, status: string): Promise<void> {
    const event: RealtimeEvent = {
      type: 'campaign_status_change',
      userId,
      data: {
        campaignId,
        status,
        timestamp: new Date()
      },
      timestamp: new Date()
    };

    this.io.to(`user:${userId}`).emit('campaign_status_change', event.data);
    this.emit('campaign_status_change', event);
  }

  // Event handlers
  private async handleCampaignUpdate(socket: any, data: any): Promise<void> {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    // Validate campaign ownership
    const campaign = await this.prisma.campaign.findFirst({
      where: { 
        id: data.campaignId, 
        userId: socketUser.userId 
      }
    });

    if (!campaign) {
      socket.emit('error', { message: 'Campaign not found or access denied' });
      return;
    }

    // Update campaign
    const updatedCampaign = await this.prisma.campaign.update({
      where: { id: data.campaignId },
      data: data.updates
    });

    // Broadcast update to all user's devices
    this.io.to(`user:${socketUser.userId}`).emit('campaign_updated', {
      campaign: updatedCampaign,
      timestamp: new Date()
    });
  }

  private async triggerScraping(socket: any, campaignId: string): Promise<void> {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    // Validate campaign ownership
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, userId: socketUser.userId }
    });

    if (!campaign) {
      socket.emit('error', { message: 'Campaign not found or access denied' });
      return;
    }

    // Emit immediate feedback
    socket.emit('scraping_triggered', { 
      campaignId, 
      timestamp: new Date() 
    });

    // In production, this would queue a background job
    this.emit('manual_scraping_requested', {
      userId: socketUser.userId,
      campaignId,
      socketId: socket.id
    });
  }

  private async triggerEmailSending(socket: any, campaignId: string): Promise<void> {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    // Validate campaign ownership and Gmail connection
    const [campaign, user] = await Promise.all([
      this.prisma.campaign.findFirst({ 
        where: { id: campaignId, userId: socketUser.userId } 
      }),
      this.prisma.user.findUnique({ 
        where: { id: socketUser.userId } 
      })
    ]);

    if (!campaign) {
      socket.emit('error', { message: 'Campaign not found or access denied' });
      return;
    }

    if (!user?.gmailConnected) {
      socket.emit('error', { message: 'Gmail not connected' });
      return;
    }

    // Emit immediate feedback
    socket.emit('email_sending_triggered', { 
      campaignId, 
      timestamp: new Date() 
    });

    // In production, this would queue a background job
    this.emit('manual_email_sending_requested', {
      userId: socketUser.userId,
      campaignId,
      socketId: socket.id
    });
  }

  private async pauseCampaign(socket: any, campaignId: string): Promise<void> {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PAUSED' }
    });

    socket.emit('campaign_paused', { 
      campaignId, 
      timestamp: new Date() 
    });

    await this.broadcastCampaignStatusChange(socketUser.userId, campaignId, 'PAUSED');
  }

  private async resumeCampaign(socket: any, campaignId: string): Promise<void> {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE' }
    });

    socket.emit('campaign_resumed', { 
      campaignId, 
      timestamp: new Date() 
    });

    await this.broadcastCampaignStatusChange(socketUser.userId, campaignId, 'ACTIVE');
  }

  private async handleChatMessage(socket: any, data: any): Promise<void> {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    // Handle chat message events
    this.emit('chat_message', {
      userId: socketUser.userId,
      socketId: socket.id,
      message: data
    });
  }

  private handleTypingStart(socket: any, data: any): void {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    socket.broadcast.to(`user:${socketUser.userId}`).emit('user_typing_start', {
      userId: socketUser.userId,
      socketId: socket.id,
      timestamp: new Date()
    });
  }

  private handleTypingStop(socket: any, data: any): void {
    const socketUser = this.connectedUsers.get(socket.id);
    if (!socketUser) return;

    socket.broadcast.to(`user:${socketUser.userId}`).emit('user_typing_stop', {
      userId: socketUser.userId,
      socketId: socket.id,
      timestamp: new Date()
    });
  }

  private handleDisconnection(socket: any, reason: string): void {
    const socketUser = this.connectedUsers.get(socket.id);
    
    if (socketUser) {
      // Remove from connected users
      this.connectedUsers.delete(socket.id);
      
      // Remove from user sockets
      const userSocketSet = this.userSockets.get(socketUser.userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          this.userSockets.delete(socketUser.userId);
          
          // Emit user offline event
          this.emit('user_offline', { 
            userId: socketUser.userId, 
            socketId: socket.id,
            reason 
          });
        }
      }

      console.log(`User ${socketUser.userId} disconnected (${reason})`);
    }

    console.log('Client disconnected:', socket.id, reason);
  }

  // Utility methods
  private async sendDashboardData(userId: string, socket?: any): Promise<void> {
    try {
      const [metrics, activeCampaigns, recentActivity] = await Promise.all([
        this.getLatestMetrics(userId),
        this.getActiveCampaigns(userId),
        this.getRecentActivity(userId)
      ]);

      const dashboardData = {
        metrics,
        activeCampaigns,
        recentActivity,
        timestamp: new Date()
      };

      if (socket) {
        socket.emit('dashboard_data', dashboardData);
      } else {
        this.io.to(`user:${userId}`).emit('dashboard_data', dashboardData);
      }

    } catch (error) {
      console.error('Failed to send dashboard data:', error);
      if (socket) {
        socket.emit('error', { message: 'Failed to load dashboard data' });
      }
    }
  }

  private async getLatestMetrics(userId: string): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [emailsSent, leadsScrapped, repliesReceived] = await Promise.all([
      this.prisma.email.count({
        where: {
          userId,
          sentAt: { gte: today }
        }
      }),
      this.prisma.lead.count({
        where: {
          campaign: { userId },
          scrapedAt: { gte: today }
        }
      }),
      this.prisma.reply.count({
        where: {
          userId,
          createdAt: { gte: today }
        }
      })
    ]);

    return {
      emailsSent,
      leadsScrapped,
      repliesReceived,
      successRate: emailsSent > 0 ? ((repliesReceived / emailsSent) * 100).toFixed(1) : '0'
    };
  }

  private async getActiveCampaigns(userId: string): Promise<any[]> {
    return await this.prisma.campaign.findMany({
      where: {
        userId,
        status: 'ACTIVE'
      },
      include: {
        _count: {
          select: {
            leads: true,
            emails: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 5
    });
  }

  private async getRecentActivity(userId: string): Promise<any[]> {
    const activities = await this.prisma.email.findMany({
      where: { userId },
      include: {
        lead: true,
        campaign: true
      },
      orderBy: { sentAt: 'desc' },
      take: 10
    });

    return activities.map(email => ({
      type: 'email_sent',
      description: `Email sent to ${email.lead.name || email.lead.email}`,
      campaign: email.campaign.name,
      timestamp: email.sentAt,
      status: email.status
    }));
  }

  // Public utility methods
  getConnectedUsers(): SocketUser[] {
    return Array.from(this.connectedUsers.values());
  }

  getUserConnectionCount(userId: string): number {
    return this.userSockets.get(userId)?.size || 0;
  }

  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.size > 0;
  }

  async broadcastToUser(userId: string, event: string, data: any): Promise<void> {
    this.io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  async broadcastToAll(event: string, data: any): Promise<void> {
    this.io.emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  // Cleanup method
  async shutdown(): Promise<void> {
    // Close all connections
    this.io.close();
    
    // Clear all data
    this.connectedUsers.clear();
    this.userSockets.clear();
    
    console.log('Real-time engine shutdown completed');
  }
}
