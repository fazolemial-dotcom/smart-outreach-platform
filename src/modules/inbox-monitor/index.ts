import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { AIEngine } from '../ai-engine';
import { RealTimeEngine } from '../realtime-engine';

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  isRead: boolean;
}

interface ReplyAnalysis {
  classification: any;
  confidence: number;
  intent: string;
  summary: string;
  shouldAutoReply: boolean;
}

export class InboxMonitor {
  private prisma: PrismaClient;
  private aiEngine: AIEngine;
  private realtime: RealTimeEngine;

  constructor() {
    this.prisma = new PrismaClient();
    this.aiEngine = new AIEngine();
    this.realtime = new RealTimeEngine(); // Will be injected in production
  }

  async monitorUserInbox(userId: string, oauthCredentials: any): Promise<{
    newReplies: number;
    processed: number;
    errors: string[];
  }> {
    const results = {
      newReplies: 0,
      processed: 0,
      errors: [] as string[]
    };

    try {
      // Initialize Gmail API client
      const gmail = await this.getGmailClient(oauthCredentials);
      
      // Search for unread messages in inbox
      const unreadMessages = await this.getUnreadMessages(gmail);
      
      console.log(`Found ${unreadMessages.length} unread messages for user ${userId}`);
      
      for (const message of unreadMessages) {
        try {
          // Check if this is a reply to one of our sent emails
          const relatedEmail = await this.findRelatedEmail(userId, message);
          
          if (relatedEmail) {
            await this.processReply(userId, message, relatedEmail, gmail);
            results.newReplies++;
          }
          
          results.processed++;
          
          // Mark message as read
          await this.markAsRead(gmail, message.id);
          
        } catch (error) {
          results.errors.push(`Error processing message ${message.id}: ${error.message}`);
          console.error(`Failed to process message ${message.id}:`, error);
        }
      }
      
    } catch (error) {
      results.errors.push(`Gmail monitoring failed: ${error.message}`);
      console.error('Gmail monitoring failed:', error);
    }

    return results;
  }

  private async getGmailClient(oauthCredentials: any) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    // Refresh access token if needed
    const accessToken = await this.refreshAccessToken(oauthCredentials);
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: oauthCredentials.refreshToken
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  private async getUnreadMessages(gmail: any): Promise<GmailMessage[]> {
    try {
      // Search for unread messages in inbox
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:inbox is:unread',
        maxResults: 50
      });

      const messages = response.data.messages || [];
      const detailedMessages: GmailMessage[] = [];

      for (const message of messages) {
        try {
          const messageDetail = await gmail.users.messages.get({
            userId: 'me',
            id: message.id
          });

          const gmailMessage = await this.parseGmailMessage(messageDetail.data);
          if (gmailMessage && this.isReplyMessage(gmailMessage)) {
            detailedMessages.push(gmailMessage);
          }

        } catch (error) {
          console.error(`Error fetching message ${message.id}:`, error);
        }
      }

      return detailedMessages;
      
    } catch (error) {
      console.error('Error getting unread messages:', error);
      return [];
    }
  }

  private async parseGmailMessage(messageData: any): Promise<GmailMessage | null> {
    try {
      const headers = messageData.payload.headers;
      const getHeader = (name: string) => {
        const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
        return header ? header.value : '';
      };

      const from = getHeader('From');
      const to = getHeader('To');
      const subject = getHeader('Subject');
      const date = getHeader('Date');
      const messageId = getHeader('Message-ID');

      // Extract body
      const body = await this.extractMessageBody(messageData.payload);

      return {
        id: messageData.id,
        threadId: messageData.threadId,
        from,
        to,
        subject,
        body,
        date: new Date(date),
        isRead: messageData.labelIds.includes('UNREAD')
      };

    } catch (error) {
      console.error('Error parsing Gmail message:', error);
      return null;
    }
  }

  private async extractMessageBody(payload: any): Promise<string> {
    try {
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }

      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
          if (part.mimeType === 'text/html' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
        }
      }

      return '';
      
    } catch (error) {
      console.error('Error extracting message body:', error);
      return '';
    }
  }

  private isReplyMessage(message: GmailMessage): boolean {
    // Check if this message is likely a reply
    const replyIndicators = [
      'Re:',
      're:',
      'Fwd:',
      'fwd:',
      message.subject.toLowerCase().includes('quick question'),
      message.subject.toLowerCase().includes('regarding'),
    ];

    return replyIndicators.some(indicator => 
      typeof indicator === 'string' 
        ? message.subject.includes(indicator)
        : indicator
    );
  }

  private async findRelatedEmail(userId: string, message: GmailMessage): Promise<any | null> {
    try {
      // Extract sender email
      const senderEmail = this.extractEmailFromAddress(message.from);
      
      if (!senderEmail) return null;

      // Look for emails sent to this sender
      const relatedEmail = await this.prisma.email.findFirst({
        where: {
          userId,
          lead: {
            email: senderEmail
          },
          status: 'SENT'
        },
        include: {
          lead: true,
          campaign: true
        },
        orderBy: {
          sentAt: 'desc'
        }
      });

      return relatedEmail;
      
    } catch (error) {
      console.error('Error finding related email:', error);
      return null;
    }
  }

  private extractEmailFromAddress(address: string): string | null {
    // Extract email from "Name <email@domain.com>" format
    const match = address.match(/<([^>]+)>/);
    if (match) {
      return match[1];
    }
    
    // If no angle brackets, try to find email directly
    const emailMatch = address.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return emailMatch ? emailMatch[0] : null;
  }

  private async processReply(userId: string, gmailMessage: GmailMessage, relatedEmail: any, gmail: any): Promise<void> {
    try {
      console.log(`Processing reply from ${gmailMessage.from} for email ${relatedEmail.id}`);
      
      // Clean and analyze the reply content
      const cleanedContent = this.cleanEmailContent(gmailMessage.body);
      
      // Use AI to classify and understand the reply
      const analysis = await this.analyzeReply(cleanedContent, relatedEmail);
      
      // Store the reply in database
      const reply = await this.prisma.reply.create({
        data: {
          emailId: relatedEmail.id,
          leadId: relatedEmail.leadId,
          userId,
          content: cleanedContent,
          classification: analysis.classification,
          confidence: analysis.confidence,
          intent: analysis.intent,
          aiSummary: analysis.summary,
          autoReplySent: false
        }
      });

      // Update lead status based on classification
      let newLeadStatus = 'CONTACTED';
      if (analysis.classification === 'INTERESTED') {
        newLeadStatus = 'REPLIED';
      } else if (analysis.classification === 'NOT_INTERESTED') {
        newLeadStatus = 'BLOCKED';
      }

      await this.prisma.lead.update({
        where: { id: relatedEmail.leadId },
        data: { status: newLeadStatus as any }
      });

      // Emit real-time event
      await this.realtime.broadcastReplyReceived(userId, {
        replyId: reply.id,
        emailId: relatedEmail.id,
        leadId: relatedEmail.leadId,
        leadName: relatedEmail.lead.name,
        leadEmail: relatedEmail.lead.email,
        classification: analysis.classification,
        confidence: analysis.confidence,
        summary: analysis.summary
      });

      // Auto-reply if appropriate
      if (analysis.shouldAutoReply && this.shouldSendAutoReply(analysis)) {
        await this.sendAutoReply(userId, relatedEmail, analysis, gmail);
        
        // Mark reply as having auto-reply sent
        await this.prisma.reply.update({
          where: { id: reply.id },
          data: { autoReplySent: true }
        });

        await this.realtime.broadcastAIReplySent(userId, {
          replyId: reply.id,
          emailId: relatedEmail.id,
          leadId: relatedEmail.leadId
        });
      }

    } catch (error) {
      console.error('Error processing reply:', error);
      throw error;
    }
  }

  private async analyzeReply(content: string, relatedEmail: any): Promise<ReplyAnalysis> {
    const aiResult = this.aiEngine.classifyReply(content);
    
    // Determine if we should auto-reply
    const shouldAutoReply = this.shouldAutoReply(aiResult.classification, aiResult.confidence);
    
    return {
      classification: aiResult.classification,
      confidence: aiResult.confidence,
      intent: aiResult.intent,
      summary: aiResult.summary,
      shouldAutoReply
    };
  }

  private shouldAutoReply(classification: any, confidence: number): boolean {
    // Auto-reply conditions
    const autoReplyConditions = [
      classification === 'INTERESTED' && confidence >= 0.7,
      classification === 'QUESTION' && confidence >= 0.6,
      classification === 'FOLLOW_UP' && confidence >= 0.6
    ];

    return autoReplyConditions.some(condition => condition);
  }

  private shouldSendAutoReply(analysis: ReplyAnalysis): boolean {
    // Additional checks before sending auto-reply
    if (analysis.classification === 'NOT_INTERESTED') {
      return false; // Don't auto-reply to rejections
    }
    
    if (analysis.classification === 'SPAM') {
      return false; // Don't auto-reply to spam
    }

    return true;
  }

  private async sendAutoReply(userId: string, relatedEmail: any, analysis: ReplyAnalysis, gmail: any): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) return;

      // Generate auto-reply using AI
      const replyContent = this.aiEngine.generateReply(analysis.classification, {
        leadName: relatedEmail.lead.name,
        company: relatedEmail.lead.company,
        senderName: user.name,
        aiAnswer: this.generateSpecificAnswer(analysis.intent),
        aiFollowUp: this.generateFollowUpContent(analysis)
      });

      // Send the auto-reply
      const senderEmail = this.extractEmailFromAddress(relatedEmail.lead.email) || relatedEmail.lead.email;
      
      const message = this.createEmailMessage({
        from: user.email,
        to: senderEmail,
        subject: `Re: ${relatedEmail.subject}`,
        body: replyContent
      });

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: message
        }
      });

      console.log(`Auto-reply sent to ${senderEmail}`);

    } catch (error) {
      console.error('Error sending auto-reply:', error);
      throw error;
    }
  }

  private generateSpecificAnswer(intent: string): string {
    const answers: Record<string, string> = {
      'request_info': 'I\'d be happy to provide more details about our services. We specialize in helping companies like yours streamline operations and drive growth through proven methodologies and cutting-edge technology solutions.',
      'express_interest': 'That\'s fantastic! I\'d love to schedule a call to discuss how we can specifically help your company achieve its goals. What works best for your schedule this week?',
      'ask_question': 'Great question! Let me break that down for you. Our solution is designed to address the specific challenges that companies in your industry face, and we\'ve seen tremendous success with similar organizations.'
    };

    return answers[intent] || 'I\'d be happy to provide more information about how we can help your company.';
  }

  private generateFollowUpContent(analysis: ReplyAnalysis): string {
    return `I wanted to follow up on my previous message about how we might be able to help ${analysis.summary}. I believe there's a good fit between what we offer and your current goals.`;
  }

  private cleanEmailContent(content: string): string {
    return content
      .replace(/On\s+.*wrote:/gis, '') // Remove "On ... wrote:" signatures
      .replace(/From:\s+.*$/gim, '') // Remove "From:" lines
      .replace(/^>.*$/gim, '') // Remove quoted text
      .replace(/\[.*?\]/g, '') // Remove content in brackets
      .replace(/\*.*?\*/g, '') // Remove bold text markers
      .replace(/_{3,}/g, '') // Remove horizontal rules
      .trim();
  }

  private async refreshAccessToken(oauthCredentials: any): Promise<string> {
    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: oauthCredentials.refreshToken
    });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      return credentials.access_token!;
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${error.message}`);
    }
  }

  private createEmailMessage(options: {
    from: string;
    to: string;
    subject: string;
    body: string;
  }): string {
    const lines = [
      `From: ${options.from}`,
      `To: ${options.to}`,
      `Subject: ${options.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      options.body
    ];

    return Buffer.from(lines.join('\r\n')).toString('base64');
  }

  private async markAsRead(gmail: any, messageId: string): Promise<void> {
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }

  // Continuous monitoring method
  async startContinuousMonitoring(): Promise<void> {
    console.log('Starting continuous inbox monitoring...');
    
    const checkInterval = 60000; // Check every minute
    
    const monitor = async () => {
      try {
        const users = await this.prisma.user.findMany({
          where: { gmailConnected: true },
          include: {
            oauthCredentials: {
              where: { provider: 'gmail' }
            }
          }
        });

        for (const user of users) {
          if (user.oauthCredentials.length > 0) {
            await this.monitorUserInbox(user.id, user.oauthCredentials[0]);
          }
        }

      } catch (error) {
        console.error('Error in continuous monitoring:', error);
      }

      // Schedule next check
      setTimeout(monitor, checkInterval);
    };

    // Start monitoring
    monitor();
  }

  // Manual trigger for specific user
  async triggerMonitoringForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        oauthCredentials: {
          where: { provider: 'gmail' }
        }
      }
    });

    if (!user || user.oauthCredentials.length === 0) {
      throw new Error('User not found or Gmail not connected');
    }

    const results = await this.monitorUserInbox(user.id, user.oauthCredentials[0]);
    console.log(`Monitoring results for user ${userId}:`, results);
    
    return results;
  }
}

// src/modules/inbox-monitor/poller.ts (separate polling logic)
export class InboxPoller {
  private monitor: InboxMonitor;
  private isRunning: boolean = false;
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    this.monitor = new InboxMonitor();
  }

  start(intervalMs: number = 60000): void {
    if (this.isRunning) {
      console.log('Inbox poller is already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting inbox poller with ${intervalMs}ms interval`);

    this.interval = setInterval(async () => {
      try {
        await this.monitor.startContinuousMonitoring();
      } catch (error) {
        console.error('Error in inbox polling:', error);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('Inbox poller stopped');
  }

  getStatus(): { running: boolean; interval: number | null } {
    return {
      running: this.isRunning,
      interval: this.interval ? (this.interval as any).idleTimeout || null : null
    };
  }
}

// src/modules/inbox-monitor/parser.ts (separate parsing logic)
export class EmailParser {
  static parseEmailAddress(address: string): { name?: string; email: string } {
    const match = address.match(/^(?:"?([^"]*)"?\s)?<([^>]+)>$/);
    if (match) {
      return {
        name: match[1] || undefined,
        email: match[2]
      };
    }
    
    return { email: address };
  }

  static extractReplies(content: string): string[] {
    // Split content into potential replies
    const parts = content.split(/\n\s*\n/);
    return parts.filter(part => part.trim().length > 0);
  }

  static removeQuotedText(content: string): string {
    return content
      .replace(/^>.*$/gm, '') // Remove lines starting with >
      .replace(/On\s+.*wrote:\s*$/gim, '') // Remove "On ... wrote:"
      .replace(/From:\s+.*$/gm, '') // Remove From lines
      .replace(/-+Original Message-+/gi, '') // Remove "Original Message" separators
      .trim();
  }

  static extractIntentKeywords(content: string): string[] {
    const intentPatterns = {
      interested: ['interested', 'sounds good', 'tell me more', 'yes'],
      not_interested: ['not interested', 'no thanks', 'not now', 'pass'],
      question: ['how', 'what', 'when', 'where', 'why', '?'],
      follow_up: ['following up', 'just checking', 'bump']
    };

    const found: string[] = [];
    const lowerContent = content.toLowerCase();

    for (const [intent, keywords] of Object.entries(intentPatterns)) {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        found.push(intent);
      }
    }

    return found;
  }
}
