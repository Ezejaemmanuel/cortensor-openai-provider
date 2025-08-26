/**
 * Cortensor API Transformers
 * 
 * This module handles the conversion between OpenAI format and Cortensor API format.
 * It provides utilities to transform requests and responses between the two formats,
 * enabling seamless integration with the Vercel AI SDK.
 */

import type { CoreMessage } from 'ai';
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
import { DEFAULT_MODEL_CONFIG, MAX_INPUT_TOKEN } from './constants';

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
  messages: CoreMessage[],
  webSearchConfig?: CortensorModelConfig['webSearch']
): SearchDirectives {
  console.log('🔍 [SEARCH] Extracting search directives from messages:', {
    messageCount: messages.length,
    webSearchConfig: webSearchConfig ? {
      mode: webSearchConfig.mode,
      maxResults: webSearchConfig.maxResults
    } : null
  });

  if (!webSearchConfig) {
    console.log('🔍 [SEARCH] No web search config provided, skipping search');
    return {
      shouldSearch: false,
      cleanedMessages: messages,
    };
  }

  if (messages.length === 0) {
    console.log('🔍 [SEARCH] No messages provided, skipping search');
    return {
      shouldSearch: false,
      cleanedMessages: messages,
    };
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    console.log('🔍 [SEARCH] Last message is undefined, skipping search');
    return {
      shouldSearch: false,
      cleanedMessages: messages,
    };
  }

  const originalContent = extractMessageContent(lastMessage);
  console.log('🔍 [SEARCH] Analyzing last message content:', {
    role: lastMessage.role,
    contentLength: originalContent.length,
    contentPreview: originalContent.substring(0, 100) + (originalContent.length > 100 ? '...' : '')
  });

  let cleanedContent = originalContent;
  let shouldSearch = false;

  // Check for [**search**] marker
  const hasSearchMarker = /\[\*\*search\*\*\]/i.test(originalContent);
  // Check for [**no-search**] marker
  const hasNoSearchMarker = /\[\*\*no-search\*\*\]/i.test(originalContent);

  console.log('🔍 [SEARCH] Search markers detected:', {
    hasSearchMarker,
    hasNoSearchMarker,
    searchMode: webSearchConfig.mode
  });

  // Remove markers from content
  cleanedContent = cleanedContent.replace(/\[\*\*search\*\*\]/gi, '').replace(/\[\*\*no-search\*\*\]/gi, '').trim();
  console.log('🔍 [SEARCH] Content after marker removal:', {
    originalLength: originalContent.length,
    cleanedLength: cleanedContent.length,
    markersRemoved: originalContent !== cleanedContent
  });

  // Determine if search should be performed based on mode and markers
  if (webSearchConfig.mode === 'force') {
    shouldSearch = true;
    console.log('🔍 [SEARCH] Force mode enabled - search will be performed');
  } else if (webSearchConfig.mode === 'disable') {
    shouldSearch = false;
    console.log('🔍 [SEARCH] Search disabled by configuration');
  } else { // prompt-based mode
    if (hasNoSearchMarker) {
      shouldSearch = false;
      console.log('🔍 [SEARCH] No-search marker found - search disabled');
    } else if (hasSearchMarker) {
      shouldSearch = true;
      console.log('🔍 [SEARCH] Search marker found - search enabled');
    } else {
      shouldSearch = false; // Default to no search unless explicitly requested
      console.log('🔍 [SEARCH] No explicit markers - defaulting to no search');
    }
  }

  const cleanedMessages: CoreMessage[] = [
    ...messages.slice(0, -1),
    {
      ...lastMessage,
      content: cleanedContent as any
    }
  ];

  console.log('🔍 [SEARCH] Final search decision:', {
    shouldSearch,
    cleanedMessagesCount: cleanedMessages.length,
    searchMode: webSearchConfig.mode
  });

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
  messages: CoreMessage[],
  cortensorConfig: { apiKey: string; baseUrl: string; sessionId: number }
): Promise<string> {
  console.log('🔍 [SEARCH-QUERY] Starting search query generation:', {
    messageCount: messages.length,
    sessionId: cortensorConfig.sessionId,
    hasApiKey: !!cortensorConfig.apiKey,
    baseUrl: cortensorConfig.baseUrl
  });

  if (messages.length === 0) {
    console.log('🔍 [SEARCH-QUERY] No messages provided, using default query');
    return 'general information';
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    console.log('🔍 [SEARCH-QUERY] Last message is undefined, using default query');
    return 'general information';
  }

  const userPrompt = extractMessageContent(lastMessage);
  console.log('🔍 [SEARCH-QUERY] Extracted user prompt:', {
    role: lastMessage.role,
    promptLength: userPrompt.length,
    promptPreview: userPrompt.substring(0, 150) + (userPrompt.length > 150 ? '...' : '')
  });

  // Create a prompt to ask the model to generate a search query
  const searchQueryPrompt = `Convert the following user prompt into a concise web search query (maximum 10 words). Only return the search query, nothing else:\n\nUser prompt: ${userPrompt}`;
  console.log('🔍 [SEARCH-QUERY] Generated search query prompt for API call');

  try {
    // Validate configuration
    if (!cortensorConfig.apiKey || !cortensorConfig.baseUrl) {
      console.error('🔍 [SEARCH-QUERY] Missing API configuration:', {
        hasApiKey: !!cortensorConfig.apiKey,
        hasBaseUrl: !!cortensorConfig.baseUrl
      });
      throw new ConfigurationError('API key and base URL are required for search query generation');
    }

    console.log('🔍 [SEARCH-QUERY] Making API call to generate search query:', {
      url: `${cortensorConfig.baseUrl}/chat/completions`,
      sessionId: cortensorConfig.sessionId,
      maxTokens: 50,
      temperature: 0.1
    });

    const response = await fetch(`${cortensorConfig.baseUrl}/api/v1/completions`, {
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

    console.log('🔍 [SEARCH-QUERY] API response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      console.error('🔍 [SEARCH-QUERY] API request failed:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new WebSearchError(`Failed to generate search query: API request failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('🔍 [SEARCH-QUERY] API response data:', {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length || 0,
      firstChoiceText: data.choices?.[0]?.text?.substring(0, 100)
    });

    let searchQuery = data.choices?.[0]?.text?.trim() || userPrompt;
    
    // Strip stop tokens and other unwanted tokens from the search query
    searchQuery = searchQuery
      .replace(/<\/s>/g, '')  // Remove </s> stop tokens
      .replace(/<s>/g, '')    // Remove <s> start tokens
      .replace(/\[INST\]/g, '') // Remove instruction tokens
      .replace(/\[\/INST\]/g, '') // Remove end instruction tokens
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .trim();
    
    // Fallback to user prompt if query becomes empty after cleaning
    if (!searchQuery) {
      searchQuery = userPrompt;
    }
    
    console.log('🔍 [SEARCH-QUERY] Generated and cleaned search query:', {
      query: searchQuery,
      usedFallback: searchQuery === userPrompt
    });

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
 * Formats search results as numbered citations with a sources section
 * @param results - Array of search results
 * @returns Formatted search results with numbered citations and sources section
 */
export function formatSearchResults(
  results: WebSearchResult[]
): string {
  console.log('🔍 [SEARCH-FORMAT] Formatting search results:', {
    resultCount: results?.length || 0,
    hasResults: !!(results && results.length > 0)
  });

  if (results.length === 0) {
    console.log('🔍 [SEARCH-FORMAT] No search results to format');
    return '';
  }

  // Create the sources section
  const sources = results
    .map((result, index) => {
      console.log(`🔍 [SEARCH-FORMAT] Formatting result ${index + 1}:`, {
        title: result.title?.substring(0, 50) + (result.title?.length > 50 ? '...' : ''),
        url: result.url
      });
      return `[${index + 1}] [${result.title}](${result.url})`;
    })
    .join('\n');

  const formattedResults = `\n\n**Sources:**\n${sources}`;
  console.log('🔍 [SEARCH-FORMAT] Formatted results length:', formattedResults.length);
  return formattedResults;
}

/**
 * Estimates token count for a given text (rough approximation: 1 token ≈ 4 characters)
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncates search results to fit within token limits
 * @param searchResults - Array of search results
 * @param maxTokens - Maximum tokens allowed for search results
 * @returns Truncated search results
 */
function truncateSearchResults(searchResults: WebSearchResult[], maxTokens: number): WebSearchResult[] {
  const truncatedResults: WebSearchResult[] = [];
  let currentTokens = 0;
  
  console.log('🔍 [SEARCH-RESULTS] Processing search results for truncation:', {
    totalResults: searchResults.length,
    maxTokens,
    results: searchResults.map((result, index) => ({
      index: index + 1,
      title: result.title,
      url: result.url,
      snippet: result.snippet?.substring(0, 100) + (result.snippet && result.snippet.length > 100 ? '...' : ''),
      estimatedTokens: estimateTokenCount(`[${index + 1}] [${result.title}](${result.url})\n${result.snippet || ''}`)
    }))
  });
  
  for (const result of searchResults) {
    const resultText = `[${truncatedResults.length + 1}] [${result.title}](${result.url})\n${result.snippet || ''}`;
    const resultTokens = estimateTokenCount(resultText);
    
    if (currentTokens + resultTokens <= maxTokens) {
      truncatedResults.push(result);
      currentTokens += resultTokens;
      console.log('🔍 [SEARCH-RESULTS] Including result:', {
        index: truncatedResults.length,
        title: result.title,
        url: result.url,
        snippet: result.snippet?.substring(0, 150) + (result.snippet && result.snippet.length > 150 ? '...' : ''),
        tokens: resultTokens,
        totalTokens: currentTokens
      });
    } else {
      console.log('🔍 [SEARCH-PROMPT] Truncating search results due to token limit:', {
        includedResults: truncatedResults.length,
        totalResults: searchResults.length,
        currentTokens,
        maxTokens,
        excludedResult: {
          title: result.title,
          url: result.url,
          snippet: result.snippet?.substring(0, 100) + (result.snippet && result.snippet.length > 100 ? '...' : ''),
          wouldAddTokens: resultTokens
        }
      });
      break;
    }
  }
  
  console.log('🔍 [SEARCH-RESULTS] Final truncation summary:', {
    includedResults: truncatedResults.length,
    totalResults: searchResults.length,
    finalTokenCount: currentTokens,
    maxTokens
  });
  
  return truncatedResults;
}

/**
 * Builds a prompt enhanced with search results
 * @param messages - Original conversation messages
 * @param searchResults - Web search results
 * @param searchQuery - The query used for searching
 * @returns Enhanced prompt string
 */
export function buildPromptWithSearchResults(
  messages: CoreMessage[],
  searchResults: WebSearchResult[],
  searchQuery: string
): string {
  console.log('🔍 [SEARCH-PROMPT] Building prompt with search results:', {
    messageCount: messages.length,
    resultCount: searchResults.length,
    searchQuery: searchQuery
  });

  const systemMessages = messages.filter(msg => msg.role === 'system');
  const conversationMessages = messages.filter(msg => msg.role !== 'system');

  const originalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
  const originalTokens = estimateTokenCount(originalPrompt);
  
  // Target max tokens: ~3000, reserve space for original prompt and search formatting
  const maxTotalTokens = MAX_INPUT_TOKEN;
  const searchFormattingTokens = 100; // Estimated tokens for search headers and instructions
  const maxSearchResultTokens = maxTotalTokens - originalTokens - searchFormattingTokens;
  
  console.log('🔍 [SEARCH-PROMPT] Token analysis:', {
    originalTokens,
    maxTotalTokens,
    maxSearchResultTokens,
    searchFormattingTokens
  });
  
  // Truncate search results if necessary
  let finalSearchResults = searchResults;
  if (maxSearchResultTokens > 0) {
    finalSearchResults = truncateSearchResults(searchResults, maxSearchResultTokens);
  } else {
    console.warn('🔍 [SEARCH-PROMPT] Original prompt too long, excluding all search results');
    finalSearchResults = [];
  }
  
  const formattedResults = formatSearchResults(finalSearchResults);
  const finalPrompt = `${originalPrompt}\n\n--- WEB SEARCH RESULTS ---\nSearch Query: "${searchQuery}"\n\n${formattedResults}\n\nPlease use the above search results to provide an accurate, up-to-date response. If the search results are relevant, incorporate the information into your answer. If they're not relevant, you can ignore them and provide a general response.`;
  
  const finalTokens = estimateTokenCount(finalPrompt);
  
  console.log('🔍 [SEARCH-PROMPT] Built final prompt:', {
    promptLength: finalPrompt.length,
    estimatedTokens: finalTokens,
    includesSearchResults: formattedResults.length > 0,
    originalPromptLength: originalPrompt.length,
    includedSearchResults: finalSearchResults.length,
    totalSearchResults: searchResults.length
  });
  
  return finalPrompt;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts text content from a message, handling both string and array formats
 * @param message - The message to extract content from
 * @returns The extracted text content
 */
function extractMessageContent(message: CoreMessage): string {
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
function buildFormattedPrompt(systemMessages: CoreMessage[], conversationMessages: CoreMessage[]): string {
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
  console.log('🔍 [WEB-SEARCH] Starting web search:', {
    query: query,
    maxResults: maxResults,
    providerType: typeof provider
  });

  try {
    let results: WebSearchResult[];
    
    // Check if it's a provider object with search method or direct function
    if (typeof provider === 'function') {
      console.log('🔍 [WEB-SEARCH] Using function-based provider');
      results = await provider(query, maxResults);
    } else {
      console.log('🔍 [WEB-SEARCH] Using object-based provider with search method');
      results = await provider.search(query, maxResults);
    }
    
    console.log('🔍 [WEB-SEARCH] Search completed successfully:', {
      resultCount: results.length,
      firstResultTitle: results[0]?.title?.substring(0, 50)
    });
    
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown web search error';
    console.error('🔍 [WEB-SEARCH] Search failed:', {
      error: errorMessage,
      query: query,
      maxResults: maxResults
    });
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
  console.log('🔄 [TRANSFORM] Starting OpenAI to Cortensor transformation:', {
    sessionId: sessionId,
    requestBodyLength: requestBody.length,
    hasModelConfig: !!modelConfig,
    webSearchEnabled: !!modelConfig?.webSearch
  });

  try {
    const openAIRequest: OpenAIRequest = JSON.parse(requestBody);
    console.log('🔄 [TRANSFORM] Parsed OpenAI request:', {
      model: openAIRequest.model,
      messageCount: openAIRequest.messages?.length || 0,
      stream: openAIRequest.stream,
      temperature: openAIRequest.temperature,
      maxTokens: openAIRequest.max_tokens
    });

    // Extract search directives and clean messages
    const searchDirectives = extractSearchDirectives(openAIRequest.messages, modelConfig?.webSearch);
    console.log('🔄 [TRANSFORM] Search directives extracted:', {
      shouldSearch: searchDirectives.shouldSearch,
      cleanedMessageCount: searchDirectives.cleanedMessages.length
    });

    let finalPrompt: string = '';
    let webSearchResults: WebSearchResult[] | undefined;
    let searchQuery: string | undefined;

    // Handle web search if needed
    if (searchDirectives.shouldSearch && modelConfig?.webSearch?.provider) {
      console.log('🔄 [TRANSFORM] Web search required, starting search process:', {
        hasProvider: !!modelConfig.webSearch.provider,
        maxResults: modelConfig.webSearch.maxResults ?? 5,
        searchMode: modelConfig.webSearch.mode
      });

      try {
        // Generate search query using main Cortensor configuration
        console.log('🔄 [TRANSFORM] Generating search query with Cortensor config');
        searchQuery = await generateSearchQuery(
          searchDirectives.cleanedMessages,
          {
            apiKey: process.env.CORTENSOR_API_KEY || '',
            baseUrl: process.env.CORTENSOR_BASE_URL || '',
            sessionId: sessionId
          }
        );
        console.log('🔄 [TRANSFORM] Search query generated:', { searchQuery });

        // Perform web search using flexible provider
        console.log('🔄 [TRANSFORM] Performing web search with provider');
        webSearchResults = await handleWebSearch(
          searchQuery,
          modelConfig.webSearch.provider,
          modelConfig.webSearch.maxResults ?? 5
        );
        console.log('🔄 [TRANSFORM] Web search completed:', {
          resultCount: webSearchResults.length,
          totalCharacters: webSearchResults.reduce((sum, r) => sum + (r.snippet?.length || 0), 0)
        });

        // Build enhanced prompt with search results
        console.log('🔄 [TRANSFORM] Building enhanced prompt with search results');
        finalPrompt = buildPromptWithSearchResults(
          searchDirectives.cleanedMessages,
          webSearchResults,
          searchQuery
        );
        console.log('🔄 [TRANSFORM] Enhanced prompt built:', {
          promptLength: finalPrompt.length,
          includesSearchResults: finalPrompt.includes('Search Results:')
        });
      } catch (error) {
        if (error instanceof ConfigurationError) {
          console.error('🔄 [TRANSFORM] Configuration error during web search:', error.message);
          throw error;
        }

        // Log web search errors but continue with fallback
        if (error instanceof WebSearchError) {
          console.warn('🔄 [TRANSFORM] Web search failed, continuing without search results:', {
            error: error.message,
            fallbackToBuildStandardPrompt: true
          });
        } else {
          console.warn('🔄 [TRANSFORM] Unexpected error during web search:', {
            error: error instanceof Error ? error.message : String(error),
            errorType: error?.constructor?.name,
            fallbackToBuildStandardPrompt: true
          });
        }

        // Fall through to standard prompt building
      }
    } else {
      console.log('🔄 [TRANSFORM] Web search not required or no provider configured');
    }

    // Build standard prompt if no search or search failed
    if (!finalPrompt) {
      console.log('🔄 [TRANSFORM] Building standard prompt (no web search)');
      const systemMessages = searchDirectives.cleanedMessages.filter(msg => msg.role === 'system');
      const conversationMessages = searchDirectives.cleanedMessages.filter(msg => msg.role !== 'system');
      console.log('🔄 [TRANSFORM] Message breakdown for standard prompt:', {
        systemMessageCount: systemMessages.length,
        conversationMessageCount: conversationMessages.length
      });
      finalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
      console.log('🔄 [TRANSFORM] Standard prompt built:', {
        promptLength: finalPrompt.length
      });
    }

    // Create Cortensor request with model config or defaults
    console.log('🔄 [TRANSFORM] Creating Cortensor request with configuration');
    const cortensorRequest: CortensorRequest = {
      session_id: sessionId,
      prompt: finalPrompt,
      prompt_type: modelConfig?.promptType ?? DEFAULT_MODEL_CONFIG.promptType,
      prompt_template: modelConfig?.promptTemplate ?? DEFAULT_MODEL_CONFIG.promptTemplate,
      stream: modelConfig?.stream ?? DEFAULT_MODEL_CONFIG.stream,
      timeout: modelConfig?.timeout ?? DEFAULT_MODEL_CONFIG.timeout,
      client_reference: `user-request-${Date.now()}`,
      max_tokens: modelConfig?.maxTokens ?? DEFAULT_MODEL_CONFIG.maxTokens,
      temperature: modelConfig?.temperature ?? openAIRequest.temperature ?? DEFAULT_MODEL_CONFIG.temperature,
      top_p: modelConfig?.topP ?? DEFAULT_MODEL_CONFIG.topP,
      top_k: modelConfig?.topK ?? DEFAULT_MODEL_CONFIG.topK,
      presence_penalty: modelConfig?.presencePenalty ?? DEFAULT_MODEL_CONFIG.presencePenalty,
      frequency_penalty: modelConfig?.frequencyPenalty ?? DEFAULT_MODEL_CONFIG.frequencyPenalty
    };

    console.log('🔄 [TRANSFORM] Cortensor request created:', {
      sessionId: cortensorRequest.session_id,
      promptLength: cortensorRequest.prompt.length,
      promptType: cortensorRequest.prompt_type,
      stream: cortensorRequest.stream,
      maxTokens: cortensorRequest.max_tokens,
      temperature: cortensorRequest.temperature,
      clientReference: cortensorRequest.client_reference
    });

    const result: CortensorTransformResult = {
      request: cortensorRequest
    };

    if (webSearchResults) {
      result.webSearchResults = webSearchResults;
      console.log('🔄 [TRANSFORM] Added web search results to transform result:', {
        resultCount: webSearchResults.length
      });
    }

    if (searchQuery) {
      result.searchQuery = searchQuery;
      console.log('🔄 [TRANSFORM] Added search query to transform result:', {
        searchQuery: searchQuery
      });
    }

    console.log('🔄 [TRANSFORM] Transformation completed successfully:', {
      hasWebSearchResults: !!result.webSearchResults,
      hasSearchQuery: !!result.searchQuery,
      finalPromptLength: finalPrompt.length
    });

    return result;
  } catch (error) {
    console.error('🔄 [TRANSFORM] Critical error during transformation:', {
      error: error instanceof Error ? error.message : String(error),
      errorType: error?.constructor?.name,
      stack: error instanceof Error ? error.stack : undefined,
      sessionId: sessionId,
      requestBodyLength: requestBody?.length || 0
    });
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
  console.log('🔄 [RESPONSE-TRANSFORM] Starting Cortensor to OpenAI response transformation:', {
    responseStatus: cortensorResponse.status,
    responseStatusText: cortensorResponse.statusText,
    hasWebSearchResults: !!webSearchResults,
    webSearchResultCount: webSearchResults?.length || 0,
    hasSearchQuery: !!searchQuery
  });

  try {
    const cortensorData = await cortensorResponse.json() as CortensorResponse;
    console.log('🔄 [RESPONSE-TRANSFORM] Parsed Cortensor response:', {
      id: cortensorData.id,
      model: cortensorData.model,
      choiceCount: cortensorData.choices?.length || 0,
      hasUsage: !!cortensorData.usage,
      created: cortensorData.created
    });

    // Transform choices to OpenAI format
    console.log('🔄 [RESPONSE-TRANSFORM] Transforming choices to OpenAI format');
    const transformedChoices = cortensorData.choices.map((choice: CortensorChoice, index: number) => {
      console.log(`🔄 [RESPONSE-TRANSFORM] Processing choice ${index}:`, {
        choiceIndex: choice.index,
        contentLength: choice.text?.length || 0,
        finishReason: choice.finish_reason
      });

      let content = choice.text || '';

      // Append search results as markdown URLs to content if they exist
      if (webSearchResults && webSearchResults.length > 0) {
        console.log('🔄 [RESPONSE-TRANSFORM] Appending search results to content:', {
          searchResultCount: webSearchResults.length,
          originalContentLength: content.length
        });
        const searchResultsMarkdown = formatSearchResults(webSearchResults);
        if (searchResultsMarkdown) {
          content += `\n\n**Search Results:** ${searchResultsMarkdown}`;
          console.log('🔄 [RESPONSE-TRANSFORM] Search results appended:', {
            finalContentLength: content.length,
            searchResultsMarkdownLength: searchResultsMarkdown.length
          });
        }
      }

      const message: any = {
        role: 'assistant' as const,
        content: content
      };

      const transformedChoice = {
        index: choice.index ?? index,
        message,
        finish_reason: choice.finish_reason || 'stop'
      };

      console.log(`🔄 [RESPONSE-TRANSFORM] Choice ${index} transformed:`, {
        finalIndex: transformedChoice.index,
        finalContentLength: transformedChoice.message.content.length,
        finishReason: transformedChoice.finish_reason
      });

      return transformedChoice;
    });

    // Transform usage information
    console.log('🔄 [RESPONSE-TRANSFORM] Transforming usage information:', {
      hasUsageData: !!cortensorData.usage,
      originalUsage: cortensorData.usage
    });
    const transformedUsage = cortensorData.usage ? {
      prompt_tokens: cortensorData.usage.prompt_tokens,
      completion_tokens: cortensorData.usage.completion_tokens,
      total_tokens: cortensorData.usage.total_tokens
    } : {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
    console.log('🔄 [RESPONSE-TRANSFORM] Usage transformed:', transformedUsage);

    // Create OpenAI-formatted response
    console.log('🔄 [RESPONSE-TRANSFORM] Creating final OpenAI response');
    const openAIResponse: OpenAIResponse = {
      id: cortensorData.id || `cortensor-${Date.now()}`,
      object: 'chat.completion',
      created: cortensorData.created || Math.floor(Date.now() / 1000),
      model: cortensorData.model || 'cortensor-model',
      choices: transformedChoices,
      usage: transformedUsage
    };

    console.log('🔄 [RESPONSE-TRANSFORM] OpenAI response created:', {
      id: openAIResponse.id,
      model: openAIResponse.model,
      choiceCount: openAIResponse.choices.length,
      totalTokens: openAIResponse?.usage?.total_tokens,
      responseSize: JSON.stringify(openAIResponse).length
    });

    // Return as Response object
    console.log('🔄 [RESPONSE-TRANSFORM] Creating HTTP Response object');
    const finalResponse = new Response(
      JSON.stringify(openAIResponse),
      {
        status: cortensorResponse.status,
        statusText: cortensorResponse.statusText,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('🔄 [RESPONSE-TRANSFORM] Transformation completed successfully:', {
      responseStatus: finalResponse.status,
      responseStatusText: finalResponse.statusText,
      hasWebSearchResults: !!webSearchResults,
      finalResponseSize: JSON.stringify(openAIResponse).length
    });

    return finalResponse;
  } catch (error) {
    console.error('🔄 [RESPONSE-TRANSFORM] Critical error during response transformation:', {
      error: error instanceof Error ? error.message : String(error),
      errorType: error?.constructor?.name,
      stack: error instanceof Error ? error.stack : undefined,
      responseStatus: cortensorResponse?.status,
      hasWebSearchResults: !!webSearchResults,
      webSearchResultCount: webSearchResults?.length || 0
    });

    // Return standardized error response
    console.log('🔄 [RESPONSE-TRANSFORM] Creating error response');
    const errorResponse = createErrorResponse();
    console.log('🔄 [RESPONSE-TRANSFORM] Error response created:', {
      errorResponseId: errorResponse.id,
      errorMessage: errorResponse.choices[0]?.message?.content
    });
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