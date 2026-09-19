# Project Structure & Architecture

## Repository Structure

The TaskMaster system follows a multi-repository structure with separate repositories for frontend and backend:

### Frontend Repository: `task-master-front`
```
task-master-front/
├── public/                  # Static assets and PWA manifest
│   ├── index.html
│   ├── manifest.json       # PWA manifest
│   ├── icons/              # App icons for PWA
│   └── favicon.ico
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── layout/         # Layout components (Layout, BottomNav, Toast)
│   │   ├── tasks/          # Task-related components
│   │   ├── projects/       # Project management components
│   │   └── gamification/   # Achievement and streak components
│   ├── contexts/           # React Context providers
│   ├── pages/              # Page-level components
│   ├── hooks/              # Custom React hooks
│   ├── utils/              # Utility functions and helpers
│   ├── services/           # API service functions
│   ├── styles/             # CSS and styling files
│   ├── config/             # Configuration files
│   └── App.js              # Main App component
├── package.json
├── .env.development
├── .env.production
├── .env.example
└── README.md
```

### Backend Repository: `task-master-server`
```
task-master-server/
├── src/
│   ├── controllers/        # Route handlers and business logic
│   ├── middleware/         # Express middleware functions
│   ├── models/             # Database models and schemas
│   ├── routes/             # API route definitions
│   ├── services/           # Business logic services
│   │   ├── auth/           # Authentication services
│   │   ├── tasks/          # Task management services
│   │   ├── projects/       # Project management services
│   │   ├── gamification/   # Achievement and streak services
│   │   └── analytics/      # Analytics and reporting services
│   ├── utils/              # Utility functions and helpers
│   ├── config/             # Configuration files
│   ├── database/           # Database migrations and seeds
│   └── server.js           # Main server entry point
├── package.json
├── .env.development
├── .env.production
├── .env.test
├── .env.example
└── README.md
```

## Architecture Principles

### Frontend Architecture
- **Component-Based**: Use functional React components with hooks
- **Context Pattern**: Use React Context for global state management (Auth, Tasks, Projects, Settings)
- **Service Layer**: Separate API calls into dedicated service functions
- **Custom Hooks**: Extract reusable logic into custom hooks
- **Responsive Design**: Mobile-first approach with Progressive Web App capabilities

### Backend Architecture
- **MVC Pattern**: Controllers handle requests, Services contain business logic, Models define data structure
- **Middleware Chain**: Authentication, validation, error handling through Express middleware
- **Service Layer**: Business logic separated from route handlers
- **Repository Pattern**: Database operations abstracted through repository classes
- **Error Handling**: Centralized error handling with consistent response formats

### Database Design
- **PostgreSQL**: Primary database with UUID primary keys
- **Soft Deletion**: Use archived_at timestamps instead of hard deletes
- **JSONB Storage**: Use JSONB for flexible data (settings, repeat patterns)
- **Indexing Strategy**: Comprehensive indexes for performance optimization
- **Migration System**: Version-controlled database schema changes

## Naming Conventions

### Files and Directories
- **React Components**: PascalCase (e.g., `TaskCard.jsx`, `QuickAddModal.jsx`)
- **Hooks**: camelCase with "use" prefix (e.g., `useTaskWeight.js`, `useAuth.js`)
- **Services**: camelCase (e.g., `taskService.js`, `authService.js`)
- **Utilities**: camelCase (e.g., `dateUtils.js`, `weightCalculator.js`)
- **API Routes**: kebab-case (e.g., `/api/tasks`, `/api/user-projects`)

### Code Conventions
- **Variables**: camelCase (e.g., `taskWeight`, `userProjects`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_PROJECTS`, `WEIGHT_MULTIPLIERS`)
- **Database Tables**: snake_case (e.g., `users`, `task_projects`, `user_achievements`)
- **API Endpoints**: RESTful with kebab-case (e.g., `GET /api/tasks`, `POST /api/user-settings`)

## Technology Stack Standards

### Frontend Dependencies
- **Core**: React 18+, React Router v6, React Context API
- **HTTP**: Axios for API requests with interceptors
- **UI**: react-beautiful-dnd for drag-and-drop, date-fns for date manipulation
- **PWA**: Workbox for service worker, web-app-manifest for PWA configuration
- **Development**: Create React App or Vite for build tooling

### Backend Dependencies
- **Core**: Node.js 18+, Express.js 4+
- **Authentication**: Passport.js with JWT strategy, bcrypt for password hashing
- **Database**: node-postgres (pg) for PostgreSQL connectivity
- **Validation**: express-validator for input validation and sanitization
- **Security**: helmet for security headers, cors for CORS configuration
- **Development**: nodemon for development, PM2 for production process management

### Development Tools
- **Linting**: ESLint with React and Node.js configurations
- **Formatting**: Prettier with consistent configuration across frontend and backend
- **Testing**: Jest for unit testing, React Testing Library for component testing
- **Git**: Conventional commit messages, feature branch workflow