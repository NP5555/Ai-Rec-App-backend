#!/bin/bash

# AI Receptionist Backend Setup Script
# This script helps set up the Node.js/Express.js backend

set -e

echo "🚀 AI Receptionist Backend Setup"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if Node.js is installed
check_nodejs() {
    print_status "Checking Node.js installation..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        echo "Visit: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current version: $(node --version)"
        exit 1
    fi
    
    print_success "Node.js $(node --version) is installed"
}

# Check if Supabase CLI is installed (optional)
check_supabase() {
    print_status "Checking Supabase CLI installation..."
    
    if ! command -v supabase &> /dev/null; then
        print_warning "Supabase CLI is not installed (optional)."
        echo "You can install it for local development:"
        echo "Visit: https://supabase.com/docs/guides/cli"
        echo ""
        read -p "Do you want to continue without Supabase CLI? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            exit 1
        fi
    else
        print_success "Supabase CLI is available"
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Please run this script from the backend directory."
        exit 1
    fi
    
    npm install
    
    print_success "Dependencies installed successfully"
}

# Setup environment file
setup_environment() {
    print_status "Setting up environment configuration..."
    
    if [ ! -f ".env" ]; then
        if [ -f "env.example" ]; then
            cp env.example .env
            print_success "Environment file created from template"
            print_warning "Please edit .env file with your configuration"
        else
            print_error "env.example not found"
            exit 1
        fi
    else
        print_warning ".env file already exists"
    fi
}

# Setup database
setup_database() {
    print_status "Setting up Supabase database..."
    
    # Check if database connection is configured
    if [ -f ".env" ]; then
        source .env
        if [ -z "$SUPABASE_DB_URL" ] && [ -z "$DATABASE_URL" ]; then
            print_warning "Supabase database URL not configured in .env"
            echo "Please set SUPABASE_DB_URL or DATABASE_URL in your .env file"
        else
            print_success "Supabase database URL configured"
        fi
    fi
    
    echo ""
    print_warning "Supabase database setup steps:"
    echo "1. Create a Supabase project at: https://supabase.com"
    echo "2. Get your database connection string from:"
    echo "   Supabase Dashboard > Settings > Database > Connection string > URI"
    echo "3. Update .env with SUPABASE_DB_URL"
    echo "4. Run migrations: npm run migrate"
    echo "5. Seed data: npm run seed"
    echo ""
}

# Create logs directory
create_logs_directory() {
    print_status "Creating logs directory..."
    
    mkdir -p logs
    print_success "Logs directory created"
}

# Test setup
test_setup() {
    print_status "Testing setup..."
    
    # Test Node.js
    if node --version > /dev/null 2>&1; then
        print_success "Node.js is working"
    else
        print_error "Node.js test failed"
    fi
    
    # Test npm
    if npm --version > /dev/null 2>&1; then
        print_success "npm is working"
    else
        print_error "npm test failed"
    fi
    
    # Test if dependencies are installed
    if [ -d "node_modules" ]; then
        print_success "Dependencies are installed"
    else
        print_error "Dependencies are not installed"
    fi
}

# Main setup function
main() {
    echo ""
    print_status "Starting backend setup..."
    
    check_nodejs
    check_supabase
    install_dependencies
    setup_environment
    setup_database
    create_logs_directory
    test_setup
    
    echo ""
    print_success "Backend setup completed!"
    echo ""
    print_status "Next steps:"
    echo "1. Edit .env file with your Supabase configuration"
    echo "2. Create a Supabase project and get your database URL"
    echo "3. Run database setup: npm run migrate && npm run seed"
    echo "4. Start the server: npm run dev"
    echo ""
    print_status "Default super admin credentials:"
    echo "Email: admin@default.local"
    echo "Password: admin123"
    echo ""
    print_status "API will be available at: http://localhost:3000"
    echo "Health check: http://localhost:3000/health"
}

# Run main function
main "$@" 