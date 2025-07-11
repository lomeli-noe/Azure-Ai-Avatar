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
var currentPrompt = 'superintelligence_prompt'; // Default prompt

// =================== UI CONTROL FUNCTIONS ===================

// Called when the page is loaded
window.onload = async function() {
    try {
        // Get conference from URL
        const urlParams = new URLSearchParams(window.location.search);
        const conference = urlParams.get('conference');

        const response = await fetch('/api/config');
        config = await response.json();
        console.log("Configuration loaded:", config);

        // Knowledge base selector has been removed from the UI. Skip related logic.
        const knowledgeBaseSelector = document.getElementById('knowledgeBase');
        if (knowledgeBaseSelector) {
            if (config.cognitiveSearchIndices && Object.keys(config.cognitiveSearchIndices).length > 0) {
                knowledgeBaseSelector.innerHTML = '';
                for (const friendlyName in config.cognitiveSearchIndices) {
                    const option = document.createElement('option');
                    option.value = config.cognitiveSearchIndices[friendlyName];
                    option.textContent = friendlyName;
                    knowledgeBaseSelector.appendChild(option);
                }
                knowledgeBaseSelector.addEventListener('change', switchKnowledgeBase);
                knowledgeBaseSelector.disabled = false;
                document.getElementById('openSessionButton').disabled = false;
            } else {
                // If no indexes are configured, keep the controls disabled but inform the user.
                console.warn("No search indexes found in configuration.");
                const openSessionButton = document.getElementById('openSessionButton');
                openSessionButton.textContent = 'Configuration Incomplete';
                openSessionButton.title = 'Please configure at least one AZURE_COGNITIVE_SEARCH_INDEX in the .env file.';
            }
        } else {
            // If the selector is not present, just enable the session button
            const openSessionButton = document.getElementById('openSessionButton');
            if (openSessionButton) openSessionButton.disabled = false;
        }

        // Set prompt and knowledge base based on conference selection
        if (conference) {
            let promptName = 'superintelligence_prompt';
            let kbMatch = '';
            if (conference === 'agi') {
                promptName = 'four_gifts_prompt';
                kbMatch = 'four gifts';
            } else if (conference === 'cogsci') {
                promptName = 'superintelligence_prompt';
                kbMatch = 'super intelligence';
            }
            currentPrompt = promptName;
            // Set prompt selector if present
            const promptSelector = document.getElementById('promptSelector');
            if (promptSelector) promptSelector.value = promptName;
            // Set knowledge base selector if present and still in DOM
            if (kbMatch && knowledgeBaseSelector) {
                for (const friendlyName in config.cognitiveSearchIndices) {
                    if (friendlyName.toLowerCase().includes(kbMatch)) {
                        knowledgeBaseSelector.value = config.cognitiveSearchIndices[friendlyName];
                        setDataSources(config.azureCogSearchEndpoint, config.azureCogSearchKey, config.cognitiveSearchIndices[friendlyName]);
                        break;
                    }
                }
            }
        }

        // Load the initial prompt
        await loadPrompt(currentPrompt);

        // Display custom user avatar if path is provided
        if (config.userAvatarImagePath && config.userAvatarImagePath.trim() !== '' && config.userAvatarImagePath !== 'image/my_avatar.png') {
            const remoteVideoElement = document.getElementById('remoteVideo');
            const customAvatarImg = document.createElement('img');
            customAvatarImg.src = config.userAvatarImagePath;
            customAvatarImg.className = 'custom-avatar';
            remoteVideoElement.innerHTML = ''; // Clear any existing video/canvas
            remoteVideoElement.appendChild(customAvatarImg);
            document.getElementById('videoContainer').hidden = false;
        }

        // =================== ATTACH EVENT LISTENERS ===================
        // These are now inside window.onload to ensure the DOM is ready.

        // Upload functionality
        document.getElementById('uploadImgIcon').addEventListener('click', () => {
            document.getElementById('imageUpload').click();
        });

        document.getElementById('imageUpload').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const imgElement = document.createElement('img');
                    imgElement.src = e.target.result;
                    imgElement.className = 'uploaded-image';
                    document.getElementById('chat-history').appendChild(imgElement);
                    // Optionally, you can send the image to the server or process it further
                };
                reader.readAsDataURL(file);
            }
        });

        // Shortcut keys
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key === 'Enter') {
                // Ctrl + Enter to send the message
                const userMessageBox = document.getElementById('userMessageBox');
                if (userMessageBox && !userMessageBox.hidden) {
                    const userMessage = userMessageBox.textContent || userMessageBox.innerHTML;
                    if (userMessage.trim() !== '') {
                        sendMessageToGPT(userMessage.trim());
                        userMessageBox.textContent = '';
                    }
                }
            } else if (event.key === 'F5') {
                // F5 to reload the prompt
                event.preventDefault();
                reloadPrompt();
            } else if (event.key === 'Escape') {
                // Escape to close any open modals
                closePromptModal();
            }
        });
        
        // Add Enter key support for the message box
        document.addEventListener('keydown', (event) => {
            if (event.target.id === 'userMessageBox' && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                event.preventDefault();
                window.sendTypedMessage();
            }
        });

    } catch (error) {
        console.error('Failed to load configuration:', error);
        alert('Failed to load configuration. Please check the server and .env file.');
    }

    // Close modal when clicking outside of it
    window.onclick = function(event) {
        const promptModal = document.getElementById('promptModal');
        if (event.target == promptModal) {
            promptModal.style.display = "none";
        }
    }

    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error caught:', event);
        alert('An unexpected error occurred. Please try again later.');
    });
};

// Called when the knowledge base selection changes
window.switchKnowledgeBase = function() {
    const selector = document.getElementById('knowledgeBase');
    const newIndexName = selector.value;
    console.log(`Switching knowledge base to: ${newIndexName}`);

    // Update the data source configuration
    setDataSources(config.azureCogSearchEndpoint, config.azureCogSearchKey, newIndexName);

    // Clear the chat history to start a new conversation context
    clearChatHistory();

    alert(`Knowledge base switched to "${selector.options[selector.selectedIndex].text}". The chat has been reset.`);
};

// Called when the prompt selection changes
window.switchPrompt = async function() {
    const selector = document.getElementById('promptSelector');
    currentPrompt = selector.value;
    console.log(`Switching prompt to: ${currentPrompt}`);

    await loadPrompt(currentPrompt);

    // Clear the chat history to start a new conversation context
    clearChatHistory();

    alert(`Prompt switched to "${selector.options[selector.selectedIndex].text}". The chat has been reset.`);
};

// Called when "Open Avatar Session" is clicked
window.startSession = function() {
    document.getElementById('openSessionButton').disabled = true;
    document.getElementById('controlsToolbar').style.display = 'block';
    connectAvatar();
};

// Called when "Close Avatar Session" is clicked
window.stopSession = function() {
    disconnectAvatar();
    document.getElementById('openSessionButton').disabled = false;
    document.getElementById('controlsToolbar').style.display = 'none';
    document.getElementById('chatContainer').hidden = true;
    document.getElementById('videoContainer').hidden = true;
    document.getElementById('microphone').disabled = true;
    document.getElementById('microphone').textContent = '🎤 Start Microphone'; // Reset button text
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
    await loadPrompt(currentPrompt);
    // Clear chat history and apply the new system prompt
    clearChatHistory();
    alert("Prompt reloaded successfully. The chat history has been cleared.");
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
        const response = await fetch(`/api/prompt/${currentPrompt}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: newPrompt }),
        });

        if (response.ok) {
            console.log("Prompt saved successfully.");
            closePromptModal();
            await loadPrompt(currentPrompt); // Reload to apply the new prompt
            clearChatHistory();
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
    document.getElementById('messageInputContainer').hidden = !show;
};

// Send a message from the typed message box
window.sendTypedMessage = function() {
    const userMessageBox = document.getElementById('userMessageBox');
    if (userMessageBox) {
        const userMessage = userMessageBox.textContent || userMessageBox.innerHTML;
        if (userMessage && userMessage.trim() !== '') {
            sendMessageToGPT(userMessage.trim());
            userMessageBox.textContent = '';
        } else {
            console.log("Empty typed message, not sending");
        }
    }
};

async function loadPrompt(promptName) {
    try {
        const response = await fetch(`/api/prompt/${promptName}`);
        if (!response.ok) {
            throw new Error(`Failed to load prompt: ${response.statusText}`);
        }
        const promptData = await response.json();
        config.systemPrompt = promptData.prompt;
        console.log(`Prompt "${promptName}" loaded.`);
        
        // Auto-switch knowledge base to match the new prompt
        if (config.cognitiveSearchIndices && Object.values(config.cognitiveSearchIndices).length > 0) {
            let newIndexName = null;
            
            if (promptName === 'four_gifts_prompt') {
                // Look for Four Gifts index
                for (const friendlyName in config.cognitiveSearchIndices) {
                    if (friendlyName.toLowerCase().includes('four gifts')) {
                        newIndexName = config.cognitiveSearchIndices[friendlyName];
                        console.log(`Auto-switching to Four Gifts index: ${newIndexName}`);
                        break;
                    }
                }
            } else if (promptName === 'superintelligence_prompt') {
                // Look for SuperIntelligence index
                for (const friendlyName in config.cognitiveSearchIndices) {
                    if (friendlyName.toLowerCase().includes('super intelligence') || friendlyName.toLowerCase().includes('ai super intelligence')) {
                        newIndexName = config.cognitiveSearchIndices[friendlyName];
                        console.log(`Auto-switching to SuperIntelligence index: ${newIndexName}`);
                        break;
                    }
                }
            }
            
            // Update data sources if we found a matching index
            if (newIndexName) {
                setDataSources(config.azureCogSearchEndpoint, config.azureCogSearchKey, newIndexName);
            }
        }
    } catch (error) {
        console.error('Failed to load prompt:', error);
        alert('Failed to load prompt. Please check the server.');
    }
}

// Called when the microphone button is clicked
window.microphone = function() {
    console.log("Microphone button clicked");
    const micButton = document.getElementById('microphone');
    console.log("Current button text:", micButton.textContent);
    if (micButton.textContent.includes('Start Microphone')) {
        console.log("Starting microphone...");
        startMicrophone();
        micButton.textContent = '🛑 Stop Microphone';
    } else {
        console.log("Stopping microphone...");
        stopMicrophone();
        micButton.textContent = '🎤 Start Microphone';
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
async function connectAvatar() {
    console.log("Connecting to avatar...");

    // If a custom avatar image is used, we don't need the full avatar synthesizer
    if (config.userAvatarImagePath && config.userAvatarImagePath.trim() !== '' && config.userAvatarImagePath !== 'image/my_avatar.png') {
        console.log("Custom avatar image detected, initializing speech synthesis only.");
        const cogSvcRegion = config.azureSpeechRegion;
        const cogSvcSubKey = config.azureSpeechKey;
        let speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
        speechSynthesisConfig.speechSynthesisVoiceName = config.ttsVoice;
        
        // Use a standard speech synthesizer as we don't need video
        avatarSynthesizer = new SpeechSDK.SpeechSynthesizer(speechSynthesisConfig);

        // Setup STT recognizer with English-only configuration
        const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
        speechRecognitionConfig.speechRecognitionLanguage = "en-US"; // Force English only
        // Removed problematic properties to fix websocket error 1007
        
        speechRecognizer = new SpeechSDK.SpeechRecognizer(
            speechRecognitionConfig,
            SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
        );

        // Set data sources based on current prompt setting
        let indexName = null;
        const knowledgeBaseSelector = document.getElementById('knowledgeBase');
        if (knowledgeBaseSelector) {
            indexName = knowledgeBaseSelector.value;
        } else if (config.cognitiveSearchIndices && Object.values(config.cognitiveSearchIndices).length > 0) {
            // Auto-select the appropriate index based on current prompt
            if (currentPrompt === 'four_gifts_prompt') {
                // Look for Four Gifts index
                for (const friendlyName in config.cognitiveSearchIndices) {
                    if (friendlyName.toLowerCase().includes('four gifts')) {
                        indexName = config.cognitiveSearchIndices[friendlyName];
                        console.log(`Auto-selected Four Gifts index: ${indexName}`);
                        break;
                    }
                }
            } else if (currentPrompt === 'superintelligence_prompt') {
                // Look for SuperIntelligence index
                for (const friendlyName in config.cognitiveSearchIndices) {
                    if (friendlyName.toLowerCase().includes('super intelligence') || friendlyName.toLowerCase().includes('ai super intelligence')) {
                        indexName = config.cognitiveSearchIndices[friendlyName];
                        console.log(`Auto-selected SuperIntelligence index: ${indexName}`);
                        break;
                    }
                }
            }
            
            // Fallback to first available index if no match found
            if (!indexName) {
                indexName = Object.values(config.cognitiveSearchIndices)[0];
                console.log(`No matching index found for prompt ${currentPrompt}, using fallback: ${indexName}`);
            }
        }
        setDataSources(config.azureCogSearchEndpoint, config.azureCogSearchKey, indexName);
        messages = [];
        if (config.systemPrompt) {
            messages.push({ role: 'system', content: config.systemPrompt });
        }

        // Enable controls as the session is now "active" for speech
        document.getElementById('chatContainer').hidden = false;
        document.getElementById('microphone').disabled = false;
        document.getElementById('stopSession').disabled = false;
        sessionActive = true;
        
        // Auto-start microphone
        startMicrophone();
        document.getElementById('microphone').textContent = '🛑 Stop Microphone';
        
        // Auto-start the conversation with the introduction
        autoStartConversation();
        return; // Skip the rest of the function for WebRTC setup
    }

    const cogSvcRegion = config.azureSpeechRegion;
    const cogSvcSubKey = config.azureSpeechKey;

    let speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    speechSynthesisConfig.speechSynthesisVoiceName = config.ttsVoice;

    const avatarConfig = new SpeechSDK.AvatarConfig(config.avatarCharacter, config.avatarStyle);
    avatarConfig.backgroundColor = config.avatarBackgroundColor;

    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);

    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    speechRecognitionConfig.speechRecognitionLanguage = "en-US"; // Force English only
    // Removed problematic properties to fix websocket error 1007
    
    speechRecognizer = new SpeechSDK.SpeechRecognizer(
        speechRecognitionConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    let indexName = null;
    const knowledgeBaseSelector = document.getElementById('knowledgeBase');
    if (knowledgeBaseSelector) {
        indexName = knowledgeBaseSelector.value;
    } else if (config.cognitiveSearchIndices && Object.values(config.cognitiveSearchIndices).length > 0) {
        // Auto-select the appropriate index based on current prompt
        if (currentPrompt === 'four_gifts_prompt') {
            // Look for Four Gifts index
            for (const friendlyName in config.cognitiveSearchIndices) {
                if (friendlyName.toLowerCase().includes('four gifts')) {
                    indexName = config.cognitiveSearchIndices[friendlyName];
                    console.log(`Auto-selected Four Gifts index: ${indexName}`);
                    break;
                }
            }
        } else if (currentPrompt === 'superintelligence_prompt') {
            // Look for SuperIntelligence index
            for (const friendlyName in config.cognitiveSearchIndices) {
                if (friendlyName.toLowerCase().includes('super intelligence') || friendlyName.toLowerCase().includes('ai super intelligence')) {
                    indexName = config.cognitiveSearchIndices[friendlyName];
                    console.log(`Auto-selected SuperIntelligence index: ${indexName}`);
                    break;
                }
            }
        }
        
        // Fallback to first available index if no match found
        if (!indexName) {
            indexName = Object.values(config.cognitiveSearchIndices)[0];
            console.log(`No matching index found for prompt ${currentPrompt}, using fallback: ${indexName}`);
        }
    }
    setDataSources(config.azureCogSearchEndpoint, config.azureCogSearchKey, indexName);

    const systemPrompt = config.systemPrompt;
    messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
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
                    
                    // Auto-start microphone
                    startMicrophone();
                    document.getElementById('microphone').textContent = '🛑 Stop Microphone';
                    
                    // Auto-start the conversation with the introduction
                    autoStartConversation();
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
        try {
            speechRecognizer.close();
        } catch (error) {
            console.error("Error closing speech recognizer during session stop: ", error);
        }
        speechRecognizer = null;
    }
    sessionActive = false;
    console.log('Session disconnected.');
}

// =================== SET DATA SOURCES (On Your Data) ===================
function setDataSources(endpoint, key, indexName) {
    console.log("[DEBUG] setDataSources called with:");
    console.log("[DEBUG] - endpoint:", endpoint);
    console.log("[DEBUG] - key:", key ? `${key.substring(0, 8)}...` : "undefined");
    console.log("[DEBUG] - indexName:", indexName);
    
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
            }
        }
    }];
    
    console.log('Data sources configured:', dataSources);
    console.log("[DEBUG] Data source configuration complete. Length:", dataSources.length);
}

// =================== AUTO-START CONVERSATION ===================
async function autoStartConversation() {
    console.log('Auto-starting conversation with introduction...');
    
    // Wait a moment to ensure everything is properly initialized
    setTimeout(async () => {
        try {
            const introductionMessage = "Hello! I'm an AI avatar trained to answer questions about the conference paper 'Four Gifts From the Founders of AI.' I'm here to help you explore this research. Feel free to ask me any question about the paper, or if you'd prefer, I can suggest some interesting questions to get us started. What would you like to know?";
            
            // Add the introduction to the chat display
            addMessage('Assistant', introductionMessage);
            
            // Speak the introduction with the avatar
            await speakWithAvatar(introductionMessage);
            
            console.log('Auto-introduction completed successfully');
        } catch (error) {
            console.error('Error during auto-start conversation:', error);
        }
    }, 500); // Short delay to ensure avatar is fully ready
}

// =================== MESSAGE DISPLAY FUNCTIONS ===================
function addMessage(role, content) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) {
        console.error('Chat history element not found');
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = role === 'User' ? 'user-message' : 'assistant-message';
    messageDiv.textContent = content;
    chatHistory.appendChild(messageDiv);
    
    // Scroll to bottom
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// =================== SEND MESSAGE TO GPT ===================
async function sendMessageToGPT(userMessage) {
    console.log('Sending message to GPT:', userMessage);
    
    // Add user message to chat
    addMessage('User', userMessage);
    
    // Add user message to conversation
    messages.push({ role: 'user', content: userMessage });
    
    try {
        const requestData = {
            messages: messages,
            temperature: 0.7,
            max_tokens: 1000,
            top_p: 0.95,
            frequency_penalty: 0,
            presence_penalty: 0
        };
        
        // Add data sources for RAG if configured
        if (dataSources && dataSources.length > 0) {
            requestData.data_sources = dataSources;
        }
        
        console.log('[DEBUG] Sending request to /api/gpt:');
        console.log('- Messages count:', requestData.messages.length);
        console.log('- Has data sources:', !!requestData.data_sources);
        console.log('- Data sources count:', requestData.data_sources?.length || 0);
        
        const response = await fetch('/api/gpt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const responseData = await response.json();
        const gptMessage = responseData.choices[0].message.content;
        
        // Add GPT response to conversation
        messages.push({ role: 'assistant', content: gptMessage });
        
        // Add GPT response to chat display
        addMessage('Assistant', gptMessage);
        
        // Speak the GPT message using the avatar
        await speakWithAvatar(gptMessage);
        
    } catch (error) {
        console.error('Error sending message to GPT:', error);
        const errorMessage = 'Sorry, I encountered an error processing your request. Please try again.';
        addMessage('Assistant', errorMessage);
        await speakWithAvatar(errorMessage);
    }
}

// =================== MICROPHONE FUNCTIONS ===================
function startMicrophone() {
    if (!speechRecognizer) {
        console.error("Speech recognizer is not initialized.");
        return;
    }

    console.log("Starting continuous speech recognition...");
    
    speechRecognizer.recognizing = (s, e) => {
        console.log("Recognizing: " + e.result.text);
    };

    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text.trim() !== '') {
            console.log("Recognized: " + e.result.text);
            sendMessageToGPT(e.result.text);
        }
    };

    speechRecognizer.canceled = (s, e) => {
        console.log("Speech recognition canceled: " + e.errorDetails);
        if (e.reason === SpeechSDK.CancellationReason.Error) {
            console.error("Speech recognition error: " + e.errorDetails);
        }
    };

    speechRecognizer.sessionStopped = (s, e) => {
        console.log("Speech recognition session stopped.");
    };

    speechRecognizer.startContinuousRecognitionAsync(
        () => {
            console.log("Continuous speech recognition started successfully.");
        },
        err => {
            console.error("Failed to start speech recognition: ", err);
            document.getElementById('microphone').textContent = '🎤 Start Microphone';
        }
    );
}

function stopMicrophone() {
    if (speechRecognizer) {
        console.log("Stopping speech recognition...");
        speechRecognizer.stopContinuousRecognitionAsync(
            () => {
                console.log("Speech recognition stopped successfully.");
            },
            err => {
                console.error("Failed to stop speech recognition: ", err);
            }
        );
    }
}

// =================== SPEAK WITH AVATAR ===================
async function speakWithAvatar(message) {
    if (!avatarSynthesizer) {
        console.error("Avatar synthesizer is not initialized.");
        return;
    }

    isSpeaking = true;
    document.getElementById('stopSpeaking').disabled = false;
    
    try {
        console.log('Avatar speaking:', message.substring(0, 50) + '...');
        await avatarSynthesizer.speakTextAsync(message);
        console.log('Avatar finished speaking');
    } catch (error) {
        console.error("Error speaking with avatar:", error);
    } finally {
        isSpeaking = false;
        document.getElementById('stopSpeaking').disabled = true;
    }
}
