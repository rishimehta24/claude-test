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
