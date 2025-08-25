/**
 * Cortensor Provider for Mastra AI
 * 
 * This module provides integration between the Cortensor API and the Vercel AI SDK.
 * It creates an OpenAI-compatible interface that handles session management,
 * request/response transformations, and error handling automatically.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { transformToCortensor, transformToOpenAI } from './transformers';

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

// Load environment variables (validation happens at runtime)
const CORTENSOR_API_KEY = process.env.CORTENSOR_API_KEY;
const CORTENSOR_BASE_URL = process.env.CORTENSOR_BASE_URL;

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base error class for Cortensor-related errors
 */
export class CortensorError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'CortensorError';
  }
}

/**
 * Error thrown when web search operations fail
 */
export class WebSearchError extends CortensorError {
  constructor(message: string) {
    super(message, 'WEB_SEARCH_ERROR');
  }
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends CortensorError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
  }
}

/**
 * Validates Cortensor configuration at runtime
 * @param apiKey - API key to validate
 * @param baseUrl - Base URL to validate
 * @throws ConfigurationError if validation fails
 */
function validateCortensorConfig(apiKey?: string, baseUrl?: string): void {
  if (!apiKey) {
    throw new ConfigurationError(
      'CORTENSOR_API_KEY is required. Set it as environment variable or pass it explicitly.'
    );
  }
  if (!baseUrl) {
    throw new ConfigurationError(
      'CORTENSOR_BASE_URL is required. Set it as environment variable or pass it explicitly.'
    );
  }
}

// ============================================================================
// WEB SEARCH INTERFACES
// ============================================================================

/**
 * Base interface for web search providers
 */
export interface WebSearchProvider {
  search(query: string, maxResults?: number): Promise<WebSearchResult[]>;
}

/**
 * Flexible callback type - can be a provider or direct function
 */
export type WebSearchCallback =
  | WebSearchProvider
  | ((query: string, maxResults?: number) => Promise<WebSearchResult[]>);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Global configuration store for model instances
const modelConfigurations = new Map<string, CortensorModelConfig>();

/**
 * Extracts model configuration and session ID from request body
 * @param requestBody - The request body as string
 * @returns Object containing sessionId and modelConfig
 * @throws Error if session ID is not found
 */
function extractModelConfiguration(requestBody: string): {
  sessionId: number;
  modelConfig?: CortensorModelConfig;
} {
  try {
    const parsedBody = JSON.parse(requestBody);
    const modelName = parsedBody.model;

    if (typeof modelName !== 'string') {
      throw new Error('Model name must be a string');
    }

    // Extract session ID from model name
    const sessionMatch = modelName.match(/-session-(\d+)$/);
    if (!sessionMatch || !sessionMatch[1]) {
      throw new Error('Session ID not found in model name. Model name should end with "-session-{sessionId}"');
    }

    const sessionId = parseInt(sessionMatch[1]);
    const modelConfig = modelConfigurations.get(modelName);

    if (!modelConfig) {
      throw new Error(`Model configuration not found for model: ${modelName}`);
    }

    return {
      sessionId,
      modelConfig
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to extract model configuration: ${errorMessage}`);
  }
}

/**
 * Creates a standardized error response for the provider
 * @param error - The error that occurred
 * @returns Response object with error details
 */
function createProviderErrorResponse(error: unknown): Response {
  let errorMessage = 'Unknown error';
  let errorCode = 'UNKNOWN_ERROR';
  let statusCode = 500;

  if (error instanceof CortensorError) {
    errorMessage = error.message;
    errorCode = error.code;

    // Set appropriate status codes for different error types
    if (error instanceof ConfigurationError) {
      statusCode = 400; // Bad Request
    } else if (error instanceof WebSearchError) {
      statusCode = 502; // Bad Gateway
    }
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return new Response(
    JSON.stringify({
      error: {
        message: errorMessage,
        type: 'provider_error',
        code: errorCode
      }
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}

/**
 * Handles the core request processing logic
 * @param requestBody - The request body as string
 * @returns Promise<Response> - The processed response
 */
async function processRequest(requestBody: string): Promise<Response> {
  // Extract configuration from request
  const { sessionId, modelConfig } = extractModelConfiguration(requestBody);

  // Transform to Cortensor format
  const transformResult = await transformToCortensor(requestBody, sessionId, modelConfig);

  // Prepare API request
  const cortensorUrl = `${CORTENSOR_BASE_URL}/api/v1/completions`;
  const cortensorOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CORTENSOR_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(transformResult.request),
  };

  // Make API call
  const cortensorResponse = await fetch(cortensorUrl, cortensorOptions);

  if (!cortensorResponse.ok) {
    throw new Error(`Cortensor API error: ${cortensorResponse.status} ${cortensorResponse.statusText}`);
  }

  // Process response
  const responseText = await cortensorResponse.text();
  const cortensorResponseClone = new Response(responseText, {
    status: cortensorResponse.status,
    statusText: cortensorResponse.statusText,
    headers: cortensorResponse.headers
  });

  // Transform back to OpenAI format with web search results
  return await transformToOpenAI(cortensorResponseClone, transformResult.webSearchResults, transformResult.searchQuery);
}

// ============================================================================
// MAIN PROVIDER
// ============================================================================

/**
 * Main Cortensor provider using OpenAI-compatible interface
 * Handles session management and format transformations automatically
 */
export const cortensorProvider = createOpenAICompatible({
  name: 'cortensor',
  baseURL: `${CORTENSOR_BASE_URL || 'https://api.cortensor.com'}/v1`,
  headers: {
    'Authorization': `Bearer ${CORTENSOR_API_KEY || ''}`,
    'Content-Type': 'application/json',
  },
  fetch: async (input, options: RequestInit = {}) => {
    try {
      // Validate configuration at runtime
      validateCortensorConfig(CORTENSOR_API_KEY, CORTENSOR_BASE_URL);

      const requestBody = options.body as string;
      return await processRequest(requestBody);
    } catch (error) {
      console.error('Cortensor provider error:', error);
      return createProviderErrorResponse(error);
    }
  },
});

// ============================================================================
// MODEL CREATION UTILITIES
// ============================================================================

/**
 * Creates a configurable Cortensor model with custom parameters
 * @param config - Configuration options for the model
 * @returns Cortensor model instance with applied configuration
 */
export function cortensorModel(config: CortensorModelConfig): ReturnType<typeof cortensorProvider> {
  // Extract configuration with defaults
  const {
    sessionId,
    modelName = 'cortensor-chat',
    temperature = 0.7,
    maxTokens = 128,
    topP = 0.95,
    topK = 40,
    presencePenalty = 0,
    frequencyPenalty = 0,
    stream = false,
    timeout = 60,
    promptType = 1,
    promptTemplate = ''
  } = config;

  // Validate required session ID
  if (!sessionId) {
    throw new Error('Session ID is required for Cortensor model creation');
  }

  // Create a unique model identifier that includes session ID
  const uniqueModelName = `${modelName}-session-${sessionId}`;

  // Store the complete configuration globally
  const configToStore = {
    sessionId,
    modelName,
    temperature,
    maxTokens,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    stream,
    timeout,
    promptType,
    promptTemplate
  };

  modelConfigurations.set(uniqueModelName, configToStore);

  // Create model instance with unique name that contains session ID
  const modelInstance = cortensorProvider(uniqueModelName);

  return modelInstance;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration options for Cortensor provider
 */
export interface CortensorConfig {
  /** API key for authentication (optional, defaults to env var) */
  apiKey?: string;
  /** Base URL for the API (optional, defaults to env var) */
  baseURL?: string;
  /** Request timeout in seconds */
  timeout?: number;
  /** Session timeout in seconds */
  sessionTimeout?: number;
}

/**
 * Web search result structure
 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

/**
 * Web search request structure
 */
export interface WebSearchRequest {
  query: string;
  maxResults: number;
}

/**
 * Web search configuration options
 */
export interface WebSearchConfig {
  mode: 'prompt' | 'force' | 'disable';
  provider?: WebSearchCallback;
  maxResults?: number;
}

/**
 * Model configuration options for Cortensor models
 */
export interface CortensorModelConfig {
  /** Required session ID for the conversation */
  sessionId: number;
  /** Model name identifier */
  modelName?: string;
  /** Sampling temperature (0.0 to 2.0) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Top-p sampling parameter */
  topP?: number;
  /** Top-k sampling parameter */
  topK?: number;
  /** Presence penalty (-2.0 to 2.0) */
  presencePenalty?: number;
  /** Frequency penalty (-2.0 to 2.0) */
  frequencyPenalty?: number;
  /** Whether to stream responses */
  stream?: boolean;
  /** Request timeout in seconds */
  timeout?: number;
  /** Prompt type identifier */
  promptType?: number;
  /** Custom prompt template */
  promptTemplate?: string;
  /** Web search configuration */
  webSearch?: WebSearchConfig;
}

// ============================================================================
// EXPORTS
// ============================================================================

// Re-export transformer functions for convenience
export { transformToCortensor, transformToOpenAI } from './transformers';

// Re-export types for external use
export type {
  OpenAIRequest,
  CortensorRequest,
  OpenAIResponse,
  CortensorResponse,
  CortensorChoice,
  CortensorUsage
} from './types';

// ============================================================================
// CUSTOM PROVIDER FACTORY
// ============================================================================

/**
 * Clears stored model configurations (useful for cleanup)
 * @param sessionId - Optional session ID to clear specific session configs
 */
export function clearModelConfigurations(sessionId?: number) {
  if (sessionId) {
    // Clear configurations for specific session
    for (const [modelName, config] of modelConfigurations.entries()) {
      if (config.sessionId === sessionId) {
        modelConfigurations.delete(modelName);
      }
    }
  } else {
    // Clear all configurations
    modelConfigurations.clear();
  }
}

/**
 * Gets the current number of stored model configurations
 * @returns Number of stored configurations
 */
export function getStoredConfigurationsCount(): number {
  return modelConfigurations.size;
}

/**
 * Creates a custom Cortensor provider with specific configuration
 * @param config - Configuration options to override defaults
 * @returns Configured Cortensor provider instance
 */
export function createCortensorProvider(config: CortensorConfig = {}) {
  // Use provided config or fall back to environment variables
  const apiKey = config.apiKey || CORTENSOR_API_KEY;
  const baseURL = config.baseURL || `${CORTENSOR_BASE_URL}/v1`;

  // Validate configuration
  if (!apiKey) {
    throw new Error('API key is required for custom Cortensor provider');
  }

  /**
   * Custom request processor for the provider
   * @param requestBody - The request body as string
   * @returns Promise<Response> - The processed response
   */
  async function processCustomRequest(requestBody: string): Promise<Response> {
    // Extract configuration from request
    const { sessionId, modelConfig } = extractModelConfiguration(requestBody);

    // Transform to Cortensor format
    const cortensorRequest = transformToCortensor(requestBody, sessionId, modelConfig);

    // Prepare API request with custom config
    const cortensorUrl = `${CORTENSOR_BASE_URL}/api/v1/completions`;
    const cortensorOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cortensorRequest),
    };

    // Make API call
    const cortensorResponse = await fetch(cortensorUrl, cortensorOptions);

    if (!cortensorResponse.ok) {
      throw new Error(`Cortensor API error: ${cortensorResponse.status} ${cortensorResponse.statusText}`);
    }

    // Process response
    const responseText = await cortensorResponse.text();
    const cortensorResponseClone = new Response(responseText, {
      status: cortensorResponse.status,
      statusText: cortensorResponse.statusText,
      headers: cortensorResponse.headers
    });

    // Transform back to OpenAI format
    return await transformToOpenAI(cortensorResponseClone);
  }

  // Return configured provider
  return createOpenAICompatible({
    name: 'cortensor-custom',
    baseURL,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    fetch: async (input, options: RequestInit = {}) => {
      try {
        const requestBody = options.body as string;
        return await processCustomRequest(requestBody);
      } catch (error) {
        console.error('Custom Cortensor provider error:', error);
        return createProviderErrorResponse(error);
      }
    }
  });
}
