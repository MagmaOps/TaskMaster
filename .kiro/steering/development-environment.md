# Development Environment & Configuration

## Environment Setup Requirements

### System Prerequisites
- **Node.js**: Version 18+ (LTS recommended)
- **npm**: Version 8+ (comes with Node.js)
- **PostgreSQL**: Version 14+ for local development
- **Git**: Latest version for version control

### Development Database Setup
```bash
# Install PostgreSQL locally or use Docker
docker run --name taskmaster-db -e POSTGRES_PASSWORD=dev_password -e POSTGRES_DB=taskmaster_dev -p 5432:5432 -d postgres:14

# Or install PostgreSQL locally and create database
createdb taskmaster_dev
createdb taskmaster_test  # For testing
```

## Environment Configuration Files

### Frontend Environment (.env files)
```bash
# task-master-front/.env.development
REACT_APP_API_URL=http://localhost:3001/api
REACT_APP_ENV=development
REACT_APP_PWA_ENABLED=true

# task-master-front/.env.production
REACT_APP_API_URL=https://api.taskmaster.app/api
REACT_APP_ENV=production
REACT_APP_PWA_ENABLED=true

# task-master-front/.env.local (not committed to git)
REACT_APP_DEBUG=true
```

### Backend Environment (.env files)
```bash
# task-master-server/.env.development
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:dev_password@localhost:5432/taskmaster_dev
JWT_SECRET=your_jwt_secret_key_for_development
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10
CORS_ORIGIN=http://localhost:3000

# task-master-server/.env.production
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://username:password@host:5432/taskmaster_prod
JWT_SECRET=your_secure_jwt_secret_key
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
CORS_ORIGIN=https://taskmaster.app

# task-master-server/.env.test
NODE_ENV=test
DATABASE_URL=postgresql://postgres:dev_password@localhost:5432/taskmaster_test
JWT_SECRET=test_jwt_secret
JWT_EXPIRES_IN=1h
```

## Development Scripts Configuration

### Frontend Package.json Scripts
```json
{
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "test:coverage": "react-scripts test --coverage --watchAll=false",
    "eject": "react-scripts eject",
    "lint": "eslint src --ext .js,.jsx",
    "lint:fix": "eslint src --ext .js,.jsx --fix",
    "format": "prettier --write src/**/*.{js,jsx,css,md}",
    "analyze": "npm run build && npx serve -s build"
  }
}
```

### Backend Package.json Scripts
```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src --ext .js",
    "lint:fix": "eslint src --ext .js --fix",
    "format": "prettier --write src/**/*.js",
    "migrate": "node src/database/migrate.js",
    "migrate:rollback": "node src/database/migrate.js --rollback",
    "seed": "node src/database/seed.js",
    "db:reset": "npm run migrate:rollback && npm run migrate && npm run seed"
  }
}
```

## Configuration File Templates

### Frontend Configuration
```javascript
// task-master-front/src/config/index.js
const config = {
  apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
  environment: process.env.REACT_APP_ENV || 'development',
  pwaEnabled: process.env.REACT_APP_PWA_ENABLED === 'true',
  debug: process.env.REACT_APP_DEBUG === 'true',
  
  // App-specific configuration
  maxProjects: 20,
  taskWeightRefreshInterval: 60000, // 1 minute
  achievementToastDuration: 3000, // 3 seconds
  focusModeEnabled: true,
  
  // API endpoints
  endpoints: {
    auth: {
      login: '/auth/login',
      register: '/auth/register',
      refresh: '/auth/refresh',
      logout: '/auth/logout'
    },
    tasks: {
      base: '/tasks',
      complete: '/tasks/:id/complete',
      defer: '/tasks/:id/defer'
    },
    projects: {
      base: '/projects',
      reorder: '/projects/reorder'
    },
    achievements: '/achievements',
    analytics: '/analytics'
  }
};

export default config;
```

### Backend Configuration
```javascript
// task-master-server/src/config/index.js
require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3001,
  
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000
    }
  },
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS) || 10
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
  },
  
  // App-specific configuration
  limits: {
    maxProjectsPerUser: 20,
    maxTasksPerUser: 1000,
    rateLimitRequests: 100,
    rateLimitWindow: 15 * 60 * 1000 // 15 minutes
  },
  
  weightAlgorithm: {
    priorityMultipliers: { high: 3, medium: 2, low: 1 },
    deferralBonus: 5,
    repeatableMultiplier: 2,
    dueDateBonusMax: 35,
    overdueBonus: 10
  }
};

module.exports = config;
```

## Development Workflow

### Local Development Setup
1. **Clone and Install**:
   ```bash
   # Clone both repositories
   git clone <task-master-front-url>
   git clone <task-master-server-url>
   
   # Install frontend dependencies
   cd task-master-front && npm install
   
   # Install backend dependencies
   cd ../task-master-server && npm install
   ```

2. **Database Setup**:
   ```bash
   # Start PostgreSQL (Docker or local)
   # Run migrations
   cd task-master-server && npm run migrate
   
   # Seed development data
   npm run seed
   ```

3. **Start Development Servers**:
   ```bash
   # Terminal 1: Backend
   cd task-master-server && npm run dev
   
   # Terminal 2: Frontend
   cd task-master-front && npm start
   ```

### Environment Validation
```javascript
// backend/src/utils/validateEnv.js
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET'
];

const validateEnvironment = () => {
  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    process.exit(1);
  }
  
  console.log('✅ Environment validation passed');
};

module.exports = validateEnvironment;
```

## IDE Configuration

### VSCode Settings (.vscode/settings.json)
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "emmet.includeLanguages": {
    "javascript": "javascriptreact"
  },
  "files.associations": {
    "*.js": "javascriptreact"
  }
}
```

### Recommended VSCode Extensions
- ES7+ React/Redux/React-Native snippets
- Prettier - Code formatter
- ESLint
- Auto Rename Tag
- Bracket Pair Colorizer
- GitLens
- Thunder Client (for API testing)