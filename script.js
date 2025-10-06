// Current state of the starting image
let currentImage = localStorage.getItem('current_image') || 'CircleStart.png';
document.getElementById('main-image').src = currentImage;

// Load or initialize history
let history = JSON.parse(localStorage.getItem('history') || '[]');

// Load or initialize prompt history
let promptHistory = JSON.parse(localStorage.getItem('prompt_history') || '[]');

// Backend API base: dynamic resolution with optional ?api= override
function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

let API_BASE = getQueryParam('api');
if (API_BASE) {
    try { API_BASE = decodeURIComponent(API_BASE); } catch (e) { /* leave as-is */ }
}

if (!API_BASE) {
    if (window.location.protocol.startsWith('http')) {
        const host = window.location.hostname;
        const proto = window.location.protocol;
        // If page is served from same PC, default to 127.0.0.1
        if (host === 'localhost' || host === '127.0.0.1') {
            API_BASE = 'http://127.0.0.1:65500';
        } else {
            // Assume backend runs on same host but port 65500
            API_BASE = `${proto}//${host}:65500`;
        }
    } else {
        // file:// case – assume backend on local machine by default
        API_BASE = 'http://127.0.0.1:65500';
    }
}
console.log('Using API_BASE =', API_BASE);

// Test connection to backend on load
async function testBackendConnection() {
    try {
        console.log('🧪 Testing backend connection...');
        const response = await fetch(`${API_BASE}/get-instructions-count`);
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Backend connected successfully. Instructions count:', data.count);
        } else {
            console.error('❌ Backend responded with error:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('❌ Cannot connect to backend:', error.message);
        console.error('❌ Check if backend is running on:', API_BASE);
    }
}

// Physical buttons state
let physicalButtonsEnabled = false;
let buttonCheckInterval = null;
let currentVariants = null;

// Voting system state - load from localStorage or default to 0
let variant1Votes = parseInt(localStorage.getItem('variant1Votes') || '0');
let variant2Votes = parseInt(localStorage.getItem('variant2Votes') || '0');
const VOTES_TO_WIN = 3;

// Setup physical buttons only - disable digital buttons
function setupPhysicalVoting() {
    console.log('Setting up physical button voting system');

    // Get buttons and disable their click handlers
    const btn1 = document.getElementById('choose-v1');
    const btn2 = document.getElementById('choose-v2');

    if (btn1) {
        btn1.onclick = null; // Disable digital clicking
        btn1.style.cursor = 'not-allowed';
        btn1.style.opacity = '0.6';
        btn1.textContent = `Physical Button 1: (${variant1Votes}/${VOTES_TO_WIN} votes)`;
        console.log('Digital button 1 disabled');
    }

    if (btn2) {
        btn2.onclick = null; // Disable digital clicking
        btn2.style.cursor = 'not-allowed';
        btn2.style.opacity = '0.6';
        btn2.textContent = `Physical Button 2: (${variant2Votes}/${VOTES_TO_WIN} votes)`;
        console.log('Digital button 2 disabled');
    }

    // Enable physical button monitoring
    checkPhysicalButtons();
    startPhysicalButtonMonitoring();
}

function getPrompt() {
    // Use the last selected variant as the new prompt, or the default if none
    return localStorage.getItem('current_image_prompt') || "Create a simple mutation of shape in the image with minimal design. Use solid colors and clean lines. The image should be very simple and minimal.";
}

async function generateTextVariants(prompt) {
    // Pass the current image URL so the backend can analyze it with Vision
    const currentImageUrl = localStorage.getItem('current_image') || 'CircleStart.png';
    const response = await fetch(`${API_BASE}/generate-text-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            history,
            imageUrl: currentImageUrl
        })
    });
    if (!response.ok) throw new Error('Error generating text');
    const data = await response.json();

    // Don't store text variants prompts - we only want final image generation prompts

    return data;
}

async function generateImage(prompt) {
    try {
        console.log('🔍 GENERATE_IMAGE: Starting with prompt:', prompt.substring(0, 100) + '...');

        // Use the current image (initial image for first iteration, user-selected image for subsequent iterations)
        const currentImageUrl = localStorage.getItem('current_image') || 'CircleStart.png';
        console.log('🔍 GENERATE_IMAGE: Using image:', currentImageUrl);

        const response = await fetch(`${API_BASE}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: currentImageUrl, prompt })
        });

        console.log('🔍 GENERATE_IMAGE: Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ GENERATE_IMAGE: HTTP Error:', response.status, errorText);
            throw new Error(`Error generating image: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log('🔍 GENERATE_IMAGE: Success, got data:', !!data.modifiedImageUrl);

        // Store only the final prompt sent to DALL-E for image generation
        if (data.debug_info) {
            addPromptToHistory('DALL-E Image Generation', {
                final_prompt_sent_to_dalle: data.debug_info.final_prompt,
                generated_image_url: data.modifiedImageUrl,
                variant_text: prompt
            });
        }

        return data;

    } catch (error) {
        console.error('❌ GENERATE_IMAGE ERROR:', error);
        console.error('❌ GENERATE_IMAGE ERROR message:', error.message);
        throw error; // Re-throw per farla gestire dal chiamante
    }
}

async function generateSummary(variantText, instruction) {
    try {
        console.log('🔍 SUMMARY: Generating summary for:', variantText.substring(0, 50) + '...');
        console.log('🔍 SUMMARY: With instruction:', instruction);

        const response = await fetch(`${API_BASE}/generate_summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variant_text: variantText,
                instruction: instruction
            })
        });

        if (!response.ok) {
            throw new Error('Error generating summary');
        }

        const data = await response.json();
        console.log('🔍 SUMMARY: Generated summary:', data.summary);
        return data.summary;

    } catch (error) {
        console.error('Error generating summary:', error);
        // Fallback: return original text truncated + instruction
        const truncated = variantText.substring(0, 150) + '...';
        return instruction ? `${truncated}\n\n ${instruction}` : truncated;
    }
}

async function generateReflection(prompt, history) {
    const response = await fetch(`${API_BASE}/generate-reflection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, history })
    });
    if (!response.ok) throw new Error('Error generating reflection');
    const data = await response.json();

    // Don't store reflection prompts - we only want final image generation prompts

    return data;
}

async function removeInstructionFromJSON(instruction) {
    try {
        const response = await fetch(`${API_BASE}/remove-instruction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction })
        });

        if (!response.ok) throw new Error('Error removing instruction');

        const data = await response.json();
        console.log('Instruction removal result:', data);

        // Get updated count
        const countResponse = await fetch(`${API_BASE}/get-instructions-count`);
        if (countResponse.ok) {
            const countData = await countResponse.json();
            console.log(`Instructions remaining: ${countData.count}`);
        }

        return data;
    } catch (error) {
        console.error('Error removing instruction:', error);
        return null;
    }
}

async function updateInstructionsCount() {
    try {
        const response = await fetch(`${API_BASE}/get-instructions-count`);
        if (response.ok) {
            const data = await response.json();
            console.log(`Instructions pool: ${data.count} remaining`);

            // Update UI if status div exists
            const statusDiv = document.getElementById('physical-button-status');
            if (statusDiv) {
                const countInfo = statusDiv.querySelector('.instructions-count') || document.createElement('div');
                countInfo.className = 'instructions-count';
                countInfo.textContent = `Instructions pool: ${data.count}`;
                countInfo.style.fontSize = '0.9em';
                countInfo.style.opacity = '0.8';
                countInfo.style.marginTop = '5px';

                if (!statusDiv.querySelector('.instructions-count')) {
                    statusDiv.appendChild(countInfo);
                }
            }

            return data.count;
        }
    } catch (error) {
        console.warn('⚠️ Backend not running - instructions count unavailable');
        return null;
    }
}


document.getElementById('start-btn').onclick = async function () {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.textContent = 'Generating variants...';
    document.getElementById('reflection').innerHTML = '';
    document.getElementById('gen-img-btn').style.display = 'none';
    document.getElementById('choose-variant').style.display = 'none';
    try {
        const data = await generateTextVariants(getPrompt());
        // Save the new prompts for the variants
        localStorage.setItem('variant1_text', data.variants[0]);
        localStorage.setItem('variant2_text', data.variants[1]);
        // Save the prompt used for this round
        localStorage.setItem('current_image_prompt', getPrompt());
        btn.textContent = 'Variants generated';

        // Start countdown for automatic image generation
        startImageGenerationCountdown();
    } catch (e) {
        btn.textContent = 'Error, try again';
        btn.disabled = false;
    }
};


document.getElementById('gen-img-btn').onclick = async function () {
    const btn = document.getElementById('gen-img-btn');
    btn.disabled = true;
    btn.textContent = 'Generating images...';
    document.getElementById('reflection').innerHTML = '';
    // Do NOT hide the choose-variant buttons here
    try {
        const variant1 = localStorage.getItem('variant1_text');
        const variant2 = localStorage.getItem('variant2_text');
        if (!variant1 || !variant2) throw new Error('Generate the variants first!');
        // Generate both images
        const [img1, img2] = await Promise.all([
            generateImage(variant1),
            generateImage(variant2)
        ]);

        // Extract instructions from the debug info
        const instruction1 = (img1.debug_info && img1.debug_info.random_instruction) ? img1.debug_info.random_instruction : '';
        const instruction2 = (img2.debug_info && img2.debug_info.random_instruction) ? img2.debug_info.random_instruction : '';

        console.log('🔍 MAIN: Instruction1:', instruction1);
        console.log('🔍 MAIN: Instruction2:', instruction2);

        // Generate summaries for both variants (parallel)
        const [summary1, summary2] = await Promise.all([
            generateSummary(variant1, instruction1),
            generateSummary(variant2, instruction2)
        ]);

        console.log('🔍 MAIN: Summary1:', summary1);
        console.log('🔍 MAIN: Summary2:', summary2);

        // Save images and summaries
        localStorage.setItem('variant1_img', img1.modifiedImageUrl);
        localStorage.setItem('variant2_img', img2.modifiedImageUrl);
        localStorage.setItem('variant1_text', summary1);  // Save the summary instead of original description
        localStorage.setItem('variant2_text', summary2);  // Save the summary instead of original description

        // Generate reflection
        const reflectionData = await generateReflection(getPrompt(), history);
        localStorage.setItem('reflection', reflectionData.reflection || '');
        document.getElementById('reflection').innerHTML = `<b>Reflection:</b><br>${reflectionData.reflection}`;
        btn.textContent = 'Images generated';
        btn.disabled = false; // <-- Re-enable the button after images are generated
        // Always show the choose-variant buttons after images are generated
        document.getElementById('choose-variant').style.display = 'block';

        // Setup physical voting system (disables digital buttons)
        setupPhysicalVoting();
    } catch (e) {
        console.error('❌ ERROR in generateImages (MAIN):', e);
        console.error('❌ ERROR stack:', e.stack);
        console.error('❌ ERROR message:', e.message);
        console.error('❌ ERROR name:', e.name);
        btn.textContent = 'Error, try again';
        btn.disabled = false;
    }
};

// Handle voting for variants - use event delegation to ensure clicks always work
function attachVoteHandlers() {
    const btn1 = document.getElementById('choose-v1');
    const btn2 = document.getElementById('choose-v2');

    if (btn1) {
        btn1.onclick = function () {
            console.log('Button 1 clicked!');
            voteForVariant(1);
            return false; // Prevent any default behavior
        };
        console.log('Vote handler attached to button 1');
    }
    if (btn2) {
        btn2.onclick = function () {
            console.log('Button 2 clicked!');
            voteForVariant(2);
            return false; // Prevent any default behavior
        };
        console.log('Vote handler attached to button 2');
    }
}

function voteForVariant(variantNumber) {
    console.log('🔵 DEBUG: voteForVariant called with:', variantNumber);
    console.log('🔵 DEBUG: Current votes before increment - V1:', variant1Votes, 'V2:', variant2Votes);

    if (variantNumber === 1) {
        variant1Votes++;
        localStorage.setItem('variant1Votes', variant1Votes.toString());
        console.log('🔵 DEBUG: Incremented V1 votes to:', variant1Votes);

        // Trigger animation on variant1 page
        triggerVoteAnimation(1);
    } else if (variantNumber === 2) {
        variant2Votes++;
        localStorage.setItem('variant2Votes', variant2Votes.toString());
        console.log('🔵 DEBUG: Incremented V2 votes to:', variant2Votes);

        // Trigger animation on variant2 page
        triggerVoteAnimation(2);
    }

    console.log('🔵 DEBUG: Final votes after increment - V1:', variant1Votes, 'V2:', variant2Votes);
    console.log('🔵 DEBUG: Calling updatePhysicalButtonDisplay()...');
    updatePhysicalButtonDisplay(); // Use physical button display

    // Check if we have a winner
    if (variant1Votes >= VOTES_TO_WIN) {
        console.log('🔵 DEBUG: Variant 1 reached', VOTES_TO_WIN, 'votes - calling selectWinningVariant(1)');
        selectWinningVariant(1);
    } else if (variant2Votes >= VOTES_TO_WIN) {
        console.log('🔵 DEBUG: Variant 2 reached', VOTES_TO_WIN, 'votes - calling selectWinningVariant(2)');
        selectWinningVariant(2);
    } else {
        console.log('🔵 DEBUG: No winner yet. Need', VOTES_TO_WIN, 'votes.');
    }
} async function selectWinningVariant(variantNumber) {
    console.log(`Variant ${variantNumber} wins with ${variantNumber === 1 ? variant1Votes : variant2Votes} votes!`);

    const imgKey = `variant${variantNumber}_img`;
    const promptKey = `variant${variantNumber}_text`;
    const img = localStorage.getItem(imgKey);
    const prompt = localStorage.getItem(promptKey);

    if (img && prompt) {
        // Remove the instruction of the losing variant from JSON
        const losingVariantNumber = variantNumber === 1 ? 2 : 1;
        const losingInstructionKey = `variant${losingVariantNumber}_instruction`;
        const losingInstruction = localStorage.getItem(losingInstructionKey);

        if (losingInstruction) {
            console.log(`Removing losing instruction: ${losingInstruction}`);
            await removeInstructionFromJSON(losingInstruction);
            await updateInstructionsCount(); // Update the count display
        }

        localStorage.setItem('current_image', img);
        document.getElementById('main-image').src = img;
        // Update history
        history.push(prompt);
        localStorage.setItem('history', JSON.stringify(history));
        // Set the prompt for the next round
        localStorage.setItem('current_image_prompt', prompt);

        // Show winner message briefly
        showWinnerMessage(variantNumber);

        // Reset for next cycle after a short delay
        setTimeout(() => {
            resetForNextCycle();
            // Start automatic variant generation after 5 seconds
            startVariantGenerationCountdown();
        }, 2000);
    }
}

function updateVoteDisplay() {
    console.log('updateVoteDisplay called');
    const btn1 = document.getElementById('choose-v1');
    const btn2 = document.getElementById('choose-v2');

    console.log('Button 1 found:', !!btn1, 'Button 2 found:', !!btn2);

    if (btn1) {
        const oldText = btn1.textContent;
        btn1.textContent = `Choose Variant 1 (${variant1Votes}/${VOTES_TO_WIN} votes)`;
        console.log('Button 1 text changed from:', oldText, 'to:', btn1.textContent);

        // Use a less intrusive styling approach
        const progress1 = (variant1Votes / VOTES_TO_WIN) * 100;
        if (progress1 > 0) {
            btn1.style.boxShadow = `inset ${progress1 * 2}px 0 0 #28a745`;
        } else {
            btn1.style.boxShadow = '';
        }
    } else {
        console.log('Button 1 not found!');
    }

    if (btn2) {
        const oldText = btn2.textContent;
        btn2.textContent = `Choose Variant 2 (${variant2Votes}/${VOTES_TO_WIN} votes)`;
        console.log('Button 2 text changed from:', oldText, 'to:', btn2.textContent);

        // Use a less intrusive styling approach
        const progress2 = (variant2Votes / VOTES_TO_WIN) * 100;
        if (progress2 > 0) {
            btn2.style.boxShadow = `inset ${progress2 * 2}px 0 0 #28a745`;
        } else {
            btn2.style.boxShadow = '';
        }
    } else {
        console.log('Button 2 not found!');
    }

    console.log(`Vote display updated: V1=${variant1Votes}, V2=${variant2Votes}`);
}

// Update button display for physical buttons
function updatePhysicalButtonDisplay() {
    console.log('updatePhysicalButtonDisplay called');
    const btn1 = document.getElementById('choose-v1');
    const btn2 = document.getElementById('choose-v2');

    if (btn1) {
        btn1.textContent = `Physical Button 1: (${variant1Votes}/${VOTES_TO_WIN} votes)`;

        // Progress bar for physical buttons
        const progress1 = (variant1Votes / VOTES_TO_WIN) * 100;
        if (progress1 > 0) {
            btn1.style.background = `linear-gradient(to right, #28a745 ${progress1}%, #f8f9fa ${progress1}%)`;
        } else {
            btn1.style.background = '#f8f9fa';
        }

        console.log('Physical button 1 display updated:', btn1.textContent);
    }

    if (btn2) {
        btn2.textContent = `Physical Button 2: (${variant2Votes}/${VOTES_TO_WIN} votes)`;

        // Progress bar for physical buttons
        const progress2 = (variant2Votes / VOTES_TO_WIN) * 100;
        if (progress2 > 0) {
            btn2.style.background = `linear-gradient(to right, #17a2b8 ${progress2}%, #f8f9fa ${progress2}%)`;
        } else {
            btn2.style.background = '#f8f9fa';
        }

        console.log('Physical button 2 display updated:', btn2.textContent);
    }

    console.log(`Physical buttons updated: V1=${variant1Votes}, V2=${variant2Votes}`);
}

// Function to trigger vote animation on variant pages
function triggerVoteAnimation(variantNumber) {
    console.log('🎯 DEBUG: Triggering vote animation for variant', variantNumber);

    // Method 1: Use localStorage trigger (works across tabs/windows)
    const triggerKey = `variant${variantNumber}_vote_trigger`;
    localStorage.setItem(triggerKey, Date.now().toString());

    // Method 2: Try to communicate with any open variant windows
    try {
        // Send message to all windows
        if (window.postMessage) {
            window.postMessage({
                type: `variant${variantNumber}_vote`,
                timestamp: Date.now()
            }, '*');
        }

        // Also try to access variant windows directly if they exist
        const variantWindows = window.frames;
        for (let i = 0; i < variantWindows.length; i++) {
            try {
                variantWindows[i].postMessage({
                    type: `variant${variantNumber}_vote`,
                    timestamp: Date.now()
                }, '*');
            } catch (e) {
                // Cross-origin access might be blocked, ignore
            }
        }

        console.log('🎯 DEBUG: Vote animation trigger sent');
    } catch (error) {
        console.log('🎯 DEBUG: Error sending vote animation trigger:', error);
    }
}

function showWinnerMessage(variantNumber) {
    const statusDiv = document.getElementById('physical-button-status');
    if (statusDiv) {
        statusDiv.innerHTML = `🎉 Variant ${variantNumber} WINS with ${variantNumber === 1 ? variant1Votes : variant2Votes} votes!`;
        statusDiv.style.background = '#d4edda';
        statusDiv.style.color = '#155724';
    } else {
        // Create temporary winner message if no status div exists
        const winnerDiv = document.createElement('div');
        winnerDiv.id = 'winner-message';
        winnerDiv.style.cssText = `
            margin-top: 15px;
            padding: 12px;
            border-radius: 6px;
            font-size: 1.1em;
            text-align: center;
            background: #d4edda;
            color: #155724;
            font-weight: bold;
        `;
        winnerDiv.innerHTML = `🎉 Variant ${variantNumber} WINS with ${variantNumber === 1 ? variant1Votes : variant2Votes} votes!`;
        document.querySelector('.start-card').appendChild(winnerDiv);

        // Remove winner message after delay
        setTimeout(() => {
            const msg = document.getElementById('winner-message');
            if (msg) msg.remove();
        }, 3000);
    }
}
function resetForNextCycle() {
    // Clear variants, images, descriptions, reflection, but keep current_image, history, and current_image_prompt
    localStorage.removeItem('variant1_text');
    localStorage.removeItem('variant2_text');
    localStorage.removeItem('variant1_text_with_instruction');
    localStorage.removeItem('variant2_text_with_instruction');
    localStorage.removeItem('variant1_img');
    localStorage.removeItem('variant2_img');
    localStorage.removeItem('variant1_desc');
    localStorage.removeItem('variant2_desc');
    localStorage.removeItem('variant1_instruction');
    localStorage.removeItem('variant2_instruction');
    localStorage.removeItem('reflection');

    // Reset vote counters and save to localStorage
    variant1Votes = 0;
    variant2Votes = 0;
    localStorage.setItem('variant1Votes', '0');
    localStorage.setItem('variant2Votes', '0');

    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').textContent = 'Generate Variants';
    document.getElementById('gen-img-btn').style.display = 'none';
    // Hide the choose-variant buttons ONLY after a choice is made
    document.getElementById('choose-variant').style.display = 'none';
    document.getElementById('reflection').innerHTML = '';

    // Stop physical button monitoring when cycle resets
    stopPhysicalButtonMonitoring();
}

// Start countdown for automatic image generation
function startImageGenerationCountdown() {
    let countdown = 10;
    const genImgBtn = document.getElementById('gen-img-btn');
    genImgBtn.style.display = 'inline-block';
    genImgBtn.disabled = true;

    const countdownInterval = setInterval(() => {
        genImgBtn.textContent = `Generating images in ${countdown}s`;
        countdown--;

        if (countdown < 0) {
            clearInterval(countdownInterval);
            // Automatically trigger image generation
            generateImagesAutomatically();
        }
    }, 1000);
}

// Automatically generate images without user click
async function generateImagesAutomatically() {
    const btn = document.getElementById('gen-img-btn');
    btn.disabled = true;
    btn.textContent = 'Generating images...';
    document.getElementById('reflection').innerHTML = '';

    try {
        const variant1 = localStorage.getItem('variant1_text');
        const variant2 = localStorage.getItem('variant2_text');
        if (!variant1 || !variant2) throw new Error('Generate the variants first!');

        // Generate both images
        const [img1, img2] = await Promise.all([
            generateImage(variant1),
            generateImage(variant2)
        ]);

        // Extract instructions from the debug info
        const instruction1 = (img1.debug_info && img1.debug_info.random_instruction) ? img1.debug_info.random_instruction : '';
        const instruction2 = (img2.debug_info && img2.debug_info.random_instruction) ? img2.debug_info.random_instruction : '';

        console.log('🔍 AUTO: Instruction1:', instruction1);
        console.log('🔍 AUTO: Instruction2:', instruction2);

        // Generate summaries for both variants (parallel)
        const [summary1, summary2] = await Promise.all([
            generateSummary(variant1, instruction1),
            generateSummary(variant2, instruction2)
        ]);

        console.log('🔍 AUTO: Summary1:', summary1);
        console.log('🔍 AUTO: Summary2:', summary2);

        // Save images and summaries
        localStorage.setItem('variant1_img', img1.modifiedImageUrl);
        localStorage.setItem('variant2_img', img2.modifiedImageUrl);
        localStorage.setItem('variant1_text', summary1);  // Save the summary instead of original description
        localStorage.setItem('variant2_text', summary2);  // Save the summary instead of original description

        // Generate reflection
        const reflectionData = await generateReflection(getPrompt(), history);
        localStorage.setItem('reflection', reflectionData.reflection || '');
        document.getElementById('reflection').innerHTML = `<b>Reflection:</b><br>${reflectionData.reflection}`;
        btn.textContent = 'Images generated';
        btn.disabled = false;
        // Always show the choose-variant buttons after images are generated
        document.getElementById('choose-variant').style.display = 'block';

        // Setup physical voting system (disables digital buttons)
        setupPhysicalVoting();
    } catch (e) {
        btn.textContent = 'Error, try again';
        btn.disabled = false;
    }
}

// Start countdown for automatic variant generation
function startVariantGenerationCountdown() {
    let countdown = 5;
    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;

    const countdownInterval = setInterval(() => {
        startBtn.textContent = `Generating variants in ${countdown}s`;
        countdown--;

        if (countdown < 0) {
            clearInterval(countdownInterval);
            // Automatically trigger variant generation
            generateVariantsAutomatically();
        }
    }, 1000);
}

// Automatically generate variants without user click
async function generateVariantsAutomatically() {
    const btn = document.getElementById('start-btn');
    btn.disabled = true;
    btn.textContent = 'Generating variants...';
    document.getElementById('reflection').innerHTML = '';
    document.getElementById('gen-img-btn').style.display = 'none';
    document.getElementById('choose-variant').style.display = 'none';
    try {
        const data = await generateTextVariants(getPrompt());
        // Save the new prompts for the variants
        localStorage.setItem('variant1_text', data.variants[0]);
        localStorage.setItem('variant2_text', data.variants[1]);
        // Save the prompt used for this round
        localStorage.setItem('current_image_prompt', getPrompt());
        btn.textContent = 'Variants generated';

        // Start countdown for automatic image generation
        startImageGenerationCountdown();
    } catch (e) {
        btn.textContent = 'Error, try again';
        btn.disabled = false;
    }
}

// Reset everything to the initial state
// Function to add prompt to history
function addPromptToHistory(type, promptData) {
    const entry = {
        timestamp: new Date().toLocaleString(),
        type: type,
        data: promptData
    };

    promptHistory.push(entry);
    localStorage.setItem('prompt_history', JSON.stringify(promptHistory));

    // Show the prompt history section if not visible
    document.getElementById('prompt-history').style.display = 'block';

    // Update the display only if we have pairs of entries (both variants generated)
    if (promptHistory.length % 2 === 0) {
        updatePromptHistoryDisplay();
    }
}

// Function to update the prompt history display
function updatePromptHistoryDisplay() {
    const entriesContainer = document.getElementById('prompt-entries');
    entriesContainer.innerHTML = '';

    // Group entries by generation session (every 2 consecutive DALL-E entries are from the same session)
    const sessions = [];
    for (let i = 0; i < promptHistory.length; i += 2) {
        if (i + 1 < promptHistory.length) {
            sessions.push([promptHistory[i], promptHistory[i + 1]]);
        } else {
            sessions.push([promptHistory[i]]);
        }
    }

    sessions.forEach((sessionEntries, sessionIndex) => {
        // Create iteration header
        const iterationHeaderDiv = document.createElement('div');
        iterationHeaderDiv.innerHTML = `
            <div style="font-weight: bold; font-size: 1.2em; color: #2a3a4b; margin: 30px 0 20px 0; text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
                Iteration #${sessionIndex + 1} - ${sessionEntries[0].timestamp}
            </div>
        `;
        entriesContainer.appendChild(iterationHeaderDiv);

        // Get the current user history to determine which images were chosen
        const currentHistory = JSON.parse(localStorage.getItem('history') || '[]');

        // Create separate entries for each variant
        sessionEntries.forEach((entry, variantIndex) => {
            if (entry.data.generated_image_url) {
                const variantDiv = document.createElement('div');
                variantDiv.className = 'prompt-entry';

                // Check if this variant was chosen by comparing with history
                const wasChosen = currentHistory.includes(entry.data.variant_text);
                const choiceClass = wasChosen ? 'chosen' : 'not-chosen';

                const variantContent = `
                    <div class="prompt-entry-main">
                        <div class="prompt-entry-header">
                            <span>Variant ${variantIndex + 1}</span>
                            <span class="prompt-entry-type">DALL-E Prompt</span>
                            <span class="prompt-entry-timestamp">${wasChosen ? '✅ CHOSEN' : '❌ Not chosen'}</span>
                        </div>
                        <div class="prompt-entry-content">${entry.data.final_prompt_sent_to_dalle}</div>
                    </div>
                    <div class="prompt-entry-images">
                        <div class="prompt-entry-image">
                            <img src="${entry.data.generated_image_url}" alt="Generated Image ${variantIndex + 1}">
                            <div class="choice-indicator ${choiceClass}"></div>
                            <div class="variant-label">Variant ${variantIndex + 1}</div>
                        </div>
                    </div>
                `;

                variantDiv.innerHTML = variantContent;
                entriesContainer.appendChild(variantDiv);
            }
        });
    });
}// Function to toggle prompt history visibility
function togglePromptHistory() {
    const content = document.getElementById('prompt-history-content');
    const button = document.getElementById('toggle-history-btn');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        button.textContent = 'Hide History';
        updatePromptHistoryDisplay();
    } else {
        content.style.display = 'none';
        button.textContent = 'Show History';
    }
}

function resetToStart() {
    localStorage.clear();
    history = [];
    promptHistory = [];
    variant1Votes = 0;
    variant2Votes = 0;
    document.getElementById('main-image').src = 'CircleStart.png';
    document.getElementById('start-btn').disabled = false;
    document.getElementById('start-btn').textContent = 'Generate Variants';
    document.getElementById('gen-img-btn').style.display = 'none';
    document.getElementById('choose-variant').style.display = 'none';
    document.getElementById('reflection').innerHTML = '';
    document.getElementById('prompt-history').style.display = 'none';
    document.getElementById('prompt-entries').innerHTML = '';
}

// On load, show the current image and button states
window.onload = function () {
    const img = localStorage.getItem('current_image') || 'CircleStart.png';
    document.getElementById('main-image').src = img;
    const v1 = localStorage.getItem('variant1_text');
    const v2 = localStorage.getItem('variant2_text');
    const r = localStorage.getItem('reflection');
    const img1 = localStorage.getItem('variant1_img');
    const img2 = localStorage.getItem('variant2_img');
    // Load history from localStorage
    history = JSON.parse(localStorage.getItem('history') || '[]');
    // Load prompt history from localStorage
    promptHistory = JSON.parse(localStorage.getItem('prompt_history') || '[]');
    // Load vote counts from localStorage
    variant1Votes = parseInt(localStorage.getItem('variant1Votes') || '0');
    variant2Votes = parseInt(localStorage.getItem('variant2Votes') || '0');

    // Show prompt history section if there are entries
    if (promptHistory.length > 0) {
        document.getElementById('prompt-history').style.display = 'block';
        updatePromptHistoryDisplay();
    }

    // Test backend connection first
    testBackendConnection();

    // Update instructions count on load
    updateInstructionsCount();

    if (v1 && v2) {
        document.getElementById('gen-img-btn').style.display = 'inline-block';
        currentVariants = { variant1: v1, variant2: v2 };
    }
    if (img1 && img2) {
        document.getElementById('choose-variant').style.display = 'block';

        // Attach vote handlers and initialize vote display
        attachVoteHandlers();
        updateVoteDisplay();

        // Setup physical voting system (disables digital buttons)
        setupPhysicalVoting();
    }
    if (r) {
        document.getElementById('reflection').innerHTML = `<b>Reflection:</b><br>${r}`;
    }
};

// =========================
// PHYSICAL BUTTONS FUNCTIONS
// =========================
async function checkPhysicalButtons() {
    console.log('🟠 DEBUG: checkPhysicalButtons called');
    console.log('🟠 DEBUG: Checking status at:', `${API_BASE}/button-status`);

    try {
        const response = await fetch(`${API_BASE}/button-status`);
        console.log('🟠 DEBUG: Status response:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('🟠 DEBUG: Status data:', data);
            physicalButtonsEnabled = data.physical_buttons_enabled;
            console.log('🟠 DEBUG: Physical buttons enabled:', physicalButtonsEnabled);

            if (physicalButtonsEnabled) {
                showPhysicalButtonStatus(true);
                console.log('🟠 DEBUG: Physical buttons detected and enabled');
            } else {
                console.log('🟠 DEBUG: Physical buttons disabled in backend');
                showPhysicalButtonStatus(false);
            }
        } else {
            console.log('🟠 DEBUG: Status response not ok');
            physicalButtonsEnabled = false;
            showPhysicalButtonStatus(false);
        }
    } catch (error) {
        console.error('🟠 DEBUG: Physical buttons not available:', error);
        physicalButtonsEnabled = false;
        showPhysicalButtonStatus(false);
    }
}

function showPhysicalButtonStatus(enabled) {
    // Create or update physical button status indicator
    let statusDiv = document.getElementById('physical-button-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'physical-button-status';
        statusDiv.style.cssText = `
            margin-top: 15px;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 0.9em;
            text-align: center;
        `;
        document.querySelector('.start-card').appendChild(statusDiv);
    }

    if (enabled) {
        statusDiv.innerHTML = '🟢 Physical buttons active - Use hardware buttons to choose';
        statusDiv.style.background = '#d4edda';
        statusDiv.style.color = '#155724';

        // Dim digital buttons when physical ones are active, and append a non-destructive hint
        const digitalButtons = document.getElementById('choose-variant');
        if (digitalButtons) {
            digitalButtons.style.opacity = '0.5';
            let hint = document.getElementById('physical-buttons-hint');
            if (!hint) {
                hint = document.createElement('small');
                hint.id = 'physical-buttons-hint';
                hint.style.color = '#666';
                hint.style.display = 'block';
                hint.style.marginTop = '6px';
                hint.textContent = 'Use physical buttons instead';
                digitalButtons.appendChild(hint);
            }
        }
    } else {
        statusDiv.innerHTML = '🔴 Physical buttons not available - Use digital buttons';
        statusDiv.style.background = '#f8d7da';
        statusDiv.style.color = '#721c24';
    }
}

function startPhysicalButtonMonitoring() {
    console.log('🔴 DEBUG: Starting physical button monitoring...');
    console.log('🔴 DEBUG: API_BASE =', API_BASE);

    // Stop any previous monitoring
    if (buttonCheckInterval) {
        clearInterval(buttonCheckInterval);
        console.log('🔴 DEBUG: Cleared previous monitoring interval');
    }

    // Check for button presses every 2 seconds (increased for better debugging)
    buttonCheckInterval = setInterval(async () => {
        try {
            console.log('🔴 DEBUG: Checking for button presses...');
            const response = await fetch(`${API_BASE}/check-button-press`);
            console.log('🔴 DEBUG: Response status:', response.status);

            if (response.ok) {
                const data = await response.json();
                console.log('🔴 DEBUG: Response data:', data);

                if (data.button_pressed) {
                    console.log(`🔴 DEBUG: Physical button ${data.button} pressed - calling handler`);
                    handlePhysicalButtonPress(data.button);

                    // DON'T stop monitoring - continue voting
                    console.log('🔴 DEBUG: Continuing monitoring for more votes...');
                } else {
                    console.log('🔴 DEBUG: No button press detected');
                }
            } else {
                console.log('🔴 DEBUG: Response not ok:', response.status);
            }
        } catch (error) {
            console.error('🔴 DEBUG: Error checking physical button press:', error);
        }
    }, 2000);

    console.log('🔴 DEBUG: Physical button monitoring started with interval ID:', buttonCheckInterval);
}

function handlePhysicalButtonPress(buttonNumber) {
    console.log('🟡 DEBUG: handlePhysicalButtonPress called with:', buttonNumber);

    const b = Number(buttonNumber);
    console.log('🟡 DEBUG: Button number converted to:', b);

    // Simulate click of corresponding digital button
    if (b === 1) {
        console.log('🟡 DEBUG: Physical button 1 -> calling chooseVariant(1)');
        chooseVariant(1);
    } else if (b === 2) {
        console.log('🟡 DEBUG: Physical button 2 -> calling chooseVariant(2)');
        chooseVariant(2);
    } else {
        console.warn('🟡 DEBUG: Unknown button number received:', buttonNumber);
    }

    // Update status
    const statusDiv = document.getElementById('physical-button-status');
    if (statusDiv) {
        const currentVotes = buttonNumber === 1 ? variant1Votes : variant2Votes;
        console.log('🟡 DEBUG: Updating status - current votes for button', buttonNumber, ':', currentVotes);
        statusDiv.innerHTML = `✅ Physical Button ${buttonNumber} voted! (${currentVotes}/${VOTES_TO_WIN} votes)`;
        statusDiv.style.background = '#d1ecf1';
        statusDiv.style.color = '#0c5460';
    } else {
        console.log('🟡 DEBUG: Status div not found');
    }
}

function stopPhysicalButtonMonitoring() {
    if (buttonCheckInterval) {
        clearInterval(buttonCheckInterval);
        buttonCheckInterval = null;
        console.log('Physical button monitoring stopped');
    }
}

// Helper function for physical buttons - now triggers voting instead of immediate selection
function chooseVariant(variantNumber) {
    console.log('🟢 DEBUG: chooseVariant called with:', variantNumber);

    if (variantNumber === 1) {
        console.log('🟢 DEBUG: Voting for Variant 1 via physical button - calling voteForVariant(1)');
        voteForVariant(1);
    } else if (variantNumber === 2) {
        console.log('🟢 DEBUG: Voting for Variant 2 via physical button - calling voteForVariant(2)');
        voteForVariant(2);
    } else {
        console.log('🟢 DEBUG: Invalid variant number:', variantNumber);
    }
}