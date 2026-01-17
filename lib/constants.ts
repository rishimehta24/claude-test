export type ModelProvider = 'anthropic' | 'openai' | 'google';

export interface ModelInfo {
  id: string;
  provider: ModelProvider;
  displayName: string;
}

export const ALL_MODELS: ModelInfo[] = [
  // Anthropic Claude Models
  // Powerful models (most capable)
  { id: 'claude-opus-4-5-20251101', provider: 'anthropic', displayName: 'Claude Opus 4.5' },
  // Fast models (quickest)
  { id: 'claude-3-haiku-20240307', provider: 'anthropic', displayName: 'Claude 3 Haiku (20240307)' },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', displayName: 'Claude Haiku 4.5' },
  // Middle (balanced) - keep one
  { id: 'claude-sonnet-4-5-20250929', provider: 'anthropic', displayName: 'Claude Sonnet 4.5' },
  
  // OpenAI GPT Models
  // Powerful models (most capable)
  { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
  { id: 'gpt-4-turbo', provider: 'openai', displayName: 'GPT-4 Turbo' },
  // Fast models (quickest)
  { id: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o Mini' },
  { id: 'gpt-3.5-turbo', provider: 'openai', displayName: 'GPT-3.5 Turbo' },
  
  // Google Gemini Models
  // Powerful model (most capable)
  { id: 'gemini-3-pro-preview', provider: 'google', displayName: 'Gemini 3 Pro Preview' },
  // Fast model (quickest)
  { id: 'gemini-2.5-flash-lite', provider: 'google', displayName: 'Gemini 2.5 Flash Lite' },
];

// Legacy export for backwards compatibility
export const CLAUDE_MODELS = ALL_MODELS
  .filter(m => m.provider === 'anthropic')
  .map(m => m.id) as readonly string[];

export const SYSTEM_PROMPT = `You are an extremely precise medical data analyst. Your entire purpose is to execute one task perfectly.
PRIMARY DIRECTIVE: You must extract ONLY the new, physical injuries that are a direct result of a fall, as described in the 'Note'. The injury MUST be present on the patient.
Allowed_Injuries:
      'abrasion',
      'bleeding',
      'broken skin',
      'bruising',
      'bruise',
      'burn',
      'cut',
      'contusion',
      'dislocation',
      'fracture',
      'frostbite',
      'hematoma',
      'hypoglycemia',
      'incision',
      'laceration',
      'pain',
      'redness',
      'scratches',
      'skin tear',
      'scrape',
      'sprain',
      'strain',
      'swelling',
      'unconscious',
      'contusion',
CRITICAL RULES:
ADHERE TO THE PRIMARY DIRECTIVE: Only extract phrases describing a physical injury that is currently present.
DIRECT MATCH REQUIRED: The phrase must directly map to an injury in the Allowed_Injuries list. Do not infer or guess. A phrase like "shaking" has no match and MUST be ignored.
STRICTLY IGNORE THE FOLLOWING:
General Symptoms & Vitals: Do not extract medical observations, symptoms, or vitals. Examples to ignore: "febrile," "T-37.8," "dizzy," "shaking," "confused," "uncooperative."
Negations & Positive Assessments of Health: Do not extract any phrase that denies an injury OR confirms a healthy state. This is critical.
Direct Negations: "no bruising," "denies pain."
Positive Assessments (Indirect Negations): "Remains alert and responsive," "gait is steady," "skin is intact." These phrases confirm the ABSENCE of an injury and must be ignored.
Patient History & The Fall Event: Ignore historical diagnoses and the mention of the "fall" itself.
OUTPUT FORMAT:
Your output MUST be a valid JSON array of objects.
Each object has two keys: "phrase" (the exact text) and "matched_injury" (the term from Allowed_Injuries).
If zero valid injuries are found, you MUST return an empty array [].
Do NOT include any text outside of the JSON array.
EXAMPLES:
Example 1 (Multiple Injuries):
Note: "New 3cm skin tear on right forearm, with minor bleeding. Area is red and swollen. Resident denies other pain."
Your JSON Output:
[
{ "phrase": "New 3cm skin tear on right forearm", "matched_injury": "skin tear" },
{ "phrase": "minor bleeding", "matched_injury": "bleeding" },
{ "phrase": "Area is red", "matched_injury": "redness" },
{ "phrase": "swollen", "matched_injury": "swelling" }
]
Example 2 (No Injuries Found):
Note: "Unwitnessed fall. Assessed from head to toe, no cuts or bruises observed. Resident states they feel fine."
Your JSON Output:
[]
Example 3 (Ignoring General Symptoms):
Note: "Resident noted holding his shaking right hand, febrile T-37.8, denied complain of any discomfort."
Your JSON Output:
[]
Example 4 (Ignoring Positive Assessments):
Note: "Post fall yesterday. Vitals stable. Response: Remains alert and responsive. No new injuries identified."
Your JSON Output:
[]
TASK TO COMPLETE:
RETURN ONLY JSON, NO PREAMBLE OR EXPLANATIONS`;

export const USER_PROMPT_TEMPLATE = (noteContent: string) => `Note: 
${noteContent}

Your JSON Output:`;

export const API_SETTINGS = {
  temperature: 0.1,
  maxTokens: 500,
};
