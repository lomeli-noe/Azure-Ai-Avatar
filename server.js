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

// Log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Serve the new entry page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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

// Endpoint to get a specific prompt
app.get('/api/prompt/:promptName', (req, res) => {
    const promptName = req.params.promptName;
    const promptFilePath = path.join(__dirname, 'prompts', `${promptName}.txt`);
    fs.readFile(promptFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error(`Error reading ${promptFilePath}:`, err);
            return res.status(500).send('Error loading prompt.');
        }
        res.json({ prompt: data });
    });
});

// Endpoint to save a specific prompt
app.post('/api/prompt/:promptName', (req, res) => {
    const promptName = req.params.promptName;
    const newPrompt = req.body.prompt;
    const promptFilePath = path.join(__dirname, 'prompts', `${promptName}.txt`);

    if (newPrompt) {
        fs.writeFile(promptFilePath, newPrompt, 'utf-8', (err) => {
            if (err) {
                console.error(`Error writing to ${promptFilePath}:`, err);
                return res.status(500).send('Error saving prompt.');
            }
            console.log(`Prompt ${promptName} updated successfully.`);
            res.send('Prompt saved successfully.');
        });
    } else {
        res.status(400).send('Prompt content is missing.');
    }
});

// Endpoint to save the system prompt (legacy support)
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

// Test endpoint to verify server is running
app.get('/api/test', (req, res) => {
    console.log('Test endpoint called');
    res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

// Endpoint to handle GPT-4 chat requests
app.post('/api/gpt', async (req, res) => {
    console.log('=== GPT ENDPOINT CALLED ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Process ID:', process.pid);
    console.log('Server port:', port);
    
    try {
        const requestData = req.body;
        console.log('Request keys:', Object.keys(requestData));
        console.log('Has data_sources:', !!requestData.data_sources);
        if (requestData.data_sources) {
            console.log('Data sources count:', requestData.data_sources.length);
            console.log('First data source type:', requestData.data_sources[0]?.type);
            console.log('Search index:', requestData.data_sources[0]?.parameters?.index_name);
        }
        console.log('Messages count:', requestData.messages?.length);
        console.log('Last user message:', requestData.messages?.slice(-1)[0]?.content);
        
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
        const apiKey = process.env.AZURE_OPENAI_KEY;

        // Validate required environment variables
        if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT is not configured');
        }
        if (!deploymentName) {
            throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME is not configured');
        }
        if (!apiVersion) {
            throw new Error('AZURE_OPENAI_API_VERSION is not configured');
        }
        if (!apiKey) {
            throw new Error('AZURE_OPENAI_KEY is not configured');
        }

        // Check if the request includes data_sources (RAG/On Your Data)
        const hasDataSources = requestData.data_sources && requestData.data_sources.length > 0;
        
        // Try different API versions and endpoints for RAG
        let url, ragApproach;
        if (hasDataSources) {
            // Try the newer API version first
            ragApproach = 'chat_completions_with_data';
            url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;
        } else {
            ragApproach = 'standard';
            url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
        }

        console.log('Using URL:', url);
        console.log('RAG request:', hasDataSources);
        console.log('RAG approach:', ragApproach);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey,
            },
            body: JSON.stringify(requestData),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            
            // If we get a 404 and we're using RAG, try with a different API version
            if (response.status === 404 && hasDataSources) {
                console.log('Current API version not working, trying with 2023-12-01-preview');
                
                const fallbackUrl = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2023-12-01-preview`;
                
                const fallbackResponse = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': apiKey,
                    },
                    body: JSON.stringify(requestData),
                });
                
                if (!fallbackResponse.ok) {
                    const fallbackErrorBody = await fallbackResponse.text();
                    console.log('Fallback API version also failed, trying without RAG');
                    
                    // Remove data_sources and try regular endpoint
                    const noRagRequestData = { ...requestData };
                    delete noRagRequestData.data_sources;
                    
                    const noRagUrl = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
                    
                    const noRagResponse = await fetch(noRagUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'api-key': apiKey,
                        },
                        body: JSON.stringify(noRagRequestData),
                    });
                    
                    if (!noRagResponse.ok) {
                        const noRagErrorBody = await noRagResponse.text();
                        console.error('All endpoints failed:', noRagErrorBody);
                        throw new Error(`Azure OpenAI API error: ${noRagResponse.status}: ${noRagErrorBody}`);
                    }
                    
                    const noRagResponseData = await noRagResponse.json();
                    console.log('WARNING: Using response without RAG due to API limitations');
                    res.json(noRagResponseData);
                    return;
                }
                
                const fallbackResponseData = await fallbackResponse.json();
                console.log('Successfully used fallback API version with RAG');
                res.json(fallbackResponseData);
                return;
            }
            
            console.error('Azure OpenAI API error:', errorBody);
            throw new Error(`Azure OpenAI API responded with ${response.status}: ${errorBody}`);
        }

        const responseData = await response.json();
        console.log('Azure OpenAI response received, choices count:', responseData.choices?.length);
        console.log('Response content preview:', responseData.choices?.[0]?.message?.content?.substring(0, 100) + '...');
        
        // Log RAG context if available
        if (responseData.choices?.[0]?.message?.context) {
            console.log('RAG context found:', JSON.stringify(responseData.choices[0].message.context, null, 2));
        }
        
        // Log citations if available
        if (responseData.choices?.[0]?.message?.context?.citations) {
            console.log('Citations found:', responseData.choices[0].message.context.citations.length);
            responseData.choices[0].message.context.citations.forEach((citation, index) => {
                console.log(`Citation ${index + 1}:`, {
                    title: citation.title,
                    filepath: citation.filepath,
                    content_preview: citation.content?.substring(0, 200) + '...'
                });
            });
        }
        
        res.json(responseData);

    } catch (error) {
        console.error('Error processing GPT request:', error.message);
        
        // Always send a proper JSON response
        const errorResponse = {
            error: 'Error processing GPT request',
            message: error.message || 'Unknown error',
            details: error.toString()
        };
        
        // Set proper headers and send JSON response
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json(errorResponse);
    }
});

// Endpoint to get the Four Gifts summary
app.get('/api/four-gifts-summary', (req, res) => {
    const summaryFilePath = path.join(__dirname, 'prompts', 'four_gifts_summary.txt');
    fs.readFile(summaryFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error(`Error reading ${summaryFilePath}:`, err);
            return res.status(500).send('Error loading Four Gifts summary.');
        }
        res.json({ summary: data });
    });
});

// Endpoint to get the Super Intelligence summary
app.get('/api/superintelligence-summary', (req, res) => {
    const summaryFilePath = path.join(__dirname, 'prompts', 'superintelligence_summary.txt');
    fs.readFile(summaryFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error(`Error reading ${summaryFilePath}:`, err);
            return res.status(500).send('Error loading Super Intelligence summary.');
        }
        res.json({ summary: data });
    });
});

app.listen(port, () => {
  const startupId = Math.random().toString(36).substring(7);
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Server startup ID: ${startupId}`);
  console.log(`Process ID: ${process.pid}`);
  console.log(`Current time: ${new Date().toISOString()}`);
});
