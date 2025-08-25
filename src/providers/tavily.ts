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
  const apiKeyToBeUsed = options.apiKey || process.env.TAVILY_API_KEY;

  if (!apiKeyToBeUsed) {
    throw new Error('Tavily API key is required. Provide it as parameter or set TAVILY_API_KEY environment variable.');
  }

  const client = tavily({ apiKey: apiKeyToBeUsed });

  return async (query: string): Promise<WebSearchResult[]> => {
    try {
      const response = await client.search(query, {
        maxResults: options.maxResults || 3,
        includeImages: options.includeImages || false,
        searchDepth: options.searchDepth || 'basic',
      });

      return response.results.map((result: any) => ({
        title: result.title || '',
        url: result.url || '',
        snippet: result.content || '',
      }));
    } catch (error) {
      throw new Error(`Tavily search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
}