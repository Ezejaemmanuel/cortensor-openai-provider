/**
 * Simple Tavily Web Search Provider
 */

// import type { WebSearchResult, WebSearchCallback } from '../provider.js';
import type { WebSearchCallback, WebSearchResult } from '@/types';
import { tavily, type TavilySearchOptions } from '@tavily/core';


/**
 * Create a simple Tavily search function
 */
export function createTavilySearch(options: TavilySearchOptions  = {}): WebSearchCallback {
  console.log('🔍 [TAVILY-SEARCH] Initializing Tavily search provider:', {
    hasApiKeyInOptions: !!options.apiKey,
    hasApiKeyInEnv: !!process.env.TAVILY_API_KEY,
    maxResults: options.maxResults || 3,
    includeImages: options.includeImages || false,
    searchDepth: options.searchDepth || 'basic'
  });

  const apiKeyToBeUsed = options.apiKey || process.env.TAVILY_API_KEY;

  if (!apiKeyToBeUsed) {
    console.error('🔍 [TAVILY-SEARCH] API key validation failed - no key provided');
    throw new Error('Tavily API key is required. Provide it as parameter or set TAVILY_API_KEY environment variable.');
  }

  console.log('🔍 [TAVILY-SEARCH] API key validated successfully');
  const client = tavily({ apiKey: apiKeyToBeUsed });
  console.log('🔍 [TAVILY-SEARCH] Tavily client created successfully');

  return async (query: string): Promise<WebSearchResult[]> => {
    console.log('🔍 [TAVILY-SEARCH] Starting web search:', {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      queryLength: query.length,
      timestamp: new Date().toISOString()
    });

    const searchOptions = {
      maxResults: options.maxResults || 3,
      includeImages: options.includeImages || false,
      searchDepth: options.searchDepth || 'basic',
    };

    console.log('🔍 [TAVILY-SEARCH] Search options:', searchOptions);

    try {
      console.log('🔍 [TAVILY-SEARCH] Making API call to Tavily');
      const response = await client.search(query, searchOptions);
      
      console.log('🔍 [TAVILY-SEARCH] Tavily API response received:', {
        resultsCount: response.results?.length || 0,
        hasResults: !!response.results,
        responseKeys: Object.keys(response || {})
      });

      if (!response.results || response.results.length === 0) {
        console.warn('🔍 [TAVILY-SEARCH] No search results returned from Tavily');
        return [];
      }

      const mappedResults = response.results.map((result: any, index: number) => {
        const mappedResult = {
          title: result.title || '',
          url: result.url || '',
          snippet: result.content || '',
        };
        
        console.log(`🔍 [TAVILY-SEARCH] Processing result ${index + 1}:`, {
          title: mappedResult.title.substring(0, 50) + (mappedResult.title.length > 50 ? '...' : ''),
          url: mappedResult.url,
          snippetLength: mappedResult.snippet.length,
          hasTitle: !!mappedResult.title,
          hasUrl: !!mappedResult.url,
          hasSnippet: !!mappedResult.snippet
        });
        
        return mappedResult;
      });

      console.log('🔍 [TAVILY-SEARCH] Web search completed successfully:', {
        totalResults: mappedResults.length,
        validResults: mappedResults.filter(r => r.title && r.url && r.snippet).length,
        timestamp: new Date().toISOString()
      });

      return mappedResults;
    } catch (error) {
      console.error('🔍 [TAVILY-SEARCH] Search failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name,
        query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
        searchOptions,
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`Tavily search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
}