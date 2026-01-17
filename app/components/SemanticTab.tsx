'use client';

import { useState } from 'react';
import { ALL_MODELS } from '@/lib/constants';
import type { Layer1Evidence, FinalInjuries } from '@/lib/rnd/schema';

interface SemanticMatch {
  text: string;
  matchedInjury: string;
  similarity: number;
  originalCandidate: string | null;
  isStrongMatch: boolean;
}

interface SemanticValidationResult {
  strongMatches: SemanticMatch[];
  mediumMatches: SemanticMatch[];
  weakMatches: SemanticMatch[];
  unmatched: string[];
}

export default function SemanticTab() {
  const [noteContent, setNoteContent] = useState('');
  const [model, setModel] = useState(ALL_MODELS[0].id);
  const [temperature, setTemperature] = useState(0);
  const [strongThreshold, setStrongThreshold] = useState(0.7);
  const [mediumThreshold, setMediumThreshold] = useState(0.5);
  const [minThreshold, setMinThreshold] = useState(0.3);
  const [loading, setLoading] = useState(false);
  const [layer1Evidence, setLayer1Evidence] = useState<Layer1Evidence | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunLayer1 = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);
    setSemanticResult(null);

    try {
      const response = await fetch('/api/rnd/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          config: {
            model,
            temperature,
            useSectionRecognizer: false,
            maxTokens: 2000,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run Layer 1 extraction');
      }

      const data = await response.json();
      setLayer1Evidence(data.layer1Evidence);
    } catch (err: any) {
      setError(err.message || 'Failed to run Layer 1 extraction');
    } finally {
      setLoading(false);
    }
  };

  const handleRunSemanticValidation = async () => {
    if (!layer1Evidence || !layer1Evidence.injury_mentions.length) {
      setError('Please run Layer 1 extraction first or ensure there are injury mentions');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/semantic/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer1Evidence,
          config: {
            strongThreshold,
            mediumThreshold,
            minThreshold,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run semantic validation');
      }

      const data = await response.json();
      setSemanticResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to run semantic validation');
    } finally {
      setLoading(false);
    }
  };

  const handleFindSimilarSentences = async () => {
    if (!noteContent.trim()) {
      setError('Please enter a note');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/semantic/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteContent,
          mode: 'find_sentences',
          config: {
            strongThreshold: 10, // top K
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to find similar sentences');
      }

      const data = await response.json();
      // Display results in a friendly way
      console.log('Similar sentences:', data.similarSentences);
      alert(`Found ${data.similarSentences.length} similar sentences. Check console for details.`);
    } catch (err: any) {
      setError(err.message || 'Failed to find similar sentences');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Semantic Validation with Sentence Transformers</h2>
        <p className="mb-6 text-gray-700">
          This tool uses sentence embeddings to validate and match injury mentions semantically.
          It can help identify injuries even when wording differs from exact keywords, and can
          validate Layer 1 extractions against the allowed injury list.
        </p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Nurse Note</label>
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Paste nurse note here..."
              className="w-full p-3 border border-gray-300 rounded-md h-32"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Model (for Layer 1)</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                {ALL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Temperature</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">Semantic Thresholds</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Strong Match (&ge;)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={strongThreshold}
                  onChange={(e) => setStrongThreshold(parseFloat(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Medium Match (&ge;)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={mediumThreshold}
                  onChange={(e) => setMediumThreshold(parseFloat(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Min Threshold (&ge;)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={minThreshold}
                  onChange={(e) => setMinThreshold(parseFloat(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRunLayer1}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Running...' : 'Step 1: Run Layer 1 Extraction'}
            </button>
            <button
              onClick={handleRunSemanticValidation}
              disabled={loading || !layer1Evidence}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Step 2: Run Semantic Validation
            </button>
            <button
              onClick={handleFindSimilarSentences}
              disabled={loading}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              Find Similar Sentences in Note
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </div>

      {layer1Evidence && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-bold mb-3">Layer 1 Evidence</h3>
          <div className="space-y-3">
            <div>
              <span className="font-semibold">Injury Mentions Found: </span>
              <span>{layer1Evidence.injury_mentions.length}</span>
            </div>
            {layer1Evidence.injury_mentions.length > 0 && (
              <div className="border rounded-md p-3">
                <ul className="list-disc list-inside space-y-2">
                  {layer1Evidence.injury_mentions.map((mention, idx) => (
                    <li key={idx} className="text-sm">
                      <span className="font-mono">"{mention.text}"</span>
                      {mention.injury_candidate && (
                        <span className="ml-2 text-green-700">
                          → {mention.injury_candidate}
                        </span>
                      )}
                      {mention.is_negated && (
                        <span className="ml-2 text-red-600">(NEGATED)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {semanticResult && (
        <div className="bg-white p-6 rounded-lg shadow-md space-y-4">
          <h3 className="text-xl font-bold mb-3">Semantic Validation Results</h3>

          {semanticResult.strongMatches.length > 0 && (
            <div>
              <h4 className="font-semibold text-green-700 mb-2">
                Strong Matches ({semanticResult.strongMatches.length})
              </h4>
              <div className="border rounded-md p-3 bg-green-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Text</th>
                      <th className="text-left p-2">Semantic Match</th>
                      <th className="text-left p-2">Layer 1 Candidate</th>
                      <th className="text-left p-2">Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.strongMatches.map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 text-green-700 font-semibold">{match.matchedInjury}</td>
                        <td className="p-2">
                          {match.originalCandidate || (
                            <span className="text-gray-400">null</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className="font-mono">{(match.similarity * 100).toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {semanticResult.mediumMatches.length > 0 && (
            <div>
              <h4 className="font-semibold text-yellow-700 mb-2">
                Medium Matches ({semanticResult.mediumMatches.length})
              </h4>
              <div className="border rounded-md p-3 bg-yellow-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Text</th>
                      <th className="text-left p-2">Semantic Match</th>
                      <th className="text-left p-2">Layer 1 Candidate</th>
                      <th className="text-left p-2">Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.mediumMatches.map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 text-yellow-700 font-semibold">
                          {match.matchedInjury}
                        </td>
                        <td className="p-2">
                          {match.originalCandidate || (
                            <span className="text-gray-400">null</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className="font-mono">{(match.similarity * 100).toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {semanticResult.weakMatches.length > 0 && (
            <div>
              <h4 className="font-semibold text-orange-700 mb-2">
                Weak Matches ({semanticResult.weakMatches.length})
              </h4>
              <div className="border rounded-md p-3 bg-orange-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Text</th>
                      <th className="text-left p-2">Semantic Match</th>
                      <th className="text-left p-2">Layer 1 Candidate</th>
                      <th className="text-left p-2">Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanticResult.weakMatches.map((match, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2 font-mono text-xs">"{match.text}"</td>
                        <td className="p-2 text-orange-700 font-semibold">
                          {match.matchedInjury}
                        </td>
                        <td className="p-2">
                          {match.originalCandidate || (
                            <span className="text-gray-400">null</span>
                          )}
                        </td>
                        <td className="p-2">
                          <span className="font-mono">{(match.similarity * 100).toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {semanticResult.unmatched.length > 0 && (
            <div>
              <h4 className="font-semibold text-red-700 mb-2">
                Unmatched ({semanticResult.unmatched.length})
              </h4>
              <div className="border rounded-md p-3 bg-red-50">
                <ul className="list-disc list-inside space-y-1">
                  {semanticResult.unmatched.map((text, idx) => (
                    <li key={idx} className="text-sm font-mono">"{text}"</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}