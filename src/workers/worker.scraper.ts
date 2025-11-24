import { Worker, Job } from 'bullmq';
import { ScraperEngine } from '../modules/scraper-engine';
import { PrismaClient } from '@prisma/client';
import { RealTimeEngine } from '../modules/realtime-engine';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined
};

console.log('Starting Scraper Worker...');

// Initialize services
const prisma = new PrismaClient();
const scraperEngine = new ScraperEngine();
const realtimeEngine = new RealTimeEngine();

const scraperWorker = new Worker('scraper', async (job: Job) => {
  console.log(`[Scraper Worker] Starting job ${job.id}`);
  console.log(`[Scraper Worker] Job data:`, job.data);

  const { campaignId, userId, profile, historyId, dailyLimit } = job.data;

  try {
    // Update scrape history to running
    if (historyId) {
      await prisma.scrapeHistory.update({
        where: { id: historyId },
        data: { status: 'RUNNING' }
      });
    }

    // Emit start event
    await realtimeEngine.broadcastScrapingStarted(userId, {
      campaignId,
      historyId,
      jobId: job.id
    });

    // Run scraping
    console.log(`[Scraper Worker] Starting scraping for campaign ${campaignId}`);
    const results = await scraperEngine.scrapeProspects(profile, dailyLimit);

    console.log(`[Scraper Worker] Scraping completed:`, results);

    // Update scrape history
    if (historyId) {
      await prisma.scrapeHistory.update({
        where: { id: historyId },
        data: {
          status: results.errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
          totalFound: results.totalFound,
          validLeads: results.validLeads,
          duplicates: results.duplicates,
          errors: results.errors,
          completedAt: new Date()
        }
      });
    }

    // Update campaign
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { lastScrapedAt: new Date() }
    });

    // Emit completion event
    await realtimeEngine.broadcastScrapingFinished(userId, {
      campaignId,
      results,
      jobId: job.id
    });

    console.log(`[Scraper Worker] Job ${job.id} completed successfully`);
    return results;

  } catch (error) {
    console.error(`[Scraper Worker] Job ${job.id} failed:`, error);

    // Update scrape history to failed
    if (historyId) {
      await prisma.scrapeHistory.update({
        where: { id: historyId },
        data: {
          status: 'FAILED',
          errors: [error.message],
          completedAt: new Date()
        }
      });
    }

    // Emit failure event
    await realtimeEngine.broadcastToUser(userId, 'scraping_failed', {
      campaignId,
      error: error.message,
      jobId: job.id
    });

    throw error; // Re-throw to mark job as failed
  }
}, { 
  connection,
  concurrency: 2, // Process 2 scraping jobs concurrently
  maxStalledCount: 3,
  stalledInterval: 30000 // 30 seconds
});

// Worker event handlers
scraperWorker.on('completed', (job: Job) => {
  console.log(`[Scraper Worker] Job ${job.id} completed`);
});

scraperWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[Scraper Worker] Job ${job?.id} failed:`, err);
});

scraperWorker.on('stalled', (jobId: string) => {
  console.warn(`[Scraper Worker] Job ${jobId} stalled`);
});

scraperWorker.on('error', (error: Error) => {
  console.error('[Scraper Worker] Worker error:', error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Scraper Worker] Received SIGTERM, shutting down gracefully...');
  await scraperWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Scraper Worker] Received SIGINT, shutting down gracefully...');
  await scraperWorker.close();
  process.exit(0);
});

// Keep the process running
console.log('[Scraper Worker] Worker is ready and waiting for jobs...');
