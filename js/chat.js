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

        // Populate the knowledge base selector dynamically
        const selector = document.getElementById('knowledgeBase');
        if (selector && config.cognitiveSearchIndices && Object.keys(config.cognitiveSearchIndices).length > 0) {
            // Clear existing options
            selector.innerHTML = '';

            // Add new options from config
            for (const friendlyName in config.cognitiveSearchIndices) {
                const option = document.createElement('option');
                option.value = config.cognitiveSearchIndices[friendlyName];
                option.textContent = friendlyName; // Use the user-friendly name from the server
                selector.appendChild(option);
            }
            
            // Add event listener for changes
            selector.addEventListener('change', switchKnowledgeBase);

            // Enable the selector and session button now that they are ready
            selector.disabled = false;
            document.getElementById('openSessionButton').disabled = false;
        } else {
            // If no indexes are configured, keep the controls disabled but inform the user.
            console.warn("No search indexes found in configuration.");
            const openSessionButton = document.getElementById('openSessionButton');
            openSessionButton.textContent = 'Configuration Incomplete';
            openSessionButton.title = 'Please configure at least one AZURE_COGNITIVE_SEARCH_INDEX in the .env file.';
        }

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
                const userMessage = document.getElementById('userMessage').value;
                if (userMessage.trim() !== '') {
                    sendMessageToGPT(userMessage);
                    document.getElementById('userMessage').value = '';
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

        // Contextual help
        document.getElementById('helpButton').addEventListener('click', () => {
            const helpText = `
                <h3>Available Commands:</h3>
                <ul>
                    <li><strong>Open Avatar Session:</strong> Connect to the avatar service.</li>
                    <li><strong>Close Avatar Session:</strong> Disconnect from the avatar service.</li>
                    <li><strong>Clear Chat History:</strong> Clear the current chat history.</li>
                    <li><strong>Reload Prompt:</strong> Reload the system prompt from the server.</li>
                    <li><strong>Edit Prompt:</strong> Modify the system prompt used by the AI.</li>
                    <li><strong>Microphone:</strong> Start/stop voice input.</li>
                    <li><strong>Stop Speaking:</strong> Immediately stop the avatar's speech.</li>
                </ul>
                <p>For detailed instructions, please refer to the documentation.</p>
            `;
            const modal = document.getElementById('helpModal');
            modal.querySelector('.modal-content').innerHTML = helpText;
            modal.style.display = 'block';
        });

        // Close modal when clicking outside of it
        window.onclick = function(event) {
            const modal = document.getElementById('helpModal');
            if (event.target == modal) {
                modal.style.display = "none";
            }
        }

    } catch (error) {
        console.error('Failed to load configuration:', error);
        alert('Failed to load configuration. Please check the server and .env file.');
    }

    // =================== EVENT LISTENERS for UI elements ===================
    // These are placed inside window.onload to ensure the DOM is fully loaded.

    // UPLOAD FUNCTIONALITY
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

    // SHORTCUT KEYS
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'Enter') {
            // Ctrl + Enter to send the message
            const userMessage = document.getElementById('userMessage').value;
            if (userMessage.trim() !== '') {
                sendMessageToGPT(userMessage);
                document.getElementById('userMessage').value = '';
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

    // CONTEXTUAL HELP
    document.getElementById('helpButton').addEventListener('click', () => {
        const helpText = `
            <h3>Available Commands:</h3>
            <ul>
                <li><strong>Open Avatar Session:</strong> Connect to the avatar service.</li>
                <li><strong>Close Avatar Session:</strong> Disconnect from the avatar service.</li>
                <li><strong>Clear Chat History:</strong> Clear the current chat history.</li>
                <li><strong>Reload Prompt:</strong> Reload the system prompt from the server.</li>
                <li><strong>Edit Prompt:</strong> Modify the system prompt used by the AI.</li>
                <li><strong>Microphone:</strong> Start/stop voice input.</li>
                <li><strong>Stop Speaking:</strong> Immediately stop the avatar's speech.</li>
            </ul>
            <p>For detailed instructions, please refer to the documentation.</p>
        `;
        const modal = document.getElementById('helpModal');
        modal.querySelector('.modal-content').innerHTML = helpText;
        modal.style.display = 'block';
    });

    // Close modal when clicking outside of it
    window.onclick = function(event) {
        const helpModal = document.getElementById('helpModal');
        const promptModal = document.getElementById('promptModal');
        if (event.target == helpModal) {
            helpModal.style.display = "none";
        }
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

        // Setup STT recognizer
        const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
        speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
        const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(config.sttLocales.split(','));
        speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
            speechRecognitionConfig,
            autoDetectSourceLanguageConfig,
            SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
        );

        // Set data sources and initialize messages
        const selector = document.getElementById('knowledgeBase');
        const indexName = selector.value;
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
    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
    const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(config.sttLocales.split(','));
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechRecognitionConfig,
        autoDetectSourceLanguageConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    const selector = document.getElementById('knowledgeBase');
    const indexName = selector.value;
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
    const cogSvcRegion = config.azureSpeechRegion;
    const cogSvcSubKey = config.azureSpeechKey;

    // Ensure only one recognizer is active at a time
    if (speechRecognizer) {
        speechRecognizer.close();
        speechRecognizer = null;
    }

    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
    const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(config.sttLocales.split(','));
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechRecognitionConfig,
        autoDetectSourceLanguageConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    speechRecognizer.recognizing = (s, e) => {
        // console.log(`Recognizing: ${e.result.text}`);
    };

    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            const text = e.result.text.trim();
            console.log(`Recognized: ${text}`);
            addMessage('user', text);

            // Send the user message to the GPT model
            sendMessageToGPT(text);
        } else if (e.result.reason === SpeechSDK.ResultReason.NoMatch) {
            console.log("No speech could be recognized.");
        } else if (e.result.reason === SpeechSDK.ResultReason.Canceled) {
            const cancellation = SpeechSDK.CancellationDetails.fromResult(e.result);
            console.error(`Speech recognition canceled: ${cancellation.errorDetails}`);
        }
    };

    speechRecognizer.startContinuousRecognitionAsync(
        () => {
            console.log("Speech recognition started.");
            document.getElementById('stopSpeaking').disabled = false;
        },
        err => {
            console.error("Failed to start speech recognition: ", err);
        }
    );
}

// =================== STOP SPEECH-TO-TEXT (STT) ===================
function stopMicrophone() {
    if (speechRecognizer) {
        speechRecognizer.stopContinuousRecognitionAsync(
            () => {
                console.log("Speech recognition stopped.");
                speechRecognizer.close();
                speechRecognizer = null;
            },
            err => {
                console.error("Failed to stop speech recognition: ", err);
            }
        );
    }
}

// =================== SEND MESSAGE TO GPT ===================
async function sendMessageToGPT(userMessage) {
    // Add the user message to the chat history
    addMessage('user', userMessage);

    // Prepare the request payload, now including the data sources
    const requestPayload = {
        data_sources: dataSources, // Add the configured data sources
        messages: messages.concat([{ role: 'user', content: userMessage }]),
        temperature: 0.7,
        max_tokens: 150,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
    };

    try {
        // Send the request to the GPT API
        const response = await fetch('/api/gpt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        const gptMessage = responseData.choices[0].message.content.trim();
        console.log(`GPT: ${gptMessage}`);

        // Add the GPT message to the chat history
        addMessage('assistant', gptMessage);

        // Speak the GPT message using the avatar
        await speakWithAvatar(gptMessage);

    } catch (error) {
        console.error('Error communicating with GPT:', error);
        alert('Error communicating with GPT. Please try again later.');
    }
}

// =================== ADD MESSAGE TO CHAT ===================
function addMessage(role, content) {
    messages.push({ role, content });
    const chatHistory = document.getElementById('chat-history');
    const messageElement = document.createElement('div');
    messageElement.className = `message ${role}`;
    messageElement.textContent = content;
    chatHistory.appendChild(messageElement);
    chatHistory.scrollTop = chatHistory.scrollHeight; // Auto-scroll to the bottom
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
        await avatarSynthesizer.speakTextAsync(message);
    } catch (error) {
        console.error("Error speaking with avatar:", error);
    } finally {
        isSpeaking = false;
        document.getElementById('stopSpeaking').disabled = true;
    }
}

// =================== DOWNLOAD FUNCTION ===================
async function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    if (window.navigator.msSaveBlob) {
        // For IE and Edge
        window.navigator.msSaveBlob(blob, filename);
    } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// =================== INITIATE CONVERSATION ===================
function initiateConversation() {
    clearChatHistory();
    const welcomeMessage = "Hello! I'm your AI assistant. How can I help you today?";
    addMessage('assistant', welcomeMessage);
    speakWithAvatar(welcomeMessage);
}

// =================== SHORTCUT KEYS ===================
// MOVED to window.onload

// =================== CONTEXTUAL HELP ===================
// MOVED to window.onload

// =================== ERROR HANDLING ===================
window.addEventListener('error', (event) => {
    console.error('Global error caught:', event);
    alert('An unexpected error occurred. Please try again later.');
});
