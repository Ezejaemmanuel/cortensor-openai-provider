import type { CoreMessage } from "ai";
import { ConfigurationError, WebSearchError } from "./provider";
import type { CortensorModelConfig, SearchDirectives, WebSearchCallback, WebSearchResult } from "./types";
import { buildFormattedPrompt, extractMessageContent } from "./utils";

/**
 * Helper function to handle different web search callback types
 * @param query - The search query
 * @param provider - The web search provider (object or function)
 * @param maxResults - Maximum number of results to return
 * @returns Promise resolving to search results
 */
export async function performWebSearch(
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
 * Handles web search functionality
 * @param messages - Array of conversation messages
 * @param webSearchConfig - Web search configuration
 * @returns Web search results or null if search is not performed
 */
export async function handleWebSearch(
    messages: CoreMessage[],
    webSearchConfig?: CortensorModelConfig['webSearch']
): Promise<{ query: string; results: WebSearchResult[] } | null> {
    console.log('🌐 [HANDLE_WEB_SEARCH] Starting web search handling');
    console.log('🌐 [HANDLE_WEB_SEARCH] Messages count:', messages.length);
    console.log('🌐 [HANDLE_WEB_SEARCH] Has web search config:', !!webSearchConfig);
    
    if (!webSearchConfig) {
        console.log('🌐 [HANDLE_WEB_SEARCH] No web search config provided, returning null');
        return null;
    }

    console.log('🌐 [HANDLE_WEB_SEARCH] Extracting search directives');
    const { shouldSearch, cleanedMessages } = extractSearchDirectives(messages, webSearchConfig);
    console.log('🌐 [HANDLE_WEB_SEARCH] Search directives result:', {
        shouldSearch,
        cleanedMessagesCount: cleanedMessages.length
    });

    if (!shouldSearch) {
        console.log('🌐 [HANDLE_WEB_SEARCH] Search not required, returning null');
        return null;
    }

    try {
        console.log('🌐 [HANDLE_WEB_SEARCH] Generating search query from cleaned messages');
        const searchQuery = await generateSearchQuery(cleanedMessages, webSearchConfig);
        console.log('🌐 [HANDLE_WEB_SEARCH] Generated search query:', searchQuery);
        
        if (!searchQuery) {
            console.log('🌐 [HANDLE_WEB_SEARCH] No search query generated, returning null');
            return null;
        }

        console.log('🌐 [HANDLE_WEB_SEARCH] Performing web search with query:', searchQuery);
        
        if (!webSearchConfig.provider) {
            console.log('🌐 [HANDLE_WEB_SEARCH] No web search provider configured, returning null');
            return null;
        }
        
        const searchResults = await performWebSearch(searchQuery, webSearchConfig.provider, webSearchConfig.maxResults || 5);
        console.log('🌐 [HANDLE_WEB_SEARCH] Web search completed, results count:', searchResults?.length || 0);
        
        if (searchResults && searchResults.length > 0) {
            console.log('🌐 [HANDLE_WEB_SEARCH] Search results preview:', searchResults.map(r => ({
                title: r.title?.substring(0, 50) + (r.title && r.title.length > 50 ? '...' : ''),
                url: r.url,
                hasSnippet: !!r.snippet
            })));
        }
        
        const result = {
            query: searchQuery,
            results: searchResults
        };
        console.log('🌐 [HANDLE_WEB_SEARCH] Returning web search result:', {
            query: result.query,
            resultsCount: result.results?.length || 0
        });
        
        return result;
    } catch (error) {
        console.error('🌐 [HANDLE_WEB_SEARCH] Web search failed:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        return null;
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
    messages: CoreMessage[],
    searchResults: WebSearchResult[],
    searchQuery: string
): string {
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Starting prompt building with search results');
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Messages count:', messages.length);
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Search query:', searchQuery);
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Search results count:', searchResults?.length || 0);

    const systemMessages = messages.filter(msg => msg.role === 'system');
    const conversationMessages = messages.filter(msg => msg.role !== 'system');
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] System messages:', systemMessages.length, 'Conversation messages:', conversationMessages.length);

    const originalPrompt = buildFormattedPrompt(systemMessages, conversationMessages);
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Original prompt built, length:', originalPrompt.length);

    const finalSearchResults = searchResults;
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Processing search results for integration');

    // Create detailed search results with snippets for AI prompt
    const detailedResults = finalSearchResults.length > 0 ?
        finalSearchResults.map((result, index) => {
            return `[${index + 1}] ${result.title}\nURL: ${result.url}\nContent: ${result.snippet || 'No content available'}`;
        }).join('\n\n') : 'No search results found.';
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Detailed results formatted, length:', detailedResults.length);

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
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Current date/time context:', currentDateTime);

    const finalPrompt = `${originalPrompt}\n\n--- CURRENT DATE AND TIME ---\n${currentDateTime}\n\n--- WEB SEARCH RESULTS ---\nSearch Query: "${searchQuery}"\n\n${detailedResults}\n\n--- RESPONSE INSTRUCTIONS ---\nYou MUST provide a comprehensive and substantive response that:\n1. First provides your own analysis and understanding of the topic\n2. Incorporates relevant information from the search results above as supporting evidence\n3. Synthesizes the information rather than just listing or repeating the search results\n4. Offers insights, explanations, and conclusions based on the combined information\n5. Always provides a meaningful response - never return empty or minimal content\n\nIMPORTANT: Do not simply copy or list the search results. Analyze, interpret, and integrate the information to create a thoughtful, comprehensive response. You must always respond with substantial content regardless of search result quality.`;
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Final prompt created, total length:', finalPrompt.length);
    console.log('📝 [BUILD_PROMPT_WITH_SEARCH] Search results integration completed successfully');

    return finalPrompt;
}
  


/**
 * Generates a search query based on conversation context
 * @param messages - Array of conversation messages
 * @param webSearchConfig - Web search configuration
 * @returns Promise resolving to search query string
 */
export async function generateSearchQuery(
    messages: CoreMessage[],
    webSearchConfig: CortensorModelConfig['webSearch']
): Promise<string> {
    console.log('🔎 [GENERATE_SEARCH_QUERY] Starting search query generation');
    console.log('🔎 [GENERATE_SEARCH_QUERY] Messages count:', messages.length);

    if (messages.length === 0) {
        console.log('🔎 [GENERATE_SEARCH_QUERY] No messages provided, returning general information');
        return 'general information';
    }

    // Get the last 3 messages (or all messages if fewer than 3) for better context
    const contextMessages = messages.slice(-3);
    console.log('🔎 [GENERATE_SEARCH_QUERY] Context messages count:', contextMessages.length);

    // Extract content from all context messages to build a comprehensive prompt
    const contextPrompts = contextMessages.map(msg => {
        const content = extractMessageContent(msg);
        return `${msg.role}: ${content}`;
    }).join('\n');
    console.log('🔎 [GENERATE_SEARCH_QUERY] Context prompts built, length:', contextPrompts.length);

    // Fallback to last message if context building fails
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        console.log('🔎 [GENERATE_SEARCH_QUERY] No last message found, returning general information');
        return 'general information';
    }

    const userPrompt = contextPrompts || extractMessageContent(lastMessage);
    console.log('🔎 [GENERATE_SEARCH_QUERY] User prompt prepared:', {
        length: userPrompt.length,
        preview: userPrompt.substring(0, 100) + (userPrompt.length > 100 ? '...' : '')
    });

    // Get current date for context
    const currentDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    console.log('🔎 [GENERATE_SEARCH_QUERY] Current date for context:', currentDate);

    // Create a prompt to ask the model to generate a search query based on conversation context
    const searchQueryPrompt = `Current date: ${currentDate}\n\nBased on the following conversation context, generate a concise web search query (maximum 20 words) that would help find relevant information. Only return the search query, nothing else:\n\nConversation context:\n${userPrompt}`;
    console.log('🔎 [GENERATE_SEARCH_QUERY] Search query prompt created, length:', searchQueryPrompt.length);

    try {
        // Get configuration from environment variables
        const apiKey = process.env.CORTENSOR_API_KEY;
        const baseUrl = process.env.CORTENSOR_BASE_URL;
        const sessionId = process.env.CORTENSOR_SESSION_ID || '1';
        
        // Validate configuration
        if (!apiKey || !baseUrl) {
            console.error('🔎 [GENERATE_SEARCH_QUERY] Missing API key or base URL');
            throw new ConfigurationError('API key and base URL are required for search query generation');
        }

        console.log('🔎 [GENERATE_SEARCH_QUERY] Making API request to:', `${baseUrl}/api/v1/completions`);
        const response = await fetch(`${baseUrl}/api/v1/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                session_id: parseInt(sessionId),
                prompt: searchQueryPrompt,
                max_tokens: 50,
                temperature: 0.1
            })
        });
        console.log('🔎 [GENERATE_SEARCH_QUERY] API response status:', response.status);

        if (!response.ok) {
            console.error('🔎 [GENERATE_SEARCH_QUERY] API request failed with status:', response.status);
            throw new WebSearchError(`Failed to generate search query: API request failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log('🔎 [GENERATE_SEARCH_QUERY] API response data received');

        let searchQuery = data.choices?.[0]?.text?.trim() || userPrompt;
        console.log('🔎 [GENERATE_SEARCH_QUERY] Raw search query from API:', searchQuery);

        // Strip stop tokens and other unwanted tokens from the search query
        searchQuery = searchQuery
            .replace(/<\/s>/g, '')  // Remove </s> stop tokens
            .replace(/<s>/g, '')    // Remove <s> start tokens
            .replace(/\[INST\]/g, '') // Remove instruction tokens
            .replace(/\[\/INST\]/g, '') // Remove end instruction tokens
            .replace(/^["']|["']$/g, '') // Remove surrounding quotes
            .trim();
        console.log('🔎 [GENERATE_SEARCH_QUERY] Cleaned search query:', searchQuery);

        // Fallback to user prompt if query becomes empty after cleaning
        if (!searchQuery) {
            searchQuery = userPrompt;
            console.log('🔎 [GENERATE_SEARCH_QUERY] Using user prompt as fallback:', searchQuery);
        }

        console.log('🔎 [GENERATE_SEARCH_QUERY] Final search query:', searchQuery);
        return searchQuery;
    } catch (error) {
        if (error instanceof ConfigurationError || error instanceof WebSearchError) {
            throw error; // Re-throw custom errors
        }
        console.warn('🔎 [GENERATE_SEARCH_QUERY] Failed to generate search query via API, using fallback prompt:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        // Use last message content as fallback if context building failed
        const fallbackQuery = contextPrompts ? contextPrompts.split('\n').pop()?.replace(/^(user|assistant|system):\s*/i, '') || extractMessageContent(lastMessage) : extractMessageContent(lastMessage);
        console.log('🔎 [GENERATE_SEARCH_QUERY] Using fallback query:', fallbackQuery);
        return fallbackQuery;
    }
}


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
    console.log('🔍 [EXTRACT_DIRECTIVES] Starting search directives extraction');
    console.log('🔍 [EXTRACT_DIRECTIVES] Messages count:', messages.length);
    console.log('🔍 [EXTRACT_DIRECTIVES] Has web search config:', !!webSearchConfig);

    if (!webSearchConfig) {
        console.log('🔍 [EXTRACT_DIRECTIVES] No web search config provided, returning no search');
        return {
            shouldSearch: false,
            cleanedMessages: messages,
        };
    }

    if (messages.length === 0) {
        console.log('🔍 [EXTRACT_DIRECTIVES] No messages provided, returning no search');
        return {
            shouldSearch: false,
            cleanedMessages: messages,
        };
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        console.log('🔍 [EXTRACT_DIRECTIVES] No last message found, returning no search');
        return {
            shouldSearch: false,
            cleanedMessages: messages,
        };
    }

    console.log('🔍 [EXTRACT_DIRECTIVES] Extracting content from last message');
    const originalContent = extractMessageContent(lastMessage);
    console.log('🔍 [EXTRACT_DIRECTIVES] Original content length:', originalContent.length);
    console.log('🔍 [EXTRACT_DIRECTIVES] Original content preview:', originalContent.substring(0, 200) + (originalContent.length > 200 ? '...' : ''));

    let cleanedContent = originalContent;
    let shouldSearch = false;

    // Check for [**search**] marker
    const hasSearchMarker = /\[\*\*search\*\*\]/i.test(originalContent);
    // Check for [**no-search**] marker
    const hasNoSearchMarker = /\[\*\*no-search\*\*\]/i.test(originalContent);
    console.log('🔍 [EXTRACT_DIRECTIVES] Search markers found:', {
        hasSearchMarker,
        hasNoSearchMarker
    });

    // Remove markers from content
    cleanedContent = cleanedContent.replace(/\[\*\*search\*\*\]/gi, '').replace(/\[\*\*no-search\*\*\]/gi, '').trim();
    console.log('🔍 [EXTRACT_DIRECTIVES] Content after marker removal:', {
        originalLength: originalContent.length,
        cleanedLength: cleanedContent.length,
        markersRemoved: originalContent.length !== cleanedContent.length
    });

    // Determine if search should be performed based on mode and markers
    console.log('🔍 [EXTRACT_DIRECTIVES] Web search mode:', webSearchConfig.mode);
    if (webSearchConfig.mode === 'force') {
        shouldSearch = true;
        console.log('🔍 [EXTRACT_DIRECTIVES] Force mode: search enabled');
    } else if (webSearchConfig.mode === 'disable') {
        shouldSearch = false;
        console.log('🔍 [EXTRACT_DIRECTIVES] Disable mode: search disabled');
    } else { // prompt-based mode
        if (hasNoSearchMarker) {
            shouldSearch = false;
            console.log('🔍 [EXTRACT_DIRECTIVES] No-search marker found: search disabled');
        } else if (hasSearchMarker) {
            shouldSearch = true;
            console.log('🔍 [EXTRACT_DIRECTIVES] Search marker found: search enabled');
        } else {
            shouldSearch = false; // Default to no search unless explicitly requested
            console.log('🔍 [EXTRACT_DIRECTIVES] No markers found: search disabled by default');
        }
    }

    const cleanedMessages: CoreMessage[] = [
        ...messages.slice(0, -1),
        {
            ...lastMessage,
            content: cleanedContent as any
        }
    ];
    console.log('🔍 [EXTRACT_DIRECTIVES] Created cleaned messages array');
    console.log('🔍 [EXTRACT_DIRECTIVES] Final result:', {
        shouldSearch,
        originalMessagesCount: messages.length,
        cleanedMessagesCount: cleanedMessages.length
    });

    return {
        shouldSearch,
        cleanedMessages,
    };
}

