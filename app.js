// Optimized app.js

// 1) Lazy loading of score tab with deferred rendering
const loadScoreTab = async () => {
    const scoreTab = document.getElementById('scoreTab');
    if (!scoreTab.loaded) {
        scoreTab.loaded = true;
        const { Score } = await import('./Score.js');
        scoreTab.appendChild(new Score());
    }
};

// 2) Batched async rendering of score card holes using requestIdleCallback
const renderScoreCardHoles = (holes) => {
    const fragment = document.createDocumentFragment();
    holes.forEach(hole => {
        const holeElement = document.createElement('div');
        holeElement.textContent = `Hole ${hole.number}`;
        fragment.appendChild(holeElement);
    });
    requestIdleCallback(() => {
        document.getElementById('scoreCard').appendChild(fragment);
    });
};

// 3) Debounced updateAmounts function
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};
const updateAmounts = debounce(() => {
    // Update amounts logic
}, 300);

// 4) Panel caching system
const playerPanels = {};
const loadPlayerPanel = (playerId) => {
    if (!playerPanels[playerId]) {
        playerPanels[playerId] = document.createElement('div'); // Build panel
        // Add player specific content
    }
    document.body.appendChild(playerPanels[playerId]);
};

// 5) Cache-first strategy for fines loading
const loadFines = async () => {
    const cacheKey = 'fines';
    const cachedFines = localStorage.getItem(cacheKey);
    if (cachedFines) {
        return JSON.parse(cachedFines);
    }
    const response = await fetch('/api/fines');
    const fines = await response.json();
    localStorage.setItem(cacheKey, JSON.stringify(fines));
    return fines;
};

// 6) Optimized DOM operations using document fragments
const renderFines = async () => {
    const fines = await loadFines();
    const fragment = document.createDocumentFragment();
    fines.forEach(fine => {
        const fineElement = document.createElement('div');
        fineElement.textContent = fine.description;
        fragment.appendChild(fineElement);
    });
    document.getElementById('finesList').appendChild(fragment);
};

// Maintain existing functionality
// ... existing code ...