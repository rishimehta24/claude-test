/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Example usage demonstrating the pipeline
 */

import { runPipeline, PipelineConfig } from './pipeline';
import { runTests } from './evaluator.test';

// Example notes for testing
const EXAMPLE_NOTES = {
  noInjuries: 'Unwitnessed fall. Assessed from head to toe, no cuts or bruises observed. Resident states they feel fine.',
  
  multipleInjuries: 'New 3cm skin tear on right forearm, with minor bleeding. Area is red and swollen. Resident denies other pain.',
  
  conflicting: 'Post fall assessment at 10:00 AM. No injuries noted during initial check. Later at 2:00 PM, resident reported new skin tear on left arm.',
  
  painWithBodySite: 'Resident reports pain in right shoulder after fall. No other complaints.',
  
  painWithoutBodySite: 'Resident reports pain after fall. No specific location mentioned.',
  
  generalSymptoms: 'Resident noted holding his shaking right hand, febrile T-37.8, denied complain of any discomfort.',
};

/**
 * Run example pipeline on a note
 */
async function runExample(noteName: keyof typeof EXAMPLE_NOTES) {
  const noteContent = EXAMPLE_NOTES[noteName];
  console.log(`\n=== Example: ${noteName} ===`);
  console.log(`Note: ${noteContent}\n`);

  const config: PipelineConfig = {
    apiKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY || '',
      openai: process.env.OPENAI_API_KEY || '',
      google: process.env.GOOGLE_API_KEY || '',
    },
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0,
    maxTokens: 2000,
    useSectionRecognizer: false,
  };

  const result = await runPipeline(noteContent, config);

  if (result.error) {
    console.error('Error:', result.error);
    return;
  }

  console.log('Final Injuries:', JSON.stringify(result.finalInjuries, null, 2));
  console.log('\nLayer 1 Evidence Summary:');
  console.log(`- Injury Mentions: ${result.layer1Evidence?.injury_mentions.length || 0}`);
  console.log(`- Negations: ${result.layer1Evidence?.negations.length || 0}`);
  console.log(`- No Injury Statements: ${result.layer1Evidence?.no_injury_statements.length || 0}`);
  console.log(`- Timing Markers: ${result.layer1Evidence?.timing_markers.length || 0}`);
  console.log(`- Body Sites: ${result.layer1Evidence?.body_sites.length || 0}`);
}

/**
 * Main example runner
 */
export async function runExamples() {
  console.log('R&D Two-Layer Injury Extraction Pipeline - Examples\n');

  // Check if API key is available
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('Warning: ANTHROPIC_API_KEY not set. Examples will fail.');
    console.log('Set ANTHROPIC_API_KEY environment variable to run examples.\n');
  }

  // Run unit tests first
  console.log('Running unit tests...');
  runTests();
  console.log('\n');

  // Run pipeline examples (if API key is set)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Running pipeline examples...\n');
    await runExample('noInjuries');
    await runExample('multipleInjuries');
    await runExample('painWithBodySite');
  } else {
    console.log('Skipping pipeline examples (no API key).');
  }
}

// If running directly, execute examples
if (require.main === module) {
  runExamples().catch(console.error);
}