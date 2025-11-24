import { Worker, Job } from 'bullmq';
import { InboxMonitor } from '../modules/inbox-monitor';
import { AIEngine } from '../modules/ai-engine';
import { EmailEngine } from '../modules/email-engine';
import { PrismaClient } from '@prisma/client';
import { RealTimeEngine } from '../modules/realtime-engine';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined
};

console.log('Starting Reply Handler Worker...');

// Initialize services
const prisma = new PrismaClient();
const inboxMonitor = new InboxMonitor();
const aiEngine = new AIEngine();
const emailEngine = new EmailEngine();
const realtimeEngine = new RealTimeEngine();

const replyHandlerWorker = new Worker('reply-handler', async (job: Job) => {
  console.log(`[Reply Handler] Starting job ${job.id}`);
  console.log(`[Reply Handler] Job data:`, job.data);

  const { userId, oauthCredentials } = job.data;

  try {
    // Monitor inbox for replies
    console.log(`[Reply Handler] Monitoring inbox for user ${userId}`);
    const results = await inboxMonitor.monitorUserInbox(userId, oauthCredentials);

    console.log(`[Reply Handler] Inbox monitoring completed:`, results);

    // Process any new replies found
    if (results.newReplies > 0) {
      console.log(`[Reply Handler] Found ${results.newReplies} new replies`);

      // Get the replies that were just processed
      const newReplies = await prisma.reply.findMany({
        where: {
          userId,
          createdAt: {
            gte: new Date(Date.now() - 60000) // Last minute
          }
        },
        include: {
          lead: true,
          email: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Process each reply
      for (const reply of newReplies) {
        await processReply(userId, reply, oauthCredentials);
      }
    }

    console.log(`[Reply Handler] Job ${job.id} completed successfully`);
    return results;

  } catch (error) {
    console.error(`[Reply Handler] Job ${job.id} failed:`, error);
    throw error;
  }
}, { 
  connection,
  concurrency: 2, // Process 2 inbox monitoring jobs concurrently
  maxStalledCount: 3,
  stalledInterval: 30000
});

// Worker event handlers
replyHandlerWorker.on('completed', (job: Job) => {
  console.log(`[Reply Handler] Job ${job.id} completed`);
});

replyHandlerWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Reply Handler] Job ${job?.id} failed:`, err);
});

replyHandlerWorker.on('stalled', (jobId: string) => {
  console.warn(`[Reply Handler] Job ${jobId} stalled`);
});

replyHandlerWorker.on('error', (error: Error) => {
  console.error('[Reply Handler] Worker error:', error);
});

// Individual reply processing
async function processReply(userId: string, reply: any, oauthCredentials: any): Promise<void> {
  try {
    console.log(`[Reply Handler] Processing reply ${reply.id} from ${reply.lead.email}`);

    // The reply is already processed by the inbox monitor
    // This function handles additional processing like auto-responses

    const shouldAutoReply = reply.classification === 'INTERESTED' ||
                           reply.classification === 'QUESTION' ||
                           reply.classification === 'FOLLOW_UP';

    if (shouldAutoReply && !reply.autoReplySent) {
      console.log(`[Reply Handler] Sending auto-reply to ${reply.lead.email}`);

      // Get user and email details
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const originalEmail = reply.email;

      if (user && originalEmail) {
        // Generate auto-reply
        const replyContent = aiEngine.generateReply(reply.classification, {
          leadName: reply.lead.name,
          company: reply.lead.company,
          senderName: user.name,
          aiAnswer: 'I\'d be happy to provide more details about our services.',
          aiFollowUp: 'I wanted to follow up on my previous message.'
        });

        // Send auto-reply
        await emailEngine.sendEmail(
          reply.lead,
          {
            id: 'auto-reply',
            name: `${user.name} - Auto Reply`,
            userId,
            targetIndustry: reply.lead.company ? 'general' : null,
            targetLocation: reply.lead.location || null
          },
          {
            user: { email: user.email },
            refreshToken: oauthCredentials.refreshToken
          },
          replyContent
        );

        // Mark reply as having auto-reply sent
        await prisma.reply.update({
          where: { id: reply.id },
          data: { autoReplySent: true }
        });

        // Emit real-time event
        await realtimeEngine.broadcastAIReplySent(userId, {
          replyId: reply.id,
          emailId: reply.emailId,
          leadId: reply.leadId,
          classification: reply.classification
        });

        console.log(`[Reply Handler] Auto-reply sent successfully to ${reply.lead.email}`);
      }
    }

  } catch (error) {
    console.error(`[Reply Handler] Error processing reply ${reply.id}:`, error);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Reply Handler] Received SIGTERM, shutting down gracefully...');
  await replyHandlerWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Reply Handler] Received SIGINT, shutting down gracefully...');
  await replyHandlerWorker.close();
  process.exit(0);
});

// Keep the process running
console.log('[Reply Handler] Worker is ready and waiting for jobs...');
