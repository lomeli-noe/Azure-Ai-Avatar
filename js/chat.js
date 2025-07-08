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
        const response = await fetch('/api/config');
        config = await response.json();
        console.log("Configuration loaded:", config);

        // Populate the knowledge base selector dynamically
        const knowledgeBaseSelector = document.getElementById('knowledgeBase');
        if (knowledgeBaseSelector && config.cognitiveSearchIndices && Object.keys(config.cognitiveSearchIndices).length > 0) {
            // Clear existing options
            knowledgeBaseSelector.innerHTML = '';

            // Add new options from config
            for (const friendlyName in config.cognitiveSearchIndices) {
                const option = document.createElement('option');
                option.value = config.cognitiveSearchIndices[friendlyName];
                option.textContent = friendlyName; // Use the user-friendly name from the server
                knowledgeBaseSelector.appendChild(option);
            }
            
            // Add event listener for changes
            knowledgeBaseSelector.addEventListener('change', switchKnowledgeBase);

            // Enable the selector and session button now that they are ready
            knowledgeBaseSelector.disabled = false;
            document.getElementById('openSessionButton').disabled = false;
        } else {
            // If no indexes are configured, keep the controls disabled but inform the user.
            console.warn("No search indexes found in configuration.");
            const openSessionButton = document.getElementById('openSessionButton');
            openSessionButton.textContent = 'Configuration Incomplete';
            openSessionButton.title = 'Please configure at least one AZURE_COGNITIVE_SEARCH_INDEX in the .env file.';
        }

        // Event listener for prompt selector
        const promptSelector = document.getElementById('promptSelector');
        promptSelector.addEventListener('change', switchPrompt);

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
    if (micButton.textContent === 'Start Microphone') {
        console.log("Starting microphone...");
        startMicrophone();
        micButton.textContent = 'Stop Microphone';
    } else {
        console.log("Stopping microphone...");
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

        // Setup STT recognizer with English-only configuration
        const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
        speechRecognitionConfig.speechRecognitionLanguage = "en-US"; // Force English only
        // Removed problematic properties to fix websocket error 1007
        
        speechRecognizer = new SpeechSDK.SpeechRecognizer(
            speechRecognitionConfig,
            SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
        );

        // Set data sources and initialize messages
        const knowledgeBaseSelector = document.getElementById('knowledgeBase');
        const indexName = knowledgeBaseSelector.value;
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
    speechRecognitionConfig.speechRecognitionLanguage = "en-US"; // Force English only
    // Removed problematic properties to fix websocket error 1007
    
    speechRecognizer = new SpeechSDK.SpeechRecognizer(
        speechRecognitionConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    const knowledgeBaseSelector = document.getElementById('knowledgeBase');
    const indexName = knowledgeBaseSelector.value;
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

// =================== CLEAN GPT RESPONSE ===================
function cleanGPTResponse(text) {
    // Remove document citations like [doc1], [doc2], etc.
    let cleanedText = text.replace(/\[doc\d+\]/gi, '');
    
    // Remove other common citation patterns
    cleanedText = cleanedText.replace(/\[\d+\]/g, ''); // Remove [1], [2], etc.
    cleanedText = cleanedText.replace(/\[citation:\s*\d+\]/gi, ''); // Remove [citation: 1], etc.
    cleanedText = cleanedText.replace(/\[ref\s*\d+\]/gi, ''); // Remove [ref1], [ref 1], etc.
    
    // Remove multiple spaces that might be left after removing citations
    cleanedText = cleanedText.replace(/\s+/g, ' ');
    
    // Trim any leading/trailing whitespace
    cleanedText = cleanedText.trim();
    
    return cleanedText;
}

// =================== SPEECH TEXT CLEANUP ===================
function cleanupSpeechText(text) {
    // Common speech recognition error corrections
    const corrections = {
        'gib mir': 'give me',
        'stucki mit': 'document',
        'dokument': 'document',
        'zusammenfassung': 'summary',
        'was ist': 'what is',
        'tell mir': 'tell me',
        'sumary': 'summary',
        'summery': 'summary',
        'documnet': 'document',
        'documen': 'document'
    };
    
    let cleanedText = text.toLowerCase();
    
    // Apply corrections
    for (const [error, correction] of Object.entries(corrections)) {
        cleanedText = cleanedText.replace(new RegExp(error, 'gi'), correction);
    }
    
    // Capitalize first letter
    cleanedText = cleanedText.charAt(0).toUpperCase() + cleanedText.slice(1);
    
    return cleanedText;
}

// =================== TEST SPEECH SERVICE CONNECTION ===================
async function testSpeechServiceConnection(cogSvcRegion, cogSvcSubKey) {
    console.log("Testing Speech Service connection...");
    
    try {
        // Create a minimal config to test authentication
        const testConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
        testConfig.speechRecognitionLanguage = "en-US";
        
        // Create a simple recognizer for testing
        const testRecognizer = new SpeechSDK.SpeechRecognizer(testConfig);
        
        return new Promise((resolve, reject) => {
            let connectionTested = false;
            
            const timeout = setTimeout(() => {
                if (!connectionTested) {
                    connectionTested = true;
                    console.log("Connection test timed out - this might indicate network issues");
                    testRecognizer.close();
                    resolve(false);
                }
            }, 10000); // 10 second timeout
            
            testRecognizer.canceled = (s, e) => {
                if (!connectionTested) {
                    connectionTested = true;
                    clearTimeout(timeout);
                    console.error("Connection test failed:", e.reason, e.errorDetails);
                    testRecognizer.close();
                    resolve(false);
                }
            };
            
            testRecognizer.sessionStarted = (s, e) => {
                if (!connectionTested) {
                    connectionTested = true;
                    clearTimeout(timeout);
                    console.log("Speech Service connection test successful");
                    testRecognizer.close();
                    resolve(true);
                }
            };
            
            // Start recognition briefly to test connection
            testRecognizer.startContinuousRecognitionAsync(
                () => {
                    console.log("Connection test recognition started");
                    // Stop immediately after starting to test connection
                    setTimeout(() => {
                        if (testRecognizer && !connectionTested) {
                            testRecognizer.stopContinuousRecognitionAsync();
                        }
                    }, 2000);
                },
                err => {
                    if (!connectionTested) {
                        connectionTested = true;
                        clearTimeout(timeout);
                        console.error("Connection test failed to start:", err);
                        testRecognizer.close();
                        resolve(false);
                    }
                }
            );
        });
    } catch (error) {
        console.error("Error during connection test:", error);
        return false;
    }
}

// =================== SPEECH-TO-TEXT (STT) ===================
function startMicrophone() {
    console.log("Starting microphone...");
    
    // Check if Speech SDK is available
    if (typeof SpeechSDK === 'undefined') {
        console.error("Speech SDK not loaded. Make sure the script is included in HTML.");
        alert("Speech SDK is not loaded. Please refresh the page and try again.");
        return;
    }
    
    console.log("Speech SDK is available, version:", SpeechSDK.version || "unknown");
    
    const cogSvcRegion = config.azureSpeechRegion;
    const cogSvcSubKey = config.azureSpeechKey;
    
    console.log("Speech config region:", cogSvcRegion);
    console.log("Speech key available:", !!cogSvcSubKey);
    
    if (!cogSvcRegion || !cogSvcSubKey) {
        console.error("Missing speech configuration");
        alert("Speech recognition is not configured. Please check your Azure Speech Service credentials.");
        return;
    }
    
    // Test connection first
    testSpeechServiceConnection(cogSvcRegion, cogSvcSubKey).then(connectionOk => {
        if (!connectionOk) {
            console.error("Speech Service connection test failed");
            alert("Cannot connect to Azure Speech Service. Please check your credentials and internet connection.");
            return;
        }
        
        // Check microphone permissions (non-blocking)
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    console.log("Microphone permission granted");
                    // Stop the stream since we just needed to check permissions
                    stream.getTracks().forEach(track => track.stop());
                    // Continue with speech recognition setup
                    setupSpeechRecognizer();
                })
                .catch(error => {
                    console.error("Microphone permission denied or not available:", error);
                    // Try to continue anyway - Azure SDK might handle permissions differently
                    setupSpeechRecognizer();
                });
        } else {
            console.error("getUserMedia not supported by browser");
            // Try to continue anyway
            setupSpeechRecognizer();
        }
    });
}

function setupSpeechRecognizer() {
    console.log("setupSpeechRecognizer called");
    const cogSvcRegion = config.azureSpeechRegion;
    const cogSvcSubKey = config.azureSpeechKey;
    
    console.log("Speech config - Region:", cogSvcRegion, "Key available:", !!cogSvcSubKey);
    
    // Validate configuration
    if (!validateSpeechConfig(cogSvcRegion, cogSvcSubKey)) {
        alert("Speech recognition configuration is invalid. Please check your Azure Speech Service credentials.");
        return;
    }

    // Ensure only one recognizer is active at a time
    if (speechRecognizer) {
        try {
            speechRecognizer.close();
        } catch (error) {
            console.error("Error closing existing speech recognizer: ", error);
        }
        speechRecognizer = null;
    }

    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    speechRecognitionConfig.speechRecognitionLanguage = "en-US"; // Force English only
    // Removed problematic properties to fix websocket error 1007
    
    console.log("Creating speech recognizer...");
    speechRecognizer = new SpeechSDK.SpeechRecognizer(
        speechRecognitionConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );
    
    console.log("Speech recognizer created successfully");

    speechRecognizer.recognizing = (s, e) => {
        console.log(`Recognizing: ${e.result.text}`);
    };

    speechRecognizer.recognized = (s, e) => {
        console.log("Recognition event fired, reason:", e.result.reason, "offset:", e.result.offset, "duration:", e.result.duration);
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            let text = e.result.text.trim();
            console.log(`Recognized: "${text}" (length: ${text.length})`);
            
            // Check if we actually have meaningful text
            if (!text || text.length === 0) {
                console.log("Empty text recognized, ignoring...");
                return;
            }
            
            // Clean up common speech recognition errors
            text = cleanupSpeechText(text);
            console.log(`Cleaned text: "${text}" (length: ${text.length})`);
            
            // Double-check after cleanup that we still have meaningful text
            if (!text || text.trim().length === 0) {
                console.log("Text became empty after cleanup, ignoring...");
                return;
            }

            // Send the user message to the GPT model (it will add the message to chat)
            sendMessageToGPT(text);
        } else if (e.result.reason === SpeechSDK.ResultReason.NoMatch) {
            console.log("No speech could be recognized.");
        } else if (e.result.reason === SpeechSDK.ResultReason.Canceled) {
            const cancellation = SpeechSDK.CancellationDetails.fromResult(e.result);
            console.error(`Speech recognition canceled: ${cancellation.errorDetails}`);
        }
    };

    // Add error handler for the speech recognizer
    speechRecognizer.sessionStarted = (s, e) => {
        console.log("Speech recognition session started");
    };

    speechRecognizer.sessionStopped = (s, e) => {
        console.log("Speech recognition session stopped");
    };

    speechRecognizer.speechStartDetected = (s, e) => {
        console.log("Speech start detected");
    };

    speechRecognizer.speechEndDetected = (s, e) => {
        console.log("Speech end detected - offset:", e.offset, "duration:", e.duration);
    };

    speechRecognizer.canceled = (s, e) => {
        console.error("Speech recognition canceled:", e.reason);
        console.error("Cancellation reason code:", e.reason);
        console.error("Error code:", e.errorCode);
        console.error("Error details:", e.errorDetails);
        
        if (e.reason === SpeechSDK.CancellationReason.Error) {
            console.error("Cancellation due to error. Error details:", e.errorDetails);
            console.error("Error code:", e.errorCode);
            
            // Common error scenarios
            if (e.errorDetails && e.errorDetails.includes("401")) {
                console.error("Authentication failed - check your Speech Service key");
                alert("Authentication failed. Please check your Azure Speech Service key.");
            } else if (e.errorDetails && e.errorDetails.includes("403")) {
                console.error("Access forbidden - check your Speech Service region and key");
                alert("Access forbidden. Please check your Azure Speech Service region and key.");
            } else if (e.errorDetails && e.errorDetails.includes("Connection")) {
                console.error("Connection issue - check internet connection");
                alert("Connection issue. Please check your internet connection.");
            } else {
                console.error("Unknown error:", e.errorDetails);
                alert(`Speech recognition error: ${e.errorDetails}`);
            }
        } else if (e.reason === SpeechSDK.CancellationReason.EndOfStream) {
            console.log("Speech recognition ended - end of stream");
        } else {
            console.error("Speech recognition canceled for unknown reason:", e.reason);
        }
    };

    console.log("Starting continuous recognition...");
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
                if (speechRecognizer) {
                    speechRecognizer.close();
                    speechRecognizer = null;
                }
            },
            err => {
                console.error("Failed to stop speech recognition: ", err);
                // Even if stopping fails, try to clean up
                if (speechRecognizer) {
                    try {
                        speechRecognizer.close();
                    } catch (closeError) {
                        console.error("Error closing speech recognizer: ", closeError);
                    }
                    speechRecognizer = null;
                }
            }
        );
    }
}

// =================== SEND MESSAGE TO GPT ===================
async function sendMessageToGPT(userMessage) {
    // Validate that we have a meaningful message
    if (!userMessage || userMessage.trim().length === 0) {
        console.log("Empty or whitespace-only message, not sending to GPT");
        return;
    }
    
    // Ensure the system prompt is in the messages if not already there
    if (messages.length === 0 || messages[0].role !== 'system') {
        if (config.systemPrompt) {
            messages.unshift({ role: 'system', content: config.systemPrompt });
        }
    }

    // Add the user message to the chat history
    addMessage('user', userMessage);

    // Check if this is a summary request - if so, don't use RAG
    const summaryKeywords = [
        'summary', 
        'summarize', 
        'what is this paper about', 
        'what is this document about', 
        'tell me about this document', 
        'what does this document say',
        'what is this about',
        'about this paper',
        'about this document',
        'overview',
        'what does this cover',
        'gib mir summary', // Common German mistranscription
        'give me summary',
        'stucki mit', // Common mistranscription of "document"
        'sumary', // Common misspelling
        'summery', // Common misspelling
        'zusammenfassung', // German word that might be picked up
        'document summary',
        'paper summary'
    ];
    const isSummaryRequest = summaryKeywords.some(keyword => 
        userMessage.toLowerCase().includes(keyword.toLowerCase())
    );

    // Prepare the request payload
    const requestPayload = {
        messages: messages.concat([{ role: 'user', content: userMessage }]),
        temperature: 0.7,
        max_tokens: 150,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
    };

    // Only add data sources for specific questions, not summaries
    if (!isSummaryRequest) {
        requestPayload.data_sources = dataSources;
    }

    console.log(`Request type: ${isSummaryRequest ? 'Summary' : 'Specific'}, Using RAG: ${!isSummaryRequest}`);

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
        let gptMessage = responseData.choices[0].message.content.trim();
        
        // Clean up document citations before processing
        gptMessage = cleanGPTResponse(gptMessage);
        
        console.log(`GPT: ${gptMessage}`);

        // If this was a summary request and we still got a RAG error, provide immediate fallback
        if (isSummaryRequest && gptMessage.includes("The requested information is not available in the retrieved data")) {
            console.log("Summary request got RAG error, providing direct summary");
            let directSummary = "";
            if (currentPrompt === 'four_gifts_prompt') {
                directSummary = "The Four Gifts is a document that explores four key principles or concepts that are meant to guide personal development and understanding. It presents these gifts as foundational elements for growth and wisdom.";
            } else if (currentPrompt === 'superintelligence_prompt') {
                directSummary = "Designing Safe SuperIntelligence is a document that addresses the critical challenges of developing artificial intelligence systems that surpass human cognitive abilities while ensuring they remain safe and aligned with human values. It explores strategies for governance, risk mitigation, and responsible development of superintelligent AI systems.";
            }
            if (directSummary) {
                addMessage('assistant', directSummary);
                await speakWithAvatar(directSummary);
                return;
            }
        }

        // Check for repeated error messages to prevent loops (only for non-summary requests)
        if (!isSummaryRequest && gptMessage.includes("The requested information is not available in the retrieved data")) {
            const lastMessages = messages.slice(-3); // Check last 3 messages
            const recentErrorCount = lastMessages.filter(msg => 
                msg.role === 'assistant' && 
                msg.content.includes("The requested information is not available in the retrieved data")
            ).length;
            
            if (recentErrorCount >= 2) {
                console.log("Detected repeated RAG errors, providing fallback response");
                const fallbackMessage = "I'm having trouble accessing the specific information right now. Could you try asking for a summary of the document instead, or rephrase your question?";
                addMessage('assistant', fallbackMessage);
                await speakWithAvatar(fallbackMessage);
                return;
            }
        }

        // Add the GPT message to the chat history
        addMessage('assistant', gptMessage);

        // Speak the GPT message using the avatar
        await speakWithAvatar(gptMessage);

    } catch (error) {
        console.error('Error communicating with GPT:', error);
        const errorMessage = 'Error communicating with GPT. Please try again later.';
        addMessage('assistant', errorMessage);
        await speakWithAvatar(errorMessage);
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

// =================== ERROR HANDLING ===================
window.addEventListener('error', (event) => {
    console.error('Global error caught:', event);
    alert('An unexpected error occurred. Please try again later.');
});

// Function to validate and debug speech configuration
function validateSpeechConfig(cogSvcRegion, cogSvcSubKey) {
    console.log("=== Speech Configuration Validation ===");
    console.log("Region:", cogSvcRegion);
    console.log("Key length:", cogSvcSubKey ? cogSvcSubKey.length : "undefined");
    console.log("Key starts with:", cogSvcSubKey ? cogSvcSubKey.substring(0, 8) + "..." : "undefined");
    
    // Check for common issues
    if (!cogSvcRegion || cogSvcRegion.trim() === '') {
        console.error("ERROR: Speech Service region is empty or undefined");
        return false;
    }
    
    if (!cogSvcSubKey || cogSvcSubKey.trim() === '') {
        console.error("ERROR: Speech Service key is empty or undefined");
        return false;
    }
    
    if (cogSvcSubKey.length !== 32) {
        console.warn("WARNING: Speech Service key length is not 32 characters (expected length)");
    }
    
    console.log("Configuration validation passed");
    return true;
}
