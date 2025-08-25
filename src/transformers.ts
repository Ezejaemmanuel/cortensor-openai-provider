/**
 * Cortensor API Transformers
 * 
 * This module handles the conversion between OpenAI format and Cortensor API format.
 * It provides utilities to transform requests and responses between the two formats,
 * enabling seamless integration with the Vercel AI SDK.
 */

import type { ModelMessage } from 'ai';
import type { 
  CortensorModelConfig, 
  WebSearchResult, 
  WebSearchCallback,
  CortensorRequest,
  CortensorResponse,
  CortensorChoice,
  CortensorUsage,
  OpenAIRequest,
  OpenAIResponse,
  SearchDirectives,
  CortensorTransformResult
} from './types';
import { WebSearchError, ConfigurationError } from './provider';

// ============================================================================
// WEB SEARCH FUNCTIONALITY
// ============================================================================

/**
 * Extracts search directives from messages and cleans the content
 * @param messages - Array of conversation messages
 * @param webSearchConfig - Web search configuration
 * @returns Search directives and cleaned messages
 */
export function extractSearchDirectives(
  messages: ModelMessage[],
  webSearchConfig?: CortensorModelConfig['webSearch']
): SearchDirectives {
  if (!webSearchConfig) {
    return {
      shouldSearch: false,
      cleanedMessages: messages,
    };
  }

  if (messages.length === 0) {
    return {
      shouldSearch: false,
      cleanedMessages: messages,
    };
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    return {
      shouldSearch: false,
      cleanedMessages: messages,
    };
  }

  const originalContent = extractMessageContent(lastMessage);
  let cleanedContent = originalContent;
  let shouldSearch = false;

  // Check for [search] marker
  const hasSearchMarker = /\[search\]/i.test(originalContent);
  // Check for [no-search] marker
  const hasNoSearchMarker = /\[no-search\]/i.test(originalContent);

  // Remove markers from content
  cleanedContent = cleanedContent.replace(/\[search\]/gi, '').replace(/\[no-search\]/gi, '').trim();

  // Determine if search should be performed based on mode and markers
  if (webSearchConfig.mode === 'force') {
    shouldSearch = true;
  } else if (webSearchConfig.mode === 'disable') {
    shouldSearch = false;
  } else { // prompt-based mode
    if (hasNoSearchMarker) {
      shouldSearch = false;
    } else if (hasSearchMarker) {
      shouldSearch = true;
    } else {
      shouldSearch = false; // Default to no search unless explicitly requested
    }
  }

  const cleanedMessages: ModelMessage[] = [
    ...messages.slice(0, -1),
    {
      ...lastMessage,
      content: cleanedContent as any
    }
  ];

  return {
    shouldSearch,
    cleanedMessages,
  };
}



/**
 * Generates a search query from conversation messages
 * @param messages - Array of conversation messages
 * @param cortensorConfig - Configuration for making API calls to Cortensor
 * @returns Promise resolving to search query string
 */
export async function generateSearchQuery(
  messages: ModelMessage[],
  cortensorConfig: { apiKey: string; baseUrl: string; sessionId: number }
): Promise<string> {
  if (messages.length === 0) {
    return 'general information';
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    return 'general information';
  }

  const userPrompt = extractMessageContent(lastMessage);

  // Create a prompt to ask the model to generate a search query
  const searchQueryPrompt = `Convert the following user prompt into a concise web search query (maximum 10 words). Only return the search query, nothing else:\n\nUser prompt: ${userPrompt}`;

  try {
    // Validate configuration
    if (!cortensorConfig.apiKey || !cortensorConfig.baseUrl) {
      throw new ConfigurationError('API key and base URL are required for search query generation');
    }

    const response = await fetch(`${cortensorConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cortensorConfig.apiKey}`
      },
      body: JSON.stringify({
        session_id: cortensorConfig.sessionId,
        prompt: searchQueryPrompt,
        max_tokens: 50,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new WebSearchError(`Failed to generate search query: API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const searchQuery = data.choices?.[0]?.text?.trim() || userPrompt;

    return searchQuery;
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof WebSearchError) {
      throw error; // Re-throw custom errors
    }
    console.warn('Failed to generate search query via API, using original prompt:', error);
    return userPrompt;
  }
}

/**
 * Formats search results for inclusion in the prompt
 * @param results - Array of search results
 * @param query - The search query used
 * @param format - Format type for results
 * @returns Formatted search results string
 */
export function formatSearchResults(
  results: WebSearchResult[],
  query: string,
  format: 'json' | 'markdown' | 'plain' = 'markdown'
): string {
  if (results.length === 0) {
    return `No search results found for query: "${query}"`;
  }

  switch (format) {
    case 'json':
      return JSON.stringify(results, null, 2);

    case 'plain':
      return results.map((result, index) =>
        `${index + 1}. ${result.title}\n${result.snippet}\nSource: ${result.url}\n`
      ).join('\n');

    case 'markdown':
    default:
      return results.map((result, index) =>
        `### ${index + 1}. ${result.title}\n\n${result.snippet}\n\n**Source:** [${result.url}](${result.url})${result.publishedDate ? `\n**Published:** ${result.publishedDate}` : ''}\n`
      ).join('\n---\n\n');
  }
}

/**
 * Builds a prompt enhanced with search results
 * @param messages - Original conversation messages
 * @param searchResults - Web search results
 * @param searchQuery - The query used for searching
 * @returns Enhanced prompt string
 */
export function buildPromptWithSearchResults(
  messages: ModelMessage[],
  searchResults: WebSearchResult[],
  searchQuery: string
): string {
  const systemMessages = messages.filter(msg => msg.role === 'system');
  const conversationMessages = messages.filter(msg => msg.role !== 'system');

  const originalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
  const formattedResults = formatSearchResults(searchResults, searchQuery);

  return `${originalPrompt}\n\n--- WEB SEARCH RESULTS ---\nSearch Query: "${searchQuery}"\n\n${formattedResults}\n\nPlease use the above search results to provide an accurate, up-to-date response. If the search results are relevant, incorporate the information into your answer. If they're not relevant, you can ignore them and provide a general response.`;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts text content from a message, handling both string and array formats
 * @param message - The message to extract content from
 * @returns The extracted text content
 */
function extractMessageContent(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter(part => {
        // Handle string parts
        if (typeof part === 'string') return true;
        // Handle text objects
        if (typeof part === 'object' && part !== null && 'type' in part) {
          return part.type === 'text';
        }
        return false;
      })
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }
        // Extract text from text objects
        return (part as any).text || '';
      })
      .join(' ')
      .trim();
  }

  return '';
}

/**
 * Builds a formatted prompt from system and conversation messages
 * @param systemMessages - Array of system messages
 * @param conversationMessages - Array of conversation messages
 * @returns Formatted prompt string
 */
function buildFormattedPrompt(systemMessages: ModelMessage[], conversationMessages: ModelMessage[]): string {
  let prompt = '';

  // Add system instructions section if present
  if (systemMessages.length > 0) {
    const systemInstructions = systemMessages
      .map(msg => extractMessageContent(msg))
      .join('\n\n');

    prompt += `### SYSTEM INSTRUCTIONS ###\n${systemInstructions}\n\n### CONVERSATION ###\n`;
  }

  // Add conversation history with role formatting
  const conversationText = conversationMessages
    .map(msg => {
      const content = extractMessageContent(msg);
      switch (msg.role) {
        case 'user':
          return `Human: ${content}`;
        case 'assistant':
          return `Assistant: ${content}`;
        default:
          return content;
      }
    })
    .join('\n\n');

  prompt += conversationText;

  // Add assistant prompt if the last message is from user
  const lastMessage = conversationMessages[conversationMessages.length - 1];
  if (conversationMessages.length > 0 && lastMessage?.role === 'user') {
    prompt += '\n\nAssistant:';
  }

  return prompt;
}

/**
 * Helper function to handle different web search callback types
 * @param query - The search query
 * @param provider - The web search provider (object or function)
 * @param maxResults - Maximum number of results to return
 * @returns Promise resolving to search results
 */
async function handleWebSearch(
  query: string,
  provider: WebSearchCallback,
  maxResults: number
): Promise<WebSearchResult[]> {
  try {
    // Check if it's a provider object with search method or direct function
    if (typeof provider === 'function') {
      return await provider(query, maxResults);
    } else {
      return await provider.search(query, maxResults);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown web search error';
    throw new WebSearchError(`Web search failed: ${errorMessage}`);
  }
}

/**
 * Transforms OpenAI request format to Cortensor API format
 * @param requestBody - The OpenAI-formatted request body as string
 * @param sessionId - The session ID to include in the request
 * @param modelConfig - Optional model configuration to override defaults
 * @returns Cortensor transform result with request and optional web search data
 */
export async function transformToCortensor(
  requestBody: string,
  sessionId: number,
  modelConfig?: CortensorModelConfig
): Promise<CortensorTransformResult> {
  try {
    const openAIRequest: OpenAIRequest = JSON.parse(requestBody);

    // Extract search directives and clean messages
    const searchDirectives = extractSearchDirectives(openAIRequest.messages, modelConfig?.webSearch);
    let finalPrompt: string = '';
    let webSearchResults: WebSearchResult[] | undefined;
    let searchQuery: string | undefined;

    // Handle web search if needed
    if (searchDirectives.shouldSearch && modelConfig?.webSearch?.provider) {
      try {
        // Generate search query using main Cortensor configuration
        searchQuery = await generateSearchQuery(
          searchDirectives.cleanedMessages,
          {
            apiKey: process.env.CORTENSOR_API_KEY || '',
            baseUrl: process.env.CORTENSOR_BASE_URL || '',
            sessionId: sessionId
          }
        );

        // Perform web search using flexible provider
        webSearchResults = await handleWebSearch(
          searchQuery,
          modelConfig.webSearch.provider,
          modelConfig.webSearch.maxResults ?? 5
        );

        // Build enhanced prompt with search results
        finalPrompt = buildPromptWithSearchResults(
          searchDirectives.cleanedMessages,
          webSearchResults,
          searchQuery
        );
      } catch (error) {
        if (error instanceof ConfigurationError) {
          throw error;
        }

        // Log web search errors but continue with fallback
        if (error instanceof WebSearchError) {
          console.warn('Web search failed, continuing without search results:', error.message);
        } else {
          console.warn('Unexpected error during web search:', error);
        }

        // Fall through to standard prompt building
      }
    }

    // Build standard prompt if no search or search failed
    if (!finalPrompt) {
      const systemMessages = searchDirectives.cleanedMessages.filter(msg => msg.role === 'system');
      const conversationMessages = searchDirectives.cleanedMessages.filter(msg => msg.role !== 'system');
      finalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
    }

    // Create Cortensor request with model config or defaults
    const cortensorRequest: CortensorRequest = {
      session_id: sessionId,
      prompt: finalPrompt,
      prompt_type: modelConfig?.promptType ?? 1,
      prompt_template: modelConfig?.promptTemplate ?? '',
      stream: modelConfig?.stream ?? false,
      timeout: modelConfig?.timeout ?? 60,
      client_reference: `user-request-${Date.now()}`,
      max_tokens: modelConfig?.maxTokens ?? openAIRequest.max_tokens ?? 128,
      temperature: modelConfig?.temperature ?? openAIRequest.temperature ?? 0.7,
      top_p: modelConfig?.topP ?? 0.95,
      top_k: modelConfig?.topK ?? 40,
      presence_penalty: modelConfig?.presencePenalty ?? 0,
      frequency_penalty: modelConfig?.frequencyPenalty ?? 0
    };

    const result: CortensorTransformResult = {
      request: cortensorRequest
    };
    
    if (webSearchResults) {
      result.webSearchResults = webSearchResults;
    }
    
    if (searchQuery) {
      result.searchQuery = searchQuery;
    }
    
    return result;
  } catch (error) {
    console.error('Error transforming to Cortensor format:', error);
    throw new Error('Failed to transform request to Cortensor format');
  }
}

/**
 * Creates a standardized error response in OpenAI format
 * @param errorMessage - The error message to include
 * @returns OpenAI-formatted error response
 */
function createErrorResponse(errorMessage: string = 'Sorry, I encountered an error processing your request.'): OpenAIResponse {
  return {
    id: `cortensor-error-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'cortensor-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: errorMessage
        },
        finish_reason: 'stop'
      }
    ]
  };
}


/**
 * Transforms Cortensor response to OpenAI format
 * @param cortensorResponse - The response from Cortensor API
 * @param webSearchResults - Optional web search results to include as tool calls
 * @param searchQuery - The search query used (if any)
 * @returns Promise<Response> - OpenAI-formatted response
 */
export async function transformToOpenAI(
  cortensorResponse: Response, 
  webSearchResults?: WebSearchResult[], 
  searchQuery?: string
): Promise<Response> {
  try {
    const cortensorData = await cortensorResponse.json() as CortensorResponse;

    // Transform choices to OpenAI format
    const transformedChoices = cortensorData.choices.map((choice: CortensorChoice, index: number) => {
      const message: any = {
        role: 'assistant' as const,
        content: choice.text || ''
      };

      // Add tool calls if web search results exist
      if (webSearchResults && webSearchResults.length > 0 && searchQuery) {
        message.tool_calls = [{
          id: `call_web_search_${Date.now()}`,
          type: 'function' as const,
          function: {
            name: 'web_search',
            arguments: JSON.stringify({
              query: searchQuery,
              results: webSearchResults
            })
          }
        }];
      }

      return {
        index: choice.index ?? index,
        message,
        finish_reason: webSearchResults && webSearchResults.length > 0 ? 'tool_calls' : (choice.finish_reason || 'stop')
      };
    });

    // Transform usage information
    const transformedUsage = cortensorData.usage ? {
      prompt_tokens: cortensorData.usage.prompt_tokens,
      completion_tokens: cortensorData.usage.completion_tokens,
      total_tokens: cortensorData.usage.total_tokens
    } : {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    // Create OpenAI-formatted response
    const openAIResponse: OpenAIResponse = {
      id: cortensorData.id || `cortensor-${Date.now()}`,
      object: 'chat.completion',
      created: cortensorData.created || Math.floor(Date.now() / 1000),
      model: cortensorData.model || 'cortensor-model',
      choices: transformedChoices,
      usage: transformedUsage
    };

    // Return as Response object
    return new Response(
      JSON.stringify(openAIResponse),
      {
        status: cortensorResponse.status,
        statusText: cortensorResponse.statusText,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Error transforming from Cortensor format:', error);

    // Return standardized error response
    const errorResponse = createErrorResponse();
    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ============================================================================
// NOTES
// ============================================================================
// - Streaming is currently disabled - all responses are sent at once
// - The transformer handles both successful responses and error cases
// - All responses are converted to OpenAI-compatible format for SDK integration