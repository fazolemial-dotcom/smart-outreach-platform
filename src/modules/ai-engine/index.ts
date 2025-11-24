import { Classification } from '@prisma/client';

interface CampaignProfile {
  targetIndustry: string | null;
  targetLocation: string | null;
  targetRole: string | null;
  keywords: string[];
  description: string;
  campaignId?: string;
  userId?: string;
}

export class AIEngine {
  private static readonly INDUSTRY_KEYWORDS = {
    'technology': ['software', 'saas', 'tech', 'startup', 'api', 'cloud', 'development', 'programming', 'IT', 'cybersecurity'],
    'healthcare': ['medical', 'health', 'hospital', 'clinic', 'pharma', 'biotech', 'medicine', 'nursing', 'pharmaceutical'],
    'finance': ['banking', 'investment', 'fintech', 'insurance', 'accounting', 'financial', 'wealth', 'trading'],
    'education': ['school', 'university', 'course', 'learning', 'training', 'education', 'teaching', 'academic'],
    'retail': ['ecommerce', 'store', 'shop', 'marketplace', 'sales', 'retail', 'consumer', 'merchandise'],
    'manufacturing': ['manufacturing', 'production', 'factory', 'industrial', 'assembly', 'automation'],
    'realestate': ['real estate', 'property', 'realty', 'housing', 'commercial', 'residential'],
    'marketing': ['marketing', 'advertising', 'brand', 'digital marketing', 'seo', 'social media', 'content'],
    'consulting': ['consulting', 'advisory', 'strategy', 'management consulting', 'business consulting'],
    'ecommerce': ['e-commerce', 'online store', 'marketplace', 'dropshipping', 'digital products']
  };

  private static readonly ROLE_KEYWORDS = {
    'executive': ['ceo', 'cto', 'cfo', 'founder', 'owner', 'president', 'vp', 'vice president'],
    'manager': ['manager', 'director', 'head', 'lead', 'supervisor', 'team lead', 'project manager'],
    'developer': ['developer', 'engineer', 'programmer', 'architect', 'software engineer', 'full stack'],
    'marketing': ['marketing', 'growth', 'brand', 'content', 'social media', 'digital marketing', 'growth hacker'],
    'sales': ['sales', 'business', 'revenue', 'client', 'customer', 'account manager', 'business development'],
    'hr': ['hr', 'human resources', 'recruiter', 'talent', 'people operations'],
    'operations': ['operations', 'ops', 'logistics', 'supply chain', 'process improvement'],
    'design': ['designer', 'ux', 'ui', 'product design', 'graphic design', 'creative'],
    'finance': ['finance', 'financial', 'accountant', 'bookkeeping', 'financial controller'],
    'product': ['product', 'product manager', 'product owner', 'scrum master', 'agile']
  };

  private static readonly LOCATION_KEYWORDS = {
    'north-america': ['usa', 'united states', 'america', 'canada', 'california', 'new york', 'texas', 'florida'],
    'europe': ['europe', 'uk', 'united kingdom', 'germany', 'france', 'netherlands', 'switzerland'],
    'asia': ['asia', 'china', 'japan', 'south korea', 'singapore', 'india', 'australia'],
    'specific-cities': ['san francisco', 'new york', 'london', 'berlin', 'tokyo', 'sydney', 'toronto']
  };

  static understandBusinessNeeds(message: string): CampaignProfile {
    const lowerMessage = message.toLowerCase();
    
    const profile: CampaignProfile = {
      targetIndustry: this.extractIndustry(lowerMessage),
      targetLocation: this.extractLocation(lowerMessage),
      targetRole: this.extractRole(lowerMessage),
      keywords: this.extractKeywords(message),
      description: message
    };

    // If no specific industry found, try to infer from role or keywords
    if (!profile.targetIndustry && profile.targetRole) {
      const roleIndustryMap: Record<string, string> = {
        'developer': 'technology',
        'designer': 'technology',
        'marketer': 'marketing',
        'sales': 'retail',
        'manager': 'general',
        'executive': 'general'
      };
      
      const inferredIndustry = roleIndustryMap[profile.targetRole] || 'general';
      if (inferredIndustry !== 'general') {
        profile.targetIndustry = inferredIndustry;
      }
    }

    return profile;
  }

  static classifyReply(content: string): {
    classification: Classification;
    confidence: number;
    intent: string;
    summary: string;
  } {
    const cleaned = this.cleanEmailContent(content);
    const features = this.extractFeatures(cleaned);
    
    // Enhanced rule-based classification
    const rules = this.getClassificationRules();
    const scores: Record<Classification, number> = {
      [Classification.INTERESTED]: 0,
      [Classification.NOT_INTERESTED]: 0,
      [Classification.QUESTION]: 0,
      [Classification.FOLLOW_UP]: 0,
      [Classification.SPAM]: 0,
      [Classification.UNCLEAR]: 0,
      [Classification.UNCERTAIN]: 0
    };

    // Score each category
    for (const [category, ruleSet] of Object.entries(rules)) {
      const classification = category as Classification;
      
      // Keyword matching
      for (const keyword of ruleSet.keywords) {
        if (cleaned.includes(keyword)) {
          scores[classification] += 0.2;
        }
      }
      
      // Pattern matching
      for (const pattern of ruleSet.patterns) {
        if (pattern.test(content)) {
          scores[classification] += 0.4;
        }
      }
      
      // Phrase matching
      for (const phrase of ruleSet.phrases) {
        if (content.toLowerCase().includes(phrase)) {
          scores[classification] += 0.3;
        }
      }
    }

    // Special cases
    if (this.isSpam(content)) {
      scores[Classification.SPAM] = 1.0;
    }

    // Find best match
    let bestClassification = Classification.UNCERTAIN;
    let highestScore = 0;

    for (const [classification, score] of Object.entries(scores)) {
      if (score > highestScore) {
        highestScore = score;
        bestClassification = classification as Classification;
      }
    }

    // Apply confidence thresholds
    let confidence = Math.min(highestScore, 1.0);
    
    if (confidence < 0.3) {
      bestClassification = Classification.UNCERTAIN;
    } else if (confidence < 0.5) {
      bestClassification = Classification.UNCLEAR;
    }

    return {
      classification: bestClassification,
      confidence,
      intent: this.detectIntent(cleaned),
      summary: this.generateSummary(cleaned)
    };
  }

  static generateReply(classification: Classification, context: any): string {
    const templates = this.getReplyTemplates();
    
    const baseTemplate = templates[classification] || templates[Classification.INTERESTED];
    
    // Personalize the response based on context
    const personalizedTemplate = this.personalizeTemplate(baseTemplate, context);
    
    return personalizedTemplate;
  }

  private static extractIndustry(message: string): string | null {
    for (const [industry, keywords] of Object.entries(this.INDUSTRY_KEYWORDS)) {
      if (keywords.some(keyword => message.includes(keyword))) {
        return industry;
      }
    }
    return null;
  }

  private static extractRole(message: string): string | null {
    for (const [role, keywords] of Object.entries(this.ROLE_KEYWORDS)) {
      if (keywords.some(keyword => message.includes(keyword))) {
        return role;
      }
    }
    return null;
  }

  private static extractLocation(message: string): string | null {
    for (const [region, keywords] of Object.entries(this.LOCATION_KEYWORDS)) {
      if (keywords.some(keyword => message.includes(keyword))) {
        return region;
      }
    }
    return null;
  }

  private static extractKeywords(message: string): string[] {
    // Remove common words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
      'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
    ]);

    return message
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 20); // Limit to top 20 keywords
  }

  private static cleanEmailContent(content: string): string {
    return content
      .replace(/https?:\/\/\S+/g, '') // Remove URLs
      .replace(/[^\w\s@.]/gi, ' ') // Keep only alphanumeric, spaces, @ and dots
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim()
      .toLowerCase();
  }

  private static extractFeatures(content: string): Record<string, number> {
    const features: Record<string, number> = {};
    
    // Word count
    features['word_count'] = content.split(/\s+/).length;
    
    // Question mark count
    features['question_marks'] = (content.match(/\?/g) || []).length;
    
    // Exclamation mark count
    features['exclamation_marks'] = (content.match(/!/g) || []).length;
    
    // Capital letters ratio
    const letters = content.match(/[a-z]/gi) || [];
    const capitals = letters.filter(letter => letter === letter.toUpperCase()).length;
    features['capital_ratio'] = letters.length > 0 ? capitals / letters.length : 0;
    
    return features;
  }

  private static getClassificationRules(): Record<Classification, { keywords: string[], patterns: RegExp[], phrases: string[] }> {
    return {
      [Classification.INTERESTED]: {
        keywords: [
          'interested', 'yes', 'sounds good', 'tell me more', 'curious', 'awesome', 'great',
          'love', 'amazing', 'fantastic', 'perfect', 'excited', 'when can', 'how much',
          'pricing', 'cost', 'trial', 'demo', 'schedule', 'call', 'meeting'
        ],
        patterns: [
          /i'?m interested/i,
          /can you tell me more/i,
          /sounds interesting/i,
          /when can we/i,
          /how much does/i,
          /let'?s schedule/i
        ],
        phrases: [
          'i would like to know more',
          'sounds interesting',
          'when can we start',
          'how does this work'
        ]
      },
      [Classification.NOT_INTERESTED]: {
        keywords: [
          'no', 'not interested', 'stop', 'unsubscribe', 'don\'t contact', 'not now',
          'busy', 'no time', 'not relevant', 'pass', 'decline', 'refuse'
        ],
        patterns: [
          /not interested/i,
          /stop contacting/i,
          /unsubscribe/i,
          /remove me/i,
          /don'?t want/i
        ],
        phrases: [
          'not interested at this time',
          'please stop sending emails',
          'not relevant to us'
        ]
      },
      [Classification.QUESTION]: {
        keywords: [
          'how', 'what', 'when', 'where', 'why', '?', 'can you explain', 'tell me about',
          'details', 'information', 'specs', 'features', 'benefits'
        ],
        patterns: [
          /how (much|does|do|can)/i,
          /what (is|are|does)/i,
          /when can/i,
          /where can/i,
          /why do/i
        ],
        phrases: [
          'can you explain',
          'tell me about',
          'what are the details',
          'how does this work'
        ]
      },
      [Classification.FOLLOW_UP]: {
        keywords: [
          'following up', 'just checking', 'bump', 'update', 'status', 'hear back',
          'response', 'revert', 'get back', 'touch base'
        ],
        patterns: [
          /following up/i,
          /just checking/i,
          /bumping this/i,
          /any update/i
        ],
        phrases: [
          'following up on my previous email',
          'just checking if you received',
          'any updates on this'
        ]
      },
      [Classification.SPAM]: {
        keywords: [
          'viagra', 'lottery', 'winner', 'congratulations', 'free money', 'act now',
          'limited time', 'urgent', 'click here', 'buy now', 'guaranteed'
        ],
        patterns: [
          /congratulations.*winner/i,
          /you.*won/i,
          /free.*money/i,
          /click here/i
        ],
        phrases: [
          'you have won',
          'congratulations you are a winner'
        ]
      },
      [Classification.UNCLEAR]: {
        keywords: [],
        patterns: [],
        phrases: []
      },
      [Classification.UNCERTAIN]: {
        keywords: [],
        patterns: [],
        phrases: []
      }
    };
  }

  private static isSpam(content: string): boolean {
    const spamIndicators = [
      /congratulations.*winner/i,
      /free.*money/i,
      /click here/i,
      /viagra/i,
      /casino/i,
      /lottery/i
    ];
    
    return spamIndicators.some(pattern => pattern.test(content));
  }

  private static detectIntent(content: string): string {
    const intentPatterns = {
      'request_info': /(how|what|when|where|why|can you|tell me)/i,
      'express_interest': /(interested|sounds good|yes|awesome|great)/i,
      'decline': /(no|not interested|stop|unsubscribe)/i,
      'ask_question': (content.match(/\?/g) || []).length > 0,
      'follow_up': /(following up|just checking|bump)/i
    };

    for (const [intent, pattern] of Object.entries(intentPatterns)) {
      if (typeof pattern === 'function' && pattern(content)) {
        return intent;
      } else if (pattern.test(content)) {
        return intent;
      }
    }

    return 'general';
  }

  private static generateSummary(content: string): string {
    // Simple extractive summarization
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    if (sentences.length === 0) return 'Empty or very short message';
    if (sentences.length === 1) return sentences[0].trim();
    
    // Return first sentence as summary
    return sentences[0].trim();
  }

  private static getReplyTemplates(): Record<Classification, string> {
    return {
      [Classification.INTERESTED]: `
        <p>Hi {{name}},</p>
        
        <p>Great to hear you're interested! I'd love to schedule a quick call to discuss how we can help with your specific needs.</p>
        
        <p>Would you be available for a 15-minute call this week? I can show you some relevant examples and answer any questions you might have.</p>
        
        <p>Looking forward to speaking with you!</p>
        
        <p>Best regards,<br>
        {{senderName}}</p>
      `,
      
      [Classification.NOT_INTERESTED]: `
        <p>Hi {{name}},</p>
        
        <p>I completely understand and respect your decision. Thanks for letting me know.</p>
        
        <p>If your needs change in the future, feel free to reach out. I won't bother you again.</p>
        
        <p>Best regards,<br>
        {{senderName}}</p>
      `,
      
      [Classification.QUESTION]: `
        <p>Hi {{name}},</p>
        
        <p>Thanks for your question! I'm happy to provide more details.</p>
        
        <p>{{aiGeneratedAnswer}}</p>
        
        <p>Would you like to schedule a quick call so we can dive deeper into how this might work for {{company}}?</p>
        
        <p>Best regards,<br>
        {{senderName}}</p>
      `,
      
      [Classification.FOLLOW_UP]: `
        <p>Hi {{name}},</p>
        
        <p>Thanks for the follow-up! I'm still happy to help with your needs.</p>
        
        <p>{{aiGeneratedFollowUp}}</p>
        
        <p>When would be a good time to connect and explore this further?</p>
        
        <p>Best regards,<br>
        {{senderName}}</p>
      `,
      
      [Classification.SPAM]: `
        <p>This appears to be spam and has been automatically filtered.</p>
      `,
      
      [Classification.UNCLEAR]: `
        <p>Hi {{name}},</p>
        
        <p>Thanks for your message! I'd love to help clarify how we can assist {{company}}.</p>
        
        <p>Could you provide a bit more context about what you're looking for? That way I can give you the most relevant information.</p>
        
        <p>Best regards,<br>
        {{senderName}}</p>
      `,
      
      [Classification.UNCERTAIN]: `
        <p>Hi {{name}},</p>
        
        <p>Thanks for your message! I appreciate you taking the time to reach out.</p>
        
        <p>I'd love to learn more about your specific situation so I can provide the most helpful information.</p>
        
        <p>Would you be open to a brief conversation about how we might be able to help {{company}}?</p>
        
        <p>Best regards,<br>
        {{senderName}}</p>
      `
    };
  }

  private static personalizeTemplate(template: string, context: any): string {
    let personalized = template;
    
    // Replace common variables
    const variables = {
      '{{name}}': context.leadName || 'there',
      '{{company}}': context.company || 'your company',
      '{{senderName}}': context.senderName || 'Your Name',
      '{{aiGeneratedAnswer}}': context.aiAnswer || 'I\'d be happy to provide more details about our solution.',
      '{{aiGeneratedFollowUp}}': context.aiFollowUp || 'I\'m still here to help if you have any questions.'
    };
    
    for (const [placeholder, value] of Object.entries(variables)) {
      personalized = personalized.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    return personalized;
  }
}
