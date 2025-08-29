import type { CoreMessage } from "ai";
import { WebSearchError } from "./provider";
import type { CortensorModelConfig, WebSearchCallback, WebSearchResult } from "./types";
import { extractMessageContent, truncateSnippet } from "./utils";

/**
 * Simple web search function
 */
async function performWebSearch(
    query: string,
    provider: WebSearchCallback,
    maxResults: number
): Promise<WebSearchResult[]> {
    console.log('🔍 [PERFORM_SEARCH] Starting web search with query:', query);
    console.log('🔍 [PERFORM_SEARCH] Max results:', maxResults);
    
    try {
        if (typeof provider === 'function') {
            console.log('🔍 [PERFORM_SEARCH] Using function provider');
            return await provider(query, maxResults);
        } else {
            console.log('🔍 [PERFORM_SEARCH] Using object provider');
            return await provider.search(query, maxResults);
        }
    } catch (error) {
        console.error('🔍 [PERFORM_SEARCH] Search failed:', error);
        throw new WebSearchError(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Simple web search handler
 */
export async function handleWebSearch(
    messages: CoreMessage[],
    webSearchConfig?: CortensorModelConfig['webSearch']
): Promise<{ query: string; results: WebSearchResult[] } | null> {
    console.log('🌐 [HANDLE_WEB_SEARCH] Starting web search handling');
    console.log('🌐 [HANDLE_WEB_SEARCH] Messages count:', messages.length, 'messages:', messages);
    console.log('🌐 [HANDLE_WEB_SEARCH] Has web search config:', !!webSearchConfig);

    if (!webSearchConfig?.provider) {
        console.log('🌐 [HANDLE_WEB_SEARCH] No web search provider, returning null');
        return null;
    }

    console.log('🌐 [HANDLE_WEB_SEARCH] Generating search query from messages');
    const searchQuery = generateSearchQuery(messages);
    console.log('🌐 [HANDLE_WEB_SEARCH] Generated search query:', searchQuery);

    if (!searchQuery) {
        console.log('🌐 [HANDLE_WEB_SEARCH] No search query generated, returning null');
        return null;
    }

    try {
        console.log('🌐 [HANDLE_WEB_SEARCH] Performing web search with query:', searchQuery);
        const searchResults = await performWebSearch(searchQuery, webSearchConfig.provider, webSearchConfig.maxResults || 5);
        console.log('🌐 [HANDLE_WEB_SEARCH] Web search completed, results count:', searchResults?.length || 0);

        if (searchResults && searchResults.length > 0) {
            console.log('🌐 [HANDLE_WEB_SEARCH] Search results:');
            searchResults.forEach((result, index) => {
                console.log(`🌐 [RESULT_${index + 1}] Title: ${result.title || 'No title'}`);
                console.log(`🌐 [RESULT_${index + 1}] URL: ${result.url || 'No URL'}`);
                console.log(`🌐 [RESULT_${index + 1}] Snippet: ${result.snippet || 'No snippet'}`);
            });
        } else {
            console.log('🌐 [HANDLE_WEB_SEARCH] No search results found');
        }

        const result = { query: searchQuery, results: searchResults };
        console.log('🌐 [HANDLE_WEB_SEARCH] Returning result with', result.results?.length || 0, 'results');
        return result;
    } catch (error) {
        console.error('🌐 [HANDLE_WEB_SEARCH] Web search failed:', error);
        return null;
    }
}



/**
 * Builds a prompt enhanced with search results
 */
export function buildPromptWithSearchResults(
    messages: CoreMessage[],
    searchResults: WebSearchResult[],
    searchQuery: string
): string {
    console.log('📝 [BUILD_PROMPT] Starting prompt building with search results');
    console.log('📝 [BUILD_PROMPT] Messages count:', messages.length);
    console.log('📝 [BUILD_PROMPT] Search query:', searchQuery);
    console.log('📝 [BUILD_PROMPT] Search results count:', searchResults?.length || 0);

    // Build basic prompt
    let prompt = '';
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const conversationMessages = messages.filter(msg => msg.role !== 'system');
    
    console.log('📝 [BUILD_PROMPT] System messages:', systemMessages.length);
    console.log('📝 [BUILD_PROMPT] Conversation messages:', conversationMessages.length);
    
    if (systemMessages.length > 0) {
        prompt += systemMessages.map(msg => extractMessageContent(msg)).join('\n\n') + '\n\n';
    }
    
    conversationMessages.forEach(msg => {
        const content = extractMessageContent(msg);
        if (msg.role === 'user') {
            prompt += `Human: ${content}\n\n`;
        } else {
            prompt += `Assistant: ${content}\n\n`;
        }
    });

    console.log('📝 [BUILD_PROMPT] Basic prompt length:', prompt.length);

    // Add current date/time
    const now = new Date();
    const currentDateTime = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) + ' at ' + now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });
    console.log('📝 [BUILD_PROMPT] Current date/time:', currentDateTime);

    // Add search results (with truncated snippets, no URLs in prompt)
    const searchContent = searchResults.length > 0 
        ? searchResults.map((result, index) => {
            const truncatedSnippet = result.snippet ? truncateSnippet(result.snippet) : 'No content available';
            return `${result.title}: ${truncatedSnippet}`;
        }).join('\n\n')
        : 'No search results found.';
    
    console.log('📝 [BUILD_PROMPT] Search content length:', searchContent.length);

    const finalPrompt = `${prompt}Current date and time: ${currentDateTime}\n\nSearch results for "${searchQuery}":\n\n${searchContent}\n\nAssistant:`;
    console.log('📝 [BUILD_PROMPT] Final prompt length:', finalPrompt.length);
    console.log('📝 [BUILD_PROMPT] Prompt building completed');

    return finalPrompt;
}



/**
 * Simple search query generator - uses first 390 chars of latest message
 */
export function generateSearchQuery(messages: CoreMessage[]): string {
    console.log('🔎 [GENERATE_QUERY] Starting search query generation');
    console.log('🔎 [GENERATE_QUERY] Messages count:', messages.length);

    if (messages.length === 0) {
        console.log('🔎 [GENERATE_QUERY] No messages, returning default');
        return 'general information';
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        console.log('🔎 [GENERATE_QUERY] No last message, returning default');
        return 'general information';
    }

    console.log('🔎 [GENERATE_QUERY] Extracting content from last message');
    const content = extractMessageContent(lastMessage);
    console.log('🔎 [GENERATE_QUERY] Content length:', content.length);
    console.log('🔎 [GENERATE_QUERY] Content:', content);

    // Take first 390 characters
    const searchQuery = content.substring(0, 390).trim();
    console.log('🔎 [GENERATE_QUERY] Generated query (390 chars):', searchQuery);
    console.log('🔎 [GENERATE_QUERY] Query length:', searchQuery.length);

    return searchQuery;
}


/**
 * Simple search directive checker - checks for [**search**] marker
 */
export function extractSearchDirectives(
    messages: CoreMessage[],
    webSearchConfig?: CortensorModelConfig['webSearch']
): { shouldSearch: boolean; cleanedMessages: CoreMessage[] } {
    console.log('🔍 [EXTRACT_DIRECTIVES] Checking for search directives');
    console.log('🔍 [EXTRACT_DIRECTIVES] Messages count:', messages.length);
    console.log('🔍 [EXTRACT_DIRECTIVES] Has web search config:', !!webSearchConfig);

    if (!webSearchConfig || messages.length === 0) {
        console.log('🔍 [EXTRACT_DIRECTIVES] No config or messages, returning no search');
        return { shouldSearch: false, cleanedMessages: messages };
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        console.log('🔍 [EXTRACT_DIRECTIVES] No last message, returning no search');
        return { shouldSearch: false, cleanedMessages: messages };
    }

    const content = extractMessageContent(lastMessage);
    console.log('🔍 [EXTRACT_DIRECTIVES] Last message content:', content);

    // Check for search markers
    const hasSearchMarker = /\[\*\*search\*\*\]/i.test(content);
    const hasNoSearchMarker = /\[\*\*no-search\*\*\]/i.test(content);
    console.log('🔍 [EXTRACT_DIRECTIVES] Search marker:', hasSearchMarker, 'No-search marker:', hasNoSearchMarker);

    // Determine if search should be performed
    let shouldSearch = false;
    if (webSearchConfig.mode === 'force') {
        shouldSearch = true;
        console.log('🔍 [EXTRACT_DIRECTIVES] Force mode: search enabled');
    } else if (webSearchConfig.mode === 'disable') {
        shouldSearch = false;
        console.log('🔍 [EXTRACT_DIRECTIVES] Disable mode: search disabled');
    } else { // prompt-based mode
        shouldSearch = hasSearchMarker && !hasNoSearchMarker;
        console.log('🔍 [EXTRACT_DIRECTIVES] Prompt mode: search', shouldSearch ? 'enabled' : 'disabled');
    }

    // Clean the content by removing markers
    const cleanedContent = content.replace(/\[\*\*search\*\*\]/gi, '').replace(/\[\*\*no-search\*\*\]/gi, '').trim();
    console.log('🔍 [EXTRACT_DIRECTIVES] Cleaned content:', cleanedContent);

    const cleanedMessages: CoreMessage[] = [
        ...messages.slice(0, -1),
        { ...lastMessage, content: cleanedContent as any }
    ];

    console.log('🔍 [EXTRACT_DIRECTIVES] Final result: shouldSearch =', shouldSearch);
    return { shouldSearch, cleanedMessages };
}

