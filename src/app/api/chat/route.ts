import { NextRequest, NextResponse } from 'next/server';
import { AIEngine } from '../../../modules/ai-engine';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const prisma = new PrismaClient();

// Initialize Redis queue for background jobs
const redisQueue = new Queue('outreach-jobs', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId, userId = 'demo-user-id' } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Use AI to understand the user's business needs
    const businessProfile = AIEngine.understandBusinessNeeds(message);

    // Generate AI response
    const aiResponse = await generateAIResponse(message, businessProfile);

    // Check if this is a campaign creation request
    const campaignCreated = await handleCampaignCreation(message, businessProfile, userId);

    const response = {
      id: `msg-${Date.now()}`,
      type: 'ai',
      content: aiResponse,
      timestamp: new Date().toISOString(),
      businessProfile,
      campaignCreated
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}

async function generateAIResponse(message: string, businessProfile: any): Promise<string> {
  // Check if the message contains campaign creation intent
  const creationKeywords = [
    'start', 'begin', 'create', 'setup', 'launch', 'help me find',
    'need clients', 'need prospects', 'find customers', 'outreach'
  ];

  const lowerMessage = message.toLowerCase();
  const hasCreationIntent = creationKeywords.some(keyword => lowerMessage.includes(keyword));

  if (hasCreationIntent && businessProfile.targetIndustry) {
    return generateCampaignResponse(businessProfile);
  }

  if (businessProfile.targetIndustry) {
    return generateAnalysisResponse(businessProfile);
  }

  return generateHelpResponse();
}

function generateCampaignResponse(profile: any): string {
  return `
Great! I understand you're looking to find prospects in the **${profile.targetIndustry || 'technology'}** industry${profile.targetLocation ? ` located in ${profile.targetLocation}` : ''}${profile.targetRole ? ` for ${profile.targetRole} roles` : ''}.

I've analyzed your requirements and I'm ready to create an automated outreach campaign for you. Here's what I'll do:

## 🔍 **Daily Prospect Discovery**
- Scrape up to 2,000 high-quality prospects daily
- Focus on ${profile.targetIndustry || 'technology'} companies
- Target ${profile.targetRole || 'decision-makers'} specifically
${profile.targetLocation ? `- Geographic focus: ${profile.targetLocation}` : ''}

## 📧 **Intelligent Email Outreach**
- Send personalized emails using your business details
- Gmail integration for professional delivery
- Smart rate limiting to maintain sender reputation

## 🤖 **AI-Powered Response Management**
- Automatically classify incoming replies
- Generate appropriate responses for:
  - **Interested prospects** → Schedule calls
  - **Questions** → Provide detailed answers
  - **Replies** → Follow up appropriately

## 📊 **Real-Time Dashboard**
- Track emails sent, prospects found, and reply rates
- Monitor campaign performance daily
- See all activities in real-time

Should I go ahead and create this campaign for you? I'll set it up to start running automatically every day at 9 AM!
`;
}

function generateAnalysisResponse(profile: any): string {
  return `
I've analyzed your message and identified the following requirements:

**Target Industry:** ${profile.targetIndustry || 'Not specified'}
**Target Location:** ${profile.targetLocation || 'Global'}
**Target Role:** ${profile.targetRole || 'Decision-makers'}
**Key Focus Areas:** ${profile.keywords.join(', ') || 'General outreach'}

To create an effective outreach campaign, could you tell me:

1. **What specific outcome are you looking for?** (Sales calls, partnerships, etc.)
2. **What makes your solution unique?**
3. **Any specific companies or types of companies you want to target?**

Once I have these details, I can set up a completely automated campaign that will find prospects and handle responses for you!
`;
}

function generateHelpResponse(): string {
  return `
I'm your AI Business Assistant, and I'm here to help you set up automated client outreach campaigns. Here's how I can help:

## 🎯 **What I can do for you:**

**1. Find Prospects**
- Scrape up to 2,000 high-quality leads daily
- Target specific industries, locations, and roles
- Validate and clean email addresses

**2. Send Outreach Emails**
- Personalized email campaigns
- Gmail integration for professional delivery
- Smart batching with rate limiting

**3. Handle Responses**
- AI classifies incoming replies automatically
- Generates appropriate responses for different scenarios
- Manages follow-ups and scheduling

**4. Track Everything**
- Real-time dashboard with live metrics
- Campaign performance analytics
- Detailed activity logs

## 💬 **Tell me about your business:**

Just describe your ideal clients in natural language, like:
- *"I help SaaS companies in San Francisco find CTOs"*
- *"I provide marketing services to e-commerce businesses"*
- *"I work with healthcare startups looking for funding"*

I'll understand your needs and set up everything automatically!
`;
}

async function handleCampaignCreation(message: string, profile: any, userId: string): Promise<any> {
  const creationKeywords = [
    'start', 'begin', 'create', 'setup', 'launch', 'go ahead',
    'yes', 'create campaign', 'set it up'
  ];

  const lowerMessage = message.toLowerCase();
  const hasCreationIntent = creationKeywords.some(keyword => lowerMessage.includes(keyword));

  if (!hasCreationIntent || !profile.targetIndustry) {
    return null;
  }

  try {
    // Create the campaign
    const campaign = await prisma.campaign.create({
      data: {
        userId,
        name: `${profile.targetIndustry} Outreach Campaign`,
        description: profile.description,
        targetIndustry: profile.targetIndustry,
        targetLocation: profile.targetLocation,
        targetRole: profile.targetRole,
        keywords: profile.keywords,
        status: 'ACTIVE',
        dailyLimit: 50
      }
    });

    // Add initial scrape job to queue
    await redisQueue.add('scrapeProspects', {
      campaignId: campaign.id,
      userId,
      profile: {
        ...profile,
        campaignId: campaign.id
      },
      dailyLimit: 50,
      manual: false
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    return {
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status
    };

  } catch (error) {
    console.error('Failed to create campaign:', error);
    return null;
  }
}

