'use client';

import { useState } from 'react';
import { ALL_MODELS } from '@/lib/constants';

interface PipelineStep {
  id: string;
  type: 'semantic' | 'llm';
  modelId?: string;
  order: number;
}

interface StepResult {
  step: string;
  type: 'semantic' | 'llm';
  inputTokens: number;
  outputTokens: number;
  cost: number;
  processedText: string;
  error?: string;
}

interface CostEstimate {
  steps: StepResult[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

const MODEL_PRICING: Record<string, { input: number; output: number; name: string }> = {
  'claude-opus-4-5-20251101': { input: 5.0, output: 25.0, name: 'Claude Opus 4.5' },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0, name: 'Claude Sonnet 4.5' },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, name: 'Claude Haiku 4.5' },
  'claude-3-haiku-20240307': { input: 0.8, output: 4.0, name: 'Claude 3 Haiku' },
  'gpt-4o': { input: 2.5, output: 10.0, name: 'GPT-4o' },
  'gpt-4-turbo': { input: 10.0, output: 30.0, name: 'GPT-4 Turbo' },
  'gpt-4o-mini': { input: 0.15, output: 0.6, name: 'GPT-4o Mini' },
  'gpt-3.5-turbo': { input: 1.5, output: 3.0, name: 'GPT-3.5 Turbo' },
  'gemini-1.5-pro-latest': { input: 2.0, output: 12.0, name: 'Gemini 1.5 Pro' },
  'gemini-1.5-flash-latest': { input: 0.1, output: 0.4, name: 'Gemini 1.5 Flash' },
};

const EXAMPLE_NOTE = `Effective Date: 11/24/2025 12:15Type: RNAO - Post Fall Assessment Section B Post Fall Assessment : Fall was witnessed. Date and time the Resident fell or was found: 11/24/2025 12:15 PMDate and time of notification: 11/24/2025Name of SDM/POA contacted. Vicky and Brian TiltWitness report: Resident was standing in elevator with Lindsay PSW and start telling that she feeling dizzy and Lindsy said by the time while she was trying to help Linda she fell and hit her head on elevator wallResident's description of the fall: Feeling DizzyResident does not have any fall-related injury/injuries or verbal/non-verbal indicators of pain. Resident shows signs of new pain after fall. Resident hit their head. Resident is drowsy.`;

export default function CostCalculatorTab() {
  const [inputText, setInputText] = useState(EXAMPLE_NOTE);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [incidentsPerDay, setIncidentsPerDay] = useState(100);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<Array<{
    name: string;
    steps: PipelineStep[];
    estimate: CostEstimate;
  }>>([]);
  const [scenarioName, setScenarioName] = useState('');

  const handleEstimateCost = async () => {
    if (!inputText.trim()) {
      setError('Please enter input text');
      return;
    }

    if (pipelineSteps.length === 0) {
      setError('Please add at least one step to the pipeline');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/cost/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputText,
          steps: pipelineSteps.map(s => ({
            type: s.type,
            modelId: s.modelId,
          })),
          systemPrompt: 'Extract injuries from medical notes.',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to estimate cost');
      }

      const data = await response.json();
      setCostEstimate(data);
    } catch (err: any) {
      setError(err.message || 'Failed to estimate cost');
    } finally {
      setLoading(false);
    }
  };

  const addStep = (type: 'semantic' | 'llm', modelId?: string) => {
    const newStep: PipelineStep = {
      id: `${type}-${Date.now()}`,
      type,
      modelId,
      order: pipelineSteps.length,
    };
    setPipelineSteps([...pipelineSteps, newStep]);
  };

  const removeStep = (id: string) => {
    setPipelineSteps(pipelineSteps.filter(s => s.id !== id).map((s, idx) => ({ ...s, order: idx })));
  };

  const moveStep = (id: string, direction: 'up' | 'down') => {
    const index = pipelineSteps.findIndex(s => s.id === id);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= pipelineSteps.length) return;

    const newSteps = [...pipelineSteps];
    [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
    newSteps.forEach((s, idx) => { s.order = idx; });
    setPipelineSteps(newSteps);
  };

  const saveScenario = () => {
    if (!scenarioName.trim() || !costEstimate) {
      setError('Please enter a scenario name and run cost estimation first');
      return;
    }

    const newScenario = {
      name: scenarioName,
      steps: [...pipelineSteps],
      estimate: costEstimate,
    };

    setSavedScenarios([...savedScenarios, newScenario]);
    setScenarioName('');
  };

  const loadScenario = (scenario: typeof savedScenarios[0]) => {
    setPipelineSteps([...scenario.steps]);
    setCostEstimate(scenario.estimate);
    setScenarioName(scenario.name);
  };

  const calculateYearlyCost = (costPerNote: number) => {
    return costPerNote * incidentsPerDay * 365;
  };

  return (
    <div className="space-y-6 text-black">
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-4">Pipeline Cost Calculator</h2>
        <p className="mb-6 text-gray-700">
          Build and compare different pipeline configurations. Drag and drop blocks to create your pipeline,
          then estimate costs based on actual token usage.
        </p>

        {/* Saved Scenarios */}
        {savedScenarios.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
            <h3 className="font-semibold mb-2">Saved Scenarios</h3>
            <div className="flex flex-wrap gap-2">
              {savedScenarios.map((scenario, idx) => (
                <button
                  key={idx}
                  onClick={() => loadScenario(scenario)}
                  className="px-3 py-1 bg-blue-100 text-blue-800 rounded text-sm hover:bg-blue-200"
                >
                  {scenario.name} (${scenario.estimate.totals.cost.toFixed(4)}/note)
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Input Text */}
          <div>
            <label className="block text-sm font-medium mb-2">Input Text (Example Note)</label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste note content here..."
              className="w-full p-3 border border-gray-300 rounded-md h-32 font-mono text-sm"
            />
          </div>

          {/* Available Blocks */}
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">Available Blocks (Click to Add)</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => addStep('semantic')}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                + Semantic Validation (Free)
              </button>
              {ALL_MODELS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => addStep('llm', model.id)}
                  className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                >
                  + {model.displayName}
                </button>
              ))}
            </div>
          </div>

          {/* Pipeline Steps */}
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">Pipeline Steps (Drag to reorder)</h3>
            {pipelineSteps.length === 0 ? (
              <div className="p-4 border-2 border-dashed border-gray-300 rounded text-center text-gray-500">
                No steps added. Click blocks above to add steps to your pipeline.
              </div>
            ) : (
              <div className="space-y-2">
                {pipelineSteps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 p-3 border rounded-lg bg-gray-50"
                  >
                    <span className="text-sm font-semibold text-gray-500 w-8">{idx + 1}.</span>
                    <div className="flex-1">
                      {step.type === 'semantic' ? (
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded text-sm font-semibold">
                          Semantic Validation (Free)
                        </span>
                      ) : (
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded text-sm font-semibold">
                          {ALL_MODELS.find(m => m.id === step.modelId)?.displayName || step.modelId}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => moveStep(step.id, 'up')}
                        disabled={idx === 0}
                        className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveStep(step.id, 'down')}
                        disabled={idx === pipelineSteps.length - 1}
                        className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeStep(step.id)}
                        className="px-2 py-1 text-xs bg-red-200 text-red-800 rounded hover:bg-red-300"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Incidents Per Day */}
          <div className="border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Incidents per Day</label>
                <input
                  type="number"
                  min="1"
                  value={incidentsPerDay}
                  onChange={(e) => setIncidentsPerDay(parseInt(e.target.value) || 0)}
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Save Scenario As</label>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="e.g., Semantic + Haiku"
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleEstimateCost}
              disabled={loading || pipelineSteps.length === 0}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Calculating...' : 'Estimate Cost'}
            </button>
            {costEstimate && (
              <button
                onClick={saveScenario}
                disabled={!scenarioName.trim()}
                className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                Save Scenario
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </div>

      {/* Cost Results */}
      {costEstimate && (
        <div className="space-y-4">
          {/* Step-by-Step Breakdown */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Step-by-Step Cost Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-2">Step</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Input Tokens</th>
                    <th className="text-right p-2">Output Tokens</th>
                    <th className="text-right p-2">Cost per Note</th>
                  </tr>
                </thead>
                <tbody>
                  {costEstimate.steps.map((step, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="p-2">{step.step}</td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          step.type === 'semantic' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {step.type === 'semantic' ? 'Free' : 'LLM'}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono">{step.inputTokens.toLocaleString()}</td>
                      <td className="p-2 text-right font-mono">{step.outputTokens.toLocaleString()}</td>
                      <td className="p-2 text-right font-mono font-semibold">
                        ${step.cost.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-gray-50 font-semibold">
                    <td colSpan={2} className="p-2">Total</td>
                    <td className="p-2 text-right font-mono">
                      {costEstimate.totals.inputTokens.toLocaleString()}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {costEstimate.totals.outputTokens.toLocaleString()}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-lg">
                      ${costEstimate.totals.cost.toFixed(4)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Yearly Projection */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-bold mb-4">Annual Cost Projection</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-sm text-gray-600 mb-1">Cost per Note</div>
                <div className="text-2xl font-bold text-blue-900">
                  ${costEstimate.totals.cost.toFixed(4)}
                </div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="text-sm text-gray-600 mb-1">Daily Cost</div>
                <div className="text-2xl font-bold text-green-900">
                  ${(costEstimate.totals.cost * incidentsPerDay).toFixed(2)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {incidentsPerDay} incidents × ${costEstimate.totals.cost.toFixed(4)}
                </div>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-sm text-gray-600 mb-1">Yearly Cost</div>
                <div className="text-2xl font-bold text-purple-900">
                  ${calculateYearlyCost(costEstimate.totals.cost).toFixed(2)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {incidentsPerDay} incidents/day × 365 days
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Table (if multiple scenarios) */}
          {savedScenarios.length > 0 && (
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-bold mb-4">Scenario Comparison</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-2">Scenario</th>
                      <th className="text-right p-2">Cost/Note</th>
                      <th className="text-right p-2">Daily Cost</th>
                      <th className="text-right p-2">Yearly Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedScenarios.map((scenario, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">{scenario.name}</td>
                        <td className="p-2 text-right font-mono">
                          ${scenario.estimate.totals.cost.toFixed(4)}
                        </td>
                        <td className="p-2 text-right font-mono">
                          ${(scenario.estimate.totals.cost * incidentsPerDay).toFixed(2)}
                        </td>
                        <td className="p-2 text-right font-mono font-semibold">
                          ${calculateYearlyCost(scenario.estimate.totals.cost).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-gray-50 font-semibold">
                      <td className="p-2">Current Pipeline</td>
                      <td className="p-2 text-right font-mono">
                        ${costEstimate.totals.cost.toFixed(4)}
                      </td>
                      <td className="p-2 text-right font-mono">
                        ${(costEstimate.totals.cost * incidentsPerDay).toFixed(2)}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">
                        ${calculateYearlyCost(costEstimate.totals.cost).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
