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


    const searchOptions = {
      maxResults: options.maxResults || 3,
      includeImages: options.includeImages || false,
      searchDepth: options.searchDepth || 'basic',
    };

    // Log the search query and options being sent to Tavily
    console.log('Tavily Search Query:', query);
    console.log('Tavily Search Options:', JSON.stringify(searchOptions, null, 2));

    try {

      const response = await client.search(query, searchOptions);
      


      if (!response.results || response.results.length === 0) {

        return [];
      }

      const mappedResults = response.results.map((result: any, index: number) => {
        const mappedResult = {
          title: result.title || '',
          url: result.url || '',
          snippet: result.content || '',
        };
        

        
        return mappedResult;
      });

      // Log first 300 characters of mapped results for debugging
      console.warn('Mapped Results (first 300 chars):', JSON.stringify(mappedResults).substring(0, 300));

      return mappedResults;
    } catch (error) {

      
      throw new Error(`Tavily search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };
}