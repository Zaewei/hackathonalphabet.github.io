// --- STATE AND LANDMARK CONSTANTS ---
        
// Indices for the 21 landmarks provided by MediaPipe
const LANDMARK_INDICES = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_PIP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// Array mappings for easier iteration
const THUMB = [LANDMARK_INDICES.THUMB_CMC, LANDMARK_INDICES.THUMB_MCP, LANDMARK_INDICES.THUMB_PIP, LANDMARK_INDICES.THUMB_TIP];
const INDEX_FINGER = [LANDMARK_INDICES.INDEX_MCP, LANDMARK_INDICES.INDEX_PIP, LANDMARK_INDICES.INDEX_DIP, LANDMARK_INDICES.INDEX_TIP];
const MIDDLE_FINGER = [LANDMARK_INDICES.MIDDLE_MCP, LANDMARK_INDICES.MIDDLE_PIP, LANDMARK_INDICES.MIDDLE_DIP, LANDMARK_INDICES.MIDDLE_TIP];
const RING_FINGER = [LANDMARK_INDICES.RING_MCP, LANDMARK_INDICES.RING_PIP, LANDMARK_INDICES.RING_DIP, LANDMARK_INDICES.RING_TIP];
const PINKY_FINGER = [LANDMARK_INDICES.PINKY_MCP, LANDMARK_INDICES.PINKY_PIP, LANDMARK_INDICES.PINKY_DIP, LANDMARK_INDICES.PINKY_TIP];

// --- TRANSLATION STATE ---
let currentTranslation = '';
let lastSign = '?';
let stabilityCount = 0;
const STABILITY_THRESHOLD = 20; // Number of frames a sign must be held before being "typed"

// Get DOM elements
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const canvasCtx = canvasElement ? canvasElement.getContext('2d') : null;
const resultElement = document.getElementById('result');
const statusElement = document.getElementById('status');
const translationTextElement = document.getElementById('translationText');

/**
 * Clears the translation text in the UI and the JavaScript state.
 */
window.clearTranslation = function() {
    currentTranslation = '';
    if (translationTextElement) {
        translationTextElement.textContent = '';
    }
    lastSign = '?';
    stabilityCount = 0;
    statusElement.textContent = 'Translation Cleared.';
}

// --- CORE UTILITY FUNCTIONS ---

/**
 * Calculates the Euclidean distance between two landmark points (normalized coordinates).
 */
const distance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
};

/**
 * Checks if a specific finger is extended (straight).
 * Uses Y-axis position for non-thumb fingers (tip must be "above" PIP and MCP) 
 * and segment ratio/Z-axis for the thumb.
 */
const isExtended = (landmarks, finger) => {
    const mcp = landmarks[finger[0]];
    const pip = landmarks[finger[1]];
    const tip = landmarks[finger[3]];

    // THUMB SPECIFIC CHECK
    if (finger === THUMB) {
        // Ensure tip is closer to the camera (extended forward, smaller Z-coordinate)
        const isTipForward = tip.z < mcp.z; 
        
        // Ensure the distance from CMC to Tip is substantially greater than CMC to MCP
        const distFromCmcToTip = distance(landmarks[THUMB[0]], tip);
        const distFromCmcToMcp = distance(landmarks[THUMB[0]], mcp);

        return distFromCmcToTip > distFromCmcToMcp * 1.5 && isTipForward;
    }

    // For non-thumb fingers (Index, Middle, Ring, Pinky): 
    // Check if the Tip's Y coordinate is less than (above) the PIP and MCP Y coordinates.
    // NOTE: Y-axis is typically 0 at the top, increasing downwards.
    const isTipAbovePip = pip.y > tip.y;
    const isTipAboveMcp = mcp.y > tip.y;
    
    return isTipAbovePip && isTipAboveMcp;
};

/**
 * Classifies the detected hand landmarks into one of the target signs (A, B, C, F, L).
 */
const classifyLetterGesture = (landmarks) => {
    if (!landmarks || landmarks.length === 0) return '?';
    
    // 1. Get states for all 5 fingers
    const thumbExtended = isExtended(landmarks, THUMB);
    const indexExtended = isExtended(landmarks, INDEX_FINGER);
    const middleExtended = isExtended(landmarks, MIDDLE_FINGER);
    const ringExtended = isExtended(landmarks, RING_FINGER);
    const pinkyExtended = isExtended(landmarks, PINKY_FINGER);

    // 2. Curled state (opposite of extended for non-thumb)
    const indexCurled = !indexExtended;
    const middleCurled = !middleExtended;
    const ringCurled = !ringExtended;
    const pinkyCurled = !pinkyExtended;

    // Helper counts and distances
    const allCurled = indexCurled && middleCurled && ringCurled && pinkyCurled;
    const fourFingersExtended = indexExtended && middleExtended && ringExtended && pinkyExtended;
    const handSize = distance(landmarks[LANDMARK_INDICES.WRIST], landmarks[LANDMARK_INDICES.PINKY_MCP]);
    
    // Distance between Index and Pinky Tips (used for 'C' and 'A' differentiation)
    const tipDist = distance(landmarks[LANDMARK_INDICES.INDEX_TIP], landmarks[LANDMARK_INDICES.PINKY_TIP]);

    // --- CLASSIFICATION LOGIC ---

    // L: Thumb and Index extended, all others curled.
    if (thumbExtended && indexExtended && middleCurled && ringCurled && pinkyCurled) {
        return 'L';
    }

    // F: Index tip and thumb tip close (O-pinch), others extended.
    const pinchDistanceF = distance(landmarks[LANDMARK_INDICES.THUMB_TIP], landmarks[LANDMARK_INDICES.INDEX_TIP]);

    if (pinchDistanceF < 0.08 && middleExtended && ringExtended && pinkyExtended) {
        return 'F';
    }
    
    // B (Flat Hand) - Fixed
    // Logic: Four fingers extended AND the thumb tip is tucked close to the Index MCP (base)
    if (fourFingersExtended) {
        const thumbTipB = landmarks[LANDMARK_INDICES.THUMB_TIP];
        const indexMcpB = landmarks[LANDMARK_INDICES.INDEX_MCP];
        
        // Tucked check: Distance between thumb tip and index MCP must be small.
        const tuckedDist = distance(thumbTipB, indexMcpB);
        
        // Normalized threshold (tuckedDist should be less than 25% of the hand size)
        if (tuckedDist < handSize * 0.25) { 
            return 'B';
        }
    }

    // C (Arc Hand) - FIX APPLIED HERE
    // Logic: All fingers curled, but the arc must be wide (tips far apart).
    if (allCurled) { 
        // 1. Arc Width Check: Distance between index and pinky tips must be sufficiently large.
        // Adjusted from 0.6 to 0.5 to allow for slightly tighter 'C's.
        if (tipDist > handSize * 0.5) { 
            // 2. Thumb Position Check: Ensure the thumb is not pressed tightly into the palm like a closed fist 'A'.
            const thumbTipDistToIndexBase = distance(landmarks[LANDMARK_INDICES.THUMB_TIP], landmarks[LANDMARK_INDICES.INDEX_MCP]);
            
            // If thumb tip is relatively far from the index base (not pressing hard into palm)
            // Increased the threshold from 0.1 to 0.15 for better separation from 'A'.
            if (thumbTipDistToIndexBase > handSize * 0.15) { 
                 return 'C';
            }
        }
    }

    // A (Fist): Standard closed fist. Final fallback for allCurled.
    if (allCurled) {
        // If it failed the generous 'C' check, it is likely a tight fist 'A'.
        return 'A'; 
    }
    
    return '?'; // Default to unknown
};

// --- MEDIA PIPE AND CAMERA SETUP ---

/**
 * Handles the results received from MediaPipe Hands.
 */
function onResults(results) {
    if (!canvasCtx || !canvasElement || !resultElement || !statusElement || !translationTextElement) {
        return;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Flip the image horizontally (mirror effect)
    canvasCtx.scale(-1, 1);
    canvasCtx.translate(-canvasElement.width, 0);

    // Draw the video frame
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    let classifiedSign = '?'; 
    let detectedHands = 0;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        detectedHands = results.multiHandLandmarks.length;
        
        // Focus on the first detected hand for single-letter translation
        const landmarks = results.multiHandLandmarks[0];
        
        // Draw the landmarks on the canvas
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
        drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 2 });
        
        // CLASSIFY THE GESTURE
        classifiedSign = classifyLetterGesture(landmarks);
        
        // --- TRANSLATION DEBOUNCE LOGIC ---
        if (classifiedSign !== '?' && classifiedSign === lastSign) {
            stabilityCount++;
            if (stabilityCount === STABILITY_THRESHOLD) {
                currentTranslation += classifiedSign;
                translationTextElement.textContent = currentTranslation;
                stabilityCount = 1; // Keep high to show stability, but prevent rapid spam
                statusElement.textContent = `Sign Committed: '${classifiedSign}'`;
            }
        } else if (classifiedSign !== lastSign) {
            lastSign = classifiedSign;
            stabilityCount = 0;
            statusElement.textContent = `Sign changed to: ${classifiedSign}. Holding...`;
        }

    } else {
        // If no hand detected, reset stability
        lastSign = '?';
        stabilityCount = 0;
    }
    
    resultElement.textContent = classifiedSign;
    if (detectedHands === 0) {
        statusElement.textContent = 'No Hand Detected. Please show your hand.';
    } else if (detectedHands > 1) {
        statusElement.textContent = `Warning: Detected ${detectedHands} hands. Focusing on the first one.`;
    }

    canvasCtx.restore();
}

/**
 * Initializes and starts the MediaPipe Hands model.
 */
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 2, 
    modelComplexity: 1, 
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

/**
 * Sets up the camera stream and connects it to MediaPipe.
 */
const camera = new Camera(videoElement, {
    onFrame: async () => {
        if (videoElement.readyState >= 3) {
            // Check if hands is initialized before sending image
            if (hands && hands.send) {
                await hands.send({ image: videoElement });
            }
        }
    },
    width: 1280,
    height: 720
});

// Update status before camera starts
if (statusElement) {
    statusElement.textContent = 'Starting Camera...';
}

// Wait for the window to load before starting the camera
window.onload = function() {
    if (!videoElement) {
        console.error("Video element not found. Cannot start camera.");
        if (statusElement) statusElement.textContent = 'ERROR: Video element missing.';
        return;
    }
    
    camera.start()
        .then(() => {
            if (statusElement) statusElement.textContent = 'Hand Model Loaded. Waiting for hand...';
            
            // Set canvas size based on video dimensions after start
            if (canvasElement && videoElement) {
                const width = videoElement.offsetWidth || 640;
                const height = videoElement.offsetHeight || 480;
                canvasElement.width = width;
                canvasElement.height = height;
                videoElement.width = width;
                videoElement.height = height;
            }
        })
        .catch(err => {
            console.error('Failed to start camera:', err);
            if (statusElement) statusElement.textContent = 'ERROR: Camera failed to start. Check browser permissions.';
        });
};
