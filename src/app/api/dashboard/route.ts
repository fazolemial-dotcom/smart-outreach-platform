import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'demo-user-id'; // In production, get from auth

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get metrics for the last 7 days
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get dashboard metrics
    const [
      todayEmails,
      todayLeads,
      todayReplies,
      activeCampaigns,
      recentActivity,
      weeklyMetrics
    ] = await Promise.all([
      // Today's emails
      prisma.email.count({
        where: {
          userId,
          sentAt: { gte: today, lt: tomorrow }
        }
      }),

      // Today's leads
      prisma.lead.count({
        where: {
          campaign: { userId },
          scrapedAt: { gte: today, lt: tomorrow }
        }
      }),

      // Today's replies
      prisma.reply.count({
        where: {
          userId,
          createdAt: { gte: today, lt: tomorrow }
        }
      }),

      // Active campaigns
      prisma.campaign.findMany({
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
      }),

      // Recent activity
      prisma.email.findMany({
        where: { userId },
        include: {
          lead: true,
          campaign: true
        },
        orderBy: { sentAt: 'desc' },
        take: 10
      }),

      // Weekly metrics for charts
      prisma.metric.findMany({
        where: {
          userId,
          date: { gte: lastWeek, lt: today }
        },
        orderBy: { date: 'asc' }
      })
    ]);

    // Calculate success rate
    const successRate = todayEmails > 0 ? ((todayReplies / todayEmails) * 100).toFixed(1) : '0';

    // Format recent activity
    const formattedActivity = recentActivity.map(email => ({
      id: email.id,
      type: 'email_sent',
      description: `Email sent to ${email.lead.name || email.lead.email}`,
      campaign: email.campaign.name,
      timestamp: email.sentAt,
      status: email.status,
      lead: {
        name: email.lead.name,
        email: email.lead.email,
        company: email.lead.company
      }
    }));

    // Format weekly metrics for charts
    const chartData = weeklyMetrics.map(metric => ({
      date: metric.date.toISOString().split('T')[0],
      emailsSent: metric.metrics.emailsSent || 0,
      leadsScraped: metric.metrics.leadsScrapped || 0,
      repliesReceived: metric.metrics.repliesReceived || 0,
      successRate: metric.metrics.emailsSent > 0 
        ? ((metric.metrics.repliesReceived / metric.metrics.emailsSent) * 100).toFixed(1)
        : '0'
    }));

    return NextResponse.json({
      metrics: {
        emailsSent: todayEmails,
        leadsScrapped: todayLeads,
        repliesReceived: todayReplies,
        successRate
      },
      activeCampaigns,
      recentActivity: formattedActivity,
      chartData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, campaignId, userId = 'demo-user-id' } = body;

    switch (action) {
      case 'trigger_scraping':
        // This would trigger the scraping worker
        console.log(`Triggering scraping for campaign ${campaignId}`);
        return NextResponse.json({ success: true, message: 'Scraping started' });

      case 'trigger_email_sending':
        // This would trigger the email sending worker
        console.log(`Triggering email sending for campaign ${campaignId}`);
        return NextResponse.json({ success: true, message: 'Email sending started' });

      case 'pause_campaign':
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'PAUSED' }
        });
        return NextResponse.json({ success: true, message: 'Campaign paused' });

      case 'resume_campaign':
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'ACTIVE' }
        });
        return NextResponse.json({ success: true, message: 'Campaign resumed' });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Dashboard action error:', error);
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    );
  }
}
