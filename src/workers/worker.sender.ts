import { Worker, Job } from 'bullmq';
import { EmailEngine } from '../modules/email-engine';
import { PrismaClient } from '@prisma/client';
import { RealTimeEngine } from '../modules/realtime-engine';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined
};

console.log('Starting Email Sender Worker...');

// Initialize services
const prisma = new PrismaClient();
const emailEngine = new EmailEngine();
const realtimeEngine = new RealTimeEngine();

const senderWorker = new Worker('sendBulkEmails', async (job: Job) => {
  console.log(`[Email Worker] Starting job ${job.id}`);
  console.log(`[Email Worker] Job data:`, job.data);

  const { campaignId, userId, batchSize } = job.data;

  try {
    // Get campaign details
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        user: {
          include: {
            oauthCredentials: {
              where: { provider: 'gmail' }
            }
          }
        }
      }
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (!campaign.user.oauthCredentials.length) {
      throw new Error('Gmail not connected');
    }

    // Emit progress event
    await realtimeEngine.broadcastEmailBatchComplete(userId, {
      campaignId,
      status: 'starting',
      batchSize,
      jobId: job.id
    });

    // Send emails
    console.log(`[Email Worker] Starting email sending for campaign ${campaignId}`);
    const results = await emailEngine.sendBulkEmails(campaignId, batchSize);

    console.log(`[Email Worker] Email sending completed:`, results);

    // Emit completion event
    await realtimeEngine.broadcastEmailBatchComplete(userId, {
      campaignId,
      status: 'completed',
      batchSize,
      results,
      jobId: job.id
    });

    // Update campaign email count (if tracking)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayEmails = await prisma.email.count({
      where: {
        campaignId,
        sentAt: { gte: today }
      }
    });

    console.log(`[Email Worker] Campaign ${campaignId} has sent ${todayEmails} emails today`);

    console.log(`[Email Worker] Job ${job.id} completed successfully`);
    return results;

  } catch (error) {
    console.error(`[Email Worker] Job ${job.id} failed:`, error);

    // Emit failure event
    await realtimeEngine.broadcastToUser(userId, 'email_sending_failed', {
      campaignId,
      error: error.message,
      jobId: job.id
    });

    throw error;
  }
}, { 
  connection,
  concurrency: 1, // Process 1 email sending job at a time to respect rate limits
  maxStalledCount: 3,
  stalledInterval: 60000 // 60 seconds for email jobs
});

// Worker event handlers
senderWorker.on('completed', (job: Job) => {
  console.log(`[Email Worker] Job ${job.id} completed`);
});

senderWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Email Worker] Job ${job?.id} failed:`, err);
});

senderWorker.on('stalled', (jobId: string) => {
  console.warn(`[Email Worker] Job ${jobId} stalled`);
});

senderWorker.on('error', (error: Error) => {
  console.error('[Email Worker] Worker error:', error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Email Worker] Received SIGTERM, shutting down gracefully...');
  await senderWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Email Worker] Received SIGINT, shutting down gracefully...');
  await senderWorker.close();
  process.exit(0);
});

// Keep the process running
console.log('[Email Worker] Worker is ready and waiting for jobs...');
