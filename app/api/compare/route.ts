import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, API_SETTINGS, CLAUDE_MODELS } from '@/lib/constants';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: NextRequest) {
  try {
    const { noteContent, models } = await request.json();

    if (!noteContent) {
      return NextResponse.json(
        { error: 'Note content is required' },
        { status: 400 }
      );
    }

    const modelsToTest = models || CLAUDE_MODELS;
    const userPrompt = USER_PROMPT_TEMPLATE(noteContent);

    const results = await Promise.allSettled(
      modelsToTest.map(async (model: string) => {
        try {
          const message = await anthropic.messages.create({
            model,
            max_tokens: API_SETTINGS.maxTokens,
            temperature: API_SETTINGS.temperature,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: userPrompt,
              },
            ],
          });

          const content = message.content[0];
          const text = content.type === 'text' ? content.text : '';

          // Try to parse JSON from the response
          let parsedResponse;
          try {
            // Extract JSON from the response (in case there's extra text)
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsedResponse = JSON.parse(jsonMatch[0]);
            } else {
              parsedResponse = [];
            }
          } catch (parseError) {
            // If parsing fails, return the raw text
            parsedResponse = text;
          }

          return {
            model,
            success: true,
            response: parsedResponse,
            rawResponse: text,
          };
        } catch (error: any) {
          return {
            model,
            success: false,
            error: error.message || 'Unknown error',
            response: null,
            rawResponse: null,
          };
        }
      })
    );

    const formattedResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          model: modelsToTest[index],
          success: false,
          error: result.reason?.message || 'Unknown error',
          response: null,
          rawResponse: null,
        };
      }
    });

    return NextResponse.json({ results: formattedResults });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
