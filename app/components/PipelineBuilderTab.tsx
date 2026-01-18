'use client';

import { useState, useEffect } from 'react';
import { LAYER1_SYSTEM_PROMPT, LAYER1_USER_PROMPT_TEMPLATE } from '@/lib/rnd/prompts';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '@/lib/constants';
import { ALL_MODELS } from '@/lib/constants';

interface PipelineBlock {
  id: string;
  type: 'input' | 'semantic_validation' | 'llm_extraction' | 'layer2_evaluator' | 'llm_refinement' | 'llm_evaluation';
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
  semantic_validation: 'Semantic Validation (Free)',
  llm_extraction: 'LLM Extraction (Layer 1)',
  layer2_evaluator: 'Layer 2 Evaluator (Deterministic)',
  llm_refinement: 'LLM Refinement (Hybrid)',
  llm_evaluation: 'LLM Evaluation (Direct)',
  double_layer_llm: 'Double Layer LLM Analysis',
};

const LAYER1_BLOCKS = ['semantic_validation', 'llm_extraction'];
const LAYER2_BLOCKS = ['layer2_evaluator', 'llm_refinement', 'llm_evaluation', 'double_layer_llm'];

const BLOCK_CATEGORIES = {
  layer1: {
    title: 'Layer 1: Preprocessing & Evidence Extraction',
    description: 'These blocks preprocess, extract, or summarize information from the note. They do NOT produce final injuries.',
    blocks: LAYER1_BLOCKS,
  },
  layer2: {
    title: 'Layer 2: Classification & Final Injury Extraction',
    description: 'These blocks produce final injuries. They can work standalone (direct from raw note) or after Layer 1 preprocessing.',
    blocks: LAYER2_BLOCKS,
  },
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
  const [promptViewBlocks, setPromptViewBlocks] = useState<Set<string>>(new Set());
  const [savedConfigs, setSavedConfigs] = useState<Array<{ id: string; name: string; blocks: PipelineBlock[] }>>([]);
  const [configName, setConfigName] = useState('');

  // Load saved configs on mount
  useEffect(() => {
    const saved = localStorage.getItem('pipelineConfigs');
    if (saved) {
      try {
        setSavedConfigs(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load saved configs:', e);
      }
    }
  }, []);

  const saveConfig = () => {
    if (!configName.trim()) {
      setError('Please enter a configuration name');
      return;
    }

    if (blocks.length === 0 || (blocks.length === 1 && blocks[0].type === 'input')) {
      setError('Please add at least one processing block');
      return;
    }

    const newConfig = {
      id: `config-${Date.now()}`,
      name: configName.trim(),
      blocks: blocks.filter(b => b.type !== 'input'), // Don't save input block
    };

    const updatedConfigs = [...savedConfigs, newConfig];
    setSavedConfigs(updatedConfigs);
    localStorage.setItem('pipelineConfigs', JSON.stringify(updatedConfigs));
    setConfigName('');
    setError(null);
  };

  const loadConfig = (configId: string) => {
    const config = savedConfigs.find(c => c.id === configId);
    if (config) {
      setBlocks([
        { id: 'input-1', type: 'input' },
        ...config.blocks.map((b, idx) => ({ ...b, id: `${b.type}-${Date.now()}-${idx}` })),
      ]);
      setConfigName(config.name);
    }
  };

  const deleteConfig = (configId: string) => {
    const updatedConfigs = savedConfigs.filter(c => c.id !== configId);
    setSavedConfigs(updatedConfigs);
    localStorage.setItem('pipelineConfigs', JSON.stringify(updatedConfigs));
  };

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
      } : type === 'double_layer_llm' ? {
        modelId: 'claude-sonnet-4-5-20250929',
        modelId2: 'claude-haiku-4-5-20251001',
        temperature: 0.1,
        temperature2: 0.1,
        maxTokens: 500,
        maxTokens2: 500,
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
      // Close prompt view when opening config
      const newPromptView = new Set(promptViewBlocks);
      newPromptView.delete(id);
      setPromptViewBlocks(newPromptView);
    }
    setExpandedBlocks(newExpanded);
  };

  const togglePromptView = (id: string) => {
    const newPromptView = new Set(promptViewBlocks);
    if (newPromptView.has(id)) {
      newPromptView.delete(id);
    } else {
      newPromptView.add(id);
      // Close config when opening prompt view
      const newExpanded = new Set(expandedBlocks);
      newExpanded.delete(id);
      setExpandedBlocks(newExpanded);
    }
    setPromptViewBlocks(newPromptView);
  };

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Unified Pipeline Builder</h2>
        <p className="mb-6 text-gray-700">
          Build custom pipelines by arranging blocks in any order. Each block processes data sequentially,
          passing output to the next block. See step-by-step results as the pipeline executes.
        </p>

        {/* Saved Configs */}
        {savedConfigs.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
            <h3 className="font-semibold mb-2">Saved Configurations</h3>
            <div className="flex flex-wrap gap-2">
              {savedConfigs.map((config) => (
                <div key={config.id} className="flex items-center gap-2 px-3 py-1 bg-white border rounded">
                  <span className="text-sm">{config.name}</span>
                  <button
                    onClick={() => loadConfig(config.id)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => deleteConfig(config.id)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
        <div className="border-t pt-4 mb-6 space-y-6">
          {/* Layer 1 Blocks */}
          <div>
            <h3 className="font-semibold mb-1 text-gray-800">{BLOCK_CATEGORIES.layer1.title}</h3>
            <p className="text-xs text-gray-600 mb-3">{BLOCK_CATEGORIES.layer1.description}</p>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>

          {/* Layer 2 Blocks */}
          <div>
            <h3 className="font-semibold mb-1 text-gray-800">{BLOCK_CATEGORIES.layer2.title}</h3>
            <p className="text-xs text-gray-600 mb-3">{BLOCK_CATEGORIES.layer2.description}</p>
            <div className="flex flex-wrap gap-2">
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
              <button
                onClick={() => addBlock('llm_evaluation')}
                className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 text-sm"
              >
                + LLM Evaluation (Direct)
              </button>
              <button
                onClick={() => addBlock('double_layer_llm')}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
              >
                + Double Layer LLM Analysis
              </button>
            </div>
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
                      LAYER1_BLOCKS.includes(block.type) ? 'bg-purple-100 text-purple-800' :
                      LAYER2_BLOCKS.includes(block.type) ? 'bg-orange-100 text-orange-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {BLOCK_DESCRIPTIONS[block.type]}
                      {LAYER1_BLOCKS.includes(block.type) && ' [Layer 1]'}
                      {LAYER2_BLOCKS.includes(block.type) && ' [Layer 2]'}
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
                    {block.type !== 'input' && (
                      <button
                        onClick={() => togglePromptView(block.id)}
                        className="px-2 py-1 text-xs bg-blue-200 text-blue-800 rounded hover:bg-blue-300"
                        title="View prompts and settings"
                      >
                        {promptViewBlocks.has(block.id) ? '📄▲' : '📄▼'}
                      </button>
                    )}
                    {(block.type === 'llm_extraction' || block.type === 'llm_refinement' || block.type === 'llm_evaluation' || block.type === 'semantic_validation' || block.type === 'double_layer_llm') && (
                      <button
                        onClick={() => toggleBlockExpansion(block.id)}
                        className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
                        title="Configure settings"
                      >
                        {expandedBlocks.has(block.id) ? '⚙️▲' : '⚙️▼'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Prompt & Settings View */}
                {promptViewBlocks.has(block.id) && (
                  <div className="border-t p-4 bg-blue-50 space-y-4">
                    {block.type === 'llm_extraction' && (
                      <div className="space-y-3">
                        <div className="font-semibold text-sm text-gray-800">LLM Extraction (Layer 1) - Prompts & Settings</div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Purpose</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Preprocessing - Extracts structured evidence (injury mentions, negations, timing, etc.). Does NOT produce final injuries.
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">System Prompt</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {LAYER1_SYSTEM_PROMPT}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">User Prompt Template</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-32 overflow-y-auto">
                            {LAYER1_USER_PROMPT_TEMPLATE('{{NOTE_CONTENT}}')}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">Note: <code>{'{{NOTE_CONTENT}}'}</code> is replaced with the actual note content</div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="font-semibold">Model:</span> {block.config?.modelId || 'claude-sonnet-4-5-20250929'}
                          </div>
                          <div>
                            <span className="font-semibold">Temperature:</span> {block.config?.temperature ?? 0}
                          </div>
                          <div>
                            <span className="font-semibold">Max Tokens:</span> {block.config?.maxTokens || 2000}
                          </div>
                          <div>
                            <span className="font-semibold">Purpose:</span> Extract structured evidence (not final injuries)
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'llm_refinement' && (
                      <div className="space-y-3">
                        <div className="font-semibold text-sm text-gray-800">LLM Refinement - Prompts & Settings</div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Purpose</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Classification - Produces final injuries by having LLM evaluate semantic validation matches table
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">System Prompt</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                            You are a medical data analyst. Review semantic validation matches and determine actual injuries. Return ONLY a JSON array: [{`{phrase: "...", matched_injury: "..."}`}] or [] if none.
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">User Prompt Template</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                            ORIGINAL NOTE:
                            {`{{NOTE_CONTENT}}`}

                            SEMANTIC VALIDATION RESULTS:
                            {`{{MATCHES_TABLE}}`}

                            Return JSON array of actual injuries.
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Note: <code>{'{{NOTE_CONTENT}}'}</code> is the original note, <code>{'{{MATCHES_TABLE}}'}</code> is a formatted table of semantic matches with similarity scores
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="font-semibold">Model:</span> {block.config?.modelId || 'claude-haiku-4-5-20251001'}
                          </div>
                          <div>
                            <span className="font-semibold">Temperature:</span> {block.config?.temperature ?? 0}
                          </div>
                          <div>
                            <span className="font-semibold">Max Tokens:</span> {block.config?.maxTokens || 2000}
                          </div>
                          <div>
                            <span className="font-semibold">Input:</span> Semantic validation matches table
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'llm_evaluation' && (
                      <div className="space-y-3">
                        <div className="font-semibold text-sm text-gray-800">LLM Evaluation (Direct) - Prompts & Settings</div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Purpose</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Classification - Produces final injuries directly from raw note content (single-step, works standalone)
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">System Prompt</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {SYSTEM_PROMPT}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">User Prompt Template</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-32 overflow-y-auto">
                            {USER_PROMPT_TEMPLATE('{{NOTE_CONTENT}}')}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">Note: <code>{'{{NOTE_CONTENT}}'}</code> is replaced with the actual note content</div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="font-semibold">Model:</span> {block.config?.modelId || 'claude-sonnet-4-5-20250929'}
                          </div>
                          <div>
                            <span className="font-semibold">Temperature:</span> {block.config?.temperature ?? 0.1}
                          </div>
                          <div>
                            <span className="font-semibold">Max Tokens:</span> {block.config?.maxTokens || 500}
                          </div>
                          <div>
                            <span className="font-semibold">Purpose:</span> Direct injury extraction (single step)
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'semantic_validation' && (
                      <div className="space-y-3">
                        <div className="font-semibold text-sm text-gray-800">Semantic Validation - Settings & Model Info</div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Purpose</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Preprocessing - Finds semantically similar sentences to injury terms. Outputs a table of matches, NOT final injuries.
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Embedding Model</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            <div><span className="font-semibold">Model:</span> Xenova/all-MiniLM-L6-v2</div>
                            <div className="mt-1"><span className="font-semibold">Provider:</span> Hugging Face (via @xenova/transformers)</div>
                            <div className="mt-1"><span className="font-semibold">Embedding Dimensions:</span> 384</div>
                            <div className="mt-1"><span className="font-semibold">Cost:</span> Free (runs locally in browser/Node.js)</div>
                            <div className="mt-1"><span className="font-semibold">Method:</span> Sentence embeddings → Cosine similarity</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Similarity Thresholds</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <span className="font-semibold">Strong:</span> ≥ {((block.config?.thresholds?.strong ?? 0.7) * 100).toFixed(0)}%
                              </div>
                              <div>
                                <span className="font-semibold">Medium:</span> ≥ {((block.config?.thresholds?.medium ?? 0.5) * 100).toFixed(0)}%
                              </div>
                              <div>
                                <span className="font-semibold">Min:</span> ≥ {((block.config?.thresholds?.min ?? 0.3) * 100).toFixed(0)}%
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">How It Works</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs space-y-1">
                            <div>1. Splits note into sentences</div>
                            <div>2. Converts each sentence to 384-dimensional embedding vector</div>
                            <div>3. Compares with pre-computed embeddings for each allowed injury</div>
                            <div>4. Calculates cosine similarity (0-1 scale)</div>
                            <div>5. Categorizes matches by similarity thresholds</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'double_layer_llm' && (
                      <div className="space-y-3">
                        <div className="font-semibold text-sm text-gray-800">Double Layer LLM Analysis - Prompts & Settings</div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Purpose</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Classification - Produces final injuries by combining two LLM outputs via consensus (Jaccard intersection). Works standalone with raw note content.
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">How It Works</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs space-y-2">
                            <div>1. Two LLMs analyze the same input text independently</div>
                            <div>2. Both LLMs output their injury lists</div>
                            <div>3. Calculate Jaccard similarity: |intersection| / |union|</div>
                            <div>4. Final output: Intersection (injuries both LLMs agree on)</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Models</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            <div><span className="font-semibold">Model 1:</span> {block.config?.modelId || 'claude-sonnet-4-5-20250929'}</div>
                            <div className="mt-1"><span className="font-semibold">Model 2:</span> {block.config?.modelId2 || 'claude-haiku-4-5-20251001'}</div>
                            <div className="mt-1"><span className="font-semibold">Temperature 1:</span> {block.config?.temperature ?? 0.1}</div>
                            <div className="mt-1"><span className="font-semibold">Temperature 2:</span> {block.config?.temperature2 ?? 0.1}</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">System Prompt (Both LLMs Use Same Prompt)</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                            {SYSTEM_PROMPT.substring(0, 500)}...
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Input</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Can accept raw note content directly (works standalone) or processed output from Layer 1
                          </div>
                        </div>
                      </div>
                    )}

                    {block.type === 'layer2_evaluator' && (
                      <div className="space-y-3">
                        <div className="font-semibold text-sm text-gray-800">Layer 2 Evaluator (Deterministic) - Rules & Settings</div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Purpose</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Classification - Produces final injuries by applying deterministic rules to Layer 1 evidence. Requires Layer 1 (LLM Extraction) output - cannot work standalone.
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Deterministic Rules Applied</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs space-y-2">
                            <div><span className="font-semibold">Rule 1:</span> Filter to Allowed_Injuries only (exclude null candidates)</div>
                            <div><span className="font-semibold">Rule 2:</span> Exclude negated mentions (is_negated=true)</div>
                            <div><span className="font-semibold">Rule 3:</span> Handle "no injury" statements - return [] unless explicit injury after statement</div>
                            <div><span className="font-semibold">Rule 4:</span> Prefer explicit mentions over implied/unclear</div>
                            <div><span className="font-semibold">Rule 5:</span> Strict "pain" evaluation - require body site OR post-fall context</div>
                            <div><span className="font-semibold">Rule 6:</span> Deduplicate by injury type, keep longest/most specific phrase</div>
                            <div><span className="font-semibold">Rule 7:</span> Sort by position in note, then alphabetically</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Configuration</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            <div className="grid grid-cols-2 gap-2">
                              <div><span className="font-semibold">excludeNegated:</span> true</div>
                              <div><span className="font-semibold">respectNoInjuryStatements:</span> true</div>
                              <div><span className="font-semibold">preferExplicit:</span> true</div>
                              <div><span className="font-semibold">strictPainEvaluation:</span> true</div>
                              <div><span className="font-semibold">requireExactMatch:</span> true</div>
                              <div><span className="font-semibold">Cost:</span> Free (pure TypeScript code)</div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Input Required</div>
                          <div className="bg-white p-3 rounded border border-gray-300 text-xs">
                            Layer 1 Evidence from LLM Extraction block (must include layer1Evidence in output)
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Expanded Config */}
                {expandedBlocks.has(block.id) && (
                  <div className="border-t p-3 bg-white space-y-2">
                    {block.type === 'double_layer_llm' ? (
                      <>
                        <div>
                          <label className="block text-xs font-medium mb-1">Model 1</label>
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
                            <label className="block text-xs font-medium mb-1">Temperature 1</label>
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.1"
                              value={block.config?.temperature ?? 0.1}
                              onChange={(e) => updateBlockConfig(block.id, { temperature: parseFloat(e.target.value) })}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Max Tokens 1</label>
                            <input
                              type="number"
                              min="100"
                              max="8000"
                              value={block.config?.maxTokens || 500}
                              onChange={(e) => updateBlockConfig(block.id, { maxTokens: parseInt(e.target.value) })}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Model 2</label>
                          <select
                            value={block.config?.modelId2 || ''}
                            onChange={(e) => updateBlockConfig(block.id, { modelId2: e.target.value })}
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
                            <label className="block text-xs font-medium mb-1">Temperature 2</label>
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.1"
                              value={block.config?.temperature2 ?? 0.1}
                              onChange={(e) => updateBlockConfig(block.id, { temperature2: parseFloat(e.target.value) })}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium mb-1">Max Tokens 2</label>
                            <input
                              type="number"
                              min="100"
                              max="8000"
                              value={block.config?.maxTokens2 || 500}
                              onChange={(e) => updateBlockConfig(block.id, { maxTokens2: parseInt(e.target.value) })}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                            />
                          </div>
                        </div>
                      </>
                    ) : block.type === 'llm_extraction' || block.type === 'llm_refinement' || block.type === 'llm_evaluation' ? (
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

        {/* Save Config */}
        <div className="border-t pt-4 mb-6">
          <h3 className="font-semibold mb-3">Save Configuration</h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              placeholder="e.g., Semantic + Haiku Refinement"
              className="flex-1 p-2 border border-gray-300 rounded-md"
            />
            <button
              onClick={saveConfig}
              disabled={!configName.trim() || blocks.length === 0}
              className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              Save Config
            </button>
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
                    {result.blockType === 'semantic_validation' && (
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-2">Semantic Matches Summary</div>
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

                        {/* Detailed Matches Table */}
                        {(result.output?.matches?.strong?.length > 0 || 
                          result.output?.matches?.medium?.length > 0 || 
                          result.output?.matches?.weak?.length > 0) && (
                          <div>
                            <div className="text-xs font-semibold text-gray-600 mb-2">Detailed Matches</div>
                            <div className="overflow-x-auto border rounded-md">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                  <tr className="border-b">
                                    <th className="text-left p-2">Category</th>
                                    <th className="text-left p-2">Sentence from Note</th>
                                    <th className="text-left p-2">Matched Injury</th>
                                    <th className="text-left p-2">Similarity</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* Strong Matches */}
                                  {result.output?.matches?.strong?.map((match: any, idx: number) => (
                                    <tr key={`strong-${idx}`} className="border-b bg-green-50">
                                      <td className="p-2">
                                        <span className="px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold">
                                          Strong
                                        </span>
                                      </td>
                                      <td className="p-2 font-mono text-xs max-w-md">
                                        "{match.sentence || match.text || ''}"
                                      </td>
                                      <td className="p-2 font-semibold text-green-700">
                                        {match.matchedInjury || match.matched_injury || 'N/A'}
                                      </td>
                                      <td className="p-2 font-mono font-semibold text-green-700">
                                        {((match.similarity || 0) * 100).toFixed(1)}%
                                      </td>
                                    </tr>
                                  ))}
                                  
                                  {/* Medium Matches */}
                                  {result.output?.matches?.medium?.map((match: any, idx: number) => (
                                    <tr key={`medium-${idx}`} className="border-b bg-yellow-50">
                                      <td className="p-2">
                                        <span className="px-2 py-1 bg-yellow-600 text-white rounded text-xs font-semibold">
                                          Medium
                                        </span>
                                      </td>
                                      <td className="p-2 font-mono text-xs max-w-md">
                                        "{match.sentence || match.text || ''}"
                                      </td>
                                      <td className="p-2 font-semibold text-yellow-700">
                                        {match.matchedInjury || match.matched_injury || 'N/A'}
                                      </td>
                                      <td className="p-2 font-mono font-semibold text-yellow-700">
                                        {((match.similarity || 0) * 100).toFixed(1)}%
                                      </td>
                                    </tr>
                                  ))}
                                  
                                  {/* Weak Matches */}
                                  {result.output?.matches?.weak?.map((match: any, idx: number) => (
                                    <tr key={`weak-${idx}`} className="border-b bg-orange-50">
                                      <td className="p-2">
                                        <span className="px-2 py-1 bg-orange-600 text-white rounded text-xs font-semibold">
                                          Weak
                                        </span>
                                      </td>
                                      <td className="p-2 font-mono text-xs max-w-md">
                                        "{match.sentence || match.text || ''}"
                                      </td>
                                      <td className="p-2 font-semibold text-orange-700">
                                        {match.matchedInjury || match.matched_injury || 'N/A'}
                                      </td>
                                      <td className="p-2 font-mono font-semibold text-orange-700">
                                        {((match.similarity || 0) * 100).toFixed(1)}%
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* No Matches Message */}
                        {(!result.output?.matches?.strong?.length && 
                          !result.output?.matches?.medium?.length && 
                          !result.output?.matches?.weak?.length) && (
                          <div className="p-3 bg-gray-50 border border-gray-200 rounded text-gray-500 text-sm">
                            No semantic matches found above the minimum threshold.
                          </div>
                        )}
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

                    {result.blockType === 'llm_evaluation' && result.output?.finalInjuries && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1">
                          Final Injuries (LLM Evaluated): {result.output.finalInjuries.length}
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

                    {result.blockType === 'double_layer_llm' && result.output && (
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">
                            Final Injuries (Combined via Jaccard): {result.output.finalInjuries?.length || 0}
                          </div>
                          <div className="text-sm bg-white p-2 rounded border border-gray-200">
                            {result.output.finalInjuries && result.output.finalInjuries.length > 0 ? (
                              <pre className="text-xs">{JSON.stringify(result.output.finalInjuries, null, 2)}</pre>
                            ) : (
                              <span className="text-gray-500">No injuries found</span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 bg-blue-50 rounded border border-blue-200">
                            <div className="font-semibold text-blue-900">Jaccard Similarity</div>
                            <div className="text-lg font-bold text-blue-700">
                              {result.output.jaccardSimilarity !== undefined 
                                ? (result.output.jaccardSimilarity * 100).toFixed(1) + '%'
                                : 'N/A'}
                            </div>
                            <div className="text-xs text-blue-600 mt-1">
                              Agreement between both LLMs
                            </div>
                          </div>
                          <div className="p-2 bg-green-50 rounded border border-green-200">
                            <div className="font-semibold text-green-900">Agreement (Intersection)</div>
                            <div className="text-lg font-bold text-green-700">
                              {result.output.intersection?.length || 0} injuries
                            </div>
                            <div className="text-xs text-green-600 mt-1">
                              Both LLMs agreed on these
                            </div>
                            {result.output.intersection && result.output.intersection.length > 0 && (
                              <div className="mt-1 text-xs text-green-600">
                                {result.output.intersection.join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 bg-gray-50 rounded border border-gray-200">
                            <div className="font-semibold text-gray-900">LLM 1 Injuries</div>
                            <div className="text-sm text-gray-700">{result.output.llm1Injuries?.length || 0}</div>
                            {result.output.llm1Injuries && result.output.llm1Injuries.length > 0 && (
                              <div className="mt-1 text-xs text-gray-500">
                                {result.output.llm1Injuries.map((inj: any) => inj.matched_injury).join(', ')}
                              </div>
                            )}
                          </div>
                          <div className="p-2 bg-gray-50 rounded border border-gray-200">
                            <div className="font-semibold text-gray-900">LLM 2 Injuries</div>
                            <div className="text-sm text-gray-700">{result.output.llm2Injuries?.length || 0}</div>
                            {result.output.llm2Injuries && result.output.llm2Injuries.length > 0 && (
                              <div className="mt-1 text-xs text-gray-500">
                                {result.output.llm2Injuries.map((inj: any) => inj.matched_injury).join(', ')}
                              </div>
                            )}
                          </div>
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
