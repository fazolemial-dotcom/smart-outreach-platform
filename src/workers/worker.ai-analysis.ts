import { Worker, Job } from 'bullmq';
import { AIEngine } from '../modules/ai-engine';
import { PrismaClient } from '@prisma/client';
import { RealTimeEngine } from '../modules/realtime-engine';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined
};

console.log('Starting AI Analysis Worker...');

// Initialize services
const prisma = new PrismaClient();
const aiEngine = new AIEngine();
const realtimeEngine = new RealTimeEngine();

const aiAnalysisWorker = new Worker('ai-analysis', async (job: Job) => {
  console.log(`[AI Analysis] Starting job ${job.id}`);
  console.log(`[AI Analysis] Job data:`, job.data);

  const { type, data } = job.data;

  try {
    switch (type) {
      case 'analyze_business_needs':
        return await analyzeBusinessNeeds(data);

      case 'classify_email_reply':
        return await classifyEmailReply(data);

      case 'generate_response':
        return await generateAIResponse(data);

      case 'analyze_campaign_performance':
        return await analyzeCampaignPerformance(data);

      case 'optimize_campaign':
        return await optimizeCampaign(data);

      default:
        throw new Error(`Unknown AI analysis type: ${type}`);
    }

  } catch (error) {
    console.error(`[AI Analysis] Job ${job.id} failed:`, error);
    throw error;
  }
}, { 
  connection,
  concurrency: 5, // Process multiple AI analysis jobs concurrently
  maxStalledCount: 3,
  stalledInterval: 30000
});

// Worker event handlers
aiAnalysisWorker.on('completed', (job: Job) => {
  console.log(`[AI Analysis] Job ${job.id} completed`);
});

aiAnalysisWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(`[AI Analysis] Job ${job?.id} failed:`, err);
});

aiAnalysisWorker.on('stalled', (jobId: string) => {
  console.warn(`[AI Analysis] Job ${jobId} stalled`);
});

aiAnalysisWorker.on('error', (error: Error) => {
  console.error('[AI Analysis] Worker error:', error);
});

// Business needs analysis
async function analyzeBusinessNeeds(data: any) {
  const { message, userId } = data;
  
  console.log(`[AI Analysis] Analyzing business needs for user ${userId}`);
  
  const businessProfile = aiEngine.understandBusinessNeeds(message);
  
  // Generate recommendations
  const recommendations = generateRecommendations(businessProfile);
  
  // Store analysis result
  const analysisResult = {
    profile: businessProfile,
    recommendations,
    confidence: calculateProfileConfidence(businessProfile),
    timestamp: new Date()
  };
  
  // Emit real-time event if user is online
  await realtimeEngine.broadcastToUser(userId, 'business_analysis_complete', {
    analysis: analysisResult,
    timestamp: new Date()
  });
  
  return analysisResult;
}

// Email reply classification
async function classifyEmailReply(data: any) {
  const { content, emailId, userId } = data;
  
  console.log(`[AI Analysis] Classifying email reply for user ${userId}`);
  
  const analysis = aiEngine.classifyReply(content);
  
  // Update reply in database with analysis
  if (emailId) {
    await prisma.reply.update({
      where: { id: emailId },
      data: {
        classification: analysis.classification,
        confidence: analysis.confidence,
        intent: analysis.intent,
        aiSummary: analysis.summary
      }
    });
  }
  
  // Emit real-time event
  await realtimeEngine.broadcastToUser(userId, 'reply_classified', {
    emailId,
    classification: analysis.classification,
    confidence: analysis.confidence,
    summary: analysis.summary,
    timestamp: new Date()
  });
  
  return analysis;
}

// AI response generation
async function generateAIResponse(data: any) {
  const { classification, context, userId } = data;
  
  console.log(`[AI Analysis] Generating AI response for user ${userId}`);
  
  const response = aiEngine.generateReply(classification, context);
  
  // Store response for logging
  console.log(`[AI Analysis] Generated response:`, response.substring(0, 100) + '...');
  
  return {
    response,
    classification,
    generatedAt: new Date()
  };
}

// Campaign performance analysis
async function analyzeCampaignPerformance(data: any) {
  const { campaignId, userId } = data;
  
  console.log(`[AI Analysis] Analyzing campaign performance for campaign ${campaignId}`);
  
  // Get campaign data
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      emails: {
        where: {
          sentAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        },
        include: {
          replies: true
        }
      },
      leads: true
    }
  });
  
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  
  // Analyze performance metrics
  const analysis = {
    campaignId,
    totalEmails: campaign.emails.length,
    totalReplies: campaign.emails.reduce((acc, email) => acc + email.replies.length, 0),
    replyRate: campaign.emails.length > 0 
      ? ((campaign.emails.reduce((acc, email) => acc + email.replies.length, 0) / campaign.emails.length) * 100).toFixed(2)
      : '0',
    interestedReplies: 0,
    questions: 0,
    notInterestedReplies: 0,
    unclearReplies: 0,
    leadConversionRate: campaign.leads.length > 0 
      ? ((campaign.emails.filter(email => email.replies.some(reply => 
          reply.classification === 'INTERESTED'
        )).length / campaign.leads.length) * 100).toFixed(2)
      : '0'
  };
  
  // Count reply types
  campaign.emails.forEach(email => {
    email.replies.forEach(reply => {
      switch (reply.classification) {
        case 'INTERESTED':
          analysis.interestedReplies++;
          break;
        case 'QUESTION':
          analysis.questions++;
          break;
        case 'NOT_INTERESTED':
          analysis.notInterestedReplies++;
          break;
        case 'UNCLEAR':
        case 'UNCERTAIN':
          analysis.unclearReplies++;
          break;
      }
    });
  });
  
  // Generate insights
  const insights = generatePerformanceInsights(analysis);
  
  // Emit real-time event
  await realtimeEngine.broadcastToUser(userId, 'campaign_analysis_complete', {
    campaignId,
    analysis,
    insights,
    timestamp: new Date()
  });
  
  return { analysis, insights };
}

// Campaign optimization
async function optimizeCampaign(data: any) {
  const { campaignId, userId } = data;
  
  console.log(`[AI Analysis] Optimizing campaign ${campaignId}`);
  
  // Get campaign performance data
  const performanceAnalysis = await analyzeCampaignPerformance({ campaignId, userId });
  
  // Generate optimization suggestions
  const optimizations = generateOptimizationSuggestions(performanceAnalysis);
  
  // Apply automatic optimizations if confidence is high
  const appliedOptimizations = [];
  
  for (const optimization of optimizations) {
    if (optimization.confidence > 0.8) {
      try {
        await applyOptimization(campaignId, optimization);
        appliedOptimizations.push(optimization);
      } catch (error) {
        console.error(`Failed to apply optimization:`, error);
      }
    }
  }
  
  return {
    suggestions: optimizations,
    applied: appliedOptimizations,
    timestamp: new Date()
  };
}

// Utility functions
function generateRecommendations(profile: any): string[] {
  const recommendations = [];
  
  if (profile.targetIndustry) {
    recommendations.push(`Target industry: ${profile.targetIndustry} is well-defined`);
  } else {
    recommendations.push('Consider specifying a target industry for better lead quality');
  }
  
  if (profile.targetLocation) {
    recommendations.push(`Geographic focus: ${profile.targetLocation} helps with local relevance`);
  } else {
    recommendations.push('Consider adding geographic targeting for better local connection');
  }
  
  if (profile.targetRole) {
    recommendations.push(`Role targeting: ${profile.targetRole} enables personalized messaging`);
  } else {
    recommendations.push('Consider specifying target job roles for better personalization');
  }
  
  if (profile.keywords.length > 0) {
    recommendations.push(`Keywords identified: ${profile.keywords.slice(0, 3).join(', ')}...`);
  }
  
  return recommendations;
}

function calculateProfileConfidence(profile: any): number {
  let confidence = 0;
  
  if (profile.targetIndustry) confidence += 0.3;
  if (profile.targetLocation) confidence += 0.2;
  if (profile.targetRole) confidence += 0.2;
  if (profile.keywords.length > 0) confidence += 0.2;
  if (profile.description.length > 50) confidence += 0.1;
  
  return Math.min(confidence, 1.0);
}

function generatePerformanceInsights(analysis: any): string[] {
  const insights = [];
  
  const replyRate = parseFloat(analysis.replyRate);
  const conversionRate = parseFloat(analysis.leadConversionRate);
  
  if (replyRate > 5) {
    insights.push('Great reply rate! Your outreach is generating good engagement.');
  } else if (replyRate < 2) {
    insights.push('Low reply rate. Consider improving your email templates or targeting.');
  }
  
  if (analysis.interestedReplies > analysis.notInterestedReplies) {
    insights.push('High interest rate - your messaging resonates with prospects.');
  } else if (analysis.notInterestedReplies > analysis.interestedReplies) {
    insights.push('High rejection rate - consider refining your target audience.');
  }
  
  if (analysis.questions > 0) {
    insights.push(`Received ${analysis.questions} questions - prospects are engaged and seeking information.`);
  }
  
  return insights;
}

function generateOptimizationSuggestions(performanceAnalysis: any): any[] {
  const suggestions = [];
  
  const { analysis } = performanceAnalysis;
  
  // Reply rate optimization
  if (parseFloat(analysis.replyRate) < 3) {
    suggestions.push({
      type: 'improve_subject_lines',
      description: 'Consider A/B testing different email subject lines',
      confidence: 0.8,
      action: 'update_email_templates'
    });
  }
  
  // Email volume optimization
  const dailyEmails = analysis.totalEmails / 30; // Approximate daily average
  if (dailyEmails < 20) {
    suggestions.push({
      type: 'increase_daily_limit',
      description: 'Consider increasing daily email limit for faster outreach',
      confidence: 0.7,
      action: 'update_daily_limit',
      parameter: 'increase_by_50'
    });
  }
  
  // Targeting optimization
  if (analysis.notInterestedReplies > analysis.interestedReplies * 2) {
    suggestions.push({
      type: 'refine_targeting',
      description: 'High rejection rate suggests refining target audience',
      confidence: 0.9,
      action: 'update_criteria'
    });
  }
  
  return suggestions;
}

async function applyOptimization(campaignId: string, optimization: any): Promise<void> {
  switch (optimization.action) {
    case 'update_daily_limit':
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (campaign) {
        const newLimit = Math.min(campaign.dailyLimit * 1.5, 200);
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { dailyLimit: Math.floor(newLimit) }
        });
      }
      break;
    // Add more optimization actions as needed
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[AI Analysis] Received SIGTERM, shutting down gracefully...');
  await aiAnalysisWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[AI Analysis] Received SIGINT, shutting down gracefully...');
  await aiAnalysisWorker.close();
  process.exit(0);
});

// Keep the process running
console.log('[AI Analysis] Worker is ready and waiting for jobs...');
