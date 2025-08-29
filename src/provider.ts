/**
 * Cortensor Provider for Mastra AI
 * 
 * This module provides integration between the Cortensor API and the Vercel AI SDK.
 * It creates an OpenAI-compatible interface that handles session management,
 * request/response transformations, and error handling automatically.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { transformToCortensor, transformToOpenAI } from './transformers';
import type { CortensorConfig, CortensorModelConfig, WebSearchResult, WebSearchCallback } from './types';
import { DEFAULT_MODEL_CONFIG } from './constants';

// Enhanced logging function
function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = `[PROVIDER ${timestamp}] ${message}`;
  console.log(logMessage);
  if (data !== undefined) {
    console.log('Data:', JSON.stringify(data, null, 2));
  }
}

// Global registry for web search providers to handle function serialization
const webSearchProviderRegistry = new Map<string, WebSearchCallback>();
let providerIdCounter = 0;

log('Provider module initialized');
log('Web search provider registry created');

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

// Load environment variables (validation happens at runtime)
const CORTENSOR_API_KEY = process.env.CORTENSOR_API_KEY;
const CORTENSOR_BASE_URL = process.env.CORTENSOR_BASE_URL;

log('Environment variables loaded', {
  hasApiKey: !!CORTENSOR_API_KEY,
  hasBaseUrl: !!CORTENSOR_BASE_URL,
  apiKeyPrefix: CORTENSOR_API_KEY?.substring(0, 8),
  baseUrl: CORTENSOR_BASE_URL
});

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
  log('Validating Cortensor configuration', { hasApiKey: !!apiKey, hasBaseUrl: !!baseUrl });

  if (!apiKey) {
    log('❌ Validation failed: Missing CORTENSOR_API_KEY');
    throw new ConfigurationError(
      'CORTENSOR_API_KEY is required. Set it as environment variable or pass it explicitly.'
    );
  }
  if (!baseUrl) {
    log('❌ Validation failed: Missing CORTENSOR_BASE_URL');
    throw new ConfigurationError(
      'CORTENSOR_BASE_URL is required. Set it as environment variable or pass it explicitly.'
    );
  }

  log('✅ Configuration validation passed');
}


/**
 * Extracts model configuration and session ID from request body
 * @param requestBody - The request body as string
 * @returns Object containing sessionId and modelConfig with defaults applied
 * @throws Error if configuration cannot be extracted
 */
export function extractModelConfiguration(requestBody: string): {
  sessionId: number;
  modelConfig?: CortensorModelConfig;
} {
  log('🔍 Extracting model configuration from request body', { 
    requestBodyLength: requestBody.length,
    requestBodyPreview: requestBody.substring(0, 200) + '...'
  });

  try {
    const parsedBody = JSON.parse(requestBody);
    log('✅ Request body parsed successfully', { 
      hasModel: !!parsedBody.model,
      modelType: typeof parsedBody.model
    });

    const modelName = parsedBody.model;

    if (typeof modelName !== 'string') {
      log('❌ Model name is not a string', { modelName, modelType: typeof modelName });
      throw new Error('Model name must be a string');
    }



    // Extract configuration from model name (format: modelname-config-base64encodedconfig)
    log('🔍 Looking for config pattern in model name', { modelName });
    
    const configMatch = modelName.match(/-config-([A-Za-z0-9+/=]+)$/);
    if (!configMatch || !configMatch[1]) {
      log('❌ Config pattern not found in model name', { 
        modelName, 
        hasConfigMatch: !!configMatch,
        configMatchValue: configMatch?.[1] 
      });
      throw new Error('Configuration not found in model name. Model name should end with "-config-{base64EncodedConfig}"');
    }
    
    log('✅ Config pattern found', { 
      fullMatch: configMatch[0], 
      configBase64: configMatch[1].substring(0, 20) + '...' 
    });



    // Decode the base64 encoded configuration
    const configBase64 = configMatch[1];
    log('🔓 Decoding base64 configuration', { 
      configBase64Length: configBase64.length,
      configBase64Preview: configBase64.substring(0, 20) + '...'
    });
    
    const configJson = Buffer.from(configBase64, 'base64').toString('utf-8');
    log('✅ Base64 decoded to JSON string', { 
      configJsonLength: configJson.length,
      configJsonPreview: configJson.substring(0, 200) + '...'
    });

    const decodedConfig = JSON.parse(configJson) as Partial<CortensorModelConfig>;
    log('✅ JSON configuration parsed successfully', { 
      hasSessionId: !!decodedConfig.sessionId,
      hasWebSearch: !!decodedConfig.webSearch,
      configKeys: Object.keys(decodedConfig)
    });


    if (!decodedConfig.sessionId) {
      log('❌ Session ID not found in decoded configuration', { decodedConfig });
      throw new Error('Session ID not found in model configuration');
    }
    
    log('✅ Session ID found', { sessionId: decodedConfig.sessionId });



    // Merge decoded configuration with defaults

    const modelConfig: CortensorModelConfig = {
      sessionId: decodedConfig.sessionId,
      modelName: decodedConfig.modelName ?? DEFAULT_MODEL_CONFIG.modelName,
      temperature: decodedConfig.temperature ?? DEFAULT_MODEL_CONFIG.temperature,
      maxTokens: decodedConfig.maxTokens ?? DEFAULT_MODEL_CONFIG.maxTokens,
      topP: decodedConfig.topP ?? DEFAULT_MODEL_CONFIG.topP,
      topK: decodedConfig.topK ?? DEFAULT_MODEL_CONFIG.topK,
      presencePenalty: decodedConfig.presencePenalty ?? DEFAULT_MODEL_CONFIG.presencePenalty,
      frequencyPenalty: decodedConfig.frequencyPenalty ?? DEFAULT_MODEL_CONFIG.frequencyPenalty,
      stream: decodedConfig.stream ?? DEFAULT_MODEL_CONFIG.stream,
      timeout: decodedConfig.timeout ?? DEFAULT_MODEL_CONFIG.timeout,
      promptType: decodedConfig.promptType ?? DEFAULT_MODEL_CONFIG.promptType,
      promptTemplate: decodedConfig.promptTemplate ?? DEFAULT_MODEL_CONFIG.promptTemplate
    };

    // Copy web search configuration if present
    if (decodedConfig.webSearch) {
      log('🔍 Web search configuration found', { 
        webSearchConfig: decodedConfig.webSearch,
        hasProvider: !!decodedConfig.webSearch.provider,
        providerType: typeof decodedConfig.webSearch.provider
      });
      
      modelConfig.webSearch = { ...decodedConfig.webSearch };

      // Restore web search provider function from registry if it's a reference
      if (modelConfig.webSearch.provider && typeof modelConfig.webSearch.provider === 'string' && (modelConfig.webSearch.provider as string).startsWith('provider_')) {
        const providerId = modelConfig.webSearch.provider as string;
        log('🔍 Looking up web search provider in registry', { providerId });
        
        const providerFunction = webSearchProviderRegistry.get(providerId);

        if (providerFunction) {
          log('✅ Web search provider found in registry', { providerId });
          modelConfig.webSearch.provider = providerFunction;
        } else {
          log('❌ Web search provider not found in registry', { providerId });
          delete modelConfig.webSearch.provider;
        }
      } else {
        log('ℹ️ Web search provider is not a registry reference', { 
          providerType: typeof modelConfig.webSearch.provider 
        });
      }
    } else {
      log('ℹ️ No web search configuration found');
    }



    const result = {
      sessionId: modelConfig.sessionId,
      modelConfig
    };

    log('✅ Model configuration extraction completed', { 
      sessionId: result.sessionId,
      hasWebSearch: !!result.modelConfig.webSearch,
      modelConfigKeys: Object.keys(result.modelConfig)
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('❌ Failed to extract model configuration', { 
      error: errorMessage, 
      errorType: error instanceof Error ? error.constructor.name : 'Unknown'
    });

    throw new Error(`Failed to extract model configuration: ${errorMessage}`);
  }
}

/**
 * Creates a standardized error response for the provider
 * @param error - The error that occurred
 * @returns Response object with error details
 */
function createProviderErrorResponse(error: unknown): Response {
  log('🚨 Creating provider error response', { 
    errorType: error instanceof Error ? error.constructor.name : 'Unknown',
    errorMessage: error instanceof Error ? error.message : 'Unknown error'
  });

  let errorMessage = 'Unknown error';
  let errorCode = 'UNKNOWN_ERROR';
  let statusCode = 500;

  if (error instanceof CortensorError) {
    errorMessage = error.message;
    errorCode = error.code;
    log('📝 Cortensor error details', { errorCode, errorMessage });

    // Set appropriate status codes for different error types
    if (error instanceof ConfigurationError) {
      statusCode = 400; // Bad Request
      log('🔧 Configuration error - setting 400 status');
    } else if (error instanceof WebSearchError) {
      statusCode = 502; // Bad Gateway
      log('🌐 Web search error - setting 502 status');
    }
  } else if (error instanceof Error) {
    errorMessage = error.message;
    log('📝 Generic error details', { errorMessage });
  }

  const errorResponse = {
    error: {
      message: errorMessage,
      type: 'provider_error',
      code: errorCode
    }
  };

  log('📤 Sending error response', { statusCode, errorResponse });

  return new Response(
    JSON.stringify(errorResponse),
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
  log('🚀 Starting request processing', { 
    requestBodyLength: requestBody.length,
    requestBodyPreview: requestBody.substring(0, 200) + '...'
  });

  // Extract configuration from request
  log('🔍 Extracting model configuration...');
  const { sessionId, modelConfig } = extractModelConfiguration(requestBody);
  log('✅ Model configuration extracted', { sessionId, hasWebSearch: !!modelConfig?.webSearch });

  // Transform to Cortensor format
  log('🔄 Transforming request to Cortensor format...');
  const transformResult = await transformToCortensor(requestBody, sessionId, modelConfig);
  log('✅ Request transformed to Cortensor format', { 
    hasRequest: !!transformResult.request,
    hasWebSearchResults: !!transformResult.webSearchResults,
    webSearchResultsCount: transformResult.webSearchResults?.length || 0
  });

  // Prepare API request
  const cortensorUrl = `${CORTENSOR_BASE_URL}/api/v1/completions`;
  log('🌐 Preparing Cortensor API request', { 
    url: cortensorUrl,
    hasApiKey: !!CORTENSOR_API_KEY,
    requestBodyLength: JSON.stringify(transformResult.request).length
  });

  const cortensorOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CORTENSOR_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(transformResult.request),
  };

  // Make API call
  log('📡 Making Cortensor API call...');
  const cortensorResponse = await fetch(cortensorUrl, cortensorOptions);
  log('📡 Cortensor API response received', { 
    status: cortensorResponse.status,
    statusText: cortensorResponse.statusText,
    ok: cortensorResponse.ok
  });

  if (!cortensorResponse.ok) {
    log('❌ Cortensor API call failed', { 
      status: cortensorResponse.status,
      statusText: cortensorResponse.statusText
    });
    throw new Error(`Cortensor API error: ${cortensorResponse.status} ${cortensorResponse.statusText}`);
  }

  // Process response
  log('📥 Processing Cortensor response...');
  const responseText = await cortensorResponse.text();
  log('✅ Response text received', { 
    responseLength: responseText.length,
    responsePreview: responseText.substring(0, 200) + '...'
  });

  const cortensorResponseClone = new Response(responseText, {
    status: cortensorResponse.status,
    statusText: cortensorResponse.statusText,
    headers: cortensorResponse.headers
  });
  log('🔄 Response cloned for transformation');

  // Transform back to OpenAI format with web search results
  log('🔄 Transforming response to OpenAI format...');
  const finalResponse = await transformToOpenAI(cortensorResponseClone, transformResult.webSearchResults, transformResult.searchQuery);
  log('✅ Response transformation completed');

  return finalResponse;
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
  baseURL: `${CORTENSOR_BASE_URL}`,
  headers: {
    'Authorization': `Bearer ${CORTENSOR_API_KEY || ''}`,
    'Content-Type': 'application/json',
  },
  fetch: async (input, options: RequestInit = {}) => {
    log('🎯 Provider fetch called', { 
      input: typeof input === 'string' ? input : 'Request object',
      hasBody: !!options.body,
      bodyType: typeof options.body,
      bodyLength: typeof options.body === 'string' ? options.body.length : 'N/A'
    });

    try {
      // Validate configuration at runtime
      log('🔧 Validating configuration...');
      validateCortensorConfig(CORTENSOR_API_KEY, CORTENSOR_BASE_URL);
      log('✅ Configuration validation passed');

      const requestBody = options.body as string;
      log('📝 Processing request body', { 
        bodyLength: requestBody?.length || 0,
        bodyPreview: requestBody?.substring(0, 200) + '...' || 'No body'
      });

      const result = await processRequest(requestBody);
      log('✅ Request processing completed successfully');

      return result;
    } catch (error) {
      log('❌ Error in provider fetch', { 
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });

      const errorResponse = createProviderErrorResponse(error);
      log('📤 Returning error response');

      return errorResponse;
    }
  },
});

// ============================================================================
// MODEL CREATION UTILITIES
// ============================================================================

/**
 * Creates a configurable Cortensor model with custom parameters
 * @param config - Configuration options for the model (optional, uses defaults if not provided)
 * @returns Cortensor model instance with applied configuration
 */
export function cortensorModel(config: { sessionId: number } & Partial<Omit<CortensorModelConfig, 'sessionId'>>): ReturnType<typeof cortensorProvider> {
  log('🏗️ Creating Cortensor model', { 
    sessionId: config.sessionId,
    hasWebSearch: !!config.webSearch,
    configKeys: Object.keys(config)
  });
  
  // Validate required session ID
  if (!config.sessionId) {
    log('❌ Session ID validation failed');
    throw new Error('Session ID is required for Cortensor model creation');
  }
  
  log('✅ Session ID validation passed');

  // Only include explicitly provided configuration values
  const configToEncode: Partial<CortensorModelConfig> = {
    sessionId: config.sessionId
  };

  // Add only the properties that were explicitly provided
  if (config.modelName !== undefined) configToEncode.modelName = config.modelName;
  if (config.temperature !== undefined) configToEncode.temperature = config.temperature;
  if (config.maxTokens !== undefined) configToEncode.maxTokens = config.maxTokens;
  if (config.topP !== undefined) configToEncode.topP = config.topP;
  if (config.topK !== undefined) configToEncode.topK = config.topK;
  if (config.presencePenalty !== undefined) configToEncode.presencePenalty = config.presencePenalty;
  if (config.frequencyPenalty !== undefined) configToEncode.frequencyPenalty = config.frequencyPenalty;
  if (config.stream !== undefined) configToEncode.stream = config.stream;
  if (config.timeout !== undefined) configToEncode.timeout = config.timeout;
  if (config.promptType !== undefined) configToEncode.promptType = config.promptType;
  if (config.promptTemplate !== undefined) configToEncode.promptTemplate = config.promptTemplate;

  // Handle web search configuration with provider function serialization
  if (config.webSearch !== undefined) {
    log('🔍 Processing web search configuration', { 
      webSearchConfig: config.webSearch,
      hasProvider: !!config.webSearch.provider,
      providerType: typeof config.webSearch.provider
    });
    
    const webSearchConfig = { ...config.webSearch };

    // If there's a provider function, store it in the registry and use a reference
    if (webSearchConfig.provider && typeof webSearchConfig.provider === 'function') {
      const providerId = `provider_${providerIdCounter++}_${Date.now()}`;
      log('📝 Storing web search provider in registry', { providerId });
      webSearchProviderRegistry.set(providerId, webSearchConfig.provider);

      // Replace the function with a reference
      configToEncode.webSearch = {
        ...webSearchConfig,
        provider: providerId as any // Store the ID instead of the function
      };
      log('✅ Web search provider stored in registry', { providerId });
    } else {
      log('ℹ️ Web search provider is not a function, using as-is');
      configToEncode.webSearch = webSearchConfig;
    }
  } else {
    log('ℹ️ No web search configuration provided');
  }

  // Encode configuration as base64 JSON and embed in model name
  log('🔐 Encoding configuration to base64...');
  const configJson = JSON.stringify(configToEncode);
  const configBase64 = Buffer.from(configJson, 'utf-8').toString('base64');
  const modelName = config.modelName || DEFAULT_MODEL_CONFIG.modelName;
  const uniqueModelName = `${modelName}-config-${configBase64}`;
  
  log('✅ Configuration encoded', { 
    originalModelName: modelName,
    configLength: configJson.length,
    base64Length: configBase64.length,
    uniqueModelName: uniqueModelName.substring(0, 50) + '...'
  });

  // Create model instance with unique name that contains encoded configuration
  log('🏭 Creating model instance...');
  const modelInstance = cortensorProvider(uniqueModelName);
  log('✅ Model instance created successfully');

  return modelInstance;
}


// ============================================================================
// EXPORTS
// ============================================================================

// Re-export transformer functions for convenience
export { transformToCortensor, transformToOpenAI } from './transformers';



// ============================================================================
// CUSTOM PROVIDER FACTORY
// ============================================================================

// Note: Model configurations are now embedded directly in model names as base64 JSON,
// so no global state management or cleanup functions are needed.

/**
 * Creates a custom Cortensor provider with specific configuration
 * @param config - Configuration options to override defaults
 * @returns Configured Cortensor provider instance
 */
export function createCortensorProvider(config: CortensorConfig = {}) {
  log('🏭 Creating custom Cortensor provider', { 
    hasCustomApiKey: !!config.apiKey,
    hasCustomBaseURL: !!config.baseURL,
    configKeys: Object.keys(config)
  });
  
  // Use provided config or fall back to environment variables
  const apiKey = config.apiKey || CORTENSOR_API_KEY;
  const baseURL = config.baseURL || `${CORTENSOR_BASE_URL}/v1`;
  
  log('🔑 Using API configuration', { 
    apiKeySource: config.apiKey ? 'custom' : 'environment',
    baseURLSource: config.baseURL ? 'custom' : 'environment',
    hasApiKey: !!apiKey,
    baseURL: baseURL
  });

  // Validate configuration
  if (!apiKey) {
    log('❌ Custom provider validation failed: Missing API key');
    throw new Error('API key is required for custom Cortensor provider');
  }
  
  log('✅ Custom provider validation passed');

  /**
   * Custom request processor for the provider
   * @param requestBody - The request body as string
   * @returns Promise<Response> - The processed response
   */
  async function processCustomRequest(requestBody: string): Promise<Response> {
    log('🔄 Custom provider processing request', { 
      requestBodyLength: requestBody.length,
      requestBodyPreview: requestBody.substring(0, 200) + '...'
    });
    
    // Extract configuration from request
    const { sessionId, modelConfig } = extractModelConfiguration(requestBody);
    log('✅ Custom provider configuration extracted', { sessionId });

    // Transform to Cortensor format
    log('🔄 Custom provider transforming request...');
    const cortensorRequest = transformToCortensor(requestBody, sessionId, modelConfig);
    log('✅ Custom provider request transformed');

    // Prepare API request with custom config
    const cortensorUrl = `${CORTENSOR_BASE_URL}/api/v1/completions`;
    log('🌐 Custom provider preparing API request', { url: cortensorUrl });
    
    const cortensorOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cortensorRequest),
    };

    // Make API call
    log('📡 Custom provider making API call...');
    const cortensorResponse = await fetch(cortensorUrl, cortensorOptions);
    log('📡 Custom provider API response received', { 
      status: cortensorResponse.status,
      ok: cortensorResponse.ok
    });

    if (!cortensorResponse.ok) {
      log('❌ Custom provider API call failed', { 
        status: cortensorResponse.status,
        statusText: cortensorResponse.statusText
      });
      throw new Error(`Cortensor API error: ${cortensorResponse.status} ${cortensorResponse.statusText}`);
    }

    // Process response
    log('📥 Custom provider processing response...');
    const responseText = await cortensorResponse.text();
    log('✅ Custom provider response text received', { responseLength: responseText.length });

    const cortensorResponseClone = new Response(responseText, {
      status: cortensorResponse.status,
      statusText: cortensorResponse.statusText,
      headers: cortensorResponse.headers
    });

    // Transform back to OpenAI format
    log('🔄 Custom provider transforming response...');
    const result = await transformToOpenAI(cortensorResponseClone);
    log('✅ Custom provider response transformation completed');
    
    return result;
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
      log('🎯 Custom provider fetch called', { 
        input: typeof input === 'string' ? input : 'Request object',
        hasBody: !!options.body
      });
      
      try {
        const requestBody = options.body as string;
        log('📝 Custom provider processing request body', { bodyLength: requestBody?.length || 0 });
        
        const result = await processCustomRequest(requestBody);
        log('✅ Custom provider request completed successfully');
        
        return result;
      } catch (error) {
        log('❌ Custom provider error', { 
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });

        return createProviderErrorResponse(error);
      }
    }
  });
}
