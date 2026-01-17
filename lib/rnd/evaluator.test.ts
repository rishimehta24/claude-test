/**
 * R&D Project: Two-Layer Injury Extraction Pipeline
 * 
 * Unit Tests for Deterministic Evaluator
 */

import { evaluateEvidence, DEFAULT_CONFIG } from './evaluator';
import { Layer1Evidence, FinalInjuries } from './schema';

/**
 * Helper to create a minimal Layer1Evidence object
 */
function createEvidence(partial: Partial<Layer1Evidence>): Layer1Evidence {
  return {
    injury_mentions: [],
    negations: [],
    no_injury_statements: [],
    timing_markers: [],
    body_sites: [],
    metadata: {
      model_version: 'test',
      extraction_warnings: [],
    },
    ...partial,
  };
}

/**
 * Test runner (simple implementation for demonstration)
 */
function runTests() {
  const tests: Array<{ name: string; fn: () => boolean }> = [];
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => boolean) {
    tests.push({ name, fn });
  }

  // Test 1: No injuries (explicit "no injuries noted")
  test('No injuries - explicit "no injuries noted"', () => {
    const evidence = createEvidence({
      no_injury_statements: [
        { text: 'no injuries noted', start_char: 50, end_char: 68 },
      ],
    });

    const result = evaluateEvidence(evidence);
    return JSON.stringify(result) === JSON.stringify([]);
  });

  // Test 2: Injuries + denial of other injuries
  test('Injuries + denial of other injuries', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: '3cm skin tear on right forearm',
          injury_candidate: 'skin tear',
          body_site: 'right forearm',
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 0,
          end_char: 32,
        },
        {
          text: 'denies other pain',
          injury_candidate: 'pain',
          body_site: null,
          is_negated: true,
          negation_text: 'denies other pain',
          temporal_relation_to_fall: 'unknown',
          certainty: 'explicit',
          start_char: 50,
          end_char: 67,
        },
      ],
    });

    const result = evaluateEvidence(evidence);
    const expected: FinalInjuries = [
      { phrase: '3cm skin tear on right forearm', matched_injury: 'skin tear' },
    ];

    return (
      result.length === 1 &&
      result[0].matched_injury === 'skin tear' &&
      !result.some((r) => r.matched_injury === 'pain')
    );
  });

  // Test 3: Ambiguous symptom that should be ignored (shaking, febrile)
  test('Ambiguous symptom ignored (shaking, febrile)', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: 'shaking right hand',
          injury_candidate: null, // Not in Allowed_Injuries
          body_site: 'right hand',
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'unknown',
          certainty: 'unclear',
          start_char: 0,
          end_char: 18,
        },
      ],
    });

    const result = evaluateEvidence(evidence);
    return JSON.stringify(result) === JSON.stringify([]);
  });

  // Test 4: "skin intact" positive assessments
  test('"skin intact" positive assessments ignored', () => {
    const evidence = createEvidence({
      injury_mentions: [],
      negations: [
        {
          text: 'skin is intact',
          scope_hint: 'skin',
          start_char: 0,
          end_char: 14,
        },
      ],
    });

    const result = evaluateEvidence(evidence);
    return JSON.stringify(result) === JSON.stringify([]);
  });

  // Test 5: Conflicting note - early "no injuries noted" then later "new skin tear"
  test('Conflicting note - no injury statement then later injury', () => {
    const evidence = createEvidence({
      no_injury_statements: [
        { text: 'no injuries noted', start_char: 0, end_char: 18 },
      ],
      injury_mentions: [
        {
          text: 'new skin tear on left arm',
          injury_candidate: 'skin tear',
          body_site: 'left arm',
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 100, // After the "no injuries noted" statement
          end_char: 126,
        },
      ],
    });

    const result = evaluateEvidence(evidence, DEFAULT_CONFIG);
    // Should return [] because of respectNoInjuryStatements rule
    // BUT if we have an explicit injury after, it should be included
    // Actually, the rule says: return [] UNLESS there's at least one explicit injury after
    
    return (
      result.length === 1 &&
      result[0].matched_injury === 'skin tear'
    );
  });

  // Test 6: Multiple injuries with deduplication
  test('Multiple injuries with deduplication', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: 'bruise',
          injury_candidate: 'bruise',
          body_site: null,
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 0,
          end_char: 6,
        },
        {
          text: 'large bruise on right knee',
          injury_candidate: 'bruise',
          body_site: 'right knee',
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 20,
          end_char: 47,
        },
        {
          text: 'swelling',
          injury_candidate: 'swelling',
          body_site: null,
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 50,
          end_char: 58,
        },
      ],
    });

    const result = evaluateEvidence(evidence);
    // Should have 2 injuries (bruise deduplicated to longer phrase, swelling)
    const bruiseInjuries = result.filter((r) => r.matched_injury === 'bruise');
    const swellingInjuries = result.filter((r) => r.matched_injury === 'swelling');

    return (
      result.length === 2 &&
      bruiseInjuries.length === 1 &&
      bruiseInjuries[0].phrase === 'large bruise on right knee' &&
      swellingInjuries.length === 1
    );
  });

  // Test 7: Pain without body site or post-fall context (should be excluded)
  test('Pain without body site or post-fall context excluded', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: 'reports pain',
          injury_candidate: 'pain',
          body_site: null,
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'unknown',
          certainty: 'explicit',
          start_char: 0,
          end_char: 13,
        },
      ],
    });

    const result = evaluateEvidence(evidence, DEFAULT_CONFIG);
    return JSON.stringify(result) === JSON.stringify([]);
  });

  // Test 8: Pain with body site (should be included)
  test('Pain with body site included', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: 'pain in right shoulder',
          injury_candidate: 'pain',
          body_site: 'right shoulder',
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'unknown',
          certainty: 'explicit',
          start_char: 0,
          end_char: 23,
        },
      ],
    });

    const result = evaluateEvidence(evidence, DEFAULT_CONFIG);
    return (
      result.length === 1 &&
      result[0].matched_injury === 'pain'
    );
  });

  // Test 9: Pain with post-fall context (should be included)
  test('Pain with post-fall context included', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: 'pain after fall',
          injury_candidate: 'pain',
          body_site: null,
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 0,
          end_char: 15,
        },
      ],
    });

    const result = evaluateEvidence(evidence, DEFAULT_CONFIG);
    return (
      result.length === 1 &&
      result[0].matched_injury === 'pain'
    );
  });

  // Test 10: RNAO-style long narrative with scattered mentions
  test('RNAO-style narrative with scattered mentions', () => {
    const evidence = createEvidence({
      injury_mentions: [
        {
          text: 'resident was found on floor',
          injury_candidate: null,
          body_site: null,
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'unclear',
          start_char: 0,
          end_char: 33,
        },
        {
          text: 'abrasion on left elbow',
          injury_candidate: 'abrasion',
          body_site: 'left elbow',
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 200,
          end_char: 221,
        },
        {
          text: 'minor swelling noted',
          injury_candidate: 'swelling',
          body_site: null,
          is_negated: false,
          negation_text: null,
          temporal_relation_to_fall: 'post_fall',
          certainty: 'explicit',
          start_char: 250,
          end_char: 270,
        },
      ],
      timing_markers: [
        { text: 'found on floor', start_char: 20, end_char: 33 },
      ],
    });

    const result = evaluateEvidence(evidence);
    return (
      result.length === 2 &&
      result.some((r) => r.matched_injury === 'abrasion') &&
      result.some((r) => r.matched_injury === 'swelling')
    );
  });

  // Run all tests
  for (const { name, fn } of tests) {
    try {
      const passedTest = fn();
      if (passedTest) {
        passed++;
        console.log(`✅ PASS: ${name}`);
      } else {
        failed++;
        console.log(`❌ FAIL: ${name}`);
      }
    } catch (error: any) {
      failed++;
      console.log(`❌ ERROR: ${name} - ${error.message}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${tests.length} total`);
  return { passed, failed, total: tests.length };
}

// Export for use in other contexts
export { runTests };

// If running directly, execute tests
if (require.main === module) {
  runTests();
}