import { GoogleGenAI } from '@google/genai';
import { info } from '@actions/core';

import {
  geminiReviewResponseSchema,
  type GeminiReviewResponse,
} from './schema';

export class GeminiClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async analyzeFailure(prompt: string): Promise<GeminiReviewResponse> {
    info(`Sending analysis request to Gemini (model: ${this.model})...`);

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }

    info(`Received Gemini response (${text.length} chars)`);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Gemini sometimes produces invalid JSON escape sequences (e.g. \`)
      // Try to fix them before falling back to code block extraction
      try {
        raw = JSON.parse(sanitizeJsonEscapes(text));
      } catch {
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch?.[1]) {
          raw = JSON.parse(sanitizeJsonEscapes(jsonMatch[1].trim()));
        } else {
          throw new Error(
            `Failed to parse Gemini response as JSON: ${text.slice(0, 500)}`
          );
        }
      }
    }

    info(`Parsed Gemini response successfully`);

    const result = geminiReviewResponseSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Invalid Gemini response structure: ${result.error.message}`
      );
    }

    return result.data;
  }
}

/**
 * Fix invalid JSON escape sequences that Gemini sometimes produces.
 * JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX
 * Gemini may output e.g. \` which is invalid — remove the backslash.
 */
function sanitizeJsonEscapes(text: string): string {
  return text.replace(/\\([^"\\/bfnrtu])/g, '$1');
}
