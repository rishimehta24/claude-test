'use client';

import { useState } from 'react';
import { ALL_MODELS } from '@/lib/constants';

interface PipelineBlock {
  id: string;
  type: 'input' | 'section_recognizer' | 'semantic_validation' | 'llm_extraction' | 'layer2_evaluator' | 'llm_refinement';
  config?: {
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    thresholds?: {
      strong?: number;
      medium?: number;
      min?: number;
    };
  };
}

interface BlockResult {
  blockId: string;
  blockType: string;
  input: any;
  output: any;
  metadata: {
    tokens?: { input: number; output: number };
    cost?: number;
    processingTime?: number;
  };
  error?: string;
}

interface PipelineExecutionResult {
  results: BlockResult[];
  summary: {
    totalBlocks: number;
    executedBlocks: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    finalOutput: any;
  };
}

const EXAMPLE_NOTE = `Effective Date: 11/24/2025 12:15Type: RNAO - Post Fall Assessment Section B Post Fall Assessment : Fall was witnessed. Date and time the Resident fell or was found: 11/24/2025 12:15 PMDate and time of notification: 11/24/2025Name of SDM/POA contacted. Vicky and Brian TiltWitness report: Resident was standing in elevator with Lindsay PSW and start telling that she feeling dizzy and Lindsy said by the time while she was trying to help Linda she fell and hit her head on elevator wallResident's description of the fall: Feeling DizzyResident does not have any fall-related injury/injuries or verbal/non-verbal indicators of pain. Resident shows signs of new pain after fall. Resident hit their head. Resident is drowsy.`;

const BLOCK_DESCRIPTIONS = {
  input: 'Input Note Content',
  section_recognizer: 'Section Recognizer (Pre-processor)',
  semantic_validation: 'Semantic Validation (Free)',
  llm_extraction: 'LLM Extraction (Layer 1)',
  layer2_evaluator: 'Layer 2 Evaluator (Deterministic)',
  llm_refinement: 'LLM Refinement (Hybrid)',
};

export default function PipelineBuilderTab() {
  const [blocks, setBlocks] = useState<PipelineBlock[]>([
    { id: 'input-1', type: 'input' },
  ]);
  const [inputNote, setInputNote] = useState(EXAMPLE_NOTE);
  const [apiKey, setApiKey] = useState('');
  const [executionResult, setExecutionResult] = useState<PipelineExecutionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  const addBlock = (type: PipelineBlock['type']) => {
    const newBlock: PipelineBlock = {
      id: `${type}-${Date.now()}`,
      type,
      config: type === 'llm_extraction' ? {
        modelId: 'claude-sonnet-4-5-20250929',
        temperature: 0,
        maxTokens: 2000,
      } : type === 'semantic_validation' ? {
        thresholds: { strong: 0.7, medium: 0.5, min: 0.3 },
      } : type === 'llm_refinement' ? {
        modelId: 'claude-haiku-4-5-20251001',
        temperature: 0,
        maxTokens: 2000,
      } : undefined,
    };
    setBlocks([...blocks, newBlock]);
  };

  const removeBlock = (id: string) => {
    if (blocks.length === 1) return; // Keep at least one block
    setBlocks(blocks.filter(b => b.id !== id));
  };

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    const index = blocks.findIndex(b => b.id === id);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blocks.length) return;

    const newBlocks = [...blocks];
    [newBlocks[index], newBlocks[newIndex]] = [newBlocks[newIndex], newBlocks[index]];
    setBlocks(newBlocks);
  };

  const updateBlockConfig = (id: string, config: Partial<PipelineBlock['config']>) => {
    setBlocks(blocks.map(b => 
      b.id === id ? { ...b, config: { ...b.config, ...config } } : b
    ));
  };

  const executePipeline = async () => {
    if (!inputNote.trim()) {
      setError('Please enter input note content');
      return;
    }

    setLoading(true);
    setError(null);
    setExecutionResult(null);

    try {
      const response = await fetch('/api/pipeline/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: blocks.filter(b => b.type !== 'input'), // Exclude input block from execution
          inputNote,
          apiKey: apiKey || undefined, // Use env var if not provided
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute pipeline');
      }

      const data = await response.json();
      setExecutionResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to execute pipeline');
    } finally {
      setLoading(false);
    }
  };

  const toggleBlockExpansion = (id: string) => {
    const newExpanded = new Set(expandedBlocks);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedBlocks(newExpanded);
  };

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Unified Pipeline Builder</h2>
        <p className="mb-6 text-gray-700">
          Build custom pipelines by arranging blocks in any order. Each block processes data sequentially,
          passing output to the next block. See step-by-step results as the pipeline executes.
        </p>

        {/* Input Note */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Input Note Content</label>
          <textarea
            value={inputNote}
            onChange={(e) => setInputNote(e.target.value)}
            placeholder="Paste note content here..."
            className="w-full p-3 border border-gray-300 rounded-md h-32 font-mono text-sm"
          />
        </div>

        {/* API Key (Optional) */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            API Key (Optional - uses env var if not provided)
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave empty to use environment variable"
            className="w-full p-2 border border-gray-300 rounded-md"
          />
        </div>

        {/* Available Blocks */}
        <div className="border-t pt-4 mb-6">
          <h3 className="font-semibold mb-3">Available Blocks (Click to Add)</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => addBlock('section_recognizer')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              + Section Recognizer
            </button>
            <button
              onClick={() => addBlock('semantic_validation')}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
            >
              + Semantic Validation (Free)
            </button>
            <button
              onClick={() => addBlock('llm_extraction')}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm"
            >
              + LLM Extraction
            </button>
            <button
              onClick={() => addBlock('layer2_evaluator')}
              className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 text-sm"
            >
              + Layer 2 Evaluator (Free)
            </button>
            <button
              onClick={() => addBlock('llm_refinement')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm"
            >
              + LLM Refinement
            </button>
          </div>
        </div>

        {/* Pipeline Blocks */}
        <div className="border-t pt-4 mb-6">
          <h3 className="font-semibold mb-3">Pipeline Blocks (Drag to reorder with ↑↓)</h3>
          <div className="space-y-2">
            {blocks.map((block, idx) => (
              <div key={block.id} className="border rounded-lg bg-gray-50">
                <div className="flex items-center gap-2 p-3">
                  <span className="text-sm font-semibold text-gray-500 w-8">{idx + 1}.</span>
                  <div className="flex-1">
                    <span className={`px-3 py-1 rounded text-sm font-semibold ${
                      block.type === 'input' ? 'bg-gray-100 text-gray-800' :
                      block.type === 'semantic_validation' || block.type === 'layer2_evaluator' ? 'bg-green-100 text-green-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {BLOCK_DESCRIPTIONS[block.type]}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {block.type !== 'input' && (
                      <>
                        <button
                          onClick={() => moveBlock(block.id, 'up')}
                          disabled={idx === 0}
                          className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveBlock(block.id, 'down')}
                          disabled={idx === blocks.length - 1}
                          className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => removeBlock(block.id)}
                          className="px-2 py-1 text-xs bg-red-200 text-red-800 rounded hover:bg-red-300"
                        >
                          ×
                        </button>
                      </>
                    )}
                    {(block.type === 'llm_extraction' || block.type === 'llm_refinement' || block.type === 'semantic_validation') && (
                      <button
                        onClick={() => toggleBlockExpansion(block.id)}
                        className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
                      >
                        {expandedBlocks.has(block.id) ? '▼' : '▶'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Config */}
                {expandedBlocks.has(block.id) && (
                  <div className="border-t p-3 bg-white space-y-2">
                    {block.type === 'llm_extraction' || block.type === 'llm_refinement' ? (
                      <>
                        <div>
                          <label className="block text-xs font-medium mb-1">Model</label>
                          <select
                            value={block.config?.modelId || ''}
                            onChange={(e) => updateBlockConfig(block.id, { modelId: e.target.value })}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm"
                          >
                            {ALL_MODELS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium mb-1">Temperature</label>
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.1"
                              value={block.config?.temperature ?? 0}
                              onChange={(e) => updateBlockConfig(block.id, { temperature: parseFloat(e.target.value) })}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Max Tokens</label>
                            <input
                              type="number"
                              min="100"
                              max="8000"
                              value={block.config?.maxTokens || 2000}
                              onChange={(e) => updateBlockConfig(block.id, { maxTokens: parseInt(e.target.value) })}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                        </div>
                      </>
                    ) : block.type === 'semantic_validation' ? (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs font-medium mb-1">Strong Threshold</label>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={block.config?.thresholds?.strong ?? 0.7}
                            onChange={(e) => updateBlockConfig(block.id, {
                              thresholds: {
                                ...block.config?.thresholds,
                                strong: parseFloat(e.target.value),
                              },
                            })}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Medium Threshold</label>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={block.config?.thresholds?.medium ?? 0.5}
                            onChange={(e) => updateBlockConfig(block.id, {
                              thresholds: {
                                ...block.config?.thresholds,
                                medium: parseFloat(e.target.value),
                              },
                            })}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Min Threshold</label>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={block.config?.thresholds?.min ?? 0.3}
                            onChange={(e) => updateBlockConfig(block.id, {
                              thresholds: {
                                ...block.config?.thresholds,
                                min: parseFloat(e.target.value),
                              },
                            })}
                            className="w-full p-2 border border-gray-300 rounded-md text-sm"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Execute Button */}
        <div className="flex gap-3">
          <button
            onClick={executePipeline}
            disabled={loading || blocks.length === 0}
            className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Executing Pipeline...' : 'Execute Pipeline'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </div>

      {/* Execution Results */}
      {executionResult && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Pipeline Summary</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="p-3 bg-blue-50 rounded border border-blue-200">
                <div className="text-sm text-gray-600 mb-1">Total Cost</div>
                <div className="text-xl font-bold text-blue-900">
                  ${executionResult.summary.totalCost.toFixed(4)}
                </div>
              </div>
              <div className="p-3 bg-green-50 rounded border border-green-200">
                <div className="text-sm text-gray-600 mb-1">Input Tokens</div>
                <div className="text-xl font-bold text-green-900">
                  {executionResult.summary.totalInputTokens.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-purple-50 rounded border border-purple-200">
                <div className="text-sm text-gray-600 mb-1">Output Tokens</div>
                <div className="text-xl font-bold text-purple-900">
                  {executionResult.summary.totalOutputTokens.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-orange-50 rounded border border-orange-200">
                <div className="text-sm text-gray-600 mb-1">Blocks Executed</div>
                <div className="text-xl font-bold text-orange-900">
                  {executionResult.summary.executedBlocks}/{executionResult.summary.totalBlocks}
                </div>
              </div>
            </div>
          </div>

          {/* Step-by-Step Results */}
          <div className="bg-white p-6 rounded-lg shadow-md space-y-4">
            <h3 className="text-xl font-bold mb-4">Step-by-Step Results</h3>
            {executionResult.results.map((result, idx) => (
              <div key={result.blockId} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-lg">
                    Step {idx + 1}: {BLOCK_DESCRIPTIONS[result.blockType as keyof typeof BLOCK_DESCRIPTIONS] || result.blockType}
                  </h4>
                  <div className="flex gap-2 text-sm">
                    {result.metadata.cost !== undefined && (
                      <span className={`px-2 py-1 rounded ${
                        result.metadata.cost === 0 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        ${result.metadata.cost.toFixed(4)}
                      </span>
                    )}
                    {result.metadata.processingTime && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded">
                        {(result.metadata.processingTime / 1000).toFixed(2)}s
                      </span>
                    )}
                    {result.error && (
                      <span className="px-2 py-1 bg-red-100 text-red-800 rounded">
                        Error
                      </span>
                    )}
                  </div>
                </div>

                {result.error ? (
                  <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                    {result.error}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {result.blockType === 'section_recognizer' && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1">Processed Note (Shortened)</div>
                        <div className="text-sm bg-white p-2 rounded border border-gray-200 max-h-32 overflow-y-auto">
                          {result.output?.noteContent?.substring(0, 500)}...
                        </div>
                      </div>
                    )}

                    {result.blockType === 'semantic_validation' && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-2">Semantic Matches</div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="p-2 bg-green-100 rounded">
                            Strong: {result.output?.matches?.strong?.length || 0}
                          </div>
                          <div className="p-2 bg-yellow-100 rounded">
                            Medium: {result.output?.matches?.medium?.length || 0}
                          </div>
                          <div className="p-2 bg-orange-100 rounded">
                            Weak: {result.output?.matches?.weak?.length || 0}
                          </div>
                        </div>
                      </div>
                    )}

                    {result.blockType === 'llm_extraction' && result.output?.layer1Evidence && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1">
                          Layer 1 Evidence - Injury Mentions: {result.output.layer1Evidence.injury_mentions?.length || 0}
                        </div>
                        {result.output.layer1Evidence.injury_mentions?.length > 0 && (
                          <div className="text-xs bg-white p-2 rounded border border-gray-200 max-h-32 overflow-y-auto">
                            {result.output.layer1Evidence.injury_mentions.slice(0, 5).map((m: any, i: number) => (
                              <div key={i} className="mb-1">
                                "{m.text}" → {m.injury_candidate || 'null'}
                              </div>
                            ))}
                            {result.output.layer1Evidence.injury_mentions.length > 5 && (
                              <div className="text-gray-500">... and {result.output.layer1Evidence.injury_mentions.length - 5} more</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {result.blockType === 'layer2_evaluator' && result.output?.finalInjuries && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1">
                          Final Injuries: {result.output.finalInjuries.length}
                        </div>
                        <div className="text-sm bg-white p-2 rounded border border-gray-200">
                          {result.output.finalInjuries.length > 0 ? (
                            <pre className="text-xs">{JSON.stringify(result.output.finalInjuries, null, 2)}</pre>
                          ) : (
                            <span className="text-gray-500">No injuries found</span>
                          )}
                        </div>
                      </div>
                    )}

                    {result.blockType === 'llm_refinement' && result.output?.finalInjuries && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1">
                          Final Injuries (LLM Refined): {result.output.finalInjuries.length}
                        </div>
                        <div className="text-sm bg-white p-2 rounded border border-gray-200">
                          {result.output.finalInjuries.length > 0 ? (
                            <pre className="text-xs">{JSON.stringify(result.output.finalInjuries, null, 2)}</pre>
                          ) : (
                            <span className="text-gray-500">No injuries found</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
