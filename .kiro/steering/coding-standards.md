# Coding Standards & Best Practices

## Code Quality Standards

### General Principles
- **DRY (Don't Repeat Yourself)**: Extract common functionality into reusable functions/components
- **SOLID Principles**: Follow single responsibility, open/closed, and dependency inversion principles
- **Consistent Naming**: Use clear, descriptive names that explain purpose and behavior
- **Error Handling**: Always handle errors gracefully with user-friendly messages
- **Security First**: Validate all inputs, sanitize data, and follow security best practices

## React Frontend Standards

### Component Structure
```javascript
// TaskCard.jsx - Standard component structure
import React, { useState, useContext } from 'react';
import { TaskContext } from '../contexts/TaskContext';
import { formatDate } from '../utils/dateUtils';
import './TaskCard.css';

const TaskCard = ({ task, isTopTask = false }) => {
  const [isLoading, setIsLoading] = useState(false);
  const { completeTask, deferTask } = useContext(TaskContext);

  const handleComplete = async () => {
    setIsLoading(true);
    try {
      await completeTask(task.id);
    } catch (error) {
      console.error('Failed to complete task:', error);
      // Handle error appropriately
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`task-card ${isTopTask ? 'task-card--top' : ''}`}>
      {/* Component JSX */}
    </div>
  );
};

export default TaskCard;
```

### React Best Practices
- **Functional Components**: Always use functional components with hooks
- **PropTypes**: Define prop types for all components (or use TypeScript)
- **Error Boundaries**: Implement error boundaries for critical components
- **Memoization**: Use React.memo, useMemo, and useCallback for performance optimization
- **Custom Hooks**: Extract complex logic into custom hooks for reusability

### State Management Patterns
```javascript
// TaskContext.jsx - Context pattern
import React, { createContext, useReducer, useContext } from 'react';
import { taskService } from '../services/taskService';

const TaskContext = createContext();

const taskReducer = (state, action) => {
  switch (action.type) {
    case 'SET_TASKS':
      return { ...state, tasks: action.payload, loading: false };
    case 'ADD_TASK':
      return { ...state, tasks: [...state.tasks, action.payload] };
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(task =>
          task.id === action.payload.id ? action.payload : task
        )
      };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    default:
      return state;
  }
};

export const TaskProvider = ({ children }) => {
  const [state, dispatch] = useReducer(taskReducer, {
    tasks: [],
    loading: false,
    error: null
  });

  const createTask = async (taskData) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const newTask = await taskService.createTask(taskData);
      dispatch({ type: 'ADD_TASK', payload: newTask });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error.message });
    }
  };

  return (
    <TaskContext.Provider value={{ ...state, createTask }}>
      {children}
    </TaskContext.Provider>
  );
};

export const useTask = () => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error('useTask must be used within TaskProvider');
  }
  return context;
};
```

## Node.js Backend Standards

### Controller Structure
```javascript
// taskController.js - Standard controller structure
const { validationResult } = require('express-validator');
const taskService = require('../services/taskService');
const { ApiError } = require('../utils/errors');

const createTask = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid input data', errors.array());
    }

    // Extract user from authenticated request
    const userId = req.user.id;
    const taskData = { ...req.body, userId };

    // Call service layer
    const task = await taskService.createTask(taskData);

    // Return success response
    res.status(201).json({
      success: true,
      data: task,
      message: 'Task created successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTask
};
```

### Service Layer Pattern
```javascript
// taskService.js - Business logic layer
const taskRepository = require('../repositories/taskRepository');
const weightCalculator = require('../utils/weightCalculator');
const { ValidationError } = require('../utils/errors');

const createTask = async (taskData) => {
  // Validate business rules
  if (!taskData.subject || taskData.subject.trim().length === 0) {
    throw new ValidationError('Task subject is required');
  }

  // Apply business logic
  const task = {
    ...taskData,
    subject: taskData.subject.trim(),
    createdAt: new Date(),
    weight: weightCalculator.calculateInitialWeight(taskData)
  };

  // Save to database
  const savedTask = await taskRepository.create(task);
  
  // Return processed result
  return savedTask;
};

const getTasksByUser = async (userId, options = {}) => {
  const tasks = await taskRepository.findByUserId(userId, options);
  
  // Calculate current weights
  const tasksWithWeights = tasks.map(task => ({
    ...task,
    weight: weightCalculator.calculateWeight(task)
  }));

  // Sort by weight (highest first)
  return tasksWithWeights.sort((a, b) => b.weight - a.weight);
};

module.exports = {
  createTask,
  getTasksByUser
};
```

### Database Repository Pattern
```javascript
// taskRepository.js - Data access layer
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.database);

const create = async (taskData) => {
  const query = `
    INSERT INTO tasks (id, user_id, subject, priority, due_date, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  
  const values = [
    taskData.id,
    taskData.userId,
    taskData.subject,
    taskData.priority,
    taskData.dueDate,
    taskData.createdAt
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

const findByUserId = async (userId, options = {}) => {
  let query = `
    SELECT t.*, COUNT(d.id) as deferral_count
    FROM tasks t
    LEFT JOIN deferrals d ON t.id = d.task_id
    WHERE t.user_id = $1 AND t.archived_at IS NULL
  `;
  
  const values = [userId];
  
  if (options.projectId) {
    query += ` AND t.project_id = $2`;
    values.push(options.projectId);
  }
  
  query += ` GROUP BY t.id ORDER BY t.created_at DESC`;
  
  const result = await pool.query(query, values);
  return result.rows;
};

module.exports = {
  create,
  findByUserId
};
```

## Error Handling Standards

### Frontend Error Handling
```javascript
// errorHandler.js - Centralized error handling
export const handleApiError = (error) => {
  if (error.response) {
    // Server responded with error status
    const { status, data } = error.response;
    
    switch (status) {
      case 401:
        // Handle authentication errors
        localStorage.removeItem('token');
        window.location.href = '/login';
        break;
      case 403:
        return 'You do not have permission to perform this action';
      case 404:
        return 'The requested resource was not found';
      case 422:
        return data.error?.message || 'Invalid input data';
      default:
        return data.error?.message || 'An unexpected error occurred';
    }
  } else if (error.request) {
    // Network error
    return 'Unable to connect to the server. Please check your internet connection.';
  } else {
    // Other error
    return error.message || 'An unexpected error occurred';
  }
};
```

### Backend Error Handling
```javascript
// errorMiddleware.js - Express error handling middleware
const { ApiError } = require('../utils/errors');

const errorHandler = (error, req, res, next) => {
  console.error('Error:', error);

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
  }

  // Database errors
  if (error.code === '23505') { // Unique constraint violation
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this information already exists'
      }
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal server error occurred'
    }
  });
};

module.exports = errorHandler;
```

## Testing Standards

### Frontend Testing
```javascript
// TaskCard.test.jsx - Component testing
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskContext } from '../contexts/TaskContext';
import TaskCard from './TaskCard';

const mockTaskContext = {
  completeTask: jest.fn(),
  deferTask: jest.fn()
};

const mockTask = {
  id: '1',
  subject: 'Test Task',
  priority: 'high',
  weight: 10,
  createdAt: new Date()
};

const renderWithContext = (component) => {
  return render(
    <TaskContext.Provider value={mockTaskContext}>
      {component}
    </TaskContext.Provider>
  );
};

describe('TaskCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders task information correctly', () => {
    renderWithContext(<TaskCard task={mockTask} />);
    
    expect(screen.getByText('Test Task')).toBeInTheDocument();
    expect(screen.getByText('High Priority')).toBeInTheDocument();
  });

  test('calls completeTask when complete button is clicked', async () => {
    renderWithContext(<TaskCard task={mockTask} />);
    
    const completeButton = screen.getByRole('button', { name: /complete/i });
    fireEvent.click(completeButton);

    await waitFor(() => {
      expect(mockTaskContext.completeTask).toHaveBeenCalledWith('1');
    });
  });
});
```

### Backend Testing
```javascript
// taskService.test.js - Service testing
const taskService = require('./taskService');
const taskRepository = require('../repositories/taskRepository');
const { ValidationError } = require('../utils/errors');

jest.mock('../repositories/taskRepository');

describe('TaskService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    test('should create task with valid data', async () => {
      const taskData = {
        subject: 'Test Task',
        priority: 'high',
        userId: 'user-1'
      };

      const expectedTask = { ...taskData, id: 'task-1' };
      taskRepository.create.mockResolvedValue(expectedTask);

      const result = await taskService.createTask(taskData);

      expect(taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Test Task',
          priority: 'high',
          userId: 'user-1'
        })
      );
      expect(result).toEqual(expectedTask);
    });

    test('should throw ValidationError for empty subject', async () => {
      const taskData = {
        subject: '',
        priority: 'high',
        userId: 'user-1'
      };

      await expect(taskService.createTask(taskData))
        .rejects
        .toThrow(ValidationError);
    });
  });
});
```

## Performance Standards

### Frontend Performance
- **Bundle Size**: Keep main bundle under 500KB gzipped
- **Code Splitting**: Implement route-based code splitting
- **Lazy Loading**: Lazy load non-critical components
- **Memoization**: Use React.memo for expensive components
- **Image Optimization**: Optimize and compress all images

### Backend Performance
- **Database Queries**: Use indexes and optimize N+1 queries
- **Caching**: Implement Redis caching for frequently accessed data
- **Connection Pooling**: Use connection pooling for database connections
- **Rate Limiting**: Implement rate limiting on all public endpoints
- **Response Times**: Target <200ms for API responses