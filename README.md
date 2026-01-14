# Claude Model Comparison Tool

A Next.js application for comparing outputs from different Claude models on medical notes analysis.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Add your Anthropic API key:**
   - Create a `.env.local` file in the root directory
   - Add the following line:
     ```
     ANTHROPIC_API_KEY=your_actual_api_key_here
     ```
   - Replace `your_actual_api_key_here` with your actual Anthropic API key
   - **Important**: The `.env.local` file is gitignored and won't be committed to version control

3. **Extract data from the HTML file:**
   ```bash
   npm run extract-data
   ```
   This will extract all notes from `viewer-standalone (2).html` and create `public/notes-data.json`.

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:**
   Navigate to `http://localhost:3000`

## Features

- **Resident Toggle View**: Each resident has a toggle to expand/collapse their notes
- **Model Comparison Table**: Compare outputs from all Claude models side-by-side
- **Ground Truth Evaluation**: Displays AI evaluation of the original response (accuracy, issues, confidence, feedback)
- **Search Functionality**: Search residents by name
- **Original Response Display**: Shows the original Claude 3 Haiku response for reference
- **Individual Note Testing**: Test all models for each note independently
- **Visual Indicators**: Highlights which models match the ground truth evaluation

## Models Tested

- claude-3-haiku (original)
- claude-sonnet-4-5-20250929
- claude-haiku-4-5-20251001
- claude-opus-4-5-20251101
- claude-opus-4-1-20250805
- claude-sonnet-4-20250514
- claude-3-7-sonnet-20250219
- claude-opus-4-20250514

## Usage

1. Use the search bar to find a specific resident
2. Click on a resident name to expand and see their notes
3. For each note, click "Test All Models" to compare outputs
4. View the comparison table showing all model responses side-by-side
5. Responses are formatted as JSON arrays of detected injuries

## API Settings

- Temperature: 0.1
- Max Tokens: 500
- System prompt: Medical data analyst focused on extracting physical injuries from fall incidents
- User prompt: Contains the note content with "INSERT NOTE HERE" replaced
