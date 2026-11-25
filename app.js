const SAMPLE_PROMPTS = [
    "A sunlit Japanese tea shop on a quiet rainy alley, warm wooden counter, steam rising from a ceramic cup",
    "A miniature glass terrarium floating in the clouds with a tiny glowing lighthouse inside",
    "An astronaut sitting on a mossy forest log playing an acoustic guitar under golden hour sunbeams",
    "A sleek retro-futuristic train crossing a turquoise mountain bridge at sunrise"
];

const form = document.getElementById("gen-form");
const promptInput = document.getElementById("prompt");
const charCount = document.getElementById("char-count");
const surpriseBtn = document.getElementById("surprise-btn");
const styleGrid = document.getElementById("style-grid");
const stepsInput = document.getElementById("steps");
const stepsLabel = document.getElementById("steps-label");
const generateBtn = document.getElementById("generate-btn");
const errorBox = document.getElementById("error-box");

const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");
const resultImg = document.getElementById("result-img");
const actionBar = document.getElementById("action-bar");
const activePromptEl = document.getElementById("active-prompt");
const downloadBtn = document.getElementById("download-btn");
const historySection = document.getElementById("history-section");
const historyGrid = document.getElementById("history-grid");
const clearHistoryBtn = document.getElementById("clear-history-btn");

let selectedStyle = "photorealistic";
let currentImageData = "";
let historyItems = [];

// Character counter
promptInput.addEventListener("input", () => {
    charCount.textContent = `${promptInput.value.length} / 500`;
});

// Surprise prompt helper
surpriseBtn.addEventListener("click", () => {
    const pick = SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)];
    promptInput.value = pick;
    charCount.textContent = `${pick.length} / 500`;
    promptInput.focus();
});

// Style selector buttons
styleGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".style-card");
    if (!btn) return;

    styleGrid.querySelectorAll(".style-card").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    selectedStyle = btn.dataset.style;
});

// Detail slider label
stepsInput.addEventListener("input", () => {
    const val = Number(stepsInput.value);
    const tag = val <= 3 ? "Fast" : val <= 5 ? "Balanced" : "High Detail";
    stepsLabel.textContent = `${tag} (${val} steps)`;
});

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
}

function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
}

function displayImage(dataUrl, promptText) {
    currentImageData = dataUrl;
    resultImg.src = dataUrl;
    resultImg.hidden = false;
    emptyState.hidden = true;
    activePromptEl.textContent = promptText;
    actionBar.hidden = false;
}

function renderHistory() {
    historyGrid.textContent = "";
    if (historyItems.length === 0) {
        historySection.hidden = true;
        return;
    }

    historySection.hidden = false;
    historyItems.forEach((item) => {
        const img = document.createElement("img");
        img.src = item.image;
        img.alt = item.prompt;
        img.title = item.prompt;
        img.className = "history-thumb";
        img.addEventListener("click", () => displayImage(item.image, item.prompt));
        historyGrid.appendChild(img);
    });
}

clearHistoryBtn.addEventListener("click", () => {
    historyItems = [];
    renderHistory();
});

downloadBtn.addEventListener("click", () => {
    if (!currentImageData) return;
    const link = document.createElement("a");
    link.href = currentImageData;
    link.download = `pixelforge-${Date.now()}.jpg`;
    link.click();
});

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const prompt = promptInput.value.trim();
    if (prompt.length < 3) {
        showError("Please enter at least 3 characters describing your image.");
        return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";
    emptyState.hidden = true;
    resultImg.hidden = true;
    loadingState.hidden = false;

    try {
        const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt,
                style: selectedStyle,
                steps: Number(stepsInput.value)
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not generate image.");
        }

        displayImage(data.image, prompt);

        // Keep last 8 images in session memory
        historyItems.unshift({ image: data.image, prompt });
        if (historyItems.length > 8) historyItems.pop();
        renderHistory();
    } catch (err) {
        showError(err.message || "Network error. Please try again.");
        if (!currentImageData) emptyState.hidden = false;
    } finally {
        loadingState.hidden = true;
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate Image";
    }
});