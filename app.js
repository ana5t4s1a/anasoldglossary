// === STATE & STORAGE ===
const STORAGE_FAV_KEY = 'tech_english_starred_v2';
const STORAGE_VOL_KEY = 'tech_english_volume_v2';
const STORAGE_MUTE_KEY = 'tech_english_muted_v2';

let starredSet = new Set(JSON.parse(localStorage.getItem(STORAGE_FAV_KEY) || '[]'));

// Audio volume state (0.0 to 1.0)
let masterVolume = parseFloat(localStorage.getItem(STORAGE_VOL_KEY));
if (isNaN(masterVolume)) masterVolume = 0.85;
let isMuted = localStorage.getItem(STORAGE_MUTE_KEY) === 'true';

function getEffectiveVolume() {
    return isMuted ? 0 : Math.max(0, Math.min(1, masterVolume));
}

// === AUDIO ENGINE (WEB SPEECH + WEB AUDIO API WITH MASTER VOLUME) ===
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

const SoundFX = {
    playTone(freq, type, duration, delay = 0, baseGain = 0.16) {
        const vol = getEffectiveVolume();
        if (vol <= 0.001) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        const scaledGain = baseGain * vol;
        gain.gain.setValueAtTime(Math.max(0.0001, scaledGain), ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
    },
    correct() {
        this.playTone(523.25, 'sine', 0.14, 0, 0.18);
        this.playTone(659.25, 'sine', 0.14, 0.09, 0.18);
        this.playTone(783.99, 'sine', 0.24, 0.18, 0.18);
    },
    wrong() {
        this.playTone(230, 'sawtooth', 0.2, 0, 0.14);
        this.playTone(175, 'sawtooth', 0.28, 0.14, 0.14);
    },
    meow() {
        const vol = getEffectiveVolume();
        if (vol <= 0.001) return;
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const t = ctx.currentTime;
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(680, t + 0.13);
        osc.frequency.exponentialRampToValueAtTime(470, t + 0.34);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.18 * vol, t + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.38);
    }
};

function speakEnglish(text, rate = 0.95) {
    if (!('speechSynthesis' in window)) return;
    const vol = getEffectiveVolume();
    if (vol <= 0.001) return;
    window.speechSynthesis.cancel();
    const clean = text.split('/')[0].replace(/\(.*?\)/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'en-US';
    utterance.rate = rate;
    utterance.volume = vol;
    window.speechSynthesis.speak(utterance);
}

// === VOLUME UI SYNC ===
const volumeSlider = document.getElementById('volumeSlider');
const muteToggleBtn = document.getElementById('muteToggleBtn');
const volumePercentLabel = document.getElementById('volumePercentLabel');

function syncVolumeUI() {
    const pct = Math.round(masterVolume * 100);
    volumeSlider.value = isMuted ? 0 : pct;
    volumePercentLabel.textContent = isMuted ? '0%' : `${pct}%`;
    if (isMuted || pct === 0) {
        muteToggleBtn.textContent = '🔇';
    } else if (pct < 45) {
        muteToggleBtn.textContent = '🔉';
    } else {
        muteToggleBtn.textContent = '🔊';
    }
}

volumeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    masterVolume = val / 100;
    isMuted = val === 0;
    localStorage.setItem(STORAGE_VOL_KEY, masterVolume.toString());
    localStorage.setItem(STORAGE_MUTE_KEY, isMuted.toString());
    syncVolumeUI();
});

muteToggleBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (!isMuted && masterVolume === 0) {
        masterVolume = 0.7;
        localStorage.setItem(STORAGE_VOL_KEY, masterVolume.toString());
    }
    localStorage.setItem(STORAGE_MUTE_KEY, isMuted.toString());
    syncVolumeUI();
    if (!isMuted) SoundFX.meow();
});

// === FAVORITES PERSISTENCE ===
function saveFavorites() {
    localStorage.setItem(STORAGE_FAV_KEY, JSON.stringify([...starredSet]));
    updatePoolCountLabel();
}

function toggleFavorite(enTerm) {
    if (starredSet.has(enTerm)) {
        starredSet.delete(enTerm);
    } else {
        starredSet.add(enTerm);
    }
    saveFavorites();
    updateSpotlightStarBtn();
}

// === STRING HELPERS & LEVENSHTEIN ===
function normalize(str) {
    return str
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/[¿?¡!.,;:"'()\[\]{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getAcceptedAnswers(rawString) {
    const parts = rawString.split('/').map(p => normalize(p)).filter(Boolean);
    const fullClean = normalize(rawString);
    if (fullClean && !parts.includes(fullClean)) parts.push(fullClean);
    return parts;
}

function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[b.length][a.length];
}

// Leading words that don't change the meaning ("to allow" = "allow", "la herencia" = "herencia")
const LEADING_FILLERS = /^(to|the|el|la|los|las|un|una|se) /;
function stripFiller(str) {
    return str.replace(LEADING_FILLERS, '').trim();
}

// Statuses: 'exact' | 'typo' (1 letter off, counts as correct) | 'near' (very close → second chance) | 'wrong'
function checkAnswerMatch(userInput, correctRaw, extraAnswers = []) {
    const cleanUser = normalize(userInput);
    if (!cleanUser) return { status: 'wrong' };

    const accepted = getAcceptedAnswers(correctRaw);
    extraAnswers.forEach(a => {
        const n = normalize(a);
        if (n && !accepted.includes(n)) accepted.push(n);
    });
    const acceptedLoose = accepted.map(stripFiller);

    // The user may type one answer or several separated by "/"
    const userVariants = new Set([cleanUser]);
    userInput.split('/').map(normalize).filter(Boolean).forEach(p => userVariants.add(p));
    [...userVariants].forEach(u => userVariants.add(stripFiller(u)));

    for (const u of userVariants) {
        const idx = accepted.findIndex((ans, i) => u === ans || u === acceptedLoose[i]);
        if (idx !== -1) return { status: 'exact', matched: accepted[idx] };
    }

    let best = null;
    for (const u of userVariants) {
        accepted.forEach((ans, i) => {
            const target = acceptedLoose[i] || ans;
            const d = Math.min(levenshtein(u, ans), levenshtein(u, target));
            if (!best || d < best.d) best = { d, ans, len: target.length, u };
        });
    }
    if (!best) return { status: 'wrong' };

    if (best.len >= 4 && best.d === 1) return { status: 'typo', matched: best.ans };

    const nearLimit = Math.max(2, Math.round(best.len * 0.4));
    const isPartial = best.u.length >= 4 && best.len >= 4 &&
        accepted.some(ans => ans.includes(best.u) || best.u.includes(ans));
    if ((best.len >= 3 && best.d <= nearLimit) || isPartial) {
        return { status: 'near', matched: best.ans };
    }
    return { status: 'wrong' };
}

// === EXAMPLE SENTENCES (context hints) ===
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Hides the [target] word: "Use a for [loop]" → "Use a for ____"
function blankSentence(sentence) {
    if (!sentence) return '';
    return escapeHtml(sentence).replace(/\[(.+?)\]/g, (_, w) =>
        `<span class="font-code tracking-widest">${w.replace(/[^\s]/g, '_')}</span>`);
}
// Shows the [target] word in bold
function revealSentence(sentence) {
    if (!sentence) return '';
    return escapeHtml(sentence).replace(/\[(.+?)\]/g, '<strong>$1</strong>');
}
// guessLang: 'en' or 'es' (the language the player must write)
function buildContextHint(item, guessLang) {
    if (!item.exEn || !item.exEs) return '';
    const target = guessLang === 'en' ? item.exEn : item.exEs;
    const other = guessLang === 'en' ? item.exEs : item.exEn;
    return `<div>📝 ${blankSentence(target)}</div>` +
        `<div class="text-xs opacity-75 mt-1">${revealSentence(other)}</div>`;
}
function exampleFooter(item) {
    if (!item.exEn) return '';
    return `<div class="text-xs font-semibold mt-2 opacity-90">📘 ${revealSentence(item.exEn)}<br>🇪🇸 ${revealSentence(item.exEs)}</div>`;
}

function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// === PUSHEEN HERO SPOTLIGHT (HOME SCREEN) ===
const CODE_FACTS_EN = [
    {
        title: "Web Speech API Pronunciation",
        detail: "My voice uses your browser's native window.speechSynthesis engine — zero external MP3 files needed!"
    },
    {
        title: "Levenshtein Edit Distance",
        detail: "In Code Typing and Audio Dictation, an edit-distance matrix forgives 1-letter typos and gives you a second chance when you're very close."
    },
    {
        title: "Real-Time Web Audio Synthesizer",
        detail: "Every chime, buzzer, and Pusheen meow is generated mathematically with OscillatorNode waveforms!"
    },
    {
        title: "Client-Side LocalStorage Persistence",
        detail: "Your starred favorites (⭐) and volume level are saved automatically in localStorage across reloads."
    },
    {
        title: "Fisher-Yates Unbiased Shuffle",
        detail: "Every round uses an in-place Fisher-Yates algorithm so no two study sessions follow the same order."
    },
    {
        title: "Unified 219-Term Dataset",
        detail: "Technical English I & II terms live in a single deduplicated JSON-style array in glossary.js."
    }
];

let currentSpotlightItem = null;
let spotlightTimer = null;
let showWordNext = true;

const spotlightBadge = document.getElementById('spotlightBadge');
const spotlightMainText = document.getElementById('spotlightMainText');
const spotlightSubText = document.getElementById('spotlightSubText');
const spotlightSpeakBtn = document.getElementById('spotlightSpeakBtn');
const spotlightStarBtn = document.getElementById('spotlightStarBtn');
const spotlightNextBtn = document.getElementById('spotlightNextBtn');
const heroPusheenBtn = document.getElementById('heroPusheenBtn');

function updateSpotlightStarBtn() {
    if (!currentSpotlightItem || currentSpotlightItem.type !== 'word') {
        spotlightStarBtn.classList.add('hidden');
        return;
    }
    spotlightStarBtn.classList.remove('hidden');
    const isFav = starredSet.has(currentSpotlightItem.en);
    spotlightStarBtn.textContent = isFav ? '⭐' : '☆';
}

function renderSpotlight(forceType = null) {
    const useWord = forceType ? (forceType === 'word') : showWordNext;
    showWordNext = !useWord;

    if (useWord) {
        const entry = UNIFIED_GLOSSARY[Math.floor(Math.random() * UNIFIED_GLOSSARY.length)];
        currentSpotlightItem = { type: 'word', en: entry.en, es: entry.es };
        spotlightBadge.textContent = '🐾 Word Spotlight';
        spotlightBadge.className = 'spotlight-tag tag-word';
        spotlightMainText.innerHTML = `<span class="font-code text-[#2f7d65]">${entry.en}</span>`;
        spotlightSubText.textContent = `Meaning: ${entry.es}`;
        spotlightSpeakBtn.classList.remove('hidden');
    } else {
        const fact = CODE_FACTS_EN[Math.floor(Math.random() * CODE_FACTS_EN.length)];
        currentSpotlightItem = { type: 'code', title: fact.title, detail: fact.detail };
        spotlightBadge.textContent = '💻 Code Fun Fact';
        spotlightBadge.className = 'spotlight-tag tag-code';
        spotlightMainText.textContent = fact.title;
        spotlightSubText.textContent = fact.detail;
        spotlightSpeakBtn.classList.add('hidden');
    }
    updateSpotlightStarBtn();
}

function resetSpotlightTimer() {
    if (spotlightTimer) clearInterval(spotlightTimer);
    spotlightTimer = setInterval(() => {
        if (!document.getElementById('welcomeScreen').classList.contains('hidden')) {
            renderSpotlight();
        }
    }, 8500);
}

spotlightSpeakBtn.addEventListener('click', () => {
    if (currentSpotlightItem && currentSpotlightItem.type === 'word') {
        speakEnglish(currentSpotlightItem.en);
    }
});

spotlightStarBtn.addEventListener('click', () => {
    if (currentSpotlightItem && currentSpotlightItem.type === 'word') {
        toggleFavorite(currentSpotlightItem.en);
    }
});

spotlightNextBtn.addEventListener('click', () => {
    renderSpotlight();
    resetSpotlightTimer();
});

heroPusheenBtn.addEventListener('click', () => {
    SoundFX.meow();
    renderSpotlight();
    resetSpotlightTimer();
});

// === SINGLE-GAME CAROUSEL CONFIGURATION ===
const GAMES_CATALOG = [
    {
        id: 'typing',
        name: 'Code Typing',
        btnLabel: 'Start Code Typing',
        desc: 'Classic translation challenge with letter hints, example sentences, a second chance when you are close, and audio.',
        showDirection: true,
        showDifficulty: true,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="8" y="20" width="48" height="28" rx="7" fill="#f9d5e0" stroke="#5c4d47" stroke-width="3"/>
                <polygon points="14,20 19,10 25,20" fill="#bfb6b0" stroke="#5c4d47" stroke-width="2.5" stroke-linejoin="round"/>
                <polygon points="50,20 45,10 39,20" fill="#bfb6b0" stroke="#5c4d47" stroke-width="2.5" stroke-linejoin="round"/>
                <rect x="15" y="27" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="24" y="27" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="33" y="27" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="42" y="27" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="20" y="36" width="24" height="5" rx="2" fill="#cdeee1" stroke="#5c4d47" stroke-width="2"/>
              </svg>`
    },
    {
        id: 'match',
        name: 'Syntax Match',
        btnLabel: 'Start Syntax Match',
        desc: 'Pair 5 English terms with their Spanish meanings against the stopwatch.',
        showDirection: false,
        showDifficulty: false,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 32 C20 20, 36 20, 44 32 L54 24 L54 40 L44 32 C36 44, 20 44, 12 32 Z" fill="#cdeee1" stroke="#5c4d47" stroke-width="3" stroke-linejoin="round"/>
                <circle cx="21" cy="30" r="2.5" fill="#433631"/>
                <path d="M28 26 C26 30, 26 34, 28 38" fill="none" stroke="#5c4d47" stroke-width="2.5" stroke-linecap="round"/>
              </svg>`
    },
    {
        id: 'trivia',
        name: 'Multiple Choice',
        btnLabel: 'Start Multiple Choice',
        desc: 'Pick the right definition among 4 options — great for longer IDE concepts.',
        showDirection: true,
        showDifficulty: false,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <circle cx="32" cy="32" r="21" fill="#f9d5e0" stroke="#5c4d47" stroke-width="3"/>
                <circle cx="32" cy="32" r="13" fill="#fffaf5" stroke="#5c4d47" stroke-width="2.5"/>
                <circle cx="32" cy="32" r="5" fill="#6ec4a7" stroke="#5c4d47" stroke-width="2.5"/>
              </svg>`
    },
    {
        id: 'dictation',
        name: 'Audio Dictation',
        btnLabel: 'Start Audio Dictation',
        desc: 'Listen to native English pronunciation and type the exact term you hear.',
        showDirection: false,
        showDifficulty: false,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 36 C16 20, 48 20, 48 36" fill="none" stroke="#5c4d47" stroke-width="4" stroke-linecap="round"/>
                <rect x="11" y="33" width="10" height="16" rx="5" fill="#e8def8" stroke="#5c4d47" stroke-width="3"/>
                <rect x="43" y="33" width="10" height="16" rx="5" fill="#e8def8" stroke="#5c4d47" stroke-width="3"/>
                <polygon points="20,23 23,14 28,21" fill="#bfb6b0" stroke="#5c4d47" stroke-width="2.2" stroke-linejoin="round"/>
                <polygon points="44,23 41,14 36,21" fill="#bfb6b0" stroke="#5c4d47" stroke-width="2.2" stroke-linejoin="round"/>
              </svg>`
    },
    {
        id: 'hangman',
        name: 'Pusheen Hangman',
        btnLabel: 'Start Pusheen Hangman',
        desc: 'Decode the English word letter by letter before Pusheen runs out of treats!',
        showDirection: false,
        showDifficulty: false,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 48 L18 16 L27 25 C31 24, 33 24, 37 25 L46 16 L50 48 Z" fill="#bfb6b0" stroke="#5c4d47" stroke-width="3" stroke-linejoin="round"/>
                <circle cx="25" cy="35" r="2.6" fill="#433631"/>
                <circle cx="39" cy="35" r="2.6" fill="#433631"/>
                <path d="M29 38 Q30.5 41 32 38 Q33.5 41 35 38" fill="none" stroke="#433631" stroke-width="2.3" stroke-linecap="round"/>
                <ellipse cx="21" cy="40" rx="3.5" ry="2" fill="#f4a4b4"/>
                <ellipse cx="43" cy="40" rx="3.5" ry="2" fill="#f4a4b4"/>
              </svg>`
    }
];

let carouselIndex = 0;

const carouselIndexLabel = document.getElementById('carouselIndexLabel');
const carouselDots = document.getElementById('carouselDots');
const carouselCardStage = document.getElementById('carouselCardStage');
const carouselGameIcon = document.getElementById('carouselGameIcon');
const carouselGameTitle = document.getElementById('carouselGameTitle');
const carouselGameDesc = document.getElementById('carouselGameDesc');
const inlineDirectionWrapper = document.getElementById('inlineDirectionWrapper');
const inlineDifficultyWrapper = document.getElementById('inlineDifficultyWrapper');
const startGameBtnLabel = document.getElementById('startGameBtnLabel');

function renderCarousel() {
    const game = GAMES_CATALOG[carouselIndex];
    carouselIndexLabel.textContent = (carouselIndex + 1).toString();
    carouselGameIcon.innerHTML = game.svg;
    carouselGameTitle.textContent = game.name;
    carouselGameDesc.textContent = game.desc;
    startGameBtnLabel.textContent = game.btnLabel;

    inlineDirectionWrapper.classList.toggle('hidden', !game.showDirection);
    inlineDifficultyWrapper.classList.toggle('hidden', !game.showDifficulty);

    carouselCardStage.classList.remove('carousel-stage-anim');
    void carouselCardStage.offsetWidth;
    carouselCardStage.classList.add('carousel-stage-anim');

    carouselDots.innerHTML = '';
    GAMES_CATALOG.forEach((g, idx) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = `carousel-dot ${idx === carouselIndex ? 'active' : ''}`;
        dot.setAttribute('aria-label', g.name);
        dot.addEventListener('click', () => {
            carouselIndex = idx;
            renderCarousel();
        });
        carouselDots.appendChild(dot);
    });
}

document.getElementById('carouselPrevBtn').addEventListener('click', () => {
    carouselIndex = (carouselIndex - 1 + GAMES_CATALOG.length) % GAMES_CATALOG.length;
    renderCarousel();
});

document.getElementById('carouselNextBtn').addEventListener('click', () => {
    carouselIndex = (carouselIndex + 1) % GAMES_CATALOG.length;
    renderCarousel();
});

document.addEventListener('keydown', (e) => {
    const welcomeVisible = !document.getElementById('welcomeScreen').classList.contains('hidden');
    const modalOpen = !document.getElementById('glossaryModal').classList.contains('hidden');
    if (welcomeVisible && !modalOpen && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') {
        if (e.key === 'ArrowLeft') {
            carouselIndex = (carouselIndex - 1 + GAMES_CATALOG.length) % GAMES_CATALOG.length;
            renderCarousel();
        } else if (e.key === 'ArrowRight') {
            carouselIndex = (carouselIndex + 1) % GAMES_CATALOG.length;
            renderCarousel();
        }
    }
});

// === IN-GAME CORNER PUSHEEN MASCOT CONTROLLER ===
const Pusheen = {
    widget: document.getElementById('pusheenCornerWidget'),
    bubble: document.getElementById('pusheenCornerBubble'),
    eyesIdle: document.getElementById('eyesIdle'),
    eyesHappy: document.getElementById('eyesHappy'),
    eyesAngry: document.getElementById('eyesAngry'),
    eyesSuspicious: document.getElementById('eyesSuspicious'),
    mouthCute: document.getElementById('mouthCute'),
    mouthAngry: document.getElementById('mouthAngry'),
    sparkles: document.querySelector('#pusheenCornerWidget .corner-sparkle'),
    steam: document.querySelector('#pusheenCornerWidget .corner-steam'),
    timer: null,

    quotes: {
        idle: [
            "Meow! Ready to code & learn? 🐾",
            "Purr... You got this!",
            "Need a hint? I won't judge... much.",
            "Technical English II master in progress! 💻"
        ],
        happy: [
            "Purr-fect! Clean syntax! ✨",
            "Meow-velous! Keep that streak alive! 🐟",
            "Zero bugs detected! Genius!",
            "You're compiling knowledge fast! 🚀"
        ],
        angry: [
            "HISSS! Syntax Error!! 💢",
            "Are you even reading the glossary?!",
            "My whiskers are twitching in disappointment...",
            "404: Right Answer Not Found! 😾",
            "No treats for you until you get one right!"
        ],
        suspicious: [
            "Using a hint? Hmm... okay, just this once. 👀",
            "Peeking at the code, I see..."
        ],
        nervous: [
            "Careful! Only 1 treat left! 🐟💦",
            "Don't make me hiss! Think carefully!"
        ]
    },

    show() {
        this.widget.classList.remove('hidden');
    },

    hide() {
        this.widget.classList.add('hidden');
    },

    setState(state, customText = null, autoResetMs = 0) {
        if (this.timer) clearTimeout(this.timer);
        this.widget.classList.remove('state-idle', 'state-happy', 'state-angry', 'state-suspicious', 'state-nervous');
        this.widget.classList.add(`state-${state}`);

        this.eyesIdle.classList.add('hidden');
        this.eyesHappy.classList.add('hidden');
        this.eyesAngry.classList.add('hidden');
        this.eyesSuspicious.classList.add('hidden');
        this.mouthCute.classList.remove('hidden');
        this.mouthAngry.classList.add('hidden');
        if (this.sparkles) this.sparkles.setAttribute('opacity', '0');
        if (this.steam) this.steam.setAttribute('opacity', '0');

        if (state === 'happy') {
            this.eyesHappy.classList.remove('hidden');
            if (this.sparkles) this.sparkles.setAttribute('opacity', '1');
        } else if (state === 'angry') {
            this.eyesAngry.classList.remove('hidden');
            this.mouthCute.classList.add('hidden');
            this.mouthAngry.classList.remove('hidden');
            if (this.steam) this.steam.setAttribute('opacity', '1');
        } else if (state === 'suspicious' || state === 'nervous') {
            this.eyesSuspicious.classList.remove('hidden');
        } else {
            this.eyesIdle.classList.remove('hidden');
        }

        const pool = this.quotes[state] || this.quotes.idle;
        this.bubble.textContent = customText || pool[Math.floor(Math.random() * pool.length)];

        if (autoResetMs > 0) {
            this.timer = setTimeout(() => this.setState('idle'), autoResetMs);
        }
    }
};

document.getElementById('pusheenCornerBtn').addEventListener('click', () => {
    SoundFX.meow();
    Pusheen.setState('happy', 'Meow! *purrs softly* 🐾', 2500);
});

// === GLOBAL GAME STATE ===
let selectedGameType = 'typing';
let activePool = [];
let sessionQuestions = [];
let currentIndex = 0;
let score = 0;
let streak = 0;
let totalItemsCount = 10;
let missedWords = [];
let answerChecked = false;

// === DOM REFERENCES ===
const welcomeScreen = document.getElementById('welcomeScreen');
const gameSection = document.getElementById('gameSection');
const wordPoolSelect = document.getElementById('wordPoolSelect');
const poolCountInfo = document.getElementById('poolCountInfo');
const gameModeSelect = document.getElementById('gameModeSelect');
const difficultySelect = document.getElementById('difficultySelect');

const activeGameTitle = document.getElementById('activeGameTitle');
const currentQuestionNumber = document.getElementById('currentQuestionNumber');
const totalQuestionsDisplay = document.getElementById('totalQuestionsDisplay');
const currentScoreEl = document.getElementById('currentScore');
const streakBadge = document.getElementById('streakBadge');
const feedbackMessage = document.getElementById('feedbackMessage');
const nextButton = document.getElementById('nextButton');

const views = {
    typing: document.getElementById('viewTyping'),
    match: document.getElementById('viewMatch'),
    trivia: document.getElementById('viewTrivia'),
    dictation: document.getElementById('viewDictation'),
    hangman: document.getElementById('viewHangman')
};

function getFilteredPool() {
    if (wordPoolSelect.value === 'favorites') {
        return UNIFIED_GLOSSARY.filter(item => starredSet.has(item.en));
    }
    return [...UNIFIED_GLOSSARY];
}

function updatePoolCountLabel() {
    const total = UNIFIED_GLOSSARY.length;
    document.getElementById('totalWordsBadge').textContent = total;
    const favCount = starredSet.size;
    wordPoolSelect.options[0].text = `All Glossary Words (${total})`;
    wordPoolSelect.options[1].text = `Starred Favorites Only (${favCount} ⭐)`;

    const pool = getFilteredPool();
    const startBtn = document.getElementById('startGameDirectBtn');
    if (pool.length === 0) {
        poolCountInfo.textContent = 'No starred words yet! Click ⭐ on any word in the Spotlight or Glossary first.';
        poolCountInfo.className = 'text-xs font-extrabold text-[#dc2626] mt-3';
        startBtn.disabled = true;
    } else {
        poolCountInfo.textContent = `Ready with ${pool.length} active technical terms.`;
        poolCountInfo.className = 'text-xs font-bold text-[#85746d] mt-3';
        startBtn.disabled = false;
    }
}

wordPoolSelect.addEventListener('change', updatePoolCountLabel);

function showView(viewKey) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewKey]) views[viewKey].classList.remove('hidden');
}

function updateHeaderStats() {
    currentScoreEl.textContent = score;
    if (streak >= 2) {
        streakBadge.textContent = `🔥 x${streak}`;
        streakBadge.classList.remove('hidden');
    } else {
        streakBadge.classList.add('hidden');
    }
}

function showFeedback(type, htmlContent) {
    feedbackMessage.classList.remove('hidden', 'bg-[#f0fdf4]', 'text-[#14532d]', 'border-[#16a34a]',
        'bg-[#fef2f2]', 'text-[#7f1d1d]', 'border-[#dc2626]',
        'bg-[#fffbeb]', 'text-[#78350f]', 'border-[#d97706]');
    feedbackMessage.classList.add('border-2');

    if (type === 'correct') {
        feedbackMessage.classList.add('bg-[#f0fdf4]', 'text-[#14532d]', 'border-[#16a34a]');
    } else if (type === 'typo') {
        feedbackMessage.classList.add('bg-[#fffbeb]', 'text-[#78350f]', 'border-[#d97706]');
    } else {
        feedbackMessage.classList.add('bg-[#fef2f2]', 'text-[#7f1d1d]', 'border-[#dc2626]');
    }
    feedbackMessage.innerHTML = htmlContent;
}

function hideFeedback() {
    feedbackMessage.classList.add('hidden');
    nextButton.classList.add('hidden');
}

function recordMiss(wordObj) {
    if (!missedWords.some(w => w.en === wordObj.en)) {
        missedWords.push(wordObj);
    }
}

// === START & NAVIGATION ===
document.getElementById('startGameDirectBtn').addEventListener('click', () => {
    const chosenGame = GAMES_CATALOG[carouselIndex];
    selectedGameType = chosenGame.id;
    startSelectedGame();
});

function startSelectedGame() {
    let pool = getFilteredPool();
    if (pool.length === 0) return;

    if (selectedGameType === 'typing') {
        const diff = difficultySelect.value;
        const filtered = pool.filter(w => {
            const len = w.en.replace(/\(.*?\)/g, '').trim().length;
            if (diff === 'easy') return len <= 5;
            if (diff === 'normal') return len >= 6 && len <= 8;
            if (diff === 'medium') return len >= 9 && len <= 11;
            if (diff === 'hard') return len >= 12;
            return true;
        });
        if (filtered.length > 0) pool = filtered;
    }

    activePool = pool;
    score = 0;
    streak = 0;
    currentIndex = 0;
    missedWords = [];

    welcomeScreen.classList.add('hidden');
    document.getElementById('gameOverModal').classList.add('hidden');
    gameSection.classList.remove('hidden');

    Pusheen.show();
    Pusheen.setState('idle');

    if (selectedGameType === 'typing') initTypingGame();
    else if (selectedGameType === 'match') initMatchGame();
    else if (selectedGameType === 'trivia') initTriviaGame();
    else if (selectedGameType === 'dictation') initDictationGame();
    else if (selectedGameType === 'hangman') initHangmanGame();
}

function goHome() {
    if (matchTimerInterval) clearInterval(matchTimerInterval);
    window.speechSynthesis && window.speechSynthesis.cancel();
    gameSection.classList.add('hidden');
    document.getElementById('gameOverModal').classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
    Pusheen.hide();
    updatePoolCountLabel();
    renderSpotlight();
}

document.getElementById('gameGoHomeBtn').addEventListener('click', goHome);
document.getElementById('gameOverHomeBtn').addEventListener('click', goHome);
document.getElementById('gameOverRestartBtn').addEventListener('click', startSelectedGame);

// =========================================================
// GAME 1: CODE TYPING (WITH 3 LETTER HINTS)
// =========================================================
let typingHintsLeft = 3;
let typingRevealedIndices = [];
let currentTypingQ = null;

const typingQuestionText = document.getElementById('typingQuestionText');
const typingSpeakBtn = document.getElementById('typingSpeakBtn');
const typingAnswerInput = document.getElementById('typingAnswerInput');
const typingCheckBtn = document.getElementById('typingCheckBtn');
const typingHintBtn = document.getElementById('typingHintBtn');
const hintsRemainingEl = document.getElementById('hintsRemaining');
const hintDisplay = document.getElementById('hintDisplay');
const typingContextBtn = document.getElementById('typingContextBtn');
const typingContextDisplay = document.getElementById('typingContextDisplay');
let typingSecondChanceUsed = false;

function showTypingContext() {
    if (!currentTypingQ) return;
    const html = buildContextHint(currentTypingQ.wordObj, currentTypingQ.direction === 'es_to_en' ? 'en' : 'es');
    if (!html) return;
    typingContextDisplay.innerHTML = html;
    typingContextDisplay.classList.remove('hidden');
    typingContextBtn.disabled = true;
}

function initTypingGame() {
    activeGameTitle.textContent = 'Code Typing';
    showView('typing');
    totalItemsCount = Math.min(10, activePool.length);
    totalQuestionsDisplay.textContent = totalItemsCount;
    sessionQuestions = shuffleArray(activePool).slice(0, totalItemsCount);
    loadTypingQuestion();
}

function loadTypingQuestion() {
    answerChecked = false;
    typingHintsLeft = 3;
    typingRevealedIndices = [];
    typingSecondChanceUsed = false;
    hideFeedback();

    const item = sessionQuestions[currentIndex];
    const mode = gameModeSelect.value;
    const isEsToEn = mode === 'es_to_en' || (mode === 'mixed' && Math.random() < 0.5);

    currentTypingQ = {
        wordObj: item,
        direction: isEsToEn ? 'es_to_en' : 'en_to_es',
        prompt: isEsToEn ? item.es : item.en,
        answer: isEsToEn ? item.en : item.es
    };

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();

    typingQuestionText.textContent = currentTypingQ.prompt;
    typingSpeakBtn.classList.toggle('hidden', isEsToEn);
    if (!isEsToEn) speakEnglish(item.en);

    typingAnswerInput.value = '';
    typingAnswerInput.disabled = false;
    typingAnswerInput.classList.remove('correct', 'incorrect', 'near-miss');
    typingCheckBtn.disabled = false;
    typingHintBtn.disabled = false;
    hintsRemainingEl.textContent = '3';
    hintDisplay.textContent = '';
    typingContextDisplay.innerHTML = '';
    typingContextDisplay.classList.add('hidden');
    typingContextBtn.disabled = !item.exEn;
    typingAnswerInput.focus();
}

function handleTypingHint() {
    if (typingHintsLeft <= 0 || answerChecked) return;
    const primaryAnswer = currentTypingQ.answer.split('/')[0].replace(/\(.*?\)/g, '').trim();
    const candidates = [];
    for (let i = 0; i < primaryAnswer.length; i++) {
        if (primaryAnswer[i] !== ' ' && !typingRevealedIndices.includes(i)) {
            candidates.push(i);
        }
    }
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    typingRevealedIndices.push(pick);
    typingHintsLeft--;
    hintsRemainingEl.textContent = typingHintsLeft;
    if (typingHintsLeft === 0) typingHintBtn.disabled = true;

    let masked = '';
    for (let i = 0; i < primaryAnswer.length; i++) {
        if (primaryAnswer[i] === ' ') masked += '  ';
        else if (typingRevealedIndices.includes(i)) masked += primaryAnswer[i];
        else masked += '_';
    }
    hintDisplay.textContent = masked;
    Pusheen.setState('suspicious', null, 2500);
}

function checkTypingAnswer() {
    if (answerChecked) return;
    const userVal = typingAnswerInput.value.trim();
    if (!userVal) return;

    const extra = currentTypingQ.direction === 'en_to_es' ? (currentTypingQ.wordObj.alt || []) : [];
    const evalRes = checkAnswerMatch(userVal, currentTypingQ.answer, extra);

    // Very close → warn and give ONE more chance
    if (evalRes.status === 'near' && !typingSecondChanceUsed) {
        typingSecondChanceUsed = true;
        SoundFX.wrong();
        Pusheen.setState('suspicious', null, 2500);
        typingAnswerInput.classList.remove('correct', 'incorrect');
        typingAnswerInput.classList.add('near-miss');
        showTypingContext();
        showFeedback('typo', `🤏 <strong>¡Estuviste muy cerca!</strong> "${escapeHtml(userVal)}" casi está bien. Revisalo y probá otra vez (te queda 1 chance).`);
        typingAnswerInput.focus();
        typingAnswerInput.select();
        return;
    }

    answerChecked = true;
    typingAnswerInput.disabled = true;
    typingCheckBtn.disabled = true;
    typingHintBtn.disabled = true;
    typingContextBtn.disabled = true;
    const footer = exampleFooter(currentTypingQ.wordObj);

    speakEnglish(currentTypingQ.wordObj.en);

    if (evalRes.status === 'exact' || evalRes.status === 'typo') {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Pusheen.setState('happy');
        if (evalRes.status === 'exact') {
            typingAnswerInput.classList.add('correct');
            typingAnswerInput.classList.remove('near-miss');
            typingAnswerInput.classList.add('correct');
            const bonus = typingSecondChanceUsed ? ' (¡a la segunda!)' : '';
            showFeedback('correct', `✅ Correct${bonus}! <strong>${currentTypingQ.wordObj.en}</strong> = ${currentTypingQ.wordObj.es}${footer}`);
        } else {
            typingAnswerInput.classList.add('near-miss');
            showFeedback('typo', `⚠️ Almost exact (1-letter typo accepted)! Full answer: <strong>${currentTypingQ.answer}</strong>${footer}`);
        }
    } else {
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Pusheen.setState('angry');
        typingAnswerInput.classList.remove('near-miss');
        typingAnswerInput.classList.add('incorrect');
        recordMiss(currentTypingQ.wordObj);
        const prefix = evalRes.status === 'near' ? '❌ ¡Casi! Pero no.' : '❌ Incorrect.';
        showFeedback('wrong', `${prefix} The right answer is: <strong>${currentTypingQ.answer}</strong>${footer}`);
    }

    nextButton.textContent = (currentIndex + 1 < totalItemsCount) ? 'Next Word →' : 'See Final Results';
    nextButton.classList.remove('hidden');
}

typingSpeakBtn.addEventListener('click', () => speakEnglish(currentTypingQ.wordObj.en));
typingHintBtn.addEventListener('click', handleTypingHint);
typingContextBtn.addEventListener('click', () => {
    if (answerChecked) return;
    showTypingContext();
    Pusheen.setState('suspicious', null, 2500);
});
typingCheckBtn.addEventListener('click', checkTypingAnswer);
typingAnswerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!answerChecked) checkTypingAnswer();
        else advanceCurrentGame();
    }
});

// =========================================================
// GAME 2: SYNTAX MATCH (WITH PAIR HIGHLIGHT HINTS)
// =========================================================
let matchRoundNum = 1;
const matchTotalRounds = 3;
let matchSelectedEn = null;
let matchSelectedEs = null;
let matchPairsMatchedInRound = 0;
let matchPairsTarget = 5;
let matchStartTime = 0;
let matchTimerInterval = null;
let matchHintsLeft = 2;

const matchHintBtn = document.getElementById('matchHintBtn');
const matchHintsRemainingEl = document.getElementById('matchHintsRemaining');

function initMatchGame() {
    activeGameTitle.textContent = 'Syntax Match';
    showView('match');
    matchRoundNum = 1;
    matchHintsLeft = 2;
    matchHintsRemainingEl.textContent = '2';
    matchHintBtn.disabled = false;

    totalItemsCount = matchTotalRounds * 5;
    totalQuestionsDisplay.textContent = totalItemsCount;
    currentQuestionNumber.textContent = '1';
    updateHeaderStats();

    matchStartTime = performance.now();
    if (matchTimerInterval) clearInterval(matchTimerInterval);
    matchTimerInterval = setInterval(() => {
        const elapsed = ((performance.now() - matchStartTime) / 1000).toFixed(1);
        document.getElementById('matchTimer').textContent = elapsed;
    }, 100);

    loadMatchRound();
}

function loadMatchRound() {
    hideFeedback();
    matchSelectedEn = null;
    matchSelectedEs = null;
    matchPairsMatchedInRound = 0;
    document.getElementById('matchRound').textContent = `${matchRoundNum}/${matchTotalRounds}`;
    currentQuestionNumber.textContent = ((matchRoundNum - 1) * 5) + 1;

    const roundWords = shuffleArray(activePool).slice(0, Math.min(5, activePool.length));
    matchPairsTarget = roundWords.length;

    const enCol = document.getElementById('matchColEn');
    const esCol = document.getElementById('matchColEs');
    enCol.innerHTML = '';
    esCol.innerHTML = '';

    shuffleArray(roundWords).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'match-tile font-code text-xs sm:text-sm';
        btn.textContent = item.en;
        btn.dataset.en = item.en;
        btn.addEventListener('click', () => handleMatchSelect('en', btn, item));
        enCol.appendChild(btn);
    });

    shuffleArray(roundWords).forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'match-tile text-xs sm:text-sm';
        btn.textContent = item.es.replace(/\(.*?\)/g, '').trim();
        btn.dataset.en = item.en;
        btn.addEventListener('click', () => handleMatchSelect('es', btn, item));
        esCol.appendChild(btn);
    });
}

matchHintBtn.addEventListener('click', () => {
    if (matchHintsLeft <= 0) return;
    const unmatchedEn = [...document.querySelectorAll('#matchColEn .match-tile:not(.matched)')];
    if (unmatchedEn.length === 0) return;

    document.querySelectorAll('.match-tile.hint-glow').forEach(t => t.classList.remove('hint-glow'));
    const pickEn = unmatchedEn[Math.floor(Math.random() * unmatchedEn.length)];
    const targetTerm = pickEn.dataset.en;
    const pickEs = [...document.querySelectorAll('#matchColEs .match-tile:not(.matched)')].find(t => t.dataset.en === targetTerm);

    pickEn.classList.add('hint-glow');
    if (pickEs) pickEs.classList.add('hint-glow');
    speakEnglish(targetTerm);

    matchHintsLeft--;
    matchHintsRemainingEl.textContent = matchHintsLeft.toString();
    if (matchHintsLeft <= 0) matchHintBtn.disabled = true;
    Pusheen.setState('suspicious', 'Highlighted a matching pair for you! 👀', 2500);
});

function handleMatchSelect(side, btnEl, wordObj) {
    if (btnEl.classList.contains('matched')) return;
    btnEl.classList.remove('hint-glow');

    if (side === 'en') {
        speakEnglish(wordObj.en);
        if (matchSelectedEn) matchSelectedEn.el.classList.remove('selected');
        matchSelectedEn = { el: btnEl, wordObj };
        btnEl.classList.add('selected');
    } else {
        if (matchSelectedEs) matchSelectedEs.el.classList.remove('selected');
        matchSelectedEs = { el: btnEl, wordObj };
        btnEl.classList.add('selected');
    }

    if (matchSelectedEn && matchSelectedEs) {
        const enPair = matchSelectedEn;
        const esPair = matchSelectedEs;
        matchSelectedEn = null;
        matchSelectedEs = null;

        if (enPair.wordObj.en === esPair.wordObj.en) {
            enPair.el.classList.remove('selected', 'hint-glow');
            esPair.el.classList.remove('selected', 'hint-glow');
            enPair.el.classList.add('matched');
            esPair.el.classList.add('matched');
            score++;
            streak++;
            matchPairsMatchedInRound++;
            updateHeaderStats();
            SoundFX.correct();
            Pusheen.setState('happy', null, 1800);

            if (matchPairsMatchedInRound >= matchPairsTarget) {
                if (matchRoundNum < matchTotalRounds) {
                    showFeedback('correct', `✨ Round ${matchRoundNum} cleared! Get ready for the next batch...`);
                    setTimeout(() => {
                        matchRoundNum++;
                        loadMatchRound();
                    }, 950);
                } else {
                    clearInterval(matchTimerInterval);
                    const finalSec = ((performance.now() - matchStartTime) / 1000).toFixed(1);
                    setTimeout(() => finishGame(`Completed all rounds in ${finalSec}s!`), 600);
                }
            }
        } else {
            streak = 0;
            updateHeaderStats();
            SoundFX.wrong();
            Pusheen.setState('angry', null, 2000);
            recordMiss(enPair.wordObj);
            enPair.el.classList.add('wrong-flash');
            esPair.el.classList.add('wrong-flash');
            setTimeout(() => {
                enPair.el.classList.remove('selected', 'wrong-flash');
                esPair.el.classList.remove('selected', 'wrong-flash');
            }, 420);
        }
    }
}

// =========================================================
// GAME 3: MULTIPLE CHOICE TRIVIA (WITH 50/50 HINT)
// =========================================================
let currentTriviaQ = null;
const triviaHintBtn = document.getElementById('triviaHintBtn');

function initTriviaGame() {
    activeGameTitle.textContent = 'Multiple Choice';
    showView('trivia');
    totalItemsCount = Math.min(10, activePool.length);
    totalQuestionsDisplay.textContent = totalItemsCount;
    sessionQuestions = shuffleArray(activePool).slice(0, totalItemsCount);
    loadTriviaQuestion();
}

function loadTriviaQuestion() {
    answerChecked = false;
    hideFeedback();
    triviaHintBtn.disabled = false;

    const target = sessionQuestions[currentIndex];
    const mode = gameModeSelect.value;
    const isEnToEs = mode === 'en_to_es' || (mode === 'mixed' && Math.random() < 0.5);

    const distractorSource = activePool.length >= 4 ? activePool : UNIFIED_GLOSSARY;
    const distractors = shuffleArray(distractorSource.filter(w => w.en !== target.en)).slice(0, 3);
    const options = shuffleArray([target, ...distractors]);

    currentTriviaQ = { target, isEnToEs, options };

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();

    document.getElementById('triviaPromptTag').textContent = isEnToEs ? 'Select Spanish Meaning' : 'Select English Term';
    document.getElementById('triviaQuestionText').textContent = isEnToEs ? target.en : target.es;
    document.getElementById('triviaSpeakBtn').classList.toggle('hidden', !isEnToEs);
    if (isEnToEs) speakEnglish(target.en);

    const grid = document.getElementById('triviaOptionsGrid');
    grid.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mc-option text-sm sm:text-base';
        const labelText = isEnToEs ? opt.es : opt.en;
        btn.innerHTML = `<span class="font-code font-bold text-[#2f7d65] bg-[#cdeee1] border border-[#5c4d47] px-2.5 py-0.5 rounded-lg">${letters[idx]}</span> <span>${labelText}</span>`;
        btn.addEventListener('click', () => checkTriviaChoice(btn, opt));
        grid.appendChild(btn);
    });
}

triviaHintBtn.addEventListener('click', () => {
    if (answerChecked || !currentTriviaQ) return;
    triviaHintBtn.disabled = true;
    const allBtns = [...document.querySelectorAll('#triviaOptionsGrid .mc-option')];
    const wrongIndices = currentTriviaQ.options
        .map((opt, idx) => (opt.en !== currentTriviaQ.target.en ? idx : -1))
        .filter(idx => idx !== -1);

    const toEliminate = shuffleArray(wrongIndices).slice(0, 2);
    toEliminate.forEach(idx => {
        allBtns[idx].disabled = true;
        allBtns[idx].classList.add('mc-eliminated');
    });
    Pusheen.setState('suspicious', '50/50 used! Two wrong choices removed 👀', 2500);
});

function checkTriviaChoice(clickedBtn, chosenOpt) {
    if (answerChecked) return;
    answerChecked = true;
    triviaHintBtn.disabled = true;

    const allBtns = document.querySelectorAll('#triviaOptionsGrid .mc-option');
    allBtns.forEach((b, idx) => {
        b.disabled = true;
        if (currentTriviaQ.options[idx].en === currentTriviaQ.target.en) {
            b.classList.add('mc-correct');
        }
    });

    speakEnglish(currentTriviaQ.target.en);

    if (chosenOpt.en === currentTriviaQ.target.en) {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Pusheen.setState('happy');
        showFeedback('correct', `✅ Spot on! <strong>${currentTriviaQ.target.en}</strong> = ${currentTriviaQ.target.es}`);
    } else {
        clickedBtn.classList.add('mc-wrong');
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Pusheen.setState('angry');
        recordMiss(currentTriviaQ.target);
        showFeedback('wrong', `❌ Not quite. <strong>${currentTriviaQ.target.en}</strong> means <strong>${currentTriviaQ.target.es}</strong>.`);
    }

    nextButton.textContent = (currentIndex + 1 < totalItemsCount) ? 'Next Question →' : 'See Final Results';
    nextButton.classList.remove('hidden');
}

document.getElementById('triviaSpeakBtn').addEventListener('click', () => {
    if (currentTriviaQ) speakEnglish(currentTriviaQ.target.en);
});

// =========================================================
// GAME 4: AUDIO DICTATION (MEANING CLUE + 3 LETTER HINTS)
// =========================================================
const dictationAnswerInput = document.getElementById('dictationAnswerInput');
const dictationCheckBtn = document.getElementById('dictationCheckBtn');
const dictationMeaningText = document.getElementById('dictationMeaningText');
const dictationMeaningHintBtn = document.getElementById('dictationMeaningHintBtn');
const dictationLetterHintBtn = document.getElementById('dictationLetterHintBtn');
const dictationHintsRemainingEl = document.getElementById('dictationHintsRemaining');
const dictationLetterDisplay = document.getElementById('dictationLetterDisplay');

let dictationHintsLeft = 3;
let dictationRevealedIndices = [];
let dictationSecondChanceUsed = false;
const dictationContextBtn = document.getElementById('dictationContextBtn');
const dictationContextDisplay = document.getElementById('dictationContextDisplay');

function showDictationContext() {
    const html = buildContextHint(sessionQuestions[currentIndex], 'en');
    if (!html) return;
    dictationContextDisplay.innerHTML = html;
    dictationContextDisplay.classList.remove('hidden');
    dictationContextBtn.disabled = true;
}

function initDictationGame() {
    activeGameTitle.textContent = 'Audio Dictation';
    showView('dictation');
    totalItemsCount = Math.min(10, activePool.length);
    totalQuestionsDisplay.textContent = totalItemsCount;
    sessionQuestions = shuffleArray(activePool).slice(0, totalItemsCount);
    loadDictationQuestion();
}

function loadDictationQuestion() {
    answerChecked = false;
    dictationHintsLeft = 3;
    dictationRevealedIndices = [];
    dictationSecondChanceUsed = false;
    hideFeedback();
    const target = sessionQuestions[currentIndex];
    dictationContextDisplay.innerHTML = '';
    dictationContextDisplay.classList.add('hidden');
    dictationContextBtn.disabled = !target.exEn;

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();

    dictationMeaningText.classList.add('hidden');
    dictationMeaningText.textContent = `Spanish meaning: ${target.es}`;
    dictationMeaningHintBtn.disabled = false;

    dictationLetterHintBtn.disabled = false;
    dictationHintsRemainingEl.textContent = '3';
    dictationLetterDisplay.textContent = '';

    dictationAnswerInput.value = '';
    dictationAnswerInput.disabled = false;
    dictationAnswerInput.classList.remove('correct', 'incorrect', 'near-miss');
    dictationCheckBtn.disabled = false;
    dictationAnswerInput.focus();

    setTimeout(() => speakEnglish(target.en, 0.95), 250);
}

function handleDictationLetterHint() {
    if (dictationHintsLeft <= 0 || answerChecked) return;
    const primaryAnswer = sessionQuestions[currentIndex].en.split('/')[0].replace(/\(.*?\)/g, '').trim();
    const candidates = [];
    for (let i = 0; i < primaryAnswer.length; i++) {
        if (primaryAnswer[i] !== ' ' && !dictationRevealedIndices.includes(i)) {
            candidates.push(i);
        }
    }
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    dictationRevealedIndices.push(pick);
    dictationHintsLeft--;
    dictationHintsRemainingEl.textContent = dictationHintsLeft.toString();
    if (dictationHintsLeft === 0) dictationLetterHintBtn.disabled = true;

    let masked = '';
    for (let i = 0; i < primaryAnswer.length; i++) {
        if (primaryAnswer[i] === ' ') masked += '  ';
        else if (dictationRevealedIndices.includes(i)) masked += primaryAnswer[i];
        else masked += '_';
    }
    dictationLetterDisplay.textContent = masked;
    Pusheen.setState('suspicious', null, 2500);
}

function checkDictationAnswer() {
    if (answerChecked) return;
    const userVal = dictationAnswerInput.value.trim();
    if (!userVal) return;

    const target = sessionQuestions[currentIndex];
    const evalRes = checkAnswerMatch(userVal, target.en);

    // Very close → warn and give ONE more chance
    if (evalRes.status === 'near' && !dictationSecondChanceUsed) {
        dictationSecondChanceUsed = true;
        SoundFX.wrong();
        Pusheen.setState('suspicious', null, 2500);
        dictationAnswerInput.classList.remove('correct', 'incorrect');
        dictationAnswerInput.classList.add('near-miss');
        showDictationContext();
        showFeedback('typo', `🤏 <strong>¡Estuviste muy cerca!</strong> "${escapeHtml(userVal)}" casi está bien. Escuchá de nuevo y probá otra vez (te queda 1 chance).`);
        setTimeout(() => speakEnglish(target.en, 0.75), 300);
        dictationAnswerInput.focus();
        dictationAnswerInput.select();
        return;
    }

    answerChecked = true;
    dictationAnswerInput.disabled = true;
    dictationCheckBtn.disabled = true;
    dictationMeaningHintBtn.disabled = true;
    dictationLetterHintBtn.disabled = true;
    dictationContextBtn.disabled = true;
    const footer = exampleFooter(target);

    if (evalRes.status === 'exact' || evalRes.status === 'typo') {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Pusheen.setState('happy');
        dictationAnswerInput.classList.remove('near-miss');
        dictationAnswerInput.classList.add(evalRes.status === 'exact' ? 'correct' : 'near-miss');
        const bonus = dictationSecondChanceUsed ? ' (¡a la segunda!)' : '';
        showFeedback(evalRes.status === 'exact' ? 'correct' : 'typo', `✅ Great ears${bonus}! The term was <strong>${target.en}</strong> (${target.es}).${footer}`);
    } else {
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Pusheen.setState('angry');
        dictationAnswerInput.classList.remove('near-miss');
        dictationAnswerInput.classList.add('incorrect');
        recordMiss(target);
        showFeedback('wrong', `❌ You wrote "${escapeHtml(userVal)}". The spoken term was <strong>${target.en}</strong> (${target.es}).${footer}`);
    }

    nextButton.textContent = (currentIndex + 1 < totalItemsCount) ? 'Next Audio →' : 'See Final Results';
    nextButton.classList.remove('hidden');
}

document.getElementById('dictationPlayNormalBtn').addEventListener('click', () => {
    speakEnglish(sessionQuestions[currentIndex].en, 0.95);
});
document.getElementById('dictationPlaySlowBtn').addEventListener('click', () => {
    speakEnglish(sessionQuestions[currentIndex].en, 0.65);
});
dictationMeaningHintBtn.addEventListener('click', () => {
    dictationMeaningText.classList.remove('hidden');
    dictationMeaningHintBtn.disabled = true;
    Pusheen.setState('suspicious', null, 2500);
});
dictationLetterHintBtn.addEventListener('click', handleDictationLetterHint);
dictationContextBtn.addEventListener('click', () => {
    if (answerChecked) return;
    showDictationContext();
    Pusheen.setState('suspicious', null, 2500);
});
dictationCheckBtn.addEventListener('click', checkDictationAnswer);
dictationAnswerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!answerChecked) checkDictationAnswer();
        else advanceCurrentGame();
    }
});

// =========================================================
// GAME 5: PUSHEEN HANGMAN (WITH REVEAL-LETTER HINT)
// =========================================================
let hangmanTargetWord = '';
let hangmanGuessedLetters = new Set();
let hangmanLives = 6;
let hangmanHintsLeft = 2;

const hangmanHintBtn = document.getElementById('hangmanHintBtn');
const hangmanHintsRemainingEl = document.getElementById('hangmanHintsRemaining');

function initHangmanGame() {
    activeGameTitle.textContent = 'Pusheen Hangman';
    showView('hangman');
    hangmanHintsLeft = 2;
    hangmanHintsRemainingEl.textContent = '2';
    hangmanHintBtn.disabled = false;

    totalItemsCount = Math.min(8, activePool.length);
    totalQuestionsDisplay.textContent = totalItemsCount;
    sessionQuestions = shuffleArray(activePool).slice(0, totalItemsCount);
    loadHangmanQuestion();
}

function loadHangmanQuestion() {
    answerChecked = false;
    hideFeedback();
    const item = sessionQuestions[currentIndex];
    hangmanTargetWord = item.en.split('/')[0].replace(/\(.*?\)/g, '').trim().toUpperCase();
    hangmanGuessedLetters = new Set();
    hangmanLives = 6;

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();
    document.getElementById('hangmanClueText').textContent = item.es;
    document.getElementById('hangmanSpeakBtn').classList.add('hidden');
    hangmanHintBtn.disabled = hangmanHintsLeft <= 0;
    updateHangmanLivesUI();
    renderHangmanSlots();
    renderHangmanKeyboard();
}

hangmanHintBtn.addEventListener('click', () => {
    if (answerChecked || hangmanHintsLeft <= 0) return;
    const unrevealed = [...new Set([...hangmanTargetWord].filter(ch => /[A-Z]/.test(ch) && !hangmanGuessedLetters.has(ch)))];
    if (unrevealed.length === 0) return;

    const chosenLetter = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    const keyBtn = document.querySelector(`#hangmanKeyboard .kb-key[data-letter="${chosenLetter}"]`);
    if (keyBtn) {
        hangmanHintsLeft--;
        hangmanHintsRemainingEl.textContent = hangmanHintsLeft.toString();
        if (hangmanHintsLeft <= 0) hangmanHintBtn.disabled = true;
        Pusheen.setState('suspicious', `Revealed letter "${chosenLetter}" for you! 👀`, 2200);
        handleHangmanGuess(chosenLetter, keyBtn);
    }
});

function updateHangmanLivesUI() {
    const fish = '🐟'.repeat(Math.max(0, hangmanLives)) + '🦴'.repeat(Math.max(0, 6 - hangmanLives));
    document.getElementById('hangmanLivesDisplay').textContent = `${fish} (${hangmanLives} lives)`;
}

function renderHangmanSlots() {
    const container = document.getElementById('hangmanWordSlots');
    container.innerHTML = '';
    const words = hangmanTargetWord.split(' ');
    words.forEach(w => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'inline-flex gap-1';
        for (const ch of w) {
            const isLetter = /[A-Z]/.test(ch);
            const revealed = !isLetter || hangmanGuessedLetters.has(ch) || answerChecked;
            const slot = document.createElement('span');
            slot.className = 'border-b-4 border-[#5c4d47] min-w-[1.3rem] text-center pb-0.5';
            slot.textContent = revealed ? ch : '_';
            wordSpan.appendChild(slot);
        }
        container.appendChild(wordSpan);
    });
}

function renderHangmanKeyboard() {
    const kb = document.getElementById('hangmanKeyboard');
    kb.innerHTML = '';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    alphabet.forEach(letter => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kb-key text-sm sm:text-base';
        btn.textContent = letter;
        btn.dataset.letter = letter;
        btn.addEventListener('click', () => handleHangmanGuess(letter, btn));
        kb.appendChild(btn);
    });
}

function handleHangmanGuess(letter, btnEl) {
    if (answerChecked || hangmanGuessedLetters.has(letter)) return;
    hangmanGuessedLetters.add(letter);
    btnEl.disabled = true;

    const item = sessionQuestions[currentIndex];

    if (hangmanTargetWord.includes(letter)) {
        btnEl.classList.add('key-hit');
        SoundFX.playTone(620, 'sine', 0.1, 0, 0.14);
        renderHangmanSlots();

        const allSolved = [...hangmanTargetWord].every(ch => !/[A-Z]/.test(ch) || hangmanGuessedLetters.has(ch));
        if (allSolved) {
            answerChecked = true;
            hangmanHintBtn.disabled = true;
            score++;
            streak++;
            updateHeaderStats();
            SoundFX.correct();
            Pusheen.setState('happy');
            speakEnglish(item.en);
            document.getElementById('hangmanSpeakBtn').classList.remove('hidden');
            disableAllKeyboardKeys();
            showFeedback('correct', `🎉 Saved Pusheen's treats! Word: <strong>${item.en}</strong>`);
            nextButton.textContent = (currentIndex + 1 < totalItemsCount) ? 'Next Word →' : 'See Final Results';
            nextButton.classList.remove('hidden');
        }
    } else {
        btnEl.classList.add('key-miss');
        hangmanLives--;
        updateHangmanLivesUI();
        SoundFX.wrong();

        if (hangmanLives === 1) {
            Pusheen.setState('nervous');
        } else if (hangmanLives <= 0) {
            answerChecked = true;
            hangmanHintBtn.disabled = true;
            streak = 0;
            updateHeaderStats();
            Pusheen.setState('angry');
            recordMiss(item);
            renderHangmanSlots();
            speakEnglish(item.en);
            document.getElementById('hangmanSpeakBtn').classList.remove('hidden');
            disableAllKeyboardKeys();
            showFeedback('wrong', `😾 Out of lives! The word was <strong>${item.en}</strong>.`);
            nextButton.textContent = (currentIndex + 1 < totalItemsCount) ? 'Next Word →' : 'See Final Results';
            nextButton.classList.remove('hidden');
        } else {
            Pusheen.setState('angry', `No "${letter}"! ${hangmanLives} treats left!`, 1800);
        }
    }
}

function disableAllKeyboardKeys() {
    document.querySelectorAll('#hangmanKeyboard .kb-key').forEach(b => b.disabled = true);
}

document.getElementById('hangmanSpeakBtn').addEventListener('click', () => {
    speakEnglish(sessionQuestions[currentIndex].en);
});

document.addEventListener('keydown', (e) => {
    if (selectedGameType === 'hangman' && !views.hangman.classList.contains('hidden') && !answerChecked) {
        const key = e.key.toUpperCase();
        if (/^[A-Z]$/.test(key)) {
            const btn = document.querySelector(`#hangmanKeyboard .kb-key[data-letter="${key}"]`);
            if (btn && !btn.disabled) handleHangmanGuess(key, btn);
        }
    }
});

// === SHARED NEXT / FINISH FLOW ===
function advanceCurrentGame() {
    currentIndex++;
    if (currentIndex < totalItemsCount) {
        Pusheen.setState('idle');
        if (selectedGameType === 'typing') loadTypingQuestion();
        else if (selectedGameType === 'trivia') loadTriviaQuestion();
        else if (selectedGameType === 'dictation') loadDictationQuestion();
        else if (selectedGameType === 'hangman') loadHangmanQuestion();
    } else {
        finishGame();
    }
}

nextButton.addEventListener('click', advanceCurrentGame);

function finishGame(customSubtitle = null) {
    gameSection.classList.add('hidden');
    document.getElementById('gameOverModal').classList.remove('hidden');

    const pct = totalItemsCount > 0 ? Math.round((score / totalItemsCount) * 100) : 100;
    document.getElementById('finalScore').textContent = `${score} / ${totalItemsCount}`;
    document.getElementById('finalAccuracy').textContent = `Accuracy: ${pct}%`;
    document.getElementById('gameOverSubtitle').textContent = customSubtitle ||
        (pct >= 80 ? 'Outstanding command of Technical English!' : 'Keep practicing those tricky terms!');

    if (pct >= 70) {
        Pusheen.setState('happy', 'You finished! Purr-fect job! 🏆');
    } else {
        Pusheen.setState('suspicious', 'Finished! Review those missed words below!');
    }

    const missedSection = document.getElementById('missedWordsSection');
    const missedList = document.getElementById('missedWordsList');
    missedList.innerHTML = '';

    if (missedWords.length > 0) {
        missedSection.classList.remove('hidden');
        missedWords.forEach(w => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between bg-[#fffdf9] p-2.5 rounded-xl border-2 border-[#d8c7bc] text-xs sm:text-sm';
            row.innerHTML = `
                <div>
                    <span class="font-code font-bold text-[#2f7d65]">${w.en}</span>
                    <span class="text-[#85746d] mx-1">&rarr;</span>
                    <span class="font-bold text-[#433631]">${w.es}</span>
                </div>
                <button type="button" class="btn-audio-pill py-0.5 px-2 text-xs" title="Listen">🔊</button>
            `;
            row.querySelector('button').addEventListener('click', () => speakEnglish(w.en));
            missedList.appendChild(row);
        });
    } else {
        missedSection.classList.add('hidden');
    }
}

// =========================================================
// INTERACTIVE FULL GLOSSARY MODAL (STICKY X + ESC + BACKDROP)
// =========================================================
const glossaryModal = document.getElementById('glossaryModal');
const glossaryContent = document.getElementById('glossaryContent');
const glossarySearchInput = document.getElementById('glossarySearchInput');
const glossaryFilterSelect = document.getElementById('glossaryFilterSelect');
const sortGlossaryBy = document.getElementById('sortGlossaryBy');
const glossaryMatchCount = document.getElementById('glossaryMatchCount');

function closeGlossaryModal() {
    glossaryModal.classList.add('hidden');
}

function renderGlossary() {
    const query = normalize(glossarySearchInput.value);
    const filterMode = glossaryFilterSelect.value;
    const sortBy = sortGlossaryBy.value;

    let list = UNIFIED_GLOSSARY.filter(item => {
        if (filterMode === 'favorites' && !starredSet.has(item.en)) return false;
        if (!query) return true;
        return normalize(item.en).includes(query) || normalize(item.es).includes(query);
    });

    list.sort((a, b) => {
        const valA = sortBy === 'english' ? a.en.toLowerCase() : a.es.toLowerCase();
        const valB = sortBy === 'english' ? b.en.toLowerCase() : b.es.toLowerCase();
        return valA.localeCompare(valB);
    });

    glossaryMatchCount.textContent = `Showing ${list.length} of ${UNIFIED_GLOSSARY.length} terms (${starredSet.size} starred ⭐)`;
    glossaryContent.innerHTML = '';

    list.forEach(item => {
        const isFav = starredSet.has(item.en);
        const card = document.createElement('div');
        card.className = 'cozy-subcard p-3 flex items-center justify-between gap-2';
        card.innerHTML = `
            <div class="min-w-0">
                <p class="font-code font-bold text-[#2f7d65] text-sm break-words">${item.en}</p>
                <p class="text-[#433631] font-bold text-xs sm:text-sm break-words">${item.es}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" class="speak-btn btn-audio-pill py-1 px-2 text-xs" title="Pronounce English">🔊</button>
                <button type="button" class="star-btn w-8 h-8 rounded-full bg-white border-2 border-[#5c4d47] text-sm flex items-center justify-center cursor-pointer hover:bg-[#f9d5e0]" title="Bookmark word">${isFav ? '⭐' : '☆'}</button>
            </div>
        `;
        card.querySelector('.speak-btn').addEventListener('click', () => speakEnglish(item.en));
        const starBtn = card.querySelector('.star-btn');
        starBtn.addEventListener('click', () => {
            toggleFavorite(item.en);
            starBtn.textContent = starredSet.has(item.en) ? '⭐' : '☆';
            glossaryMatchCount.textContent = `Showing ${list.length} of ${UNIFIED_GLOSSARY.length} terms (${starredSet.size} starred ⭐)`;
        });
        glossaryContent.appendChild(card);
    });
}

document.getElementById('showGlossaryBtn').addEventListener('click', () => {
    renderGlossary();
    glossaryModal.classList.remove('hidden');
    const modalBox = glossaryModal.querySelector('.modal-content');
    if (modalBox) modalBox.scrollTop = 0;
});

document.getElementById('glossaryCloseBtn').addEventListener('click', closeGlossaryModal);
document.getElementById('glossaryCloseXBtn').addEventListener('click', closeGlossaryModal);

// Close glossary when clicking dark backdrop outside the card
glossaryModal.addEventListener('click', (e) => {
    if (e.target === glossaryModal) {
        closeGlossaryModal();
    }
});

// Close glossary with Escape key from anywhere
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !glossaryModal.classList.contains('hidden')) {
        closeGlossaryModal();
    }
});

glossarySearchInput.addEventListener('input', renderGlossary);
glossaryFilterSelect.addEventListener('change', renderGlossary);
sortGlossaryBy.addEventListener('change', renderGlossary);

// === INITIAL BOOT ===
syncVolumeUI();
updatePoolCountLabel();
renderSpotlight('word');
resetSpotlightTimer();
renderCarousel();