// Add these variables at the top level
let geminiAnalysisTimer = null;
let isGeminiInitialized = false;

// Function to handle Gemini analysis
async function performGeminiAnalysis() {
    try {
        // Your existing Gemini analysis code
        const result = await analyzeLocationData(); // Your existing analysis function
        updateAIRating(result);
    } catch (error) {
        console.error('Gemini analysis error:', error);
        // Fallback to default rating or show error state
        updateAIRating('Data processing...');
    }
}

// Initialize Gemini with delay
function initializeGeminiAnalysis() {
    // Initial delay of 10 seconds
    setTimeout(() => {
        performGeminiAnalysis();
        isGeminiInitialized = true;
        
        // Set up recurring analysis every 250 seconds
        geminiAnalysisTimer = setInterval(performGeminiAnalysis, 250000);
    }, 10000);
}

// Clean up function
function cleanupGeminiAnalysis() {
    if (geminiAnalysisTimer) {
        clearInterval(geminiAnalysisTimer);
    }
}

// Add this to your initialization code
window.addEventListener('load', () => {
    // ...existing initialization code...
    initializeGeminiAnalysis();
});

// Add this to handle cleanup when needed
window.addEventListener('unload', () => {
    cleanupGeminiAnalysis();
});

// Update your existing map initialization to show loading state
function initializeMap() {
    // ...existing map initialization code...
    
    // Show loading state for AI rating initially
    updateAIRating('Initializing analysis...');
    
    // ...rest of your initialization code...
}

// Helper function to update AI rating display
function updateAIRating(rating) {
    const ratingElement = document.getElementById('ai-rating');
    if (ratingElement) {
        ratingElement.textContent = rating;
    }
}