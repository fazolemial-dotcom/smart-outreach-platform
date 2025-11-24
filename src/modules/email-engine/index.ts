import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

interface EmailResult {
  messageId: string;
  success: boolean;
  error?: string;
}

export class EmailEngine {
  private prisma: PrismaClient;
  private transporter: Transporter;

  constructor() {
    this.prisma = new PrismaClient();
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2'
      }
    });
  }

  async sendBulkEmails(campaignId: string, batchSize: number = 50): Promise<{
    success: number;
    failed: number;
    total: number;
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        user: {
          include: {
            oauthCredentials: {
              where: { provider: 'gmail' }
            }
          }
        },
        leads: {
          where: { status: 'NEW' },
          take: batchSize
        }
      }
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (!campaign.user.oauthCredentials.length) {
      throw new Error('Gmail not connected for user');
    }

    const oauthCredentials = campaign.user.oauthCredentials[0];
    const results = {
      success: 0,
      failed: 0,
      total: campaign.leads.length
    };

    for (const lead of campaign.leads) {
      try {
        await this.sendEmail(lead, campaign, oauthCredentials);
        
        // Update lead status
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'CONTACTED' }
        });

        results.success++;
        
        // Rate limiting - wait between emails
        await this.delay(2000); // 2 seconds between emails

      } catch (error) {
        console.error(`Failed to send email to ${lead.email}:`, error);
        
        await this.logEmailError(lead.id, error.message);
        results.failed++;
      }
    }

    return results;
  }

  private async sendEmail(lead: any, campaign: any, oauthCredentials: any): Promise<EmailResult> {
    try {
      // Refresh OAuth token if needed
      const accessToken = await this.refreshAccessToken(oauthCredentials);
      
      const emailContent = await this.generateEmailContent(lead, campaign);
      
      const mailOptions: SendMailOptions = {
        from: oauthCredentials.user.email,
        to: lead.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: {
          'X-Campaign-ID': campaign.id,
          'X-Lead-ID': lead.id
        }
      };

      // Configure OAuth2 for this request
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: oauthCredentials.refreshToken
      });

      // Send email using Gmail API directly for better tracking
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      const rawMessage = this.createRawMessage(mailOptions);
      
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: rawMessage
        }
      });

      // Store email record
      await this.prisma.email.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          userId: campaign.userId,
          subject: emailContent.subject,
          content: emailContent.html,
          messageId: response.data.id || '',
          status: 'SENT',
          sentAt: new Date()
        }
      });

      return {
        messageId: response.data.id || '',
        success: true
      };

    } catch (error) {
      return {
        messageId: '',
        success: false,
        error: error.message
      };
    }
  }

  private async generateEmailContent(lead: any, campaign: any): Promise<EmailContent> {
    const templates = await this.getEmailTemplates();
    
    // Select template based on campaign type
    const template = templates.outreach;
    
    const variables = {
      name: lead.name || 'there',
      company: lead.company || 'your company',
      industry: campaign.targetIndustry || 'your industry',
      location: campaign.targetLocation || 'your location',
      role: lead.role || 'professional',
      senderName: campaign.user.name || 'Your Name'
    };

    const subject = this.replaceVariables(template.subject, variables);
    const html = this.replaceVariables(template.html, variables);
    const text = this.replaceVariables(template.text, variables);

    return { subject, html, text };
  }

  private async getOAuthCredentials(userId: string): Promise<any | null> {
    return await this.prisma.oAuthCredential.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: 'gmail'
        }
      }
    });
  }

  private async refreshAccessToken(oauthCredentials: any): Promise<string> {
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

  private async getEmailTemplates(): Promise<any> {
    // In production, these would be stored in database and user-customizable
    return {
      outreach: {
        subject: 'Quick question about {{company}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            <p>Hi {{name}},</p>
            
            <p>I came across {{company}} and was impressed by your work in the {{industry}} space. 
            I noticed you're based in {{location}}, and I wanted to reach out with something that might be relevant.</p>
            
            <p>We help {{industry}} companies like yours streamline their operations and drive growth. 
            I'd love to show you how we've helped similar businesses in {{location}} achieve measurable results.</p>
            
            <p>Would you be open to a brief 15-minute call this week to explore if this might be valuable for {{company}}?</p>
            
            <div style="margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff;">
              <p style="margin: 0; font-weight: bold; color: #007bff;">Benefits we typically provide:</p>
              <ul style="margin: 10px 0 0 20px;">
                <li>Streamlined operations and processes</li>
                <li>Increased revenue and growth opportunities</li>
                <li>Improved team productivity and efficiency</li>
                <li>Better customer experience and satisfaction</li>
              </ul>
            </div>
            
            <p>Looking forward to potentially helping {{company}} achieve even greater success!</p>
            
            <p>Best regards,<br>
            {{senderName}}</p>
            
            <hr style="margin: 40px 0 20px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px; text-align: center;">
              This email was sent because you fit our criteria for {{industry}} professionals in {{location}}.<br>
              If you prefer not to receive emails like this, please reply with "unsubscribe" and we'll remove you immediately.
            </p>
          </div>
        `,
        text: `
          Hi {{name}},
          
          I came across {{company}} and was impressed by your work in the {{industry}} space.
          I noticed you're based in {{location}}, and I wanted to reach out with something that might be relevant.
          
          We help {{industry}} companies like yours streamline their operations and drive growth.
          I'd love to show you how we've helped similar businesses in {{location}} achieve measurable results.
          
          Would you be open to a brief 15-minute call this week to explore if this might be valuable for {{company}}?
          
          Benefits we typically provide:
          • Streamlined operations and processes
          • Increased revenue and growth opportunities
          • Improved team productivity and efficiency
          • Better customer experience and satisfaction
          
          Looking forward to potentially helping {{company}} achieve even greater success!
          
          Best regards,
          {{senderName}}
          
          ---
          This email was sent because you fit our criteria for {{industry}} professionals in {{location}}.
          If you prefer not to receive emails like this, please reply with "unsubscribe" and we'll remove you immediately.
        `
      },
      
      follow_up: {
        subject: 'Following up on my message about {{company}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            <p>Hi {{name}},</p>
            
            <p>I wanted to follow up on my message from last week about how we might be able to help {{company}}.</p>
            
            <p>I understand you're probably busy, but I believe there's a good fit between what we do and {{company}}'s current goals in the {{industry}} space.</p>
            
            <p>Would you have just 10 minutes this week for a quick call? I can share some specific examples of how we've helped similar {{industry}} companies in {{location}}.</p>
            
            <div style="margin: 30px 0; text-align: center;">
              <p style="margin-bottom: 15px; color: #666;">Here are some quick wins we typically provide:</p>
              <div style="display: inline-block; background-color: #f0f8ff; padding: 15px 25px; border-radius: 8px;">
                <strong style="color: #007bff;">20-30% efficiency improvement</strong> within 3 months
              </div>
            </div>
            
            <p>If this isn't the right time, no worries at all. I'll make sure not to reach out again unless you express interest.</p>
            
            <p>Best regards,<br>
            {{senderName}}</p>
          </div>
        `,
        text: `
          Hi {{name}},
          
          I wanted to follow up on my message from last week about how we might be able to help {{company}}.
          
          I understand you're probably busy, but I believe there's a good fit between what we do and {{company}}'s current goals in the {{industry}} space.
          
          Would you have just 10 minutes this week for a quick call? I can share some specific examples of how we've helped similar {{industry}} companies in {{location}}.
          
          Quick wins we typically provide:
          • 20-30% efficiency improvement within 3 months
          
          If this isn't the right time, no worries at all. I'll make sure not to reach out again unless you express interest.
          
          Best regards,
          {{senderName}}
        `
      }
    };
  }

  private replaceVariables(template: string, variables: Record<string, string>): string {
    let result = template;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, value);
    }

    return result;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async logEmailError(leadId: string, error: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { campaign: true }
    });

    if (lead) {
      await this.prisma.email.create({
        data: {
          campaignId: lead.campaignId,
          leadId: leadId,
          userId: lead.campaign.userId,
          subject: 'Email Send Error',
          content: error,
          status: 'FAILED',
          error
        }
      });
    }
  }

  private createRawMessage(mailOptions: SendMailOptions): string {
    // Create RFC822 compliant message
    const lines = [
      `From: ${mailOptions.from}`,
      `To: ${mailOptions.to}`,
      `Subject: ${mailOptions.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      mailOptions.html || mailOptions.text || ''
    ];

    return Buffer.from(lines.join('\r\n')).toString('base64');
  }

  // Gmail OAuth Flow methods
  static getOAuthUrl(userId: string): string {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: userId,
      prompt: 'consent'
    });
  }

  static async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    email: string;
  }> {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    // Get user email
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    
    const userInfo = await oauth2.userinfo.get();
    
    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresIn: tokens.expiry_date!,
      email: userInfo.data.email!
    };
  }

  async saveOAuthCredentials(userId: string, tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    email: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      // Update user with email if not set
      this.prisma.user.update({
        where: { id: userId },
        data: { 
          email: tokens.email,
          gmailConnected: true
        }
      }),
      
      // Save or update OAuth credentials
      this.prisma.oAuthCredential.upsert({
        where: {
          userId_provider: {
            userId,
            provider: 'gmail'
          }
        },
        update: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: new Date(tokens.expiresIn),
          updatedAt: new Date()
        },
        create: {
          userId,
          provider: 'gmail',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: new Date(tokens.expiresIn),
          scope: ['https://www.googleapis.com/auth/gmail.send']
        }
      })
    ]);
  }

  async disconnectGmail(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { 
          gmailConnected: false,
          gmailRefreshToken: null
        }
      }),
      this.prisma.oAuthCredential.delete({
        where: {
          userId_provider: {
            userId,
            provider: 'gmail'
          }
        }
      })
    ]);
  }

  async testGmailConnection(userId: string): Promise<{
    connected: boolean;
    email?: string;
    error?: string;
  }> {
    try {
      const credentials = await this.getOAuthCredentials(userId);
      if (!credentials) {
        return { connected: false, error: 'No Gmail credentials found' };
      }

      const accessToken = await this.refreshAccessToken(credentials);
      
      // Test by getting user info
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: credentials.refreshToken
      });

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      return { 
        connected: true, 
        email: userInfo.data.email || credentials.user.email 
      };
      
    } catch (error) {
      return { 
        connected: false, 
        error: error.message 
      };
    }
  }
}
