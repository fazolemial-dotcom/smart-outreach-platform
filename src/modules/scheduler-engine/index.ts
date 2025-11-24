import cron, { ScheduledTask } from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { ScraperEngine } from '../scraper-engine';
import { EmailEngine } from '../email-engine';
import { RealTimeEngine } from '../realtime-engine';
import { Queue } from 'bullmq';

interface SchedulerConfig {
  scrapingTime: string; // Cron expression for daily scraping
  emailSendingInterval: string; // Cron expression for email sending
  inboxMonitoringInterval: string; // Cron expression for inbox monitoring
  metricsCalculationTime: string; // Cron expression for daily metrics
}

export class SchedulerEngine {
  private prisma: PrismaClient;
  private scraper: ScraperEngine;
  private emailEngine: EmailEngine;
  private realtime: RealTimeEngine;
  private tasks: Map<string, ScheduledTask> = new Map();
  private redisQueue: Queue;

  constructor() {
    this.prisma = new PrismaClient();
    this.scraper = new ScraperEngine();
    this.emailEngine = new EmailEngine();
    
    // Initialize Redis queue for background jobs
    this.redisQueue = new Queue('outreach-jobs', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    });

    // Initialize real-time engine (will be injected in production)
    this.realtime = new RealTimeEngine(); // Placeholder
  }

  async initialize(): Promise<void> {
    console.log('Initializing Scheduler Engine...');
    
    const config: SchedulerConfig = {
      scrapingTime: '0 9 * * *', // 9 AM every day
      emailSendingInterval: '0 * * * *', // Every hour
      inboxMonitoringInterval: '* * * * *', // Every minute
      metricsCalculationTime: '0 0 * * *' // Midnight every day
    };

    try {
      // Schedule all tasks
      this.scheduleDailyScraping(config.scrapingTime);
      this.scheduleEmailSending(config.emailSendingInterval);
      this.scheduleInboxMonitoring(config.inboxMonitoringInterval);
      this.scheduleMetricsCalculation(config.metricsCalculationTime);
      
      console.log('Scheduler Engine initialized successfully');
      
      // Start any paused campaigns
      await this.resumePausedCampaigns();
      
    } catch (error) {
      console.error('Failed to initialize Scheduler Engine:', error);
      throw error;
    }
  }

  private scheduleDailyScraping(cronExpression: string): void {
    const task = cron.schedule(cronExpression, async () => {
      console.log('Starting scheduled daily scraping...');
      
      try {
        await this.runDailyScraping();
      } catch (error) {
        console.error('Daily scraping failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TIMEZONE || 'UTC'
    });

    this.tasks.set('daily-scraping', task);
    task.start();
    
    console.log(`Daily scraping scheduled for ${cronExpression}`);
  }

  private scheduleEmailSending(cronExpression: string): void {
    const task = cron.schedule(cronExpression, async () => {
      console.log('Starting scheduled email sending...');
      
      try {
        await this.runScheduledEmailSending();
      } catch (error) {
        console.error('Scheduled email sending failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TIMEZONE || 'UTC'
    });

    this.tasks.set('email-sending', task);
    task.start();
    
    console.log(`Email sending scheduled for ${cronExpression}`);
  }

  private scheduleInboxMonitoring(cronExpression: string): void {
    const task = cron.schedule(cronExpression, async () => {
      try {
        await this.runInboxMonitoring();
      } catch (error) {
        console.error('Inbox monitoring failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TIMEZONE || 'UTC'
    });

    this.tasks.set('inbox-monitoring', task);
    task.start();
    
    console.log(`Inbox monitoring scheduled for ${cronExpression}`);
  }

  private scheduleMetricsCalculation(cronExpression: string): void {
    const task = cron.schedule(cronExpression, async () => {
      console.log('Calculating daily metrics...');
      
      try {
        await this.calculateDailyMetrics();
      } catch (error) {
        console.error('Metrics calculation failed:', error);
      }
    }, {
      scheduled: false,
      timezone: process.env.TIMEZONE || 'UTC'
    });

    this.tasks.set('metrics-calculation', task);
    task.start();
    
    console.log(`Metrics calculation scheduled for ${cronExpression}`);
  }

  async runDailyScraping(): Promise<void> {
    const activeCampaigns = await this.prisma.campaign.findMany({
      where: { 
        status: 'ACTIVE',
        user: {
          gmailConnected: true
        }
      },
      include: {
        user: true,
        _count: {
          select: {
            leads: {
              where: {
                scrapedAt: {
                  gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
              }
            }
          }
        }
      }
    });

    console.log(`Found ${activeCampaigns.length} active campaigns for scraping`);

    for (const campaign of activeCampaigns) {
      try {
        // Check if we've already scraped today
        const todayScraped = campaign._count.leads;
        if (todayScraped > 0) {
          console.log(`Campaign ${campaign.id} already scraped today (${todayScraped} leads)`);
          continue;
        }

        // Create scrape history record
        const scrapeHistory = await this.prisma.scrapeHistory.create({
          data: {
            campaignId: campaign.id,
            status: 'RUNNING'
          }
        });

        // Emit real-time event
        await this.emitRealtimeEvent('scraping_started', {
          campaignId: campaign.id,
          historyId: scrapeHistory.id,
          campaignName: campaign.name
        });

        // Build scraping profile
        const profile = await this.buildScrapingProfile(campaign);
        
        // Add to queue instead of running immediately
        await this.redisQueue.add('scrapeProspects', {
          campaignId: campaign.id,
          userId: campaign.userId,
          profile,
          historyId: scrapeHistory.id,
          dailyLimit: campaign.dailyLimit
        }, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        });

      } catch (error) {
        console.error(`Failed to queue scraping for campaign ${campaign.id}:`, error);
        
        await this.emitRealtimeEvent('scraping_failed', {
          campaignId: campaign.id,
          error: error.message
        });
      }
    }
  }

  async runScheduledEmailSending(): Promise<void> {
    const activeCampaigns = await this.prisma.campaign.findMany({
      where: { 
        status: 'ACTIVE',
        user: {
          gmailConnected: true
        }
      },
      include: {
        user: true,
        leads: {
          where: { status: 'NEW' },
          take: 100 // Get a batch of leads
        }
      }
    });

    console.log(`Found ${activeCampaigns.length} campaigns for email sending`);

    for (const campaign of activeCampaigns) {
      try {
        // Check if we can send more emails today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const todayEmails = await this.prisma.email.count({
          where: {
            campaignId: campaign.id,
            sentAt: {
              gte: todayStart
            }
          }
        });

        if (todayEmails >= campaign.dailyLimit) {
          console.log(`Campaign ${campaign.id} reached daily limit (${todayEmails}/${campaign.dailyLimit})`);
          continue;
        }

        if (campaign.leads.length === 0) {
          console.log(`Campaign ${campaign.id} has no new leads to email`);
          continue;
        }

        // Send batch of emails
        const batchSize = Math.min(50, campaign.dailyLimit - todayEmails);
        
        await this.redisQueue.add('sendBulkEmails', {
          campaignId: campaign.id,
          userId: campaign.userId,
          batchSize
        }, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        });

        // Emit progress event
        await this.emitRealtimeEvent('email_batch_queued', {
          campaignId: campaign.id,
          batchSize,
          remaining: campaign.dailyLimit - todayEmails - batchSize
        });

      } catch (error) {
        console.error(`Failed to queue email sending for campaign ${campaign.id}:`, error);
      }
    }
  }

  async runInboxMonitoring(): Promise<void> {
    // Monitor Gmail for new replies
    const usersWithGmail = await this.prisma.user.findMany({
      where: { gmailConnected: true },
      include: {
        oauthCredentials: {
          where: { provider: 'gmail' }
        }
      }
    });

    for (const user of usersWithGmail) {
      try {
        if (user.oauthCredentials.length === 0) continue;
        
        await this.redisQueue.add('monitorInbox', {
          userId: user.id,
          oauthCredentials: user.oauthCredentials[0]
        }, {
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 5000
          }
        });
        
      } catch (error) {
        console.error(`Failed to queue inbox monitoring for user ${user.id}:`, error);
      }
    }
  }

  async calculateDailyMetrics(): Promise<void> {
    console.log('Calculating daily metrics for all users...');
    
    const users = await this.prisma.user.findMany();

    for (const user of users) {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Calculate email metrics
        const emailMetrics = await this.prisma.email.groupBy({
          by: ['status'],
          where: {
            userId: user.id,
            sentAt: {
              gte: today,
              lt: tomorrow
            }
          },
          _count: true
        });

        // Calculate leads metrics
        const leadsScrapped = await this.prisma.lead.count({
          where: {
            campaign: {
              userId: user.id
            },
            scrapedAt: {
              gte: today,
              lt: tomorrow
            }
          }
        });

        // Calculate replies metrics
        const repliesReceived = await this.prisma.reply.count({
          where: {
            userId: user.id,
            createdAt: {
              gte: today,
              lt: tomorrow
            }
          }
        });

        // Calculate campaign activity
        const activeCampaigns = await this.prisma.campaign.count({
          where: {
            userId: user.id,
            status: 'ACTIVE'
          }
        });

        const metricData = {
          date: today.toISOString().split('T')[0],
          emailsSent: emailMetrics.find(m => m.status === 'SENT')?._count || 0,
          emailsDelivered: emailMetrics.find(m => m.status === 'DELIVERED')?._count || 0,
          emailsOpened: emailMetrics.find(m => m.status === 'OPENED')?._count || 0,
          emailsClicked: emailMetrics.find(m => m.status === 'CLICKED')?._count || 0,
          emailsBounced: emailMetrics.find(m => m.status === 'BOUNCED')?._count || 0,
          emailsFailed: emailMetrics.find(m => m.status === 'FAILED')?._count || 0,
          leadsScrapped,
          repliesReceived,
          activeCampaigns,
          timestamp: new Date().toISOString()
        };

        // Save or update metrics
        await this.prisma.metric.upsert({
          where: {
            userId_date: {
              userId: user.id,
              date: today
            }
          },
          update: {
            metrics: metricData,
            updatedAt: new Date()
          },
          create: {
            userId: user.id,
            date: today,
            metrics: metricData
          }
        });

        // Emit real-time metrics update
        await this.emitRealtimeEvent('metrics_updated', {
          userId: user.id,
          metrics: metricData
        });

      } catch (error) {
        console.error(`Failed to calculate metrics for user ${user.id}:`, error);
      }
    }
  }

  // Manual trigger methods
  async triggerManualScraping(campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true }
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (!campaign.user.gmailConnected) {
      throw new Error('Gmail not connected');
    }

    const profile = await this.buildScrapingProfile(campaign);
    
    await this.redisQueue.add('scrapeProspects', {
      campaignId: campaign.id,
      userId: campaign.userId,
      profile,
      dailyLimit: campaign.dailyLimit,
      manual: true
    }, {
      attempts: 1
    });

    await this.emitRealtimeEvent('manual_scraping_triggered', {
      campaignId: campaign.id,
      campaignName: campaign.name
    });
  }

  async triggerManualEmailSending(campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true }
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (!campaign.user.gmailConnected) {
      throw new Error('Gmail not connected');
    }

    await this.redisQueue.add('sendBulkEmails', {
      campaignId: campaign.id,
      userId: campaign.userId,
      batchSize: campaign.dailyLimit,
      manual: true
    }, {
      attempts: 1
    });

    await this.emitRealtimeEvent('manual_email_sending_triggered', {
      campaignId: campaign.id,
      campaignName: campaign.name
    });
  }

  // Campaign control methods
  async pauseCampaign(campaignId: string): Promise<void> {
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PAUSED' }
    });

    await this.emitRealtimeEvent('campaign_paused', { campaignId });
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE' }
    });

    await this.emitRealtimeEvent('campaign_resumed', { campaignId });
  }

  async updateCampaignLimit(campaignId: string, newLimit: number): Promise<void> {
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { dailyLimit: newLimit }
    });

    await this.emitRealtimeEvent('campaign_limit_updated', { 
      campaignId, 
      newLimit 
    });
  }

  private async buildScrapingProfile(campaign: any): Promise<any> {
    return {
      targetIndustry: campaign.targetIndustry,
      targetLocation: campaign.targetLocation,
      targetRole: campaign.targetRole,
      keywords: campaign.keywords,
      description: campaign.description,
      campaignId: campaign.id,
      userId: campaign.userId
    };
  }

  private async emitRealtimeEvent(eventName: string, data: any): Promise<void> {
    try {
      // In production, this would emit to the actual real-time engine
      console.log(`Real-time event: ${eventName}`, data);
      
      // Store event for processing (in production, this would use Redis pub/sub)
      // await this.redisQueue.add('realtimeEvent', { eventName, data });
      
    } catch (error) {
      console.error('Failed to emit real-time event:', error);
    }
  }

  private async resumePausedCampaigns(): Promise<void> {
    const pausedCampaigns = await this.prisma.campaign.findMany({
      where: { 
        status: 'PAUSED',
        user: {
          gmailConnected: true
        }
      }
    });

    for (const campaign of pausedCampaigns) {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'ACTIVE' }
      });
      
      console.log(`Resumed paused campaign: ${campaign.name}`);
    }
  }

  // Management methods
  stopAll(): void {
    for (const [name, task] of this.tasks) {
      task.stop();
      console.log(`Stopped scheduled task: ${name}`);
    }
    this.tasks.clear();
  }

  restartTask(taskName: string): void {
    const task = this.tasks.get(taskName);
    if (task) {
      task.stop();
      setTimeout(() => task.start(), 1000);
      console.log(`Restarted task: ${taskName}`);
    }
  }

  getTaskStatus(): Record<string, { running: boolean; nextExecution?: string }> {
    const status: Record<string, { running: boolean; nextExecution?: string }> = {};
    
    for (const [name, task] of this.tasks) {
      status[name] = {
        running: task.running || false,
        nextExecution: (task as any).nextDate?.toISOString()
      };
    }
    
    return status;
  }

  async cleanup(): Promise<void> {
    this.stopAll();
    await this.redisQueue.close();
    console.log('Scheduler Engine cleaned up');
  }
}
