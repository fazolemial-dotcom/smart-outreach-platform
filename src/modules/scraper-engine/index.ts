import puppeteer, { Browser, Page } from 'puppeteer';
import { PrismaClient } from '@prisma/client';
import { EmailValidator } from './validator';

interface Lead {
  name: string;
  email: string;
  company?: string;
  role?: string;
  location?: string;
  source: string;
  metadata?: any;
  userId?: string;
  campaignId?: string;
}

interface CampaignProfile {
  targetIndustry: string | null;
  targetLocation: string | null;
  targetRole: string | null;
  keywords: string[];
  description: string;
  campaignId: string;
  userId: string;
}

interface ScrapingResult {
  totalFound: number;
  validLeads: number;
  duplicates: number;
  errors: string[];
  leads: Lead[];
}

export class ScraperEngine {
  private prisma: PrismaClient;
  private validator: EmailValidator;

  constructor() {
    this.prisma = new PrismaClient();
    this.validator = new EmailValidator();
  }

  async scrapeProspects(profile: CampaignProfile, limit: number = 2000): Promise<ScrapingResult> {
    const results: ScrapingResult = {
      totalFound: 0,
      validLeads: 0,
      duplicates: 0,
      errors: [],
      leads: []
    };

    let browser: Browser | null = null;

    try {
      // Launch browser with optimized settings
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      
      // Set optimized viewport and user agent
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Set request interception to block unnecessary resources
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'media', 'font'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Scrape from multiple sources
      const scrapingTasks = [
        () => this.scrapeLinkedIn(page, profile, Math.ceil(limit * 0.6)),
        () => this.scrapeCompanyDirectories(page, profile, Math.ceil(limit * 0.3)),
        () => this.scrapeIndustryDatabases(page, profile, Math.ceil(limit * 0.1))
      ];

      for (const scrapeTask of scrapingTasks) {
        try {
          const leads = await scrapeTask();
          results.totalFound += leads.length;
          results.leads.push(...leads);

          // Validate and store leads
          for (const lead of leads) {
            const isValid = await this.validator.validateEmail(lead.email);
            if (!isValid) continue;

            const isDuplicate = await this.checkDuplicate(lead, profile.userId);
            if (isDuplicate) {
              results.duplicates++;
              continue;
            }

            // Store in database
            await this.storeLead(lead, profile);
            results.validLeads++;
          }

          if (results.validLeads >= limit) break;

        } catch (error) {
          results.errors.push(`Scraping source error: ${error.message}`);
        }
      }

      await browser.close();

    } catch (error) {
      results.errors.push(`Browser error: ${error.message}`);
      if (browser) await browser.close();
    }

    return results;
  }

  private async scrapeLinkedIn(page: Page, profile: CampaignProfile, limit: number): Promise<Lead[]> {
    const leads: Lead[] = [];
    
    try {
      console.log('Starting LinkedIn scraping...');
      
      // Build LinkedIn search URL
      const searchQuery = this.buildLinkedInSearchQuery(profile);
      
      // Use Google to find LinkedIn profiles (since direct LinkedIn scraping is restricted)
      await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
      await page.type('textarea[name="q"]', `${searchQuery} site:linkedin.com/in`);
      await page.keyboard.press('Enter');
      
      await page.waitForSelector('h3', { timeout: 10000 });
      
      // Extract profile links
      const profileLinks = await page.evaluate((limit) => {
        const links = Array.from(document.querySelectorAll('h3 a'));
        return links
          .map(link => link.getAttribute('href'))
          .filter(href => href && href.includes('/in/'))
          .slice(0, limit);
      }, limit);
      
      console.log(`Found ${profileLinks.length} LinkedIn profiles`);
      
      // Visit each profile to extract information
      for (const profileUrl of profileLinks) {
        try {
          if (leads.length >= limit) break;
          
          await page.goto(profileUrl, { waitUntil: 'networkidle2' });
          
          // Wait for profile to load
          await page.waitForSelector('h1', { timeout: 5000 });
          
          const profileData = await page.evaluate(() => {
            const nameEl = document.querySelector('h1');
            const titleEl = document.querySelector('.text-body-medium');
            const companyEl = document.querySelector('.text-body-medium + .text-body-medium');
            const locationEl = document.querySelector('.text-body-small.overflow-hidden');
            
            const name = nameEl?.textContent?.trim() || '';
            const title = titleEl?.textContent?.trim() || '';
            const company = companyEl?.textContent?.trim() || '';
            const location = locationEl?.textContent?.trim() || '';
            
            return { name, title, company, location };
          });
          
          if (profileData.name) {
            // Generate email from name and company
            const email = this.generateEmailFromProfile(profileData);
            
            if (email) {
              leads.push({
                name: profileData.name,
                email,
                company: profileData.company || undefined,
                role: this.extractRoleFromTitle(profileData.title),
                location: profileData.location || undefined,
                source: 'linkedin',
                metadata: {
                  linkedinUrl: profileUrl,
                  title: profileData.title
                }
              });
            }
          }
          
          // Rate limiting - wait between requests
          await page.waitForTimeout(2000);
          
        } catch (error) {
          console.error(`Error processing LinkedIn profile ${profileUrl}:`, error);
        }
      }

    } catch (error) {
      throw new Error(`LinkedIn scraping failed: ${error.message}`);
    }

    console.log(`LinkedIn scraping completed: ${leads.length} leads found`);
    return leads;
  }

  private async scrapeCompanyDirectories(page: Page, profile: CampaignProfile, limit: number): Promise<Lead[]> {
    const leads: Lead[] = [];
    
    // List of business directory sites
    const directories = [
      {
        name: 'ZoomInfo',
        url: 'https://www.zoominfo.com',
        searchQuery: this.buildDirectorySearchQuery(profile)
      },
      {
        name: 'Apollo',
        url: 'https://www.apollo.io',
        searchQuery: this.buildDirectorySearchQuery(profile)
      },
      {
        name: 'Hunter',
        url: 'https://hunter.io',
        searchQuery: this.buildHunterSearchQuery(profile)
      }
    ];

    for (const directory of directories) {
      try {
        console.log(`Scraping ${directory.name}...`);
        
        await page.goto(directory.url, { waitUntil: 'networkidle2' });
        
        // Handle cookie consent if present
        try {
          await page.click('button[contains(text(), "Accept")], button[contains(text(), "Agree")]', { timeout: 3000 });
        } catch (e) {
          // Cookie banner not present or different selector
        }
        
        // Search for companies
        await this.performDirectorySearch(page, directory.searchQuery);
        
        const directoryLeads = await this.extractDirectoryLeads(page, directory.name, limit / directories.length);
        leads.push(...directoryLeads);
        
        if (leads.length >= limit) break;
        
      } catch (error) {
        console.error(`Error scraping ${directory.name}:`, error);
      }
    }

    console.log(`Directory scraping completed: ${leads.length} leads found`);
    return leads;
  }

  private async scrapeIndustryDatabases(page: Page, profile: CampaignProfile, limit: number): Promise<Lead[]> {
    const leads: Lead[] = [];
    
    // Industry-specific databases
    const industrySites = this.getIndustrySpecificSites(profile.targetIndustry);
    
    for (const site of industrySites) {
      try {
        console.log(`Scraping ${site.name}...`);
        
        await page.goto(site.url, { waitUntil: 'networkidle2' });
        
        const siteLeads = await this.extractIndustryLeads(page, site, limit / industrySites.length);
        leads.push(...siteLeads);
        
        if (leads.length >= limit) break;
        
      } catch (error) {
        console.error(`Error scraping ${site.name}:`, error);
      }
    }

    console.log(`Industry database scraping completed: ${leads.length} leads found`);
    return leads;
  }

  private async checkDuplicate(lead: Lead, userId: string): Promise<boolean> {
    const existing = await this.prisma.lead.findFirst({
      where: {
        email: lead.email,
        campaign: {
          userId: userId
        }
      }
    });
    
    return !!existing;
  }

  private async storeLead(lead: Lead, profile: CampaignProfile): Promise<void> {
    await this.prisma.lead.create({
      data: {
        campaignId: profile.campaignId,
        email: lead.email,
        name: lead.name,
        company: lead.company,
        role: lead.role,
        location: lead.location,
        source: lead.source,
        metadata: lead.metadata,
        status: 'NEW'
      }
    });
  }

  private buildLinkedInSearchQuery(profile: CampaignProfile): string {
    const terms = [
      profile.targetRole,
      profile.targetIndustry,
      profile.targetLocation
    ].filter(Boolean);
    
    return encodeURIComponent(terms.join(' '));
  }

  private buildDirectorySearchQuery(profile: CampaignProfile): string {
    const terms = [
      profile.targetIndustry,
      profile.targetLocation,
      profile.targetRole
    ].filter(Boolean);
    
    return encodeURIComponent(terms.join(' '));
  }

  private buildHunterSearchQuery(profile: CampaignProfile): string {
    return encodeURIComponent(`${profile.targetIndustry} ${profile.targetLocation}`);
  }

  private generateEmailFromProfile(profileData: { name: string; company: string }): string | null {
    if (!profileData.company) return null;
    
    const domain = this.extractDomainFromCompany(profileData.company);
    if (!domain) return null;
    
    const nameParts = profileData.name.split(' ');
    if (nameParts.length < 2) return null;
    
    const firstName = nameParts[0].toLowerCase();
    const lastName = nameParts[nameParts.length - 1].toLowerCase();
    
    // Common email patterns
    const patterns = [
      `${firstName}.${lastName}@${domain}`,
      `${firstName}${lastName[0]}@${domain}`,
      `${firstName[0]}${lastName}@${domain}`,
      `${firstName}@${domain}`,
      `${lastName}@${domain}`
    ];
    
    return patterns[0]; // Return first pattern as most common
  }

  private extractDomainFromCompany(companyName: string): string | null {
    // Remove common company suffixes
    const cleanName = companyName
      .replace(/\s+(inc|llc|corp|corporation|ltd|limited|co|company)\.?$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    
    if (cleanName.length === 0) return null;
    
    // Map company names to common domains
    const domainMap: Record<string, string> = {
      'microsoft': 'microsoft.com',
      'google': 'google.com',
      'amazon': 'amazon.com',
      'apple': 'apple.com',
      'facebook': 'facebook.com',
      'netflix': 'netflix.com',
      'uber': 'uber.com',
      'airbnb': 'airbnb.com',
      'twitter': 'twitter.com',
      'linkedin': 'linkedin.com'
    };
    
    if (domainMap[cleanName]) {
      return domainMap[cleanName];
    }
    
    // Generate generic domain
    return `${cleanName}.com`;
  }

  private extractRoleFromTitle(title: string): string {
    const rolePatterns: Record<string, string[]> = {
      'executive': ['ceo', 'cto', 'cfo', 'founder', 'president', 'vp', 'vice president'],
      'manager': ['manager', 'director', 'head', 'lead', 'supervisor'],
      'developer': ['developer', 'engineer', 'programmer', 'software'],
      'marketing': ['marketing', 'growth', 'brand', 'content'],
      'sales': ['sales', 'business development', 'account'],
      'design': ['designer', 'design', 'ux', 'ui'],
      'product': ['product manager', 'product owner']
    };
    
    const lowerTitle = title.toLowerCase();
    
    for (const [role, keywords] of Object.entries(rolePatterns)) {
      if (keywords.some(keyword => lowerTitle.includes(keyword))) {
        return role;
      }
    }
    
    return 'professional';
  }

  private async performDirectorySearch(page: Page, searchQuery: string): Promise<void> {
    // Implementation depends on specific directory structure
    // This is a generic implementation
    try {
      const searchSelectors = [
        'input[name="q"]',
        'input[placeholder*="search" i]',
        'input[type="search"]',
        '.search-input input'
      ];
      
      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await page.$(selector);
          if (searchInput) break;
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (searchInput) {
        await searchInput.type(searchQuery, { delay: 100 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } catch (error) {
      console.error('Directory search failed:', error);
    }
  }

  private async extractDirectoryLeads(page: Page, directoryName: string, limit: number): Promise<Lead[]> {
    const leads: Lead[] = [];
    
    try {
      // Extract company/person cards
      const cardSelectors = [
        '.result-item',
        '.company-card',
        '.person-card',
        '.search-result',
        '[data-testid*="result"]'
      ];
      
      let cards: any[] = [];
      for (const selector of cardSelectors) {
        try {
          cards = await page.$$(selector);
          if (cards.length > 0) break;
        } catch (e) {
          // Continue to next selector
        }
      }
      
      for (let i = 0; i < Math.min(cards.length, limit); i++) {
        try {
          const card = cards[i];
          
          const cardData = await page.evaluate((cardElement) => {
            const nameEl = cardElement.querySelector('h3, h4, .name, [class*="name"]');
            const companyEl = cardElement.querySelector('.company, [class*="company"], .organization');
            const titleEl = cardElement.querySelector('.title, [class*="title"], .role');
            const locationEl = cardElement.querySelector('.location, [class*="location"]');
            
            return {
              name: nameEl?.textContent?.trim() || '',
              company: companyEl?.textContent?.trim() || '',
              title: titleEl?.textContent?.trim() || '',
              location: locationEl?.textContent?.trim() || ''
            };
          }, card);
          
          if (cardData.name) {
            const email = this.generateEmailFromProfile(cardData);
            if (email) {
              leads.push({
                name: cardData.name,
                email,
                company: cardData.company || undefined,
                role: this.extractRoleFromTitle(cardData.title),
                location: cardData.location || undefined,
                source: directoryName.toLowerCase()
              });
            }
          }
          
        } catch (error) {
          console.error(`Error extracting directory lead ${i}:`, error);
        }
      }
      
    } catch (error) {
      console.error(`Error extracting leads from ${directoryName}:`, error);
    }
    
    return leads;
  }

  private getIndustrySpecificSites(industry: string | null): Array<{ name: string; url: string; selector?: string }> {
    const industrySites: Record<string, Array<{ name: string; url: string; selector?: string }>> = {
      'technology': [
        { name: 'GitHub', url: 'https://github.com' },
        { name: 'Stack Overflow', url: 'https://stackoverflow.com' }
      ],
      'healthcare': [
        { name: 'Healthcare Directory', url: 'https://www.healthcare directories.com' }
      ],
      'finance': [
        { name: 'Financial Services Directory', url: 'https://www.financial directories.com' }
      ],
      'general': [
        { name: 'General Business Directory', url: 'https://www.business directories.com' }
      ]
    };
    
    return industrySites[industry || 'general'] || industrySites['general'];
  }

  private async extractIndustryLeads(page: Page, site: { name: string; url: string; selector?: string }, limit: number): Promise<Lead[]> {
    // Implementation for industry-specific extraction
    // This would be customized based on each industry's directory structure
    return [];
  }
}

// src/modules/scraper-engine/validator.ts
export class EmailValidator {
  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly disposableDomains = [
    'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.org',
    'throwaway.email', 'getnada.com', 'maildrop.cc', 'sharklasers.com',
    'grr.la', 'guerrillamail.com', 'mailcatch.com', 'mailexpire.com'
  ];
  
  private static readonly suspiciousPatterns = [
    /\d{5,}@/, // Too many digits
    /[a-z]{20,}@/, // Very long usernames
    /test.*@/, // Test emails
    /example.*@/, // Example emails
    /noreply.*@/, // No-reply emails
    /donotreply.*@/, // Do not reply emails
    /no-reply.*@/ // No reply emails
  ];

  static async validateEmail(email: string): Promise<boolean> {
    // Basic format validation
    if (!this.EMAIL_REGEX.test(email)) {
      return false;
    }

    // Check for suspicious patterns
    if (this.suspiciousPatterns.some(pattern => pattern.test(email))) {
      return false;
    }

    // Check disposable email domains
    const domain = email.split('@')[1].toLowerCase();
    if (this.disposableDomains.includes(domain)) {
      return false;
    }

    // Additional validation
    const username = email.split('@')[0];
    if (username.length < 2 || username.length > 50) {
      return false;
    }

    // Check for common typos in domain
    const commonTypos = ['gamil.com', 'gmial.com', 'gmaill.com', 'hotnail.com', 'yaho.com'];
    if (commonTypos.includes(domain)) {
      return false;
    }

    return true;
  }

  static async validateEmailWithVerification(email: string): Promise<{
    isValid: boolean;
    deliverability: 'valid' | 'risky' | 'invalid';
    details: string;
  }> {
    // Basic validation first
    const basicValid = await this.validateEmail(email);
    if (!basicValid) {
      return {
        isValid: false,
        deliverability: 'invalid',
        details: 'Email format is invalid or contains suspicious patterns'
      };
    }

    // MX record check (simplified - would need DNS library in production)
    try {
      const domain = email.split('@')[1];
      // In a real implementation, you would check MX records here
      // For now, we'll just return basic validation
      return {
        isValid: true,
        deliverability: 'valid',
        details: 'Email passed basic validation'
      };
    } catch (error) {
      return {
        isValid: false,
        deliverability: 'invalid',
        details: 'Email domain validation failed'
      };
    }
  }

  static async bulkValidateEmails(emails: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const validations = await Promise.all(
        batch.map(email => this.validateEmail(email))
      );
      
      batch.forEach((email, index) => {
        results.set(email, validations[index]);
      });
    }
    
    return results;
  }
}
