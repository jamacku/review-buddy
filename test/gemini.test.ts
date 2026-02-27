import { describe, expect, test, vi, beforeEach } from 'vitest';

import { GeminiClient } from '../src/gemini';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

vi.mock('@actions/core', () => ({
  info: vi.fn(),
}));

describe('GeminiClient', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  test('parses valid JSON response', async () => {
    const expected = {
      summary: 'Missing null check causes test failure',
      comments: [{ path: 'src/app.ts', line: 5, body: 'Add null check' }],
      confidence: 'high',
    };

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(expected),
    });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    const result = await client.analyzeFailure('prompt');

    expect(result).toEqual(expected);
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: 'prompt',
        config: { responseMimeType: 'application/json' },
      })
    );
  });

  test('extracts JSON from markdown code block', async () => {
    const expected = {
      summary: 'Build error',
      comments: [],
      confidence: 'low',
    };

    mockGenerateContent.mockResolvedValue({
      text: '```json\n' + JSON.stringify(expected) + '\n```',
    });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    const result = await client.analyzeFailure('prompt');

    expect(result).toEqual(expected);
  });

  test('extracts JSON from plain code block', async () => {
    const expected = {
      summary: 'Lint error',
      comments: [],
      confidence: 'medium',
    };

    mockGenerateContent.mockResolvedValue({
      text: '```\n' + JSON.stringify(expected) + '\n```',
    });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    const result = await client.analyzeFailure('prompt');

    expect(result).toEqual(expected);
  });

  test('throws on empty response', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    await expect(client.analyzeFailure('prompt')).rejects.toThrow(
      'Gemini returned an empty response'
    );
  });

  test('throws on null text response', async () => {
    mockGenerateContent.mockResolvedValue({ text: null });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    await expect(client.analyzeFailure('prompt')).rejects.toThrow(
      'Gemini returned an empty response'
    );
  });

  test('throws on unparseable non-JSON response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'This is not JSON at all, just plain text.',
    });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    await expect(client.analyzeFailure('prompt')).rejects.toThrow(
      'Failed to parse Gemini response as JSON'
    );
  });

  test('throws on invalid response structure', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ foo: 'bar' }),
    });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    await expect(client.analyzeFailure('prompt')).rejects.toThrow(
      'Invalid Gemini response structure'
    );
  });

  test('throws when comments have invalid line numbers', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: 'Bug found',
        comments: [{ path: 'a.ts', line: 0, body: 'fix' }],
        confidence: 'high',
      }),
    });

    const client = new GeminiClient('key', 'gemini-2.5-flash');
    await expect(client.analyzeFailure('prompt')).rejects.toThrow(
      'Invalid Gemini response structure'
    );
  });

  test('uses the configured model', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: 'ok',
        comments: [],
        confidence: 'low',
      }),
    });

    const client = new GeminiClient('key', 'gemini-2.5-pro');
    await client.analyzeFailure('prompt');

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-pro' })
    );
  });
});
