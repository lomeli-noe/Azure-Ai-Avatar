// Global objects
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
var dataSources = [];
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；'];
var isSpeaking = false;
var sessionActive = false;
var config = {};
var previousAnimationFrameTimestamp = 0;

// =================== UI CONTROL FUNCTIONS ===================

// Called when the page is loaded
window.onload = async function() {
    try {
        const response = await fetch('/api/config');
        config = await response.json();
        console.log("Configuration loaded:", config);
    } catch (error) {
        console.error('Failed to load configuration:', error);
        alert('Failed to load configuration. Please check the server and .env file.');
    }
};

// Called when "Open Avatar Session" is clicked
window.startSession = function() {
    document.getElementById('openSessionButton').disabled = true;
    connectAvatar();
};

// Called when "Close Avatar Session" is clicked
window.stopSession = function() {
    disconnectAvatar();
    document.getElementById('openSessionButton').disabled = false;
    document.getElementById('chatContainer').hidden = true;
    document.getElementById('videoContainer').hidden = true;
    document.getElementById('microphone').disabled = true;
    document.getElementById('stopSession').disabled = true;
    document.getElementById('stopSpeaking').disabled = true;
    sessionActive = false;
};

// Called when "Clear Chat History" is clicked
window.clearChatHistory = function() {
    const chatHistory = document.getElementById('chat-history');
    chatHistory.innerHTML = '';
    messages = [];
    const systemPrompt = config.systemPrompt;
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
};

// Called when "Reload Prompt" is clicked
window.reloadPrompt = async function() {
    console.log("Reloading prompt...");
    try {
        const response = await fetch('/api/config');
        const newConfig = await response.json();
        config.systemPrompt = newConfig.systemPrompt;
        console.log("New prompt loaded:", config.systemPrompt);
        
        // Clear chat history and apply the new system prompt
        clearChatHistory();
        alert("Prompt reloaded successfully. The chat history has been cleared.");

    } catch (error) {
        console.error('Failed to reload configuration:', error);
        alert('Failed to reload the prompt. Please check the server.');
    }
};

// Called when "Edit Prompt" is clicked
window.openPromptModal = function() {
    const modal = document.getElementById('promptModal');
    const textarea = document.getElementById('promptTextarea');
    textarea.value = config.systemPrompt;
    modal.style.display = "block";
};

// Called to close the prompt modal
window.closePromptModal = function() {
    const modal = document.getElementById('promptModal');
    modal.style.display = "none";
};

// Called to save the prompt from the modal
window.savePrompt = async function() {
    const textarea = document.getElementById('promptTextarea');
    const newPrompt = textarea.value;

    try {
        const response = await fetch('/api/prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: newPrompt }),
        });

        if (response.ok) {
            console.log("Prompt saved successfully.");
            closePromptModal();
            await reloadPrompt(); // Reload to apply the new prompt
            alert("Prompt saved and reloaded successfully.");
        } else {
            const errorText = await response.text();
            console.error('Failed to save prompt:', errorText);
            alert(`Failed to save prompt: ${errorText}`);
        }
    } catch (error) {
        console.error('Error saving prompt:', error);
        alert('An error occurred while saving the prompt.');
    }
};

// Called when the "Type Message" checkbox is changed
window.updateTypeMessageBox = function() {
    const show = document.getElementById('showTypeMessage').checked;
    document.getElementById('userMessageBox').hidden = !show;
    document.getElementById('uploadImgIcon').hidden = !show;
};

// Called when the microphone button is clicked
window.microphone = function() {
    const micButton = document.getElementById('microphone');
    if (micButton.textContent === 'Start Microphone') {
        startMicrophone();
        micButton.textContent = 'Stop Microphone';
    } else {
        stopMicrophone();
        micButton.textContent = 'Start Microphone';
    }
};

// Called when "Stop Speaking" is clicked
window.stopSpeaking = function() {
    if (isSpeaking && avatarSynthesizer) {
        console.log("Stopping avatar speech.");
        avatarSynthesizer.stopSpeakingAsync(
            () => {
                isSpeaking = false;
                document.getElementById('stopSpeaking').disabled = true;
                console.log("Avatar speech stopped.");
            },
            err => {
                console.error("Failed to stop avatar speech: ", err);
            }
        );
    }
};

// =================== MAKE BACKGROUND TRANSPARENT ===================
function makeBackgroundTransparent(timestamp) {
    if (!sessionActive) return; // Stop rendering if session is closed

    // Throttle the frame rate to 30 FPS to reduce CPU usage
    if (timestamp - previousAnimationFrameTimestamp > 30) {
        const video = document.getElementById('videoPlayer');
        if (!video || video.paused || video.ended) {
            window.requestAnimationFrame(makeBackgroundTransparent);
            return;
        }

        const tmpCanvas = document.getElementById('tmpCanvas');
        const tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true });
        tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        if (video.videoWidth > 0) {
            let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight);
            for (let i = 0; i < frame.data.length / 4; i++) {
                let r = frame.data[i * 4 + 0];
                let g = frame.data[i * 4 + 1];
                let b = frame.data[i * 4 + 2];
                if (g > r && g > b && g - r > 50 && g - b > 50) { // More robust green detection
                    frame.data[i * 4 + 3] = 0; // Set alpha to 0
                }
            }
            const canvas = document.getElementById('canvas');
            const canvasContext = canvas.getContext('2d');
            canvasContext.putImageData(frame, 0, 0);
        }
        previousAnimationFrameTimestamp = timestamp;
    }
    window.requestAnimationFrame(makeBackgroundTransparent);
}

// =================== CONNECT AVATAR SERVICE ===================
function connectAvatar() {
    const cogSvcRegion = config.azureSpeechRegion;
    const cogSvcSubKey = config.azureSpeechKey;

    let speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    speechSynthesisConfig.speechSynthesisVoiceName = config.ttsVoice;

    const avatarConfig = new SpeechSDK.AvatarConfig(config.avatarCharacter, config.avatarStyle);
    avatarConfig.backgroundColor = config.avatarBackgroundColor;

    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);

    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
    const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(config.sttLocales.split(','));
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechRecognitionConfig,
        autoDetectSourceLanguageConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    // Initialize messages with system prompt
    messages = [];
    if (config.systemPrompt) {
        messages.push({ role: 'system', content: config.systemPrompt });
    }

    // Set up "On Your Data" if configured
    dataSources = [];
    if (config.azureCogSearchEndpoint && config.azureCogSearchKey && config.azureCogSearchIndexName) {
        setDataSources(config.azureCogSearchEndpoint, config.azureCogSearchKey, config.azureCogSearchIndexName);
    }

    // Get token for WebRTC
    const xhr = new XMLHttpRequest();
    const tokenUrl = `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;
    xhr.open("GET", tokenUrl);
    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey);
    xhr.onload = () => {
        if (xhr.status === 200) {
            const responseData = JSON.parse(xhr.responseText);
            setupWebRTC(responseData.Urls[0], responseData.Username, responseData.Password);
        } else {
            console.error(`Failed to get token: ${xhr.statusText}`);
            alert('Failed to get avatar token. Please check your Speech key and region.');
            window.stopSession();
        }
    };
    xhr.onerror = () => {
        console.error('Token request failed.');
        alert('Failed to send request for avatar token.');
        window.stopSession();
    };
    xhr.send();
}

// =================== SETUP WEBSOCKET & AVATAR ===================
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [iceServerUrl],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    });

    peerConnection.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            console.log('Audio track received');
            let audioElement = document.createElement('audio');
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            document.body.appendChild(audioElement); // Append to body to ensure it plays
        } else if (event.track.kind === 'video') {
            console.log('Video track received');
            let videoElement = document.createElement('video');
            videoElement.id = 'videoPlayer';
            videoElement.srcObject = event.streams[0];
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.onplaying = () => {
                console.log('WebRTC video playback started.');
                document.getElementById('videoContainer').hidden = false;
                document.getElementById('chatContainer').hidden = false;
                document.getElementById('microphone').disabled = false;
                document.getElementById('stopSession').disabled = false;

                const remoteDiv = document.getElementById('remoteVideo');
                remoteDiv.innerHTML = ''; // Clear previous video elements
                remoteDiv.appendChild(videoElement);

                if (config.avatarTransparentBackground === 'true') {
                    document.getElementById('canvas').hidden = false;
                    window.requestAnimationFrame(makeBackgroundTransparent);
                } else {
                    document.getElementById('canvas').hidden = true;
                }
                setTimeout(() => { 
                    console.log('Session marked as active.');
                    sessionActive = true; 
                }, 1000); // Session is active
            };
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE state: " + peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'closed') {
            console.error('ICE connection failed. Closing session.');
            // alert('Connection to the avatar service failed. Please try again.');
            // window.stopSession();
        }
    };

    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

    avatarSynthesizer.startAvatarAsync(peerConnection)
        .then(result => {
            if (result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                const errorDetails = SpeechSDK.CancellationDetails.fromResult(result).errorDetails;
                console.error(`Could not start avatar: ${errorDetails}`);
                alert(`Failed to start avatar session: ${errorDetails}. Check console for details.`);
                window.stopSession();
            }
        })
        .catch(error => {
            console.error('Avatar failed to start: ' + error);
            alert('An unexpected error occurred while starting the avatar.');
            window.stopSession();
        });
}

// =================== DISCONNECT AVATAR ===================
function disconnectAvatar() {
    if (peerConnection && peerConnection.connectionState !== 'closed') {
        peerConnection.close();
    }
    if (avatarSynthesizer) {
        avatarSynthesizer.close();
        avatarSynthesizer = null;
    }
    stopMicrophone();
    if (speechRecognizer) {
        speechRecognizer.close();
        speechRecognizer = null;
    }
    sessionActive = false;
    console.log('Session disconnected.');
}

// =================== SET DATA SOURCES (On Your Data) ===================
function setDataSources(endpoint, key, indexName) {
    if (!endpoint || !key || !indexName) {
        console.log('Cognitive Search data source not configured.');
        dataSources = [];
        return;
    }
    dataSources = [{
        type: 'azure_search',
        parameters: {
            endpoint: endpoint,
            index_name: indexName,
            authentication: {
                type: 'api_key',
                key: key
            },
            semantic_configuration: '',
            query_type: 'simple',
            fields_mapping: {},
            in_scope: true,
            role_information: config.systemPrompt
        }
    }];
    console.log('Data sources configured:', dataSources);
}

// =================== SPEECH-TO-TEXT (STT) ===================
function startMicrophone() {
    if (!speechRecognizer) {
        console.error('Speech recognizer is not initialized.');
        return;
    }

    const micButton = document.getElementById('microphone');
    micButton.disabled = true; // Disable button to prevent multiple clicks
    let finalTranscript = '';

    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason == SpeechSDK.ResultReason.RecognizedSpeech) {
            let recognizedText = e.result.text;
            finalTranscript += recognizedText + ' ';

            // Check if the recognized text contains a sentence-ending punctuation
            const lastChar = recognizedText.trim().slice(-1);
            if (sentenceLevelPunctuations.includes(lastChar)) {
                console.log(`Sentence detected: ${finalTranscript.trim()}`);
                addUserMessage(finalTranscript.trim());
                getChatGptResponse(finalTranscript.trim());
                finalTranscript = ''; // Reset for the next sentence
            }
        }
    };

    speechRecognizer.sessionStopped = (s, e) => {
        console.log('Recognition session stopped.');
        stopMicrophone();
        if (finalTranscript) {
            addUserMessage(finalTranscript.trim());
            getChatGptResponse(finalTranscript.trim());
        }
    };

    speechRecognizer.canceled = (s, e) => {
        console.error(`CANCELED: Reason=${e.reason}`);
        if (e.reason == SpeechSDK.CancellationReason.Error) {
            console.error(`CANCELED: ErrorDetails=${e.errorDetails}`);
        }
        stopMicrophone();
    };

    speechRecognizer.startContinuousRecognitionAsync(() => {
        console.log('Recognition started');
        micButton.textContent = 'Stop Microphone';
        micButton.disabled = false;
    }, err => {
        console.error(`Error starting recognition: ${err}`);
        micButton.disabled = false;
    });
}

function stopMicrophone() {
    if (speechRecognizer) {
        speechRecognizer.stopContinuousRecognitionAsync(() => {
            console.log('Recognition stopped.');
        }, err => {
            console.error(`ERROR stopping recognition: ${err}`);
        });
    }
    const micButton = document.getElementById('microphone');
    micButton.textContent = 'Start Microphone';
}

// =================== CHAT COMPLETION ===================
function addUserMessage(message) {
    messages.push({ role: 'user', content: message });
    const chatHistory = document.getElementById('chat-history');
    const userMessage = document.createElement('div');
    userMessage.className = 'user-message';
    userMessage.textContent = message;
    chatHistory.appendChild(userMessage);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function getChatGptResponse(prompt) {
    console.log('Checking config in getChatGptResponse:', config); // Add this line for debugging
    if (!config.azureOpenAIEndpoint || !config.azureOpenAIKey || !config.azureOpenAIDeploymentName || !config.azureOpenAIApiVersion) {
        alert('Azure OpenAI configuration is incomplete. Please check your .env file and server.');
        return;
    }

    if (!prompt && messages.length === 1) { // Only system prompt exists
        return;
    }

    const chatHistory = document.getElementById('chat-history');
    const assistantMessageDiv = document.createElement('div');
    assistantMessageDiv.className = 'assistant-message';
    chatHistory.appendChild(assistantMessageDiv);

    let fullResponse = '';

    try {
        const body = {
            messages: messages,
            stream: true,
        };

        if (dataSources.length > 0) {
            body.data_sources = dataSources; // Use snake_case for the API
        }

        const url = `${config.azureOpenAIEndpoint}/openai/deployments/${config.azureOpenAIDeploymentName}/chat/completions?api-version=${config.azureOpenAIApiVersion}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': config.azureOpenAIKey
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("API Error:", errorData);
            assistantMessageDiv.innerHTML = `Error: ${errorData.error.message}`;
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6);
                    if (jsonStr.trim() === '[DONE]') {
                        break; // End of stream
                    }
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.choices && parsed.choices[0].delta) {
                            const delta = parsed.choices[0].delta;
                            if (delta.content) {
                                fullResponse += delta.content;
                                assistantMessageDiv.innerHTML = fullResponse; // Use innerHTML to render markdown
                                chatHistory.scrollTop = chatHistory.scrollHeight;
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                    }
                }
            }
        }

        // Push the full response to the messages array for chat history
        if (fullResponse) {
            messages.push({ role: 'assistant', content: fullResponse });
        }

        // Make the avatar speak the response
        if (avatarSynthesizer && fullResponse) {
            console.log("Sending response to avatar for synthesis: ", fullResponse);
            avatarSynthesizer.speakTextAsync(
                fullResponse,
                result => {
                    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        console.log("Avatar speech synthesis completed successfully.");
                    } else {
                        console.error(`Avatar speech synthesis failed: ${result.errorDetails}`);
                    }
                    isSpeaking = false;
                    document.getElementById('stopSpeaking').disabled = true;
                },
                error => {
                    console.error(`An error occurred during avatar speech synthesis: ${error}`);
                    isSpeaking = false;
                    document.getElementById('stopSpeaking').disabled = true;
                }
            );
            isSpeaking = true;
            document.getElementById('stopSpeaking').disabled = false;
        }

    } catch (error) {
        console.error('Error getting chat response:', error);
        assistantMessageDiv.textContent = 'Failed to get response.';
    }
}
