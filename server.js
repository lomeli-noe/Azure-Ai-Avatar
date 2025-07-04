const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const promptFilePath = path.join(__dirname, 'prompt.txt');

// Read the system prompt from the text file
let systemPrompt = '';
function loadPrompt() {
    try {
        systemPrompt = fs.readFileSync(promptFilePath, 'utf-8');
        console.log('System prompt loaded successfully.');
    } catch (error) {
        console.error('Could not read prompt.txt:', error);
    }
}

// Initial load
loadPrompt();

// Watch for changes in the prompt file
fs.watchFile(promptFilePath, (curr, prev) => {
    console.log('prompt.txt file changed. Reloading...');
    loadPrompt();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

// Endpoint to get the configuration
app.get('/api/config', (req, res) => {
    const searchIndexes = {};
    // More robustly find all cognitive search index names from .env
    for (const key in process.env) {
        if (key.startsWith('AZURE_COGNITIVE_SEARCH_INDEX_')) {
            // A simpler, more direct way to create a friendly name
            const friendlyName = key.replace('AZURE_COGNITIVE_SEARCH_INDEX_', '').replace(/_/g, ' ');
            searchIndexes[friendlyName] = process.env[key];
        }
    }

    console.log("Found search indexes:", searchIndexes); // Added for server-side debugging

    res.json({
        azureSpeechKey: process.env.AZURE_SPEECH_KEY,
        azureSpeechRegion: process.env.AZURE_SPEECH_REGION,
        azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
        azureOpenAIKey: process.env.AZURE_OPENAI_KEY,
        azureOpenAIDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
        systemPrompt: systemPrompt,
        azureCogSearchEndpoint: process.env.AZURE_COGNITIVE_SEARCH_ENDPOINT,
        azureCogSearchKey: process.env.AZURE_COGNITIVE_SEARCH_KEY,
        cognitiveSearchIndices: searchIndexes, // Send all found indexes
        sttLocales: process.env.STT_LOCALES,
        ttsVoice: process.env.TTS_VOICE,
        avatarCharacter: process.env.AVATAR_CHARACTER,
        avatarStyle: process.env.AVATAR_STYLE,
        avatarBackgroundColor: process.env.AVATAR_BACKGROUND_COLOR,
        avatarTransparentBackground: process.env.AVATAR_TRANSPARENT_BACKGROUND,
        userAvatarImagePath: process.env.USER_AVATAR_IMAGE_PATH
    });
});

// Endpoint to handle GPT-4 chat requests
app.post('/api/gpt', async (req, res) => {
    try {
        const requestData = req.body;

        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

        // MODIFIED: Removed '/extensions' from the path as it may not be required
        // for all Azure OpenAI configurations and could be the source of the 404 error.
        const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

        // Add detailed logging to debug the 404 error
        console.log('Forwarding request to Azure OpenAI at URL:', url);
        console.log('Request body:', JSON.stringify(requestData, null, 2));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': process.env.AZURE_OPENAI_KEY,
            },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Azure OpenAI API error:', errorBody);
            throw new Error(`Azure OpenAI API responded with ${response.status}: ${errorBody}`);
        }

        const responseData = await response.json();
        res.json(responseData);

    } catch (error) {
        console.error('Error processing GPT request:', error);
        res.status(500).send('Error processing GPT request');
    }
});

// Endpoint to save the system prompt
app.post('/api/prompt', (req, res) => {
  const newPrompt = req.body.prompt;
  if (newPrompt) {
    fs.writeFile(promptFilePath, newPrompt, 'utf-8', (err) => {
      if (err) {
        console.error('Error writing to prompt.txt:', err);
        return res.status(500).send('Error saving prompt.');
      }
      console.log('Prompt updated successfully.');
      res.send('Prompt saved successfully.');
    });
  } else {
    res.status(400).send('Prompt content is missing.');
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
