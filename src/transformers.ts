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

  // Check for [**search**] marker
  const hasSearchMarker = /\[\*\*search\*\*\]/i.test(originalContent);
  // Check for [**no-search**] marker
  const hasNoSearchMarker = /\[\*\*no-search\*\*\]/i.test(originalContent);



  // Remove markers from content
  cleanedContent = cleanedContent.replace(/\[\*\*search\*\*\]/gi, '').replace(/\[\*\*no-search\*\*\]/gi, '').trim();


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

  const cleanedMessages: CoreMessage[] = [
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
  messages: CoreMessage[],
  cortensorConfig: { apiKey: string; baseUrl: string; sessionId: number }
): Promise<string> {


  if (messages.length === 0) {

    return 'general information';
  }

  // Get the last 3 messages (or all messages if fewer than 3) for better context
  const contextMessages = messages.slice(-3);
  
  // Extract content from all context messages to build a comprehensive prompt
  const contextPrompts = contextMessages.map(msg => {
    const content = extractMessageContent(msg);
    return `${msg.role}: ${content}`;
  }).join('\n');
  
  // Fallback to last message if context building fails
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    return 'general information';
  }
  
  const userPrompt = contextPrompts || extractMessageContent(lastMessage);

  // Get current date for context
  const currentDate = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  // Create a prompt to ask the model to generate a search query based on conversation context
  const searchQueryPrompt = `Current date: ${currentDate}\n\nBased on the following conversation context, generate a concise web search query (maximum 20 words) that would help find relevant information. Only return the search query, nothing else:\n\nConversation context:\n${userPrompt}`;


  try {
    // Validate configuration
    if (!cortensorConfig.apiKey || !cortensorConfig.baseUrl) {

      throw new ConfigurationError('API key and base URL are required for search query generation');
    }



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



    if (!response.ok) {

      throw new WebSearchError(`Failed to generate search query: API request failed with status ${response.status}`);
    }

    const data = await response.json();


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
    


    return searchQuery;
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof WebSearchError) {
      throw error; // Re-throw custom errors
    }
    console.warn('Failed to generate search query via API, using fallback prompt:', error);
    // Use last message content as fallback if context building failed
    return contextPrompts ? contextPrompts.split('\n').pop()?.replace(/^(user|assistant|system):\s*/i, '') || extractMessageContent(lastMessage) : extractMessageContent(lastMessage);
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


  if (results.length === 0) {

    return '';
  }

  // Create the sources section
  const sources = results
    .map((result, index) => {

      return `[${index + 1}] [${result.title}](${result.url})`;
    })
    .join('\n');

  const formattedResults = `\n\n**Sources:**\n${sources}`;

  return formattedResults;
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


  const systemMessages = messages.filter(msg => msg.role === 'system');
  const conversationMessages = messages.filter(msg => msg.role !== 'system');

  const originalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
  
  

  
  const finalSearchResults = searchResults;

  // Create detailed search results with snippets for AI prompt
  const detailedResults = finalSearchResults.length > 0 ? 
    finalSearchResults.map((result, index) => {
      return `[${index + 1}] ${result.title}\nURL: ${result.url}\nContent: ${result.snippet || 'No content available'}`;
    }).join('\n\n') : 'No search results found.';
  
  // Get current date and time for context
  const now = new Date();
  const currentDateTime = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }) + ' at ' + now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
  
  const finalPrompt = `${originalPrompt}\n\n--- CURRENT DATE AND TIME ---\n${currentDateTime}\n\n--- WEB SEARCH RESULTS ---\nSearch Query: "${searchQuery}"\n\n${detailedResults}\n\nPlease use the above search results to provide an accurate, up-to-date response. Consider the current date and time when providing your answer. If the search results are relevant, incorporate the information into your answer. If they're not relevant, you can ignore them and provide a general response.`;
  
  

  
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

  // Get current date and time for context
  const now = new Date();
  const currentDateTime = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }) + ' at ' + now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
  
  prompt += `\n\n--- CURRENT DATE AND TIME ---\n${currentDateTime}`;

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
    let results: WebSearchResult[];
    
    // Check if it's a provider object with search method or direct function
    if (typeof provider === 'function') {

      results = await provider(query, maxResults);
    } else {

      results = await provider.search(query, maxResults);
    }
    

    
    return results;
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

        } else {

        }

        // Fall through to standard prompt building
      }
    } else {

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


      let content = choice.text || '';

      // Append search results as markdown URLs to content if they exist
      if (webSearchResults && webSearchResults.length > 0) {

        const searchResultsMarkdown = formatSearchResults(webSearchResults);
        if (searchResultsMarkdown) {
          content += `\n\n**Search Results:** ${searchResultsMarkdown}`;

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



      return transformedChoice;
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



    return finalResponse;
  } catch (error) {


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