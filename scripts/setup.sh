#!/bin/bash

# Smart Outreach Automation Platform Setup Script
# This script sets up the complete development environment

set -e

echo "🚀 Setting up Smart Outreach Automation Platform..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Node.js is installed
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ and try again."
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    print_success "Node.js found: $NODE_VERSION"
}

# Check if npm is installed
check_npm() {
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm and try again."
        exit 1
    fi
    
    NPM_VERSION=$(npm --version)
    print_success "npm found: $NPM_VERSION"
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    npm install
    print_success "Dependencies installed successfully"
}

# Setup environment variables
setup_env() {
    print_status "Setting up environment variables..."
    
    if [ ! -f .env.local ]; then
        cp .env.example .env.local
        print_warning "Created .env.local from template"
        print_warning "Please edit .env.local with your actual configuration values"
    else
        print_warning ".env.local already exists"
    fi
}

# Setup database
setup_database() {
    print_status "Setting up database..."
    
    # Check if PostgreSQL is available
    if command -v psql &> /dev/null; then
        print_success "PostgreSQL CLI found"
    else
        print_warning "PostgreSQL CLI not found. Make sure PostgreSQL is installed and running."
    fi
    
    # Generate Prisma client
    print_status "Generating Prisma client..."
    npx prisma generate
    
    # Run migrations
    print_status "Running database migrations..."
    npx prisma migrate dev --name init
    
    print_success "Database setup completed"
}

# Setup Redis (if available)
setup_redis() {
    print_status "Checking Redis installation..."
    
    if command -v redis-cli &> /dev/null; then
        print_success "Redis CLI found"
        
        # Test Redis connection
        if redis-cli ping &> /dev/null; then
            print_success "Redis is running and accessible"
        else
            print_warning "Redis is installed but not running. Please start Redis server."
        fi
    else
        print_warning "Redis CLI not found. Please install Redis for job queue functionality."
    fi
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p temp
    mkdir -p backups
    
    print_success "Directories created"
}

# Build the application
build_app() {
    print_status "Building the application..."
    npm run build
    print_success "Application built successfully"
}

# Setup PM2 ecosystem
setup_pm2() {
    print_status "Setting up PM2 ecosystem..."
    
    cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'api-server',
    script: 'npm',
    args: 'run start',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }, {
    name: 'scraper-worker',
    script: 'npm',
    args: 'run worker:scraper',
    instances: 2,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }, {
    name: 'sender-worker',
    script: 'npm',
    args: 'run worker:sender',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }, {
    name: 'scheduler-worker',
    script: 'npm',
    args: 'run worker:scheduler',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }, {
    name: 'reply-handler-worker',
    script: 'npm',
    args: 'run worker:reply-handler',
    instances: 2,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }, {
    name: 'ai-analysis-worker',
    script: 'npm',
    args: 'run worker:ai-analysis',
    instances: 3,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
EOF

    print_success "PM2 ecosystem file created"
}

# Main setup function
main() {
    echo "=========================================="
    echo "Smart Outreach Automation Platform Setup"
    echo "=========================================="
    echo ""
    
    # Prerequisites check
    print_status "Checking prerequisites..."
    check_node
    check_npm
    
    echo ""
    
    # Setup steps
    install_dependencies
    echo ""
    
    setup_env
    echo ""
    
    setup_database
    echo ""
    
    setup_redis
    echo ""
    
    create_directories
    echo ""
    
    setup_pm2
    echo ""
    
    # Build application
    build_app
    echo ""
    
    # Final instructions
    echo "=========================================="
    print_success "Setup completed successfully!"
    echo "=========================================="
    echo ""
    echo "Next steps:"
    echo "1. Edit .env.local with your configuration values"
    echo "2. Set up Google OAuth credentials"
    echo "3. Configure your database connection"
    echo "4. Start the development server:"
    echo "   npm run dev"
    echo ""
    echo "To start background workers (in separate terminals):"
    echo "   npm run worker:scraper"
    echo "   npm run worker:sender"
    echo "   npm run worker:scheduler"
    echo "   npm run worker:reply-handler"
    echo "   npm run worker:ai-analysis"
    echo ""
    echo "For production deployment:"
    echo "   pm2 start ecosystem.config.js"
    echo ""
    echo "For more information, see README.md"
    echo ""
}

# Run main function
main "$@"
