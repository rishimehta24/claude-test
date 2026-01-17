import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, API_SETTINGS, CLAUDE_MODELS, ALL_MODELS, ModelProvider, ModelInfo } from '@/lib/constants';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const genAI = process.env.GOOGLE_API_KEY 
  ? new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
  : null;

function getModelProvider(modelId: string): ModelProvider {
  const model = ALL_MODELS.find(m => m.id === modelId);
  return model?.provider || 'anthropic';
}

async function callAnthropic(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model,
    max_tokens: API_SETTINGS.maxTokens,
    temperature: API_SETTINGS.temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });
  
  const content = message.content[0];
  return content.type === 'text' ? content.text : '';
}

async function callOpenAI(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model,
    temperature: API_SETTINGS.temperature,
    max_tokens: API_SETTINGS.maxTokens,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });
  
  return completion.choices[0]?.message?.content || '';
}

async function callGoogle(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!genAI) {
    throw new Error('Google API key not configured');
  }
  
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  const genModel = genAI.getGenerativeModel({ model });
  
  const result = await genModel.generateContent(fullPrompt);
  const response = await result.response;
  return response.text();
}

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
      modelsToTest.map(async (modelId: string) => {
        try {
          const provider = getModelProvider(modelId);
          let text: string;

          // Route to appropriate provider
          switch (provider) {
            case 'anthropic':
              text = await callAnthropic(modelId, SYSTEM_PROMPT, userPrompt);
              break;
            case 'openai':
              text = await callOpenAI(modelId, SYSTEM_PROMPT, userPrompt);
              break;
            case 'google':
              text = await callGoogle(modelId, SYSTEM_PROMPT, userPrompt);
              break;
            default:
              throw new Error(`Unsupported provider for model: ${modelId}`);
          }

          // Try to parse JSON from the response
          let parsedResponse;
          try {
            // First, try to find JSON array pattern (most common)
            let jsonMatch: RegExpMatchArray | string | null = text.match(/\[[\s\S]*?\]/);
            
            // If no array found, try to find any JSON object/array
            if (!jsonMatch) {
              // Try to find JSON code blocks
              const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
              if (codeBlockMatch && codeBlockMatch[1]) {
                jsonMatch = codeBlockMatch[1]; // This is a string (capture group)
              } else {
                // Try to find JSON after common prefixes
                const afterPrefixMatch = text.match(/(?:Output|Response|JSON):\s*(\[[\s\S]*?\])/i);
                if (afterPrefixMatch && afterPrefixMatch[1]) {
                  jsonMatch = afterPrefixMatch[1]; // This is a string (capture group)
                } else {
                  // Try to find any array-like structure
                  const anyArrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
                  if (anyArrayMatch) {
                    jsonMatch = anyArrayMatch; // This is RegExpMatchArray
                  }
                }
              }
            }
            
            if (jsonMatch) {
              const jsonStr = typeof jsonMatch === 'string' ? jsonMatch : jsonMatch[0];
              parsedResponse = JSON.parse(jsonStr);
              
              // Validate it's an array
              if (!Array.isArray(parsedResponse)) {
                parsedResponse = [];
              }
            } else {
              // If no JSON found and response seems empty or indicates no injuries
              const lowerText = text.toLowerCase().trim();
              if (lowerText === '' || lowerText === '[]' || lowerText.includes('no injuries') || lowerText.includes('empty array')) {
                parsedResponse = [];
              } else {
                // Return raw text if we can't parse
                parsedResponse = text;
              }
            }
          } catch (parseError) {
            // If parsing fails, check if it's just an empty response
            const trimmed = text.trim();
            if (trimmed === '' || trimmed === '[]') {
              parsedResponse = [];
            } else {
              // Return raw text for debugging
              parsedResponse = text;
            }
          }

          return {
            model: modelId,
            provider,
            success: true,
            response: parsedResponse,
            rawResponse: text,
          };
        } catch (error: any) {
          return {
            model: modelId,
            provider: getModelProvider(modelId),
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
          provider: getModelProvider(modelsToTest[index]),
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
