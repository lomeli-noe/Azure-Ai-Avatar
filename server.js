const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

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

app.get('/api/config', (req, res) => {
  console.log('Sending config:', {
    azureSpeechRegion: process.env.AZURE_SPEECH_REGION,
    azureSpeechKey: process.env.AZURE_SPEECH_KEY,
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenAIKey: process.env.AZURE_OPENAI_KEY,
    azureOpenAIDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION, // Check this value in server console
    systemPrompt: systemPrompt,
    azureCogSearchEndpoint: process.env.AZURE_COGNITIVE_SEARCH_ENDPOINT,
    azureCogSearchKey: process.env.AZURE_COGNITIVE_SEARCH_KEY,
    azureCogSearchIndexName: process.env.AZURE_COGNITIVE_SEARCH_INDEX_NAME,
    sttLocales: process.env.STT_LOCALES,
    ttsVoice: process.env.TTS_VOICE,
    avatarCharacter: process.env.AVATAR_CHARACTER,
    avatarStyle: process.env.AVATAR_STYLE,
    avatarBackgroundColor: process.env.AVATAR_BACKGROUND_COLOR,
    avatarTransparentBackground: process.env.AVATAR_TRANSPARENT_BACKGROUND
  });

  res.json({
    azureSpeechRegion: process.env.AZURE_SPEECH_REGION,
    azureSpeechKey: process.env.AZURE_SPEECH_KEY,
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenAIKey: process.env.AZURE_OPENAI_KEY,
    azureOpenAIDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
    systemPrompt: systemPrompt,
    azureCogSearchEndpoint: process.env.AZURE_COGNITIVE_SEARCH_ENDPOINT,
    azureCogSearchKey: process.env.AZURE_COGNITIVE_SEARCH_KEY,
    azureCogSearchIndexName: process.env.AZURE_COGNITIVE_SEARCH_INDEX_NAME,
    sttLocales: process.env.STT_LOCALES,
    ttsVoice: process.env.TTS_VOICE,
    avatarCharacter: process.env.AVATAR_CHARACTER,
    avatarStyle: process.env.AVATAR_STYLE,
    avatarBackgroundColor: process.env.AVATAR_BACKGROUND_COLOR,
    avatarTransparentBackground: process.env.AVATAR_TRANSPARENT_BACKGROUND
  });
});

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
