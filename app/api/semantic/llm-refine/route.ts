/**
 * API Route: Semantic Validation + LLM Refinement
 * Runs semantic validation first (free), then uses LLM to make final decisions
 */

import { NextRequest, NextResponse } from 'next/server';
import { findSimilarSentences } from '@/lib/semantic-validator';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ALL_MODELS } from '@/lib/constants';
import { ALLOWED_INJURIES } from '@/lib/rnd/schema';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `You are a medical data analyst specializing in injury extraction from clinical notes. Your task is to review a list of potential injury matches identified by semantic similarity and determine which are actual physical injuries that should be included in the final output.

IMPORTANT CONTEXT:
- You will receive the original note text and a table of potential injury matches from semantic validation
- The semantic validation uses embeddings to find text that might be injury-related
- Some matches may be false positives - not all semantically similar text represents actual injuries
- You must apply clinical reasoning to determine what's truly an injury

ALLOWED INJURIES (only these are valid):
${ALLOWED_INJURIES.map(inj => `  - ${inj}`).join('\n')}

YOUR TASK:
1. Review the original note text
2. Review the semantic validation matches table
3. For each match, determine if it represents an ACTUAL physical injury present on the patient
4. Apply medical reasoning to filter out:
   - Negated mentions (e.g., "denies pain", "no bruising")
   - Symptoms that aren't injuries (e.g., "dizzy", "febrile")
   - General observations that don't indicate injury
   - Historical or unrelated mentions

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects, nothing else:
[
  { "phrase": "exact text from note", "matched_injury": "injury_type" },
  { "phrase": "another phrase", "matched_injury": "another_type" }
]

If no injuries are found, return an empty array: []

CRITICAL RULES:
- Only include injuries that are PRESENT on the patient
- Only include injuries from the ALLOWED_INJURIES list
- Use the exact phrase from the note text
- Do NOT include negated injuries
- Do NOT include symptoms that aren't physical injuries
- Be conservative - if unsure, exclude it`;

function getModelProvider(modelId: string): 'anthropic' | 'openai' | 'google' {
  const model = ALL_MODELS.find(m => m.id === modelId);
  return model?.provider || 'anthropic';
}

async function callLLM(
  modelId: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const provider = getModelProvider(modelId);

  if (provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
    const message = await anthropic.messages.create({
      model: modelId,
      max_tokens: 2000,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const content = message.content[0];
    return content.type === 'text' ? content.text : '';
  } else if (provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
    const completion = await openai.chat.completions.create({
      model: modelId,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return completion.choices[0]?.message?.content || '';
  } else if (provider === 'google') {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
    const genModel = genAI.getGenerativeModel({ model: modelId });
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const result = await genModel.generateContent(fullPrompt);
    const response = await result.response;
    return response.text();
  } else {
    throw new Error(`Unknown provider for model: ${modelId}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { noteContent, model, config } = body;

    if (!noteContent) {
      return NextResponse.json(
        { error: 'noteContent is required' },
        { status: 400 }
      );
    }

    if (!model) {
      return NextResponse.json(
        { error: 'model is required' },
        { status: 400 }
      );
    }

    const finalConfig = {
      strongThreshold: 0.7,
      mediumThreshold: 0.5,
      minThreshold: 0.3,
      ...config,
    };

    // Step 1: Run semantic validation (free, local)
    const similarSentences = await findSimilarSentences(noteContent, 100);

    // Step 2: Organize matches by confidence level
    const strongMatches = similarSentences.filter(s => s.similarity >= finalConfig.strongThreshold);
    const mediumMatches = similarSentences.filter(
      s => s.similarity >= finalConfig.mediumThreshold && s.similarity < finalConfig.strongThreshold
    );
    const weakMatches = similarSentences.filter(
      s => s.similarity >= finalConfig.minThreshold && s.similarity < finalConfig.mediumThreshold
    );

    // Step 3: Format semantic results as a table for the LLM
    const allSemanticMatches = [...strongMatches, ...mediumMatches, ...weakMatches];
    
    let matchesTable = 'SEMANTIC VALIDATION RESULTS:\n';
    matchesTable += '┌─────────────────────────────────────────────────────────┬────────────────────┬────────────┐\n';
    matchesTable += '│ Text from Note                                        │ Matched Injury     │ Similarity │\n';
    matchesTable += '├─────────────────────────────────────────────────────────┼────────────────────┼────────────┤\n';
    
    for (const match of allSemanticMatches) {
      const text = match.sentence.substring(0, 45).padEnd(45);
      const injury = match.matchedInjury.padEnd(18);
      const similarity = `${(match.similarity * 100).toFixed(1)}%`.padEnd(10);
      matchesTable += `│ ${text} │ ${injury} │ ${similarity} │\n`;
    }
    
    matchesTable += '└─────────────────────────────────────────────────────────┴────────────────────┴────────────┘\n';

    // Step 4: Create user prompt for LLM
    const userPrompt = `ORIGINAL NOTE:
${noteContent}

${matchesTable}

The semantic validation found ${allSemanticMatches.length} potential injury matches above the ${(finalConfig.minThreshold * 100).toFixed(0)}% similarity threshold.

Your task: Review these matches and the original note. Determine which are ACTUAL physical injuries that should be included in the final output. Filter out:
- Negations (e.g., "no pain", "denies injury")
- Non-injury symptoms (e.g., "dizzy", "febrile")
- False positives from semantic matching
- Anything not in the ALLOWED_INJURIES list

Return ONLY a JSON array with the final list of injuries.`;

    // Step 5: Call LLM to make final decisions
    const llmResponse = await callLLM(model, SYSTEM_PROMPT, userPrompt);

    // Step 6: Parse LLM response (should be JSON array)
    let finalInjuries: Array<{ phrase: string; matched_injury: string }> = [];
    try {
      const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        finalInjuries = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse LLM response:', parseError);
    }

    return NextResponse.json({
      semanticMatches: {
        strong: strongMatches,
        medium: mediumMatches,
        weak: weakMatches,
        all: allSemanticMatches,
      },
      llmResponse,
      finalInjuries,
      matchesTable,
    });
  } catch (error: any) {
    console.error('Semantic + LLM refinement error:', error);
    return NextResponse.json(
      {
        error: 'Failed to run semantic + LLM refinement',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
