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
import { extractSearchDirectives, generateSearchQuery, buildPromptWithSearchResults } from './websearch';
import { buildFormattedPrompt, createErrorResponse, formatSearchResults } from './utils';
import { handleWebSearch } from './websearch';










/**
 * Sanitizes message content by removing unwanted tokens and patterns
 * @param content - The content to sanitize
 * @returns Sanitized content
 */
function sanitizeMessageContent(content: string): string {
  console.log('🧹 [SANITIZE] Starting message sanitization');
  console.log('🧹 [SANITIZE] Original content length:', content.length);
  console.log('🧹 [SANITIZE] Original content value:', content);
  
  let sanitized = content
    .replace(/<\/s>/g, '')  // Remove </s> stop tokens
    .replace(/<s>/g, '')    // Remove <s> start tokens
    .replace(/\[INST\]/g, '') // Remove instruction tokens
    .replace(/\[\/INST\]/g, '') // Remove end instruction tokens
    .trim();
    
  console.log('🧹 [SANITIZE] Sanitized content length:', sanitized.length);
  console.log('🧹 [SANITIZE] Sanitized content value:', sanitized);
  console.log('🧹 [SANITIZE] Sanitization completed');
  
  return sanitized;
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
  console.log('🔄 [TRANSFORM] Starting OpenAI to Cortensor transformation');
  console.log('🔄 [TRANSFORM] Session ID:', sessionId);
  console.log('🔄 [TRANSFORM] Request body length:', requestBody.length);
  console.log('🔄 [TRANSFORM] Request body value:', requestBody);
  console.log('🔄 [TRANSFORM] Model config provided:', !!modelConfig);
  
  if (modelConfig) {
    console.log('🔄 [TRANSFORM] Model config details:', {
      webSearch: !!modelConfig.webSearch,
      promptType: modelConfig.promptType,
      stream: modelConfig.stream,
      maxTokens: modelConfig.maxTokens
    });
  }

  try {
    console.log('📝 [PARSE] Parsing OpenAI request body');
    const openAIRequest: OpenAIRequest = JSON.parse(requestBody);
    console.log('📝 [PARSE] Successfully parsed request');
    console.log('📝 [PARSE] Messages count:', openAIRequest.messages?.length || 0);
    console.log('📝 [PARSE] Messages value:', openAIRequest.messages);
    console.log('📝 [PARSE] Model:', openAIRequest.model);
    console.log('📝 [PARSE] Temperature:', openAIRequest.temperature);


    // Extract search directives and clean messages
    console.log('🔍 [SEARCH] Extracting search directives from messages');
    const searchDirectives = extractSearchDirectives(openAIRequest.messages, modelConfig?.webSearch);
    console.log('🔍 [SEARCH] Search directives extracted:', {
      shouldSearch: searchDirectives.shouldSearch,
      originalMessagesCount: openAIRequest.messages.length,
      cleanedMessagesCount: searchDirectives.cleanedMessages.length
    });

    let finalPrompt: string = '';
    let webSearchResults: WebSearchResult[] | undefined;
    let searchQuery: string | undefined;

    // Handle web search if needed
    if (searchDirectives.shouldSearch && modelConfig?.webSearch?.provider) {
      console.log('🌐 [WEB_SEARCH] Web search is enabled and required');
      console.log('🌐 [WEB_SEARCH] Provider type:', typeof modelConfig.webSearch.provider);
      console.log('🌐 [WEB_SEARCH] Max results:', modelConfig.webSearch.maxResults ?? 5);

      try {
        // Perform web search using flexible provider
        console.log('🌍 [SEARCH_API] Performing web search');
        const searchResult = await handleWebSearch(
          searchDirectives.cleanedMessages,
          modelConfig.webSearch
        );
        
        if (searchResult) {
          webSearchResults = searchResult.results || [];
          searchQuery = searchResult.query;
          console.log('🌍 [SEARCH_API] Web search completed');
          console.log('🌍 [SEARCH_API] Search query used:', searchQuery);
          console.log('🌍 [SEARCH_API] Results count:', webSearchResults?.length || 0);
          console.log('🌍 [SEARCH_API] Results value:', webSearchResults);
          if (webSearchResults && webSearchResults.length > 0) {
            console.log('🌍 [SEARCH_API] First result preview:', {
              title: webSearchResults[0]?.title,
              url: webSearchResults[0]?.url,
              snippetLength: webSearchResults[0]?.snippet?.length || 0
            });
          }

          // Build enhanced prompt with search results
          console.log('📝 [PROMPT_BUILD] Building enhanced prompt with search results');
          finalPrompt = buildPromptWithSearchResults(
            searchDirectives.cleanedMessages,
            webSearchResults || [],
            searchQuery
          );
          console.log('📝 [PROMPT_BUILD] Enhanced prompt length:', finalPrompt.length);
          console.log('📝 [PROMPT_BUILD] Enhanced prompt value:', finalPrompt);
        } else {
          console.log('🌍 [SEARCH_API] No search results returned');
        }

      } catch (error) {
        console.log('❌ [WEB_SEARCH_ERROR] Web search failed:', error);
        if (error instanceof ConfigurationError) {
          console.log('❌ [CONFIG_ERROR] Configuration error detected, throwing:', error.message);
          throw error;
        }

        // Log web search errors but continue with fallback
        if (error instanceof WebSearchError) {
          console.log('❌ [WEB_SEARCH_ERROR] WebSearchError:', error.message);
        } else {
          console.log('❌ [UNKNOWN_ERROR] Unknown error during web search:', error);
        }

        console.log('🔄 [FALLBACK] Falling through to standard prompt building due to search error');
        // Fall through to standard prompt building
      }
    } else {
      console.log('🚫 [NO_SEARCH] Web search not enabled or not required');
      if (!searchDirectives.shouldSearch) {
        console.log('🚫 [NO_SEARCH] Reason: shouldSearch is false');
      }
      if (!modelConfig?.webSearch?.provider) {
        console.log('🚫 [NO_SEARCH] Reason: no web search provider configured');
      }
    }

    // Build standard prompt if no search or search failed
    if (!finalPrompt) {
      console.log('📝 [STANDARD_PROMPT] Building standard prompt (no search results)');
      const systemMessages = searchDirectives.cleanedMessages.filter(msg => msg.role === 'system');
      const conversationMessages = searchDirectives.cleanedMessages.filter(msg => msg.role !== 'system');
      console.log('📝 [STANDARD_PROMPT] System messages count:', systemMessages.length);
      console.log('📝 [STANDARD_PROMPT] System messages value:', systemMessages);
      console.log('📝 [STANDARD_PROMPT] Conversation messages count:', conversationMessages.length);
      console.log('📝 [STANDARD_PROMPT] Conversation messages value:', conversationMessages);

      finalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
      console.log('📝 [STANDARD_PROMPT] Standard prompt length:', finalPrompt.length);
      console.log('📝 [STANDARD_PROMPT] Standard prompt value:', finalPrompt);
    }

    // Sanitize the final prompt before sending to AI
    console.log('🧹 [FINAL_SANITIZE] Sanitizing final prompt before sending to AI');
    const sanitizedPrompt = sanitizeMessageContent(finalPrompt);
    console.log('🧹 [FINAL_SANITIZE] Final prompt sanitized');

    // Create Cortensor request with model config or defaults
    console.log('⚙️ [REQUEST_BUILD] Building Cortensor request object');
    const cortensorRequest: CortensorRequest = {
      session_id: sessionId,
      prompt: sanitizedPrompt,
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
    console.log('⚙️ [REQUEST_BUILD] Cortensor request built:', {
      session_id: cortensorRequest.session_id,
      prompt_length: cortensorRequest.prompt.length,
      prompt_type: cortensorRequest.prompt_type,
      max_tokens: cortensorRequest.max_tokens,
      temperature: cortensorRequest.temperature,
      stream: cortensorRequest.stream
    });



    console.log('📦 [RESULT_BUILD] Building transform result object');
    const result: CortensorTransformResult = {
      request: cortensorRequest
    };

    if (webSearchResults) {
      result.webSearchResults = webSearchResults;
      console.log('📦 [RESULT_BUILD] Added web search results count:', webSearchResults.length);
      console.log('📦 [RESULT_BUILD] Added web search results value:', webSearchResults);
    }

    if (searchQuery) {
      result.searchQuery = searchQuery;
      console.log('📦 [RESULT_BUILD] Added search query to result:', searchQuery);
    }

    console.log('✅ [TRANSFORM] Transformation completed successfully');
    console.log('✅ [TRANSFORM] Final result summary:', {
      hasRequest: !!result.request,
      hasWebSearchResults: !!result.webSearchResults,
      webSearchResultsCount: result.webSearchResults?.length || 0,
      hasSearchQuery: !!result.searchQuery
    });

    return result;
  } catch (error) {
    console.log('❌ [TRANSFORM_ERROR] Failed to transform request to Cortensor format:', error);
    console.log('❌ [TRANSFORM_ERROR] Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new Error('Failed to transform request to Cortensor format');
  }
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
  console.log('🔄 [RESPONSE_TRANSFORM] Starting Cortensor to OpenAI response transformation');
  console.log('🔄 [RESPONSE_TRANSFORM] Response status:', cortensorResponse.status);
  console.log('🔄 [RESPONSE_TRANSFORM] Has web search results:', !!webSearchResults);
  console.log('🔄 [RESPONSE_TRANSFORM] Web search results count:', webSearchResults?.length || 0);
  console.log('🔄 [RESPONSE_TRANSFORM] Web search results value:', webSearchResults);
  console.log('🔄 [RESPONSE_TRANSFORM] Search query:', searchQuery);

  try {
    console.log('📝 [RESPONSE_PARSE] Parsing Cortensor response JSON');
    const cortensorData = await cortensorResponse.json() as CortensorResponse;
    console.log('📝 [RESPONSE_PARSE] Successfully parsed response');
    console.log('📝 [RESPONSE_PARSE] Response data:', {
      id: cortensorData.id,
      model: cortensorData.model,
      choicesCount: cortensorData.choices?.length || 0,
      hasUsage: !!cortensorData.usage
    });

    // Transform choices to OpenAI format
    console.log('🔄 [CHOICES_TRANSFORM] Transforming choices to OpenAI format');
    const transformedChoices = cortensorData.choices.map((choice: CortensorChoice, index: number) => {
      console.log(`🔄 [CHOICE_${index}] Processing choice ${index}`);
      console.log(`🔄 [CHOICE_${index}] Original text length:`, choice.text?.length || 0);
      console.log(`🔄 [CHOICE_${index}] Original text value:`, choice.text);

      let content = choice.text || '';
      console.log(`🧹 [CHOICE_${index}] Sanitizing choice content`);
      content = sanitizeMessageContent(content);

      // Validate that we have substantial content from the AI
      const hasSubstantialContent = content.trim().length > 50; // At least 50 characters of meaningful content
      console.log(`✅ [CHOICE_${index}] Content validation - Has substantial content:`, hasSubstantialContent, `(${content.trim().length} chars)`);
      
      // If content is too brief and we have search results, add a note about the issue
      if (!hasSubstantialContent && webSearchResults && webSearchResults.length > 0) {
        console.log(`⚠️ [CHOICE_${index}] AI response is too brief, this may indicate a prompt issue`);
        content = content || 'Based on the search results provided:';
      }

      // Append search results as markdown URLs to content if they exist
      if (webSearchResults && webSearchResults.length > 0) {
        console.log(`🔗 [CHOICE_${index}] Appending search results to content`);
        const searchResultsMarkdown = formatSearchResults(webSearchResults);
        console.log(`🔗 [CHOICE_${index}] Search results markdown length:`, searchResultsMarkdown?.length || 0);
        console.log(`🔗 [CHOICE_${index}] Search results markdown value:`, searchResultsMarkdown);
        if (searchResultsMarkdown) {
          // Only add "Search Results" header if the AI's response doesn't already reference them
          const needsHeader = !content.toLowerCase().includes('search result') && !content.toLowerCase().includes('source');
          const separator = needsHeader ? `\n\n**Sources Referenced:** ${searchResultsMarkdown}` : `\n\n${searchResultsMarkdown}`;
          content += separator;
          console.log(`🔗 [CHOICE_${index}] Search results appended to content with ${needsHeader ? 'header' : 'no header'}`);
        } else {
          console.log(`🔗 [CHOICE_${index}] No search results markdown generated`);
        }
      } else {
        console.log(`🔗 [CHOICE_${index}] No search results to append`);
      }

      console.log(`📝 [CHOICE_${index}] Final content length:`, content.length);
      console.log(`📝 [CHOICE_${index}] Final content value:`, content);

      const message: any = {
        role: 'assistant' as const,
        content: content
      };

      const transformedChoice = {
        index: choice.index ?? index,
        message,
        finish_reason: choice.finish_reason || 'stop'
      };

      console.log(`✅ [CHOICE_${index}] Choice transformation completed:`, {
        index: transformedChoice.index,
        contentLength: transformedChoice.message.content.length,
        finishReason: transformedChoice.finish_reason
      });

      return transformedChoice;
    });
    console.log('✅ [CHOICES_TRANSFORM] All choices transformed successfully');

    // Transform usage information
    console.log('📊 [USAGE_TRANSFORM] Transforming usage information');
    const transformedUsage = cortensorData.usage ? {
      prompt_tokens: cortensorData.usage.prompt_tokens,
      completion_tokens: cortensorData.usage.completion_tokens,
      total_tokens: cortensorData.usage.total_tokens
    } : {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
    console.log('📊 [USAGE_TRANSFORM] Usage transformed:', transformedUsage);

    // Create OpenAI-formatted response
    console.log('📦 [OPENAI_RESPONSE] Creating OpenAI-formatted response');
    const openAIResponse: OpenAIResponse = {
      id: cortensorData.id || `cortensor-${Date.now()}`,
      object: 'chat.completion',
      created: cortensorData.created || Math.floor(Date.now() / 1000),
      model: cortensorData.model || 'cortensor-model',
      choices: transformedChoices,
      usage: transformedUsage
    };
    console.log('📦 [OPENAI_RESPONSE] OpenAI response created:', {
      id: openAIResponse.id,
      model: openAIResponse.model,
      choicesCount: openAIResponse.choices.length,
      totalTokens: openAIResponse.usage?.total_tokens || 0
    });

    // Return as Response object
    console.log('🌐 [FINAL_RESPONSE] Creating final HTTP response');
    const responseBody = JSON.stringify(openAIResponse);
    console.log('🌐 [FINAL_RESPONSE] Response body length:', responseBody.length);
    console.log('🌐 [FINAL_RESPONSE] Response body value:', responseBody);
    
    const finalResponse = new Response(
      responseBody,
      {
        status: cortensorResponse.status,
        statusText: cortensorResponse.statusText,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('🌐 [FINAL_RESPONSE] Final response created with status:', cortensorResponse.status);
    console.log('✅ [RESPONSE_TRANSFORM] Response transformation completed successfully');

    return finalResponse;
  } catch (error) {
    console.log('❌ [RESPONSE_TRANSFORM_ERROR] Failed to transform Cortensor response to OpenAI format:', error);
    console.log('❌ [RESPONSE_TRANSFORM_ERROR] Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    // Return standardized error response
    console.log('🔧 [ERROR_RESPONSE] Creating standardized error response');
    const errorResponse = createErrorResponse();
    console.log('🔧 [ERROR_RESPONSE] Error response created:', {
      id: errorResponse.id,
      choicesCount: errorResponse.choices?.length || 0
    });

    const errorResponseBody = JSON.stringify(errorResponse);
    console.log('🔧 [ERROR_RESPONSE] Error response body length:', errorResponseBody.length);
    console.log('🔧 [ERROR_RESPONSE] Error response body value:', errorResponseBody);
    
    return new Response(
      errorResponseBody,
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