import { Worker, Job } from 'bullmq';
import { SchedulerEngine } from '../modules/scheduler-engine';
import { PrismaClient } from '@prisma/client';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined
};

console.log('Starting Scheduler Worker...');

// Initialize services
const prisma = new PrismaClient();
const schedulerEngine = new SchedulerEngine();

const schedulerWorker = new Worker('scheduler', async (job: Job) => {
  console.log(`[Scheduler Worker] Starting job ${job.id}`);
  console.log(`[Scheduler Worker] Job data:`, job.data);

  const { action, campaignId, userId } = job.data;

  try {
    switch (action) {
      case 'manual_scraping':
        console.log(`[Scheduler Worker] Triggering manual scraping for campaign ${campaignId}`);
        await schedulerEngine.triggerManualScraping(campaignId);
        break;

      case 'manual_email_sending':
        console.log(`[Scheduler Worker] Triggering manual email sending for campaign ${campaignId}`);
        await schedulerEngine.triggerManualEmailSending(campaignId);
        break;

      case 'pause_campaign':
        console.log(`[Scheduler Worker] Pausing campaign ${campaignId}`);
        await schedulerEngine.pauseCampaign(campaignId);
        break;

      case 'resume_campaign':
        console.log(`[Scheduler Worker] Resuming campaign ${campaignId}`);
        await schedulerEngine.resumeCampaign(campaignId);
        break;

      case 'update_limit':
        console.log(`[Scheduler Worker] Updating campaign limit for campaign ${campaignId}`);
        await schedulerEngine.updateCampaignLimit(campaignId, job.data.newLimit);
        break;

      case 'daily_scrape':
        console.log('[Scheduler Worker] Running daily scraping');
        await schedulerEngine.runDailyScraping();
        break;

      case 'hourly_email':
        console.log('[Scheduler Worker] Running scheduled email sending');
        await schedulerEngine.runScheduledEmailSending();
        break;

      case 'inbox_monitor':
        console.log('[Scheduler Worker] Running inbox monitoring');
        await schedulerEngine.runInboxMonitoring();
        break;

      case 'metrics_calc':
        console.log('[Scheduler Worker] Calculating daily metrics');
        await schedulerEngine.calculateDailyMetrics();
        break;

      default:
        throw new Error(`Unknown scheduler action: ${action}`);
    }

    console.log(`[Scheduler Worker] Job ${job.id} completed successfully`);
    return { action, success: true };

  } catch (error) {
    console.error(`[Scheduler Worker] Job ${job.id} failed:`, error);
    throw error;
  }
}, { 
  connection,
  concurrency: 3, // Process multiple scheduler actions concurrently
  maxStalledCount: 3,
  stalledInterval: 30000
});

// Worker event handlers
schedulerWorker.on('completed', (job: Job) => {
  console.log(`[Scheduler Worker] Job ${job.id} completed`);
});

schedulerWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Scheduler Worker] Job ${job?.id} failed:`, err);
});

schedulerWorker.on('stalled', (jobId: string) => {
  console.warn(`[Scheduler Worker] Job ${jobId} stalled`);
});

schedulerWorker.on('error', (error: Error) => {
  console.error('[Scheduler Worker] Worker error:', error);
});

// Initialize the scheduler engine
schedulerEngine.initialize().catch(error => {
  console.error('[Scheduler Worker] Failed to initialize scheduler engine:', error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Scheduler Worker] Received SIGTERM, shutting down gracefully...');
  await schedulerWorker.close();
  await schedulerEngine.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Scheduler Worker] Received SIGINT, shutting down gracefully...');
  await schedulerWorker.close();
  await schedulerEngine.cleanup();
  process.exit(0);
});

// Keep the process running
console.log('[Scheduler Worker] Worker is ready and waiting for jobs...');
