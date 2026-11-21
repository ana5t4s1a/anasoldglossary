'use strict';

const $ = (id) => document.getElementById(id);

// =========================================================
// SAFE STORAGE (a corrupted value or blocked storage never breaks the app)
// =========================================================
const KEYS = {
    fav: 'tech_english_starred_v2',
    vol: 'tech_english_volume_v2',
    mute: 'tech_english_muted_v2',
    stats: 'tech_english_word_stats_v1',
    daily: 'tech_english_daily_v1',
    best: 'tech_english_best_v1',
    theme: 'tech_english_theme_v1'
};

function storageGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full or blocked: keep working in memory */ }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const storedFavs = storageGet(KEYS.fav, []);
let starredSet = new Set(Array.isArray(storedFavs) ? storedFavs.filter(x => typeof x === 'string') : []);

let masterVolume = Number(storageGet(KEYS.vol, 0.85));
if (!Number.isFinite(masterVolume)) masterVolume = 0.85;
let isMuted = storageGet(KEYS.mute, false) === true;

let wordStats = storageGet(KEYS.stats, {});
if (!isPlainObject(wordStats)) wordStats = {};
let daily = storageGet(KEYS.daily, null);
if (!isPlainObject(daily)) daily = { last: null, streak: 0, best: 0 };
let bests = storageGet(KEYS.best, null);
if (!isPlainObject(bests) || !isPlainObject(bests.match)) bests = { match: {} };

function getEffectiveVolume() {
    return isMuted ? 0 : Math.max(0, Math.min(1, masterVolume));
}

// =========================================================
// THEME (LIGHT / DARK)
// =========================================================
const themeToggleBtn = $('themeToggleBtn');
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    themeToggleBtn.textContent = dark ? '☀️' : '🌙';
    themeToggleBtn.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    if (themeMeta) themeMeta.setAttribute('content', dark ? '#312926' : '#f9d5e0');
}

themeToggleBtn.addEventListener('click', () => {
    const dark = !document.documentElement.classList.contains('dark');
    applyTheme(dark);
    try { localStorage.setItem(KEYS.theme, dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
});

applyTheme(document.documentElement.classList.contains('dark'));

// =========================================================
// AUDIO ENGINE (WEB AUDIO SYNTH + WEB SPEECH)
// =========================================================
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
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
        gain.gain.setValueAtTime(Math.max(0.0001, baseGain * vol), ctx.currentTime + delay);
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
    tick() {
        this.playTone(880, 'square', 0.05, 0, 0.05);
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

// =========================================================
// NARRATOR (TEXT-TO-SPEECH): OWN VOLUME + VOICE PICKER
// Browsers only let a page lower the volume of LOCAL (installed) voices.
// Online voices ("Google US English", Edge "... Online (Natural)") always play at
// full volume, so local voices are preferred and online ones are labelled.
// =========================================================
const NARRATOR_KEY = 'tech_english_narrator_v1';
const VOICE_KEY = 'tech_english_voice_v1';

let narratorVolume = Number(storageGet(NARRATOR_KEY, 0.4));
if (!Number.isFinite(narratorVolume)) narratorVolume = 0.4;
let savedVoiceURI = storageGet(VOICE_KEY, '');
let preferredVoice = null;
let englishVoices = [];

const narratorSlider = $('narratorSlider');
const narratorPercentLabel = $('narratorPercentLabel');
const narratorTestBtn = $('narratorTestBtn');
const voiceSelect = $('voiceSelect');

// Loudness is perceived logarithmically: squaring makes the low end of the slider really quiet
// (40% -> 16% of full volume). The general volume slider scales it too.
function getNarratorVolume() {
    return getEffectiveVolume() * narratorVolume * narratorVolume;
}

function voiceRank(v) {
    return (v.localService ? 10 : 0) +
        (/en[-_]US/i.test(v.lang) ? 2 : 0) +
        (/zira|david|mark|samantha|alex/i.test(v.name) ? 1 : 0);
}

function populateVoices() {
    if (!('speechSynthesis' in window)) {
        voiceSelect.classList.add('hidden');
        return;
    }
    englishVoices = window.speechSynthesis.getVoices()
        .filter(v => /^en[-_]/i.test(v.lang))
        .sort((a, b) => voiceRank(b) - voiceRank(a));
    if (!englishVoices.length) return;

    preferredVoice = englishVoices.find(v => v.voiceURI === savedVoiceURI) || englishVoices[0];
    voiceSelect.replaceChildren(...englishVoices.map(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        const shortName = v.name.replace(/^Microsoft\s+/i, '').replace(/\s*-\s*English.*$/i, '');
        opt.textContent = v.localService ? `🗣️ ${shortName}` : `🌐 ${shortName} (volumen fijo)`;
        opt.selected = v === preferredVoice;
        return opt;
    }));
}

if ('speechSynthesis' in window) {
    populateVoices();
    window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
}

function syncNarratorUI() {
    const pct = Math.round(narratorVolume * 100);
    narratorSlider.value = pct;
    narratorPercentLabel.textContent = `${pct}%`;
    narratorTestBtn.textContent = pct === 0 ? '🤐' : '🗣️';
}

function testNarrator() {
    if (preferredVoice && !preferredVoice.localService) {
        showToast('🌐 Esta voz es online: el navegador no permite bajarle el volumen. Elegí una voz con 🗣️.', 5000);
    }
    speakText('This is the narrator volume.');
}

narratorSlider.addEventListener('input', (e) => {
    narratorVolume = parseInt(e.target.value, 10) / 100;
    storageSet(NARRATOR_KEY, narratorVolume);
    syncNarratorUI();
});
narratorSlider.addEventListener('change', testNarrator); // preview when the slider is released
narratorTestBtn.addEventListener('click', testNarrator);

voiceSelect.addEventListener('change', () => {
    preferredVoice = englishVoices.find(v => v.voiceURI === voiceSelect.value) || preferredVoice;
    savedVoiceURI = preferredVoice ? preferredVoice.voiceURI : '';
    storageSet(VOICE_KEY, savedVoiceURI);
    testNarrator();
});

// "may/can (modal)" -> "may"
function primaryTerm(str) {
    return String(str).split('/')[0].replace(/\(.*?\)/g, '').trim();
}

// onEnd (optional) runs when the voice finishes, fails, or isn't played at all
function speakText(text, rate = 0.95, onEnd = null) {
    const done = () => { if (onEnd) onEnd(); };
    if (!('speechSynthesis' in window)) return done();
    const vol = getNarratorVolume();
    if (vol <= 0.001 || !text) return done();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = rate;
    utterance.volume = vol;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
}

function speakEnglish(term, rate = 0.95) {
    speakText(primaryTerm(term), rate);
}

function speakSentence(sentence, rate = 0.92) {
    speakText(String(sentence || '').replace(/[[\]]/g, ''), rate);
}

// =========================================================
// VOLUME UI
// =========================================================
const volumeSlider = $('volumeSlider');
const muteToggleBtn = $('muteToggleBtn');
const volumePercentLabel = $('volumePercentLabel');

function syncVolumeUI() {
    const pct = Math.round(masterVolume * 100);
    volumeSlider.value = isMuted ? 0 : pct;
    volumePercentLabel.textContent = isMuted ? '0%' : `${pct}%`;
    if (isMuted || pct === 0) muteToggleBtn.textContent = '🔇';
    else if (pct < 45) muteToggleBtn.textContent = '🔉';
    else muteToggleBtn.textContent = '🔊';
    muteToggleBtn.setAttribute('aria-pressed', String(isMuted));
}

volumeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    masterVolume = val / 100;
    isMuted = val === 0;
    storageSet(KEYS.vol, masterVolume);
    storageSet(KEYS.mute, isMuted);
    syncVolumeUI();
});

muteToggleBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (!isMuted && masterVolume === 0) {
        masterVolume = 0.7;
        storageSet(KEYS.vol, masterVolume);
    }
    storageSet(KEYS.mute, isMuted);
    syncVolumeUI();
    if (!isMuted) SoundFX.meow();
});

// =========================================================
// TOAST
// =========================================================
const toastEl = $('toast');
let toastTimer = null;
function showToast(message, ms = 2800) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    // restart the entrance animation
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

// =========================================================
// STRING HELPERS, LEVENSHTEIN & ANSWER CHECKING
// =========================================================
function normalize(str) {
    return String(str)
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/[¿?¡!.,;:"'()[\]{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getAcceptedAnswers(rawString) {
    const parts = String(rawString).split('/').map(normalize).filter(Boolean);
    const fullClean = normalize(rawString);
    if (fullClean && !parts.includes(fullClean)) parts.push(fullClean);
    return parts;
}

function levenshtein(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: a.length + 1 }, (_, j) => j);
    for (let i = 1; i <= b.length; i++) {
        const curr = [i];
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = curr;
    }
    return prev[a.length];
}

// Leading words that don't change the meaning ("to allow" = "allow", "la herencia" = "herencia")
const LEADING_FILLERS = /^(to|the|el|la|los|las|un|una|se) /;
function stripFiller(str) {
    return str.replace(LEADING_FILLERS, '').trim();
}

// --- Precomputed index (search text, meaning tokens, answers of every word) ---
const ALL_EN_ANSWERS = new Set();
const ALL_ES_ANSWERS = new Set();

UNIFIED_GLOSSARY.forEach((item, idx) => {
    item._idx = idx;
    item._units = Array.isArray(item.units) ? item.units : [];
    item._search = normalize(`${item.en} ${item.es} ${(item.alt || []).join(' ')}`);
    const esParts = getAcceptedAnswers(item.es);
    const altParts = (item.alt || []).map(normalize).filter(Boolean);
    item._tokens = new Set([...esParts, ...altParts].map(stripFiller));
    getAcceptedAnswers(item.en).forEach(a => ALL_EN_ANSWERS.add(stripFiller(a)));
    [...esParts, ...altParts].forEach(a => ALL_ES_ANSWERS.add(stripFiller(a)));
});

// Statuses: 'exact' | 'typo' (1 letter off, counts as correct) | 'near' (very close -> second chance) | 'wrong'
// lang = language of the expected answer ('en' | 'es'), used to detect "that's a different glossary word"
function checkAnswerMatch(userInput, correctRaw, extraAnswers = [], lang = 'es') {
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
    String(userInput).split('/').map(normalize).filter(Boolean).forEach(p => userVariants.add(p));
    [...userVariants].forEach(u => userVariants.add(stripFiller(u)));

    for (const u of userVariants) {
        const idx = accepted.findIndex((ans, i) => u === ans || u === acceptedLoose[i]);
        if (idx !== -1) return { status: 'exact', matched: accepted[idx] };
    }

    // The answer is a real, different glossary word (e.g. "then" for "when"): never forgive it as a typo
    const otherWords = lang === 'en' ? ALL_EN_ANSWERS : ALL_ES_ANSWERS;
    for (const u of userVariants) {
        if (otherWords.has(stripFiller(u))) return { status: 'wrong', otherWord: true };
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

    // Only forgive 1-letter typos on words of 5+ letters (on short words 1 letter changes the word)
    if (best.len >= 5 && best.d === 1) return { status: 'typo', matched: best.ans };

    const nearLimit = Math.max(2, Math.round(best.len * 0.4));
    const isPartial = best.u.length >= 4 && best.len >= 4 &&
        accepted.some(ans => ans.includes(best.u) || best.u.includes(ans));
    if ((best.len >= 3 && best.d <= nearLimit) || isPartial) {
        return { status: 'near', matched: best.ans };
    }
    return { status: 'wrong' };
}

// =========================================================
// HTML HELPERS & EXAMPLE SENTENCES
// =========================================================
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Hides the [target] word: "Use a for [loop]" -> "Use a for ____"
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

function wordPair(item) {
    return `<strong>${escapeHtml(item.en)}</strong> = ${escapeHtml(item.es)}`;
}

function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function unitLabel(item) {
    const u = item._units;
    if (u.includes(1) && u.includes(2)) return 'I · II';
    if (u.includes(2)) return 'II';
    if (u.includes(1)) return 'I';
    return '';
}

// =========================================================
// PROGRESS: SPACED REPETITION (LEITNER BOXES), DAILY STREAK, BEST TIMES
// =========================================================
const MASTERED_BOX = 3;

function dayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function touchDailyStreak() {
    const today = dayKey(new Date());
    if (daily.last === today) return;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    daily.streak = daily.last === dayKey(y) ? (daily.streak || 0) + 1 : 1;
    daily.best = Math.max(daily.best || 0, daily.streak);
    daily.last = today;
    storageSet(KEYS.daily, daily);
}

function currentDailyStreak() {
    const today = dayKey(new Date());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return (daily.last === today || daily.last === dayKey(y)) ? (daily.streak || 0) : 0;
}

// Correct -> moves up one box (max 5). Wrong -> back to box 1.
function recordResult(item, correct) {
    const s = isPlainObject(wordStats[item.en]) ? wordStats[item.en] : { box: 0, c: 0, w: 0, last: 0 };
    if (correct) {
        s.c = (s.c || 0) + 1;
        s.box = Math.min(5, (s.box || 0) + 1);
    } else {
        s.w = (s.w || 0) + 1;
        s.box = 1;
    }
    s.last = Date.now();
    wordStats[item.en] = s;
    storageSet(KEYS.stats, wordStats);
    touchDailyStreak();
}

function masteredCount() {
    return UNIFIED_GLOSSARY.filter(item => (wordStats[item.en]?.box || 0) >= MASTERED_BOX).length;
}

// Weighted pick: low boxes and frequently missed words come up more often
function smartPick(pool, n) {
    const bag = pool.map(item => {
        const s = wordStats[item.en];
        const weight = s ? Math.pow(6 - (s.box || 0), 2) + (s.w || 0) * 2 : 12;
        return { item, weight };
    });
    const picked = [];
    while (picked.length < n && bag.length) {
        const total = bag.reduce((sum, b) => sum + b.weight, 0);
        let r = Math.random() * total;
        let i = 0;
        while (i < bag.length - 1 && r >= bag[i].weight) {
            r -= bag[i].weight;
            i++;
        }
        picked.push(bag.splice(i, 1)[0].item);
    }
    return picked;
}

function pickQuestions(pool, n) {
    const count = Math.min(n, pool.length);
    if (wordPoolSelect.value === 'smart' && !reviewPool) return smartPick(pool, count);
    return shuffleArray(pool).slice(0, count);
}

function renderStats() {
    const total = UNIFIED_GLOSSARY.length;
    const mastered = masteredCount();
    $('statMastered').textContent = `${mastered}/${total}`;
    $('statMasteredBar').style.width = `${Math.round((mastered / total) * 100)}%`;
    $('statStreak').textContent = `${currentDailyStreak()} 🔥`;
    $('statBestStreak').textContent = `Best: ${daily.best || 0} day${daily.best === 1 ? '' : 's'}`;

    let c = 0;
    let w = 0;
    Object.values(wordStats).forEach(s => {
        if (isPlainObject(s)) {
            c += s.c || 0;
            w += s.w || 0;
        }
    });
    $('statAnswers').textContent = c + w;
    $('statAccuracy').textContent = c + w ? `Accuracy: ${Math.round((c / (c + w)) * 100)}%` : 'Accuracy: –';

    const pairs = questionCountSelect.value;
    const best = bests.match[pairs];
    $('statBestMatch').textContent = typeof best === 'number' ? `${best.toFixed(1)}s` : '–';
    $('statBestMatch').nextElementSibling.textContent = `fastest (${pairs} pairs)`;
}

// =========================================================
// PRONUNCIATION PRACTICE (SPEECH RECOGNITION, CHROME / EDGE / SAFARI)
// =========================================================
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRecognition = null;

function practicePronunciation(term, btn) {
    if (!SpeechRec) return;
    if (activeRecognition) {
        activeRecognition.abort();
        return;
    }
    const spoken = primaryTerm(term);
    const target = normalize(spoken);
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    activeRecognition = rec;
    btn && btn.classList.add('listening');
    showToast(`🎤 Listening... say "${spoken}"`, 6000);

    rec.onresult = (e) => {
        const alternatives = [...e.results[0]].map(r => normalize(r.transcript));
        const heard = e.results[0][0].transcript;
        const closest = Math.min(...alternatives.map(a => levenshtein(a, target)));
        const ok = alternatives.includes(target) || closest <= Math.max(1, Math.floor(target.length * 0.2));
        if (ok) {
            SoundFX.correct();
            showToast(`✅ Great pronunciation! I heard "${heard}".`);
        } else {
            SoundFX.wrong();
            showToast(`🤔 I heard "${heard}". Listen and try again!`, 3500);
        }
    };
    rec.onerror = (e) => {
        if (e.error === 'aborted') return;
        showToast(e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? '🎤 Microphone permission was denied.'
            : "🎤 I couldn't hear you. Try again!");
    };
    rec.onend = () => {
        btn && btn.classList.remove('listening');
        activeRecognition = null;
    };
    try {
        rec.start();
    } catch (err) {
        activeRecognition = null;
        btn && btn.classList.remove('listening');
    }
}

// =========================================================
// HOME SPOTLIGHT (WORDS & CODE FACTS)
// =========================================================
const CODE_FACTS_EN = [
    {
        title: 'Web Speech API Pronunciation',
        detail: "Every word is read by your browser's native speechSynthesis engine — zero MP3 files needed!"
    },
    {
        title: 'Levenshtein Edit Distance',
        detail: "An edit-distance algorithm forgives 1-letter typos on long words and gives you a second chance when you're very close."
    },
    {
        title: 'Real-Time Web Audio Synthesizer',
        detail: 'Every chime and buzzer is generated mathematically with OscillatorNode waveforms!'
    },
    {
        title: 'Spaced Repetition (Leitner Boxes)',
        detail: 'Each right answer moves a word up a box; a miss sends it back to box 1. Smart Review shows low-box words more often.'
    },
    {
        title: 'Fisher-Yates Unbiased Shuffle',
        detail: 'Every round uses the Fisher-Yates algorithm, so no two study sessions follow the same order.'
    },
    {
        title: 'Works Offline (PWA)',
        detail: 'A service worker caches the app, so once it is opened online you can install it and study without internet.'
    },
    {
        title: `Unified ${UNIFIED_GLOSSARY.length}-Term Dataset`,
        detail: 'Technical English I & II terms live in a single array in glossary.js, tagged by unit.'
    }
];

let currentSpotlightItem = null;
let spotlightTimer = null;
let showWordNext = true;

const spotlightBadge = $('spotlightBadge');
const spotlightMainText = $('spotlightMainText');
const spotlightSubText = $('spotlightSubText');
const spotlightSpeakBtn = $('spotlightSpeakBtn');
const spotlightMicBtn = $('spotlightMicBtn');
const spotlightStarBtn = $('spotlightStarBtn');
const spotlightNextBtn = $('spotlightNextBtn');
const heroMascotBtn = $('heroPusheenBtn');
const welcomeScreen = $('welcomeScreen');

function updateSpotlightStarBtn() {
    if (!currentSpotlightItem || currentSpotlightItem.type !== 'word') {
        spotlightStarBtn.classList.add('hidden');
        return;
    }
    spotlightStarBtn.classList.remove('hidden');
    const isFav = starredSet.has(currentSpotlightItem.en);
    spotlightStarBtn.textContent = isFav ? '⭐' : '☆';
    spotlightStarBtn.setAttribute('aria-pressed', String(isFav));
}

function renderSpotlight(forceType = null) {
    const useWord = forceType ? forceType === 'word' : showWordNext;
    showWordNext = !useWord;

    if (useWord) {
        const entry = UNIFIED_GLOSSARY[Math.floor(Math.random() * UNIFIED_GLOSSARY.length)];
        currentSpotlightItem = { type: 'word', en: entry.en, es: entry.es };
        spotlightBadge.textContent = '🐾 Word Spotlight';
        spotlightBadge.className = 'spotlight-tag tag-word';
        spotlightMainText.innerHTML = `<span class="font-code text-mint-dark">${escapeHtml(entry.en)}</span>`;
        spotlightSubText.textContent = `Meaning: ${entry.es}`;
        spotlightSpeakBtn.classList.remove('hidden');
        spotlightMicBtn.classList.toggle('hidden', !SpeechRec);
    } else {
        const fact = CODE_FACTS_EN[Math.floor(Math.random() * CODE_FACTS_EN.length)];
        currentSpotlightItem = { type: 'code', title: fact.title, detail: fact.detail };
        spotlightBadge.textContent = '💻 Code Fun Fact';
        spotlightBadge.className = 'spotlight-tag tag-code';
        spotlightMainText.textContent = fact.title;
        spotlightSubText.textContent = fact.detail;
        spotlightSpeakBtn.classList.remove('hidden');
        spotlightMicBtn.classList.add('hidden');
    }
    updateSpotlightStarBtn();
}

// Time each word / fact stays on screen (was 8.5 s, +4 s)
const SPOTLIGHT_INTERVAL_MS = 12500;
let spotlightReading = false;

function resetSpotlightTimer() {
    clearInterval(spotlightTimer);
    spotlightTimer = setInterval(() => {
        // Never change the card while it is being read aloud
        const stillSpeaking = spotlightReading || ('speechSynthesis' in window && window.speechSynthesis.speaking);
        if (!welcomeScreen.classList.contains('hidden') && !stillSpeaking) renderSpotlight();
    }, SPOTLIGHT_INTERVAL_MS);
}

// Reads the current word or fun fact; the card stays until the reading ends,
// then it gets a full interval again before rotating
function readSpotlight() {
    if (!currentSpotlightItem) return;
    const text = currentSpotlightItem.type === 'word'
        ? primaryTerm(currentSpotlightItem.en)
        : `${currentSpotlightItem.title}. ${currentSpotlightItem.detail}`;
    spotlightReading = true;
    clearInterval(spotlightTimer);
    speakText(text, 0.95, () => {
        spotlightReading = false;
        resetSpotlightTimer();
    });
}

function stopSpotlightReading() {
    if (spotlightReading && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    spotlightReading = false;
}

// Don't rotate the spotlight while the tab is in the background
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(spotlightTimer);
    else resetSpotlightTimer();
});

spotlightSpeakBtn.addEventListener('click', readSpotlight);

spotlightMicBtn.addEventListener('click', () => {
    if (currentSpotlightItem?.type === 'word') {
        clearInterval(spotlightTimer);
        practicePronunciation(currentSpotlightItem.en, spotlightMicBtn);
        resetSpotlightTimer();
    }
});

spotlightStarBtn.addEventListener('click', () => {
    if (currentSpotlightItem?.type === 'word') toggleFavorite(currentSpotlightItem.en);
});

spotlightNextBtn.addEventListener('click', () => {
    stopSpotlightReading();
    renderSpotlight();
    resetSpotlightTimer();
});

heroMascotBtn.addEventListener('click', () => {
    stopSpotlightReading();
    SoundFX.meow();
    renderSpotlight();
    resetSpotlightTimer();
});

// =========================================================
// FAVORITES
// =========================================================
function saveFavorites() {
    storageSet(KEYS.fav, [...starredSet]);
    updatePoolCountLabel();
}

function toggleFavorite(enTerm) {
    if (starredSet.has(enTerm)) starredSet.delete(enTerm);
    else starredSet.add(enTerm);
    saveFavorites();
    updateSpotlightStarBtn();
}

// =========================================================
// GAME CATALOG & CAROUSEL
// =========================================================
const ICON_STROKE = 'stroke="#5c4d47" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

const GAMES_CATALOG = [
    {
        id: 'typing',
        name: 'Code Typing',
        btnLabel: 'Start Code Typing',
        desc: 'Classic translation challenge with letter hints, example sentences, a second chance when you are close, and audio.',
        showDirection: true,
        showDifficulty: true,
        showTimer: true,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="16" width="52" height="32" rx="7" fill="#f9d5e0" ${ICON_STROKE}/>
                <rect x="13" y="23" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="23" y="23" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="33" y="23" width="6" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="43" y="23" width="8" height="5" rx="1.5" fill="#fffaf5" stroke="#5c4d47" stroke-width="2"/>
                <rect x="18" y="35" width="28" height="6" rx="2" fill="#cdeee1" stroke="#5c4d47" stroke-width="2"/>
              </svg>`
    },
    {
        id: 'match',
        name: 'Syntax Match',
        btnLabel: 'Start Syntax Match',
        desc: 'Pair English terms with their Spanish meanings against the stopwatch. Beat your best time!',
        showDirection: false,
        showDifficulty: false,
        showTimer: false,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="14" width="22" height="16" rx="4" fill="#cdeee1" ${ICON_STROKE}/>
                <rect x="36" y="34" width="22" height="16" rx="4" fill="#f9d5e0" ${ICON_STROKE}/>
                <path d="M28 22 C40 22, 24 42, 36 42" fill="none" ${ICON_STROKE}/>
                <circle cx="28" cy="22" r="2.5" fill="#5c4d47"/>
                <circle cx="36" cy="42" r="2.5" fill="#5c4d47"/>
              </svg>`
    },
    {
        id: 'trivia',
        name: 'Multiple Choice',
        btnLabel: 'Start Multiple Choice',
        desc: 'Pick the right meaning among 4 options (keys 1–4 work too) — great for longer IDE concepts.',
        showDirection: true,
        showDifficulty: false,
        showTimer: true,
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
        showTimer: true,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 38 C15 18, 49 18, 49 38" fill="none" stroke="#5c4d47" stroke-width="4" stroke-linecap="round"/>
                <rect x="10" y="34" width="11" height="17" rx="5" fill="#e8def8" ${ICON_STROKE}/>
                <rect x="43" y="34" width="11" height="17" rx="5" fill="#e8def8" ${ICON_STROKE}/>
              </svg>`
    },
    {
        id: 'hangman',
        name: 'Pusheen Hangman',
        btnLabel: 'Start Hangman',
        desc: 'Decode the English word letter by letter before you run out of lives! Type letters on your keyboard.',
        showDirection: false,
        showDifficulty: false,
        showTimer: false,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="5" y="20" width="16" height="20" rx="3" fill="#cdeee1" ${ICON_STROKE}/>
                <rect x="24" y="20" width="16" height="20" rx="3" fill="#fffaf5" ${ICON_STROKE}/>
                <rect x="43" y="20" width="16" height="20" rx="3" fill="#f9d5e0" ${ICON_STROKE}/>
                <text x="13" y="35" text-anchor="middle" font-family="monospace" font-weight="700" font-size="13" fill="#433631">A</text>
                <line x1="28" y1="35" x2="36" y2="35" stroke="#5c4d47" stroke-width="2.5" stroke-linecap="round"/>
                <text x="51" y="35" text-anchor="middle" font-family="monospace" font-weight="700" font-size="13" fill="#433631">I</text>
              </svg>`
    },
    {
        id: 'sentence',
        name: 'Fill the Sentence',
        btnLabel: 'Start Fill the Sentence',
        desc: 'Read a real technical sentence and type the missing English word. The Spanish version is your clue.',
        showDirection: false,
        showDifficulty: false,
        showTimer: true,
        svg: `<svg width="42" height="42" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 14 H56 V42 H26 L16 52 V42 H8 Z" fill="#e8def8" ${ICON_STROKE}/>
                <line x1="15" y1="23" x2="49" y2="23" stroke="#5c4d47" stroke-width="2.5" stroke-linecap="round"/>
                <line x1="15" y1="33" x2="24" y2="33" stroke="#5c4d47" stroke-width="2.5" stroke-linecap="round"/>
                <rect x="28" y="29" width="21" height="8" rx="2" fill="#cdeee1" stroke="#5c4d47" stroke-width="2"/>
              </svg>`
    }
];

let carouselIndex = 0;

const carouselDots = $('carouselDots');
const carouselCardStage = $('carouselCardStage');
const startGameDirectBtn = $('startGameDirectBtn');

// Dots are created once; renderCarousel only moves the "active" class
GAMES_CATALOG.forEach((g, idx) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'carousel-dot';
    dot.setAttribute('aria-label', g.name);
    dot.addEventListener('click', () => {
        carouselIndex = idx;
        renderCarousel();
    });
    carouselDots.appendChild(dot);
});
$('carouselTotalLabel').textContent = GAMES_CATALOG.length;

function renderCarousel() {
    const game = GAMES_CATALOG[carouselIndex];
    $('carouselIndexLabel').textContent = carouselIndex + 1;
    $('carouselGameIcon').innerHTML = game.svg;
    $('carouselGameTitle').textContent = game.name;
    $('carouselGameDesc').textContent = game.desc;
    $('startGameBtnLabel').textContent = game.btnLabel;

    $('inlineDirectionWrapper').classList.toggle('hidden', !game.showDirection);
    $('inlineDifficultyWrapper').classList.toggle('hidden', !game.showDifficulty);
    $('inlineTimerWrapper').classList.toggle('hidden', !game.showTimer);
    $('inlineCountWrapper').querySelector('label').textContent = game.id === 'match' ? 'Pairs' : 'Questions';

    carouselCardStage.classList.remove('carousel-stage-anim');
    void carouselCardStage.offsetWidth;
    carouselCardStage.classList.add('carousel-stage-anim');

    [...carouselDots.children].forEach((dot, idx) => {
        dot.classList.toggle('active', idx === carouselIndex);
        dot.setAttribute('aria-current', idx === carouselIndex ? 'true' : 'false');
    });
    updatePoolCountLabel();
}

function moveCarousel(step) {
    carouselIndex = (carouselIndex + step + GAMES_CATALOG.length) % GAMES_CATALOG.length;
    renderCarousel();
}

$('carouselPrevBtn').addEventListener('click', () => moveCarousel(-1));
$('carouselNextBtn').addEventListener('click', () => moveCarousel(1));

// =========================================================
// IN-GAME CORNER MASCOT CONTROLLER
// =========================================================
const Mascot = {
    widget: $('pusheenCornerWidget'),
    bubble: $('pusheenCornerBubble'),
    eyesIdle: $('eyesIdle'),
    eyesHappy: $('eyesHappy'),
    eyesAngry: $('eyesAngry'),
    eyesSuspicious: $('eyesSuspicious'),
    mouthCute: $('mouthCute'),
    mouthAngry: $('mouthAngry'),
    sparkles: document.querySelector('#pusheenCornerWidget .corner-sparkle'),
    steam: document.querySelector('#pusheenCornerWidget .corner-steam'),
    timer: null,

    quotes: {
        idle: [
            "Meow! Ready to code & learn? 🐾",
            'Purr... You got this!',
            "Need a hint? I won't judge... much.",
            'Technical English II master in progress! 💻'
        ],
        happy: [
            'Purr-fect! Clean syntax! ✨',
            'Meow-velous! Keep that streak alive! 🐟',
            'Zero bugs detected! Genius!',
            "You're compiling knowledge fast! 🚀"
        ],
        angry: [
            'HISSS! Syntax Error!! 💢',
            'Are you even reading the glossary?!',
            'My whiskers are twitching in disappointment...',
            '404: Right Answer Not Found! 😾',
            'No treats for you until you get one right!'
        ],
        suspicious: [
            'Using a hint? Hmm... okay, just this once. 👀',
            'Peeking at the code, I see...'
        ],
        nervous: [
            'Careful! Only 1 treat left! 🐟💦',
            "Don't make me hiss! Think carefully!"
        ]
    },

    show() {
        this.widget.classList.remove('hidden');
    },

    hide() {
        clearTimeout(this.timer);
        this.widget.classList.add('hidden');
    },

    setState(state, customText = null, autoResetMs = 0) {
        clearTimeout(this.timer);
        this.widget.classList.remove('state-idle', 'state-happy', 'state-angry', 'state-suspicious', 'state-nervous');
        this.widget.classList.add(`state-${state}`);

        [this.eyesIdle, this.eyesHappy, this.eyesAngry, this.eyesSuspicious, this.mouthAngry]
            .forEach(el => el && el.classList.add('hidden'));
        this.mouthCute && this.mouthCute.classList.remove('hidden');
        this.sparkles && this.sparkles.setAttribute('opacity', '0');
        this.steam && this.steam.setAttribute('opacity', '0');

        if (state === 'happy') {
            this.eyesHappy && this.eyesHappy.classList.remove('hidden');
            this.sparkles && this.sparkles.setAttribute('opacity', '1');
        } else if (state === 'angry') {
            this.eyesAngry && this.eyesAngry.classList.remove('hidden');
            this.mouthCute && this.mouthCute.classList.add('hidden');
            this.mouthAngry && this.mouthAngry.classList.remove('hidden');
            this.steam && this.steam.setAttribute('opacity', '1');
        } else if (state === 'suspicious' || state === 'nervous') {
            this.eyesSuspicious && this.eyesSuspicious.classList.remove('hidden');
        } else {
            this.eyesIdle && this.eyesIdle.classList.remove('hidden');
        }

        const pool = this.quotes[state] || this.quotes.idle;
        this.bubble.textContent = customText || pool[Math.floor(Math.random() * pool.length)];

        if (autoResetMs > 0) {
            this.timer = setTimeout(() => this.setState('idle'), autoResetMs);
        }
    }
};

$('pusheenCornerBtn').addEventListener('click', () => {
    SoundFX.meow();
    Mascot.setState('happy', 'Meow! *purrs softly* 🐾', 2500);
});

// =========================================================
// GLOBAL GAME STATE
// =========================================================
let selectedGameType = 'typing';
let activePool = [];
let sessionQuestions = [];
let currentIndex = 0;
let score = 0;
let streak = 0;
let totalItemsCount = 10;
let missedWords = [];
let answerChecked = false;
let reviewPool = null; // set by "Practice the missed words"

const gameSection = $('gameSection');
const gameOverModal = $('gameOverModal');
const glossaryModal = $('glossaryModal');
const wordPoolSelect = $('wordPoolSelect');
const poolCountInfo = $('poolCountInfo');
const gameModeSelect = $('gameModeSelect');
const difficultySelect = $('difficultySelect');
const questionCountSelect = $('questionCountSelect');
const timerSelect = $('timerSelect');

const activeGameTitle = $('activeGameTitle');
const currentQuestionNumber = $('currentQuestionNumber');
const totalQuestionsDisplay = $('totalQuestionsDisplay');
const currentScoreEl = $('currentScore');
const streakBadge = $('streakBadge');
const feedbackMessage = $('feedbackMessage');
const nextButton = $('nextButton');
const keyboardTip = $('keyboardTip');

const views = {
    typing: $('viewTyping'),
    match: $('viewMatch'),
    trivia: $('viewTrivia'),
    dictation: $('viewDictation'),
    hangman: $('viewHangman'),
    sentence: $('viewSentence')
};

// Timeouts that must die when the player leaves a game (fixes ghost rounds / ghost "Game Over")
const pendingTimeouts = new Set();
function later(fn, ms) {
    const id = setTimeout(() => {
        pendingTimeouts.delete(id);
        fn();
    }, ms);
    pendingTimeouts.add(id);
    return id;
}
function clearPending() {
    pendingTimeouts.forEach(clearTimeout);
    pendingTimeouts.clear();
}

// --- Word pools ---
function getBasePool() {
    if (reviewPool) return reviewPool;
    switch (wordPoolSelect.value) {
        case 'favorites': return UNIFIED_GLOSSARY.filter(item => starredSet.has(item.en));
        case 'unit1': return UNIFIED_GLOSSARY.filter(item => item._units.includes(1));
        case 'unit2': return UNIFIED_GLOSSARY.filter(item => item._units.includes(2));
        default: return [...UNIFIED_GLOSSARY];
    }
}

function matchesDifficulty(item) {
    const len = primaryTerm(item.en).length;
    switch (difficultySelect.value) {
        case 'easy': return len <= 5;
        case 'normal': return len >= 6 && len <= 8;
        case 'medium': return len >= 9 && len <= 11;
        case 'hard': return len >= 12;
        default: return true;
    }
}

function getGamePool(gameId) {
    let pool = getBasePool();
    if (gameId === 'typing') pool = pool.filter(matchesDifficulty);
    if (gameId === 'sentence') pool = pool.filter(item => item.exEn && /\[.+?\]/.test(item.exEn));
    return pool;
}

function updatePoolCountLabel() {
    const total = UNIFIED_GLOSSARY.length;
    const unit1 = UNIFIED_GLOSSARY.filter(i => i._units.includes(1)).length;
    const unit2 = UNIFIED_GLOSSARY.filter(i => i._units.includes(2)).length;
    $('totalWordsBadge').textContent = total;

    const labels = {
        all: `All Glossary Words (${total})`,
        unit1: `Technical English I (${unit1})`,
        unit2: `Technical English II (${unit2})`,
        smart: `🧠 Smart Review (${masteredCount()}/${total} mastered)`,
        favorites: `Starred Favorites Only (${starredSet.size} ⭐)`
    };
    [...wordPoolSelect.options].forEach(opt => { if (labels[opt.value]) opt.text = labels[opt.value]; });

    const gFilter = $('glossaryFilterSelect');
    const gLabels = { all: `Show All ${total} Terms`, unit1: labels.unit1, unit2: labels.unit2, favorites: `Starred Favorites Only (${starredSet.size} ⭐)` };
    [...gFilter.options].forEach(opt => { if (gLabels[opt.value]) opt.text = gLabels[opt.value]; });

    const game = GAMES_CATALOG[carouselIndex];
    const pool = getGamePool(game.id);
    if (pool.length === 0) {
        poolCountInfo.textContent = wordPoolSelect.value === 'favorites' && starredSet.size === 0
            ? 'No starred words yet! Click ☆ on any word in the Spotlight or Glossary first.'
            : 'No words match this combination. Try another word bank or difficulty.';
        poolCountInfo.className = 'text-xs font-extrabold text-danger mt-3';
        startGameDirectBtn.disabled = true;
    } else {
        const count = Math.min(Number(questionCountSelect.value), pool.length);
        poolCountInfo.textContent = `Ready: ${count} ${game.id === 'match' ? 'pairs' : 'questions'} from ${pool.length} technical terms.`;
        poolCountInfo.className = 'text-xs font-bold text-cocoa-soft mt-3';
        startGameDirectBtn.disabled = false;
    }
}

[wordPoolSelect, difficultySelect, questionCountSelect].forEach(sel => sel.addEventListener('change', () => {
    updatePoolCountLabel();
    renderStats();
}));

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

// type: 'correct' | 'typo' | 'wrong'
function showFeedback(type, htmlContent) {
    feedbackMessage.className = `mt-5 p-4 rounded-xl text-left font-bold fb-${type}`;
    feedbackMessage.innerHTML = htmlContent;
}

function hideFeedback() {
    feedbackMessage.classList.add('hidden');
    nextButton.classList.add('hidden');
    keyboardTip.textContent = '';
}

// Shows "Next" and moves focus there, so Enter / Space advance (inputs are disabled at this point)
let nextShownAt = 0;
function revealNext(label) {
    nextButton.textContent = (currentIndex + 1 < totalItemsCount) ? label : 'See Final Results';
    nextButton.classList.remove('hidden');
    nextShownAt = performance.now();
    keyboardTip.textContent = 'Press Enter to continue';
    nextButton.focus({ preventScroll: true });
}

function recordMiss(wordObj) {
    if (!missedWords.some(w => w.en === wordObj.en)) missedWords.push(wordObj);
}

function questionCount() {
    return Number(questionCountSelect.value) || 10;
}

// =========================================================
// PER-QUESTION TIMER (OPTIONAL)
// =========================================================
const TIMED_GAMES = new Set(['typing', 'trivia', 'dictation', 'sentence']);
const questionTimerBadge = $('questionTimerBadge');
const questionTimerValue = $('questionTimerValue');
let questionTimer = null;

function stopQuestionTimer() {
    clearInterval(questionTimer);
    questionTimer = null;
}

function startQuestionTimer(onExpire) {
    stopQuestionTimer();
    const limit = Number(timerSelect.value);
    if (!limit || !TIMED_GAMES.has(selectedGameType)) {
        questionTimerBadge.classList.add('hidden');
        return;
    }
    let left = limit;
    questionTimerValue.textContent = left;
    questionTimerBadge.classList.remove('hidden', 'text-danger');
    questionTimer = setInterval(() => {
        left--;
        questionTimerValue.textContent = Math.max(0, left);
        if (left <= 5) {
            questionTimerBadge.classList.add('text-danger');
            if (left > 0) SoundFX.tick();
        }
        if (left <= 0) {
            stopQuestionTimer();
            onExpire();
        }
    }, 1000);
}

// =========================================================
// START & NAVIGATION
// =========================================================
startGameDirectBtn.addEventListener('click', () => {
    reviewPool = null;
    selectedGameType = GAMES_CATALOG[carouselIndex].id;
    startSelectedGame();
});

function startSelectedGame() {
    const pool = getGamePool(selectedGameType);
    if (pool.length === 0) return;

    activePool = pool;
    score = 0;
    streak = 0;
    currentIndex = 0;
    missedWords = [];
    clearPending();
    stopQuestionTimer();
    clearInterval(matchTimerInterval);
    questionTimerBadge.classList.add('hidden');

    welcomeScreen.classList.add('hidden');
    closeModal(gameOverModal, false);
    gameSection.classList.remove('hidden');

    Mascot.show();
    Mascot.setState('idle');

    const inits = {
        typing: initTypingGame,
        match: initMatchGame,
        trivia: initTriviaGame,
        dictation: initDictationGame,
        hangman: initHangmanGame,
        sentence: initSentenceGame
    };
    inits[selectedGameType]();
}

function goHome() {
    clearPending();
    stopQuestionTimer();
    clearInterval(matchTimerInterval);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    reviewPool = null;
    gameSection.classList.add('hidden');
    closeModal(gameOverModal, false);
    welcomeScreen.classList.remove('hidden');
    Mascot.hide();
    updatePoolCountLabel();
    renderStats();
    renderSpotlight();
    startGameDirectBtn.focus({ preventScroll: true });
}

$('gameGoHomeBtn').addEventListener('click', goHome);
$('gameOverHomeBtn').addEventListener('click', goHome);
$('gameOverRestartBtn').addEventListener('click', startSelectedGame);
$('reviewMissedBtn').addEventListener('click', () => {
    if (!missedWords.length) return;
    reviewPool = [...missedWords];
    startSelectedGame();
});

function advanceCurrentGame() {
    currentIndex++;
    if (currentIndex < totalItemsCount) {
        Mascot.setState('idle');
        const loaders = {
            typing: loadTypingQuestion,
            trivia: loadTriviaQuestion,
            dictation: loadDictationQuestion,
            hangman: loadHangmanQuestion,
            sentence: loadSentenceQuestion
        };
        loaders[selectedGameType] && loaders[selectedGameType]();
    } else {
        finishGame();
    }
}

nextButton.addEventListener('click', () => {
    // Ignore the auto-repeat of a held Enter key right after "Next" appears
    if (performance.now() - nextShownAt < 300) return;
    advanceCurrentGame();
});

// Shared letter-hint mask: "a_ _ow" style
function buildMask(answer, revealed) {
    let masked = '';
    for (let i = 0; i < answer.length; i++) {
        if (answer[i] === ' ') masked += '  ';
        else if (revealed.includes(i)) masked += answer[i];
        else masked += '_';
    }
    return masked;
}

function revealRandomLetter(answer, revealed) {
    const candidates = [];
    for (let i = 0; i < answer.length; i++) {
        if (answer[i] !== ' ' && !revealed.includes(i)) candidates.push(i);
    }
    if (!candidates.length) return false;
    revealed.push(candidates[Math.floor(Math.random() * candidates.length)]);
    return true;
}

// =========================================================
// GAME 1: CODE TYPING
// =========================================================
let typingHintsLeft = 3;
let typingRevealedIndices = [];
let currentTypingQ = null;
let typingSecondChanceUsed = false;

const typingQuestionText = $('typingQuestionText');
const typingSpeakBtn = $('typingSpeakBtn');
const typingAnswerInput = $('typingAnswerInput');
const typingCheckBtn = $('typingCheckBtn');
const typingHintBtn = $('typingHintBtn');
const hintsRemainingEl = $('hintsRemaining');
const hintDisplay = $('hintDisplay');
const typingContextBtn = $('typingContextBtn');
const typingContextDisplay = $('typingContextDisplay');

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
    sessionQuestions = pickQuestions(activePool, questionCount());
    totalItemsCount = sessionQuestions.length;
    totalQuestionsDisplay.textContent = totalItemsCount;
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
    typingQuestionText.lang = isEsToEn ? 'es' : 'en';
    typingSpeakBtn.classList.toggle('hidden', isEsToEn);
    if (!isEsToEn) speakEnglish(item.en);

    typingAnswerInput.value = '';
    typingAnswerInput.disabled = false;
    typingAnswerInput.lang = isEsToEn ? 'en' : 'es';
    typingAnswerInput.classList.remove('correct', 'incorrect', 'near-miss');
    typingCheckBtn.disabled = false;
    typingHintBtn.disabled = false;
    hintsRemainingEl.textContent = '3';
    hintDisplay.textContent = '';
    typingContextDisplay.innerHTML = '';
    typingContextDisplay.classList.add('hidden');
    typingContextBtn.disabled = !item.exEn;
    typingAnswerInput.focus();

    startQuestionTimer(() => finalizeTyping({ status: 'wrong' }, '', true));
}

function handleTypingHint() {
    if (typingHintsLeft <= 0 || answerChecked) return;
    const primaryAnswer = primaryTerm(currentTypingQ.answer);
    if (!revealRandomLetter(primaryAnswer, typingRevealedIndices)) return;
    typingHintsLeft--;
    hintsRemainingEl.textContent = typingHintsLeft;
    if (typingHintsLeft === 0) typingHintBtn.disabled = true;
    hintDisplay.textContent = buildMask(primaryAnswer, typingRevealedIndices);
    Mascot.setState('suspicious', null, 2500);
}

function checkTypingAnswer() {
    if (answerChecked) return;
    const userVal = typingAnswerInput.value.trim();
    if (!userVal) return;

    const toSpanish = currentTypingQ.direction === 'en_to_es';
    const extra = toSpanish ? (currentTypingQ.wordObj.alt || []) : [];
    const evalRes = checkAnswerMatch(userVal, currentTypingQ.answer, extra, toSpanish ? 'es' : 'en');

    // Very close -> warn and give ONE more chance
    if (evalRes.status === 'near' && !typingSecondChanceUsed) {
        typingSecondChanceUsed = true;
        SoundFX.wrong();
        Mascot.setState('suspicious', null, 2500);
        typingAnswerInput.classList.remove('correct', 'incorrect');
        typingAnswerInput.classList.add('near-miss');
        showTypingContext();
        showFeedback('typo', `🤏 <strong>¡Estuviste muy cerca!</strong> "${escapeHtml(userVal)}" casi está bien. Revisalo y probá otra vez (te queda 1 chance).`);
        typingAnswerInput.focus();
        typingAnswerInput.select();
        return;
    }

    finalizeTyping(evalRes, userVal, false);
}

function finalizeTyping(evalRes, userVal, timedOut) {
    if (answerChecked) return;
    answerChecked = true;
    stopQuestionTimer();
    typingAnswerInput.disabled = true;
    typingCheckBtn.disabled = true;
    typingHintBtn.disabled = true;
    typingContextBtn.disabled = true;

    const item = currentTypingQ.wordObj;
    const footer = exampleFooter(item);
    speakEnglish(item.en);

    const ok = evalRes.status === 'exact' || evalRes.status === 'typo';
    recordResult(item, ok);

    if (ok) {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Mascot.setState('happy');
        typingAnswerInput.classList.remove('near-miss');
        if (evalRes.status === 'exact') {
            typingAnswerInput.classList.add('correct');
            const bonus = typingSecondChanceUsed ? ' (¡a la segunda!)' : '';
            showFeedback('correct', `✅ Correct${bonus}! ${wordPair(item)}${footer}`);
        } else {
            typingAnswerInput.classList.add('near-miss');
            showFeedback('typo', `⚠️ Almost exact (1-letter typo accepted)! Full answer: <strong>${escapeHtml(currentTypingQ.answer)}</strong>${footer}`);
        }
    } else {
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Mascot.setState('angry');
        typingAnswerInput.classList.remove('near-miss');
        typingAnswerInput.classList.add('incorrect');
        recordMiss(item);
        let prefix = '❌ Incorrect.';
        if (timedOut) prefix = "⏰ Time's up!";
        else if (evalRes.otherWord) prefix = `❌ "${escapeHtml(userVal)}" is a different glossary word.`;
        else if (evalRes.status === 'near') prefix = '❌ ¡Casi! Pero no.';
        showFeedback('wrong', `${prefix} The right answer is: <strong>${escapeHtml(currentTypingQ.answer)}</strong>${footer}`);
    }

    revealNext('Next Word →');
}

typingSpeakBtn.addEventListener('click', () => currentTypingQ && speakEnglish(currentTypingQ.wordObj.en));
typingHintBtn.addEventListener('click', handleTypingHint);
typingContextBtn.addEventListener('click', () => {
    if (answerChecked) return;
    showTypingContext();
    Mascot.setState('suspicious', null, 2500);
});
typingCheckBtn.addEventListener('click', checkTypingAnswer);
typingAnswerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        checkTypingAnswer();
    }
});

// =========================================================
// GAME 2: SYNTAX MATCH
// =========================================================
const MATCH_PAIRS_PER_ROUND = 5;
let matchRounds = [];
let matchRoundNum = 1;
let matchSelectedEn = null;
let matchSelectedEs = null;
let matchPairsMatchedInRound = 0;
let matchAttempts = 0;
let matchStartTime = 0;
let matchTimerInterval = null;
let matchHintsLeft = 2;

const matchHintBtn = $('matchHintBtn');
const matchHintsRemainingEl = $('matchHintsRemaining');
const matchColEn = $('matchColEn');
const matchColEs = $('matchColEs');

function initMatchGame() {
    activeGameTitle.textContent = 'Syntax Match';
    showView('match');

    // Pick every word up front -> no repeats between rounds
    const words = pickQuestions(activePool, questionCount());
    matchRounds = chunk(words, MATCH_PAIRS_PER_ROUND);
    matchRoundNum = 1;
    matchAttempts = 0;
    matchHintsLeft = 2;
    matchHintsRemainingEl.textContent = '2';
    matchHintBtn.disabled = false;

    totalItemsCount = words.length;
    totalQuestionsDisplay.textContent = totalItemsCount;
    currentQuestionNumber.textContent = '1';
    updateHeaderStats();

    matchStartTime = performance.now();
    clearInterval(matchTimerInterval);
    $('matchTimer').textContent = '0.0';
    matchTimerInterval = setInterval(() => {
        $('matchTimer').textContent = ((performance.now() - matchStartTime) / 1000).toFixed(1);
    }, 100);

    loadMatchRound();
}

function makeMatchTile(item, side) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = side === 'en' ? 'match-tile font-code text-xs sm:text-sm' : 'match-tile text-xs sm:text-sm';
    btn.textContent = side === 'en' ? item.en : item.es.replace(/\(.*?\)/g, '').trim();
    if (side === 'es') btn.lang = 'es';
    btn.dataset.en = item.en;
    btn.addEventListener('click', () => handleMatchSelect(side, btn, item));
    return btn;
}

function loadMatchRound() {
    hideFeedback();
    matchSelectedEn = null;
    matchSelectedEs = null;
    matchPairsMatchedInRound = 0;
    $('matchRound').textContent = `${matchRoundNum}/${matchRounds.length}`;

    const roundWords = matchRounds[matchRoundNum - 1];
    matchColEn.replaceChildren(...shuffleArray(roundWords).map(item => makeMatchTile(item, 'en')));
    matchColEs.replaceChildren(...shuffleArray(roundWords).map(item => makeMatchTile(item, 'es')));
}

matchHintBtn.addEventListener('click', () => {
    if (matchHintsLeft <= 0) return;
    const unmatchedEn = [...matchColEn.querySelectorAll('.match-tile:not(.matched)')];
    if (unmatchedEn.length === 0) return;

    document.querySelectorAll('.match-tile.hint-glow').forEach(t => t.classList.remove('hint-glow'));
    const pickEn = unmatchedEn[Math.floor(Math.random() * unmatchedEn.length)];
    const pickEs = [...matchColEs.querySelectorAll('.match-tile:not(.matched)')].find(t => t.dataset.en === pickEn.dataset.en);

    pickEn.classList.add('hint-glow');
    if (pickEs) pickEs.classList.add('hint-glow');
    speakEnglish(pickEn.dataset.en);

    matchHintsLeft--;
    matchHintsRemainingEl.textContent = matchHintsLeft;
    if (matchHintsLeft <= 0) matchHintBtn.disabled = true;
    Mascot.setState('suspicious', 'Highlighted a matching pair for you! 👀', 2500);
});

function handleMatchSelect(side, btnEl, wordObj) {
    if (btnEl.classList.contains('matched')) return;
    btnEl.classList.remove('hint-glow');

    if (side === 'en') {
        speakEnglish(wordObj.en);
        if (matchSelectedEn) matchSelectedEn.el.classList.remove('selected');
        matchSelectedEn = { el: btnEl, wordObj };
    } else {
        if (matchSelectedEs) matchSelectedEs.el.classList.remove('selected');
        matchSelectedEs = { el: btnEl, wordObj };
    }
    btnEl.classList.add('selected');

    if (!matchSelectedEn || !matchSelectedEs) return;

    const enPair = matchSelectedEn;
    const esPair = matchSelectedEs;
    matchSelectedEn = null;
    matchSelectedEs = null;
    matchAttempts++;

    if (enPair.wordObj.en === esPair.wordObj.en) {
        [enPair.el, esPair.el].forEach(el => {
            el.classList.remove('selected', 'hint-glow');
            el.classList.add('matched');
            el.setAttribute('aria-disabled', 'true');
        });
        score++;
        streak++;
        matchPairsMatchedInRound++;
        recordResult(enPair.wordObj, true);
        currentQuestionNumber.textContent = Math.min(score + 1, totalItemsCount);
        updateHeaderStats();
        SoundFX.correct();
        Mascot.setState('happy', null, 1800);

        if (matchPairsMatchedInRound >= matchRounds[matchRoundNum - 1].length) {
            if (matchRoundNum < matchRounds.length) {
                showFeedback('correct', `✨ Round ${matchRoundNum} cleared! Get ready for the next batch...`);
                later(() => {
                    matchRoundNum++;
                    loadMatchRound();
                }, 950);
            } else {
                clearInterval(matchTimerInterval);
                const finalSec = (performance.now() - matchStartTime) / 1000;
                const key = String(questionCountSelect.value);
                const prevBest = bests.match[key];
                const isRecord = !reviewPool && totalItemsCount === Number(key) && (typeof prevBest !== 'number' || finalSec < prevBest);
                if (isRecord) {
                    bests.match[key] = Number(finalSec.toFixed(1));
                    storageSet(KEYS.best, bests);
                }
                const subtitle = `Completed in ${finalSec.toFixed(1)}s${isRecord ? ' — new personal best! 🏆' : ''}`;
                const accuracy = Math.round((score / matchAttempts) * 100);
                later(() => finishGame({ subtitle, accuracy }), 600);
            }
        }
    } else {
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Mascot.setState('angry', null, 2000);
        recordMiss(enPair.wordObj);
        recordResult(enPair.wordObj, false);
        enPair.el.classList.add('wrong-flash');
        esPair.el.classList.add('wrong-flash');
        later(() => {
            enPair.el.classList.remove('selected', 'wrong-flash');
            esPair.el.classList.remove('selected', 'wrong-flash');
        }, 420);
    }
}

// =========================================================
// GAME 3: MULTIPLE CHOICE (50/50 HINT, KEYS 1-4 / A-D)
// =========================================================
let currentTriviaQ = null;
const triviaHintBtn = $('triviaHintBtn');
const triviaOptionsGrid = $('triviaOptionsGrid');

function initTriviaGame() {
    activeGameTitle.textContent = 'Multiple Choice';
    showView('trivia');
    sessionQuestions = pickQuestions(activePool, questionCount());
    totalItemsCount = sessionQuestions.length;
    totalQuestionsDisplay.textContent = totalItemsCount;
    loadTriviaQuestion();
}

// Two words "overlap" when they share a Spanish meaning (case/chassis, hence/therefore...)
function meaningsOverlap(a, b) {
    for (const t of a._tokens) if (b._tokens.has(t)) return true;
    return primaryTerm(a.en).toLowerCase() === primaryTerm(b.en).toLowerCase();
}

function pickDistractors(target) {
    const sources = activePool.length >= 4 ? [activePool, UNIFIED_GLOSSARY] : [UNIFIED_GLOSSARY];
    const chosen = [];
    for (const source of sources) {
        for (const w of shuffleArray(source)) {
            if (chosen.length === 3) return chosen;
            if (w === target || chosen.includes(w) || meaningsOverlap(target, w)) continue;
            if (chosen.some(c => meaningsOverlap(c, w))) continue;
            chosen.push(w);
        }
    }
    return chosen;
}

function loadTriviaQuestion() {
    answerChecked = false;
    hideFeedback();
    triviaHintBtn.disabled = false;

    const target = sessionQuestions[currentIndex];
    const mode = gameModeSelect.value;
    const isEnToEs = mode === 'en_to_es' || (mode === 'mixed' && Math.random() < 0.5);
    const options = shuffleArray([target, ...pickDistractors(target)]);
    currentTriviaQ = { target, isEnToEs, options };

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();

    $('triviaPromptTag').textContent = isEnToEs ? 'Select Spanish Meaning' : 'Select English Term';
    const questionEl = $('triviaQuestionText');
    questionEl.textContent = isEnToEs ? target.en : target.es;
    questionEl.lang = isEnToEs ? 'en' : 'es';
    $('triviaSpeakBtn').classList.toggle('hidden', !isEnToEs);
    if (isEnToEs) speakEnglish(target.en);

    const letters = ['A', 'B', 'C', 'D'];
    triviaOptionsGrid.replaceChildren(...options.map((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mc-option text-sm sm:text-base';
        btn.dataset.idx = idx;
        btn.innerHTML = `<span class="mc-letter" aria-hidden="true">${letters[idx]}</span> <span ${isEnToEs ? 'lang="es"' : ''}>${escapeHtml(isEnToEs ? opt.es : opt.en)}</span>`;
        btn.addEventListener('click', () => checkTriviaChoice(btn, opt));
        return btn;
    }));

    startQuestionTimer(() => checkTriviaChoice(null, null));
}

triviaHintBtn.addEventListener('click', () => {
    if (answerChecked || !currentTriviaQ) return;
    triviaHintBtn.disabled = true;
    const allBtns = [...triviaOptionsGrid.querySelectorAll('.mc-option')];
    const wrongIndices = currentTriviaQ.options
        .map((opt, idx) => (opt !== currentTriviaQ.target ? idx : -1))
        .filter(idx => idx !== -1);
    shuffleArray(wrongIndices).slice(0, 2).forEach(idx => {
        allBtns[idx].disabled = true;
        allBtns[idx].classList.add('mc-eliminated');
    });
    Mascot.setState('suspicious', '50/50 used! Two wrong choices removed 👀', 2500);
});

// clickedBtn / chosenOpt are null when the timer runs out
function checkTriviaChoice(clickedBtn, chosenOpt) {
    if (answerChecked) return;
    answerChecked = true;
    stopQuestionTimer();
    triviaHintBtn.disabled = true;

    const { target } = currentTriviaQ;
    triviaOptionsGrid.querySelectorAll('.mc-option').forEach((b, idx) => {
        b.disabled = true;
        if (currentTriviaQ.options[idx] === target) b.classList.add('mc-correct');
    });

    speakEnglish(target.en);
    const ok = chosenOpt === target;
    recordResult(target, ok);

    if (ok) {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Mascot.setState('happy');
        showFeedback('correct', `✅ Spot on! ${wordPair(target)}${exampleFooter(target)}`);
    } else {
        if (clickedBtn) clickedBtn.classList.add('mc-wrong');
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Mascot.setState('angry');
        recordMiss(target);
        const prefix = clickedBtn ? '❌ Not quite.' : "⏰ Time's up!";
        showFeedback('wrong', `${prefix} <strong>${escapeHtml(target.en)}</strong> means <strong>${escapeHtml(target.es)}</strong>.${exampleFooter(target)}`);
    }

    revealNext('Next Question →');
}

$('triviaSpeakBtn').addEventListener('click', () => {
    if (currentTriviaQ) speakEnglish(currentTriviaQ.target.en);
});

// =========================================================
// GAME 4: AUDIO DICTATION
// =========================================================
const dictationAnswerInput = $('dictationAnswerInput');
const dictationCheckBtn = $('dictationCheckBtn');
const dictationMeaningText = $('dictationMeaningText');
const dictationMeaningHintBtn = $('dictationMeaningHintBtn');
const dictationLetterHintBtn = $('dictationLetterHintBtn');
const dictationHintsRemainingEl = $('dictationHintsRemaining');
const dictationLetterDisplay = $('dictationLetterDisplay');
const dictationContextBtn = $('dictationContextBtn');
const dictationContextDisplay = $('dictationContextDisplay');

let dictationHintsLeft = 3;
let dictationRevealedIndices = [];
let dictationSecondChanceUsed = false;

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
    sessionQuestions = pickQuestions(activePool, questionCount());
    totalItemsCount = sessionQuestions.length;
    totalQuestionsDisplay.textContent = totalItemsCount;
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

    later(() => speakEnglish(target.en, 0.95), 250);
    startQuestionTimer(() => finalizeDictation({ status: 'wrong' }, '', true));
}

function handleDictationLetterHint() {
    if (dictationHintsLeft <= 0 || answerChecked) return;
    const primaryAnswer = primaryTerm(sessionQuestions[currentIndex].en);
    if (!revealRandomLetter(primaryAnswer, dictationRevealedIndices)) return;
    dictationHintsLeft--;
    dictationHintsRemainingEl.textContent = dictationHintsLeft;
    if (dictationHintsLeft === 0) dictationLetterHintBtn.disabled = true;
    dictationLetterDisplay.textContent = buildMask(primaryAnswer, dictationRevealedIndices);
    Mascot.setState('suspicious', null, 2500);
}

function checkDictationAnswer() {
    if (answerChecked) return;
    const userVal = dictationAnswerInput.value.trim();
    if (!userVal) return;

    const target = sessionQuestions[currentIndex];
    const evalRes = checkAnswerMatch(userVal, target.en, [], 'en');

    if (evalRes.status === 'near' && !dictationSecondChanceUsed) {
        dictationSecondChanceUsed = true;
        SoundFX.wrong();
        Mascot.setState('suspicious', null, 2500);
        dictationAnswerInput.classList.remove('correct', 'incorrect');
        dictationAnswerInput.classList.add('near-miss');
        showDictationContext();
        showFeedback('typo', `🤏 <strong>¡Estuviste muy cerca!</strong> "${escapeHtml(userVal)}" casi está bien. Escuchá de nuevo y probá otra vez (te queda 1 chance).`);
        later(() => speakEnglish(target.en, 0.75), 300);
        dictationAnswerInput.focus();
        dictationAnswerInput.select();
        return;
    }

    finalizeDictation(evalRes, userVal, false);
}

function finalizeDictation(evalRes, userVal, timedOut) {
    if (answerChecked) return;
    answerChecked = true;
    stopQuestionTimer();
    dictationAnswerInput.disabled = true;
    dictationCheckBtn.disabled = true;
    dictationMeaningHintBtn.disabled = true;
    dictationLetterHintBtn.disabled = true;
    dictationContextBtn.disabled = true;

    const target = sessionQuestions[currentIndex];
    const footer = exampleFooter(target);
    const ok = evalRes.status === 'exact' || evalRes.status === 'typo';
    recordResult(target, ok);

    if (ok) {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Mascot.setState('happy');
        dictationAnswerInput.classList.remove('near-miss');
        dictationAnswerInput.classList.add(evalRes.status === 'exact' ? 'correct' : 'near-miss');
        const bonus = dictationSecondChanceUsed ? ' (¡a la segunda!)' : '';
        showFeedback(evalRes.status === 'exact' ? 'correct' : 'typo',
            `✅ Great ears${bonus}! The term was <strong>${escapeHtml(target.en)}</strong> (${escapeHtml(target.es)}).${footer}`);
    } else {
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Mascot.setState('angry');
        dictationAnswerInput.classList.remove('near-miss');
        dictationAnswerInput.classList.add('incorrect');
        recordMiss(target);
        const said = timedOut ? "⏰ Time's up!" : `❌ You wrote "${escapeHtml(userVal)}".`;
        showFeedback('wrong', `${said} The spoken term was <strong>${escapeHtml(target.en)}</strong> (${escapeHtml(target.es)}).${footer}`);
    }

    revealNext('Next Audio →');
}

$('dictationPlayNormalBtn').addEventListener('click', () => speakEnglish(sessionQuestions[currentIndex].en, 0.95));
$('dictationPlaySlowBtn').addEventListener('click', () => speakEnglish(sessionQuestions[currentIndex].en, 0.65));
dictationMeaningHintBtn.addEventListener('click', () => {
    dictationMeaningText.classList.remove('hidden');
    dictationMeaningHintBtn.disabled = true;
    Mascot.setState('suspicious', null, 2500);
});
dictationLetterHintBtn.addEventListener('click', handleDictationLetterHint);
dictationContextBtn.addEventListener('click', () => {
    if (answerChecked) return;
    showDictationContext();
    Mascot.setState('suspicious', null, 2500);
});
dictationCheckBtn.addEventListener('click', checkDictationAnswer);
dictationAnswerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        checkDictationAnswer();
    }
});

// =========================================================
// GAME 5: HANGMAN
// =========================================================
let hangmanTargetWord = '';
let hangmanGuessedLetters = new Set();
let hangmanLives = 6;
let hangmanHintsLeft = 2;

const hangmanHintBtn = $('hangmanHintBtn');
const hangmanHintsRemainingEl = $('hangmanHintsRemaining');
const hangmanKeyboard = $('hangmanKeyboard');

function initHangmanGame() {
    activeGameTitle.textContent = 'Pusheen Hangman';
    showView('hangman');
    hangmanHintsLeft = 2;
    hangmanHintsRemainingEl.textContent = '2';
    hangmanHintBtn.disabled = false;

    sessionQuestions = pickQuestions(activePool, questionCount());
    totalItemsCount = sessionQuestions.length;
    totalQuestionsDisplay.textContent = totalItemsCount;
    loadHangmanQuestion();
}

function loadHangmanQuestion() {
    answerChecked = false;
    hideFeedback();
    const item = sessionQuestions[currentIndex];
    hangmanTargetWord = primaryTerm(item.en).toUpperCase();
    hangmanGuessedLetters = new Set();
    hangmanLives = 6;

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();
    $('hangmanClueText').textContent = item.es;
    $('hangmanClueText').lang = 'es';
    $('hangmanSpeakBtn').classList.add('hidden');
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
    const keyBtn = hangmanKeyboard.querySelector(`.kb-key[data-letter="${chosenLetter}"]`);
    if (keyBtn) {
        hangmanHintsLeft--;
        hangmanHintsRemainingEl.textContent = hangmanHintsLeft;
        if (hangmanHintsLeft <= 0) hangmanHintBtn.disabled = true;
        Mascot.setState('suspicious', `Revealed letter "${chosenLetter}" for you! 👀`, 2200);
        handleHangmanGuess(chosenLetter, keyBtn);
    }
});

function updateHangmanLivesUI() {
    const fish = '🐟'.repeat(Math.max(0, hangmanLives)) + '🦴'.repeat(Math.max(0, 6 - hangmanLives));
    $('hangmanLivesDisplay').textContent = `${fish} (${hangmanLives} lives)`;
}

function renderHangmanSlots() {
    const container = $('hangmanWordSlots');
    container.replaceChildren(...hangmanTargetWord.split(' ').map(w => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'inline-flex gap-1';
        for (const ch of w) {
            const isLetter = /[A-Z]/.test(ch);
            const revealed = !isLetter || hangmanGuessedLetters.has(ch) || answerChecked;
            const slot = document.createElement('span');
            slot.className = 'border-b-4 border-cocoa min-w-[1.3rem] text-center pb-0.5';
            slot.textContent = revealed ? ch : '_';
            wordSpan.appendChild(slot);
        }
        return wordSpan;
    }));
    const hidden = [...hangmanTargetWord].filter(ch => /[A-Z]/.test(ch) && !hangmanGuessedLetters.has(ch)).length;
    container.setAttribute('aria-label', answerChecked ? hangmanTargetWord : `${hidden} letters left`);
}

function renderHangmanKeyboard() {
    hangmanKeyboard.replaceChildren(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kb-key text-sm sm:text-base';
        btn.textContent = letter;
        btn.dataset.letter = letter;
        btn.addEventListener('click', () => handleHangmanGuess(letter, btn));
        return btn;
    }));
}

function finishHangmanWord(won) {
    const item = sessionQuestions[currentIndex];
    answerChecked = true;
    hangmanHintBtn.disabled = true;
    recordResult(item, won);
    renderHangmanSlots();
    speakEnglish(item.en);
    $('hangmanSpeakBtn').classList.remove('hidden');
    hangmanKeyboard.querySelectorAll('.kb-key').forEach(b => { b.disabled = true; });

    if (won) {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Mascot.setState('happy');
        showFeedback('correct', `🎉 Saved Pusheen's treats! Word: <strong>${escapeHtml(item.en)}</strong>${exampleFooter(item)}`);
    } else {
        streak = 0;
        updateHeaderStats();
        Mascot.setState('angry');
        recordMiss(item);
        showFeedback('wrong', `😾 Out of lives! The word was <strong>${escapeHtml(item.en)}</strong>.${exampleFooter(item)}`);
    }
    revealNext('Next Word →');
}

function handleHangmanGuess(letter, btnEl) {
    if (answerChecked || hangmanGuessedLetters.has(letter)) return;
    hangmanGuessedLetters.add(letter);
    btnEl.disabled = true;

    if (hangmanTargetWord.includes(letter)) {
        btnEl.classList.add('key-hit');
        SoundFX.playTone(620, 'sine', 0.1, 0, 0.14);
        renderHangmanSlots();
        const allSolved = [...hangmanTargetWord].every(ch => !/[A-Z]/.test(ch) || hangmanGuessedLetters.has(ch));
        if (allSolved) finishHangmanWord(true);
    } else {
        btnEl.classList.add('key-miss');
        hangmanLives--;
        updateHangmanLivesUI();
        SoundFX.wrong();
        if (hangmanLives <= 0) finishHangmanWord(false);
        else if (hangmanLives === 1) Mascot.setState('nervous');
        else Mascot.setState('angry', `No "${letter}"! ${hangmanLives} treats left!`, 1800);
    }
}

$('hangmanSpeakBtn').addEventListener('click', () => speakEnglish(sessionQuestions[currentIndex].en));

// =========================================================
// GAME 6: FILL THE SENTENCE
// =========================================================
const sentenceQuestionText = $('sentenceQuestionText');
const sentenceTranslation = $('sentenceTranslation');
const sentenceAnswerInput = $('sentenceAnswerInput');
const sentenceCheckBtn = $('sentenceCheckBtn');
const sentenceHintBtn = $('sentenceHintBtn');
const sentenceHintsRemainingEl = $('sentenceHintsRemaining');
const sentenceHintDisplay = $('sentenceHintDisplay');
const sentenceMeaningBtn = $('sentenceMeaningBtn');
const sentenceMeaningText = $('sentenceMeaningText');
const sentenceSpeakBtn = $('sentenceSpeakBtn');

let currentSentenceQ = null;
let sentenceHintsLeft = 3;
let sentenceRevealedIndices = [];
let sentenceSecondChanceUsed = false;

// The word inside [brackets] of the English example, e.g. "works in"
function sentenceAnswer(item) {
    const m = item.exEn.match(/\[(.+?)\]/);
    return m ? m[1] : primaryTerm(item.en);
}

function initSentenceGame() {
    activeGameTitle.textContent = 'Fill the Sentence';
    showView('sentence');
    sessionQuestions = pickQuestions(activePool, questionCount());
    totalItemsCount = sessionQuestions.length;
    totalQuestionsDisplay.textContent = totalItemsCount;
    loadSentenceQuestion();
}

function loadSentenceQuestion() {
    answerChecked = false;
    sentenceHintsLeft = 3;
    sentenceRevealedIndices = [];
    sentenceSecondChanceUsed = false;
    hideFeedback();

    const item = sessionQuestions[currentIndex];
    currentSentenceQ = { item, answer: sentenceAnswer(item) };

    currentQuestionNumber.textContent = currentIndex + 1;
    updateHeaderStats();

    sentenceQuestionText.innerHTML = blankSentence(item.exEn);
    sentenceTranslation.innerHTML = item.exEs ? `🇪🇸 ${revealSentence(item.exEs)}` : '';
    sentenceSpeakBtn.classList.add('hidden');
    sentenceMeaningText.classList.add('hidden');
    sentenceMeaningText.textContent = `Meaning: ${item.es}`;
    sentenceMeaningBtn.disabled = false;
    sentenceHintBtn.disabled = false;
    sentenceHintsRemainingEl.textContent = '3';
    sentenceHintDisplay.textContent = '';

    sentenceAnswerInput.value = '';
    sentenceAnswerInput.disabled = false;
    sentenceAnswerInput.classList.remove('correct', 'incorrect', 'near-miss');
    sentenceCheckBtn.disabled = false;
    sentenceAnswerInput.focus();

    startQuestionTimer(() => finalizeSentence({ status: 'wrong' }, '', true));
}

function checkSentenceAnswer() {
    if (answerChecked) return;
    const userVal = sentenceAnswerInput.value.trim();
    if (!userVal) return;

    const { item, answer } = currentSentenceQ;
    const evalRes = checkAnswerMatch(userVal, `${answer}/${item.en}`, [], 'en');

    if (evalRes.status === 'near' && !sentenceSecondChanceUsed) {
        sentenceSecondChanceUsed = true;
        SoundFX.wrong();
        Mascot.setState('suspicious', null, 2500);
        sentenceAnswerInput.classList.remove('correct', 'incorrect');
        sentenceAnswerInput.classList.add('near-miss');
        showFeedback('typo', `🤏 <strong>¡Estuviste muy cerca!</strong> "${escapeHtml(userVal)}" casi está bien. Revisalo y probá otra vez (te queda 1 chance).`);
        sentenceAnswerInput.focus();
        sentenceAnswerInput.select();
        return;
    }

    finalizeSentence(evalRes, userVal, false);
}

function finalizeSentence(evalRes, userVal, timedOut) {
    if (answerChecked) return;
    answerChecked = true;
    stopQuestionTimer();
    sentenceAnswerInput.disabled = true;
    sentenceCheckBtn.disabled = true;
    sentenceHintBtn.disabled = true;
    sentenceMeaningBtn.disabled = true;

    const { item, answer } = currentSentenceQ;
    sentenceQuestionText.innerHTML = revealSentence(item.exEn);
    sentenceSpeakBtn.classList.remove('hidden');
    speakSentence(item.exEn);

    const ok = evalRes.status === 'exact' || evalRes.status === 'typo';
    recordResult(item, ok);

    if (ok) {
        score++;
        streak++;
        updateHeaderStats();
        SoundFX.correct();
        Mascot.setState('happy');
        sentenceAnswerInput.classList.remove('near-miss');
        sentenceAnswerInput.classList.add(evalRes.status === 'exact' ? 'correct' : 'near-miss');
        const bonus = sentenceSecondChanceUsed ? ' (¡a la segunda!)' : '';
        showFeedback(evalRes.status === 'exact' ? 'correct' : 'typo',
            `✅ Well done${bonus}! <strong>${escapeHtml(answer)}</strong> — ${wordPair(item)}`);
    } else {
        streak = 0;
        updateHeaderStats();
        SoundFX.wrong();
        Mascot.setState('angry');
        sentenceAnswerInput.classList.remove('near-miss');
        sentenceAnswerInput.classList.add('incorrect');
        recordMiss(item);
        let prefix = '❌ Not quite.';
        if (timedOut) prefix = "⏰ Time's up!";
        else if (evalRes.otherWord) prefix = `❌ "${escapeHtml(userVal)}" is a different glossary word.`;
        showFeedback('wrong', `${prefix} The missing word was <strong>${escapeHtml(answer)}</strong> — ${wordPair(item)}`);
    }

    revealNext('Next Sentence →');
}

sentenceHintBtn.addEventListener('click', () => {
    if (sentenceHintsLeft <= 0 || answerChecked) return;
    const answer = currentSentenceQ.answer;
    if (!revealRandomLetter(answer, sentenceRevealedIndices)) return;
    sentenceHintsLeft--;
    sentenceHintsRemainingEl.textContent = sentenceHintsLeft;
    if (sentenceHintsLeft === 0) sentenceHintBtn.disabled = true;
    sentenceHintDisplay.textContent = buildMask(answer, sentenceRevealedIndices);
    Mascot.setState('suspicious', null, 2500);
});
sentenceMeaningBtn.addEventListener('click', () => {
    sentenceMeaningText.classList.remove('hidden');
    sentenceMeaningBtn.disabled = true;
    Mascot.setState('suspicious', null, 2500);
});
sentenceSpeakBtn.addEventListener('click', () => currentSentenceQ && speakSentence(currentSentenceQ.item.exEn));
sentenceCheckBtn.addEventListener('click', checkSentenceAnswer);
sentenceAnswerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        checkSentenceAnswer();
    }
});

// =========================================================
// GAME OVER
// =========================================================
function finishGame({ subtitle = null, accuracy = null } = {}) {
    stopQuestionTimer();
    gameSection.classList.add('hidden');

    const pct = accuracy ?? (totalItemsCount > 0 ? Math.round((score / totalItemsCount) * 100) : 100);
    $('finalScore').textContent = `${score} / ${totalItemsCount}`;
    $('finalAccuracy').textContent = `Accuracy: ${pct}%`;
    $('gameOverSubtitle').textContent = subtitle ||
        (pct >= 80 ? 'Outstanding command of Technical English!' : 'Keep practicing those tricky terms!');

    if (pct >= 70) Mascot.setState('happy', 'You finished! Purr-fect job! 🏆');
    else Mascot.setState('suspicious', 'Finished! Review those missed words below!');

    const missedSection = $('missedWordsSection');
    const missedList = $('missedWordsList');
    const reviewBtn = $('reviewMissedBtn');

    if (missedWords.length > 0) {
        missedSection.classList.remove('hidden');
        reviewBtn.classList.remove('hidden');
        reviewBtn.textContent = `🔁 Practice the ${missedWords.length} missed word${missedWords.length === 1 ? '' : 's'}`;
        missedList.replaceChildren(...missedWords.map(w => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between gap-2 bg-cream-card p-2.5 rounded-xl border-2 border-line text-xs sm:text-sm';
            row.innerHTML = `
                <div class="min-w-0">
                    <span class="font-code font-bold text-mint-dark">${escapeHtml(w.en)}</span>
                    <span class="text-cocoa-soft mx-1" aria-hidden="true">&rarr;</span>
                    <span lang="es" class="font-bold text-cocoa-dark">${escapeHtml(w.es)}</span>
                </div>
                <button type="button" class="btn-audio-pill py-0.5 px-2 text-xs shrink-0" aria-label="Listen to ${escapeHtml(w.en)}">🔊</button>
            `;
            row.querySelector('button').addEventListener('click', () => speakEnglish(w.en));
            return row;
        }));
    } else {
        missedSection.classList.add('hidden');
        reviewBtn.classList.add('hidden');
        missedList.replaceChildren();
    }

    renderStats();
    openModal(gameOverModal, missedWords.length ? reviewBtn : $('gameOverRestartBtn'));
}

// =========================================================
// MODALS (FOCUS MANAGEMENT + FOCUS TRAP)
// =========================================================
let lastFocusedBeforeModal = null;
const isOpen = (modal) => !modal.classList.contains('hidden');

function openModal(modal, focusEl) {
    lastFocusedBeforeModal = document.activeElement;
    modal.classList.remove('hidden');
    const box = modal.querySelector('.modal-content');
    if (box) box.scrollTop = 0;
    (focusEl || modal.querySelector('button, input, select'))?.focus({ preventScroll: true });
}

function closeModal(modal, restoreFocus = true) {
    if (!isOpen(modal)) return;
    modal.classList.add('hidden');
    if (restoreFocus && lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal)) {
        lastFocusedBeforeModal.focus({ preventScroll: true });
    }
}

function trapFocus(e) {
    const modal = [glossaryModal, gameOverModal].find(isOpen);
    if (!modal) return;
    const focusables = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select, summary')]
        .filter(el => el.offsetParent !== null || el.type === 'file');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!modal.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

// =========================================================
// GLOSSARY MODAL (DELEGATED EVENTS, DEBOUNCED SEARCH, EXAMPLES)
// =========================================================
const glossaryContent = $('glossaryContent');
const glossarySearchInput = $('glossarySearchInput');
const glossaryFilterSelect = $('glossaryFilterSelect');
const sortGlossaryBy = $('sortGlossaryBy');
const glossaryMatchCount = $('glossaryMatchCount');

const collator = new Intl.Collator('es', { sensitivity: 'base' });
const SORTED = {
    english: [...UNIFIED_GLOSSARY].sort((a, b) => collator.compare(a.en, b.en)),
    spanish: [...UNIFIED_GLOSSARY].sort((a, b) => collator.compare(a.es, b.es))
};

let glossaryListLength = 0;
function updateGlossaryCount() {
    glossaryMatchCount.textContent = `Showing ${glossaryListLength} of ${UNIFIED_GLOSSARY.length} terms (${starredSet.size} starred ⭐)`;
}

function glossaryCardHtml(item) {
    const isFav = starredSet.has(item.en);
    const en = escapeHtml(item.en);
    const micBtn = SpeechRec
        ? `<button type="button" data-action="mic" class="mic-btn btn-audio-pill py-1 px-2 text-xs" aria-label="Practice saying ${en}" title="Practice pronunciation">🎤</button>`
        : '';
    const example = item.exEn ? `
        <details>
            <summary>📝 Example sentence</summary>
            <p class="text-xs font-semibold text-cocoa mt-1">📘 ${revealSentence(item.exEn)}
                <button type="button" data-action="speak-sentence" class="btn-audio-pill py-0 px-1.5 text-[10px] ml-1" aria-label="Listen to the example">🔊</button>
            </p>
            <p lang="es" class="text-xs font-semibold text-cocoa-soft mt-0.5">🇪🇸 ${revealSentence(item.exEs)}</p>
        </details>` : '';
    return `
        <div class="glossary-card cozy-subcard p-3" data-idx="${item._idx}">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <p class="font-code font-bold text-mint-dark text-sm break-words">${en} <span class="unit-badge" title="Technical English ${unitLabel(item)}">${unitLabel(item)}</span></p>
                    <p lang="es" class="text-cocoa-dark font-bold text-xs sm:text-sm break-words">${escapeHtml(item.es)}</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" data-action="speak" class="btn-audio-pill py-1 px-2 text-xs" aria-label="Pronounce ${en}" title="Pronounce English">🔊</button>
                    ${micBtn}
                    <button type="button" data-action="star" class="icon-circle-btn" aria-pressed="${isFav}" aria-label="Favorite: ${en}" title="Bookmark word">${isFav ? '⭐' : '☆'}</button>
                </div>
            </div>
            ${example}
        </div>`;
}

function renderGlossary() {
    const query = normalize(glossarySearchInput.value);
    const filterMode = glossaryFilterSelect.value;

    const list = SORTED[sortGlossaryBy.value].filter(item => {
        if (filterMode === 'favorites' && !starredSet.has(item.en)) return false;
        if (filterMode === 'unit1' && !item._units.includes(1)) return false;
        if (filterMode === 'unit2' && !item._units.includes(2)) return false;
        return !query || item._search.includes(query);
    });

    glossaryListLength = list.length;
    updateGlossaryCount();
    glossaryContent.innerHTML = list.length
        ? list.map(glossaryCardHtml).join('')
        : '<p class="text-sm font-bold text-cocoa-soft md:col-span-2 text-center py-6">No terms found. Try another search.</p>';
}

glossaryContent.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    const card = e.target.closest('[data-idx]');
    if (!btn || !card) return;
    const item = UNIFIED_GLOSSARY[Number(card.dataset.idx)];
    switch (btn.dataset.action) {
        case 'speak':
            speakEnglish(item.en);
            break;
        case 'speak-sentence':
            speakSentence(item.exEn);
            break;
        case 'mic':
            practicePronunciation(item.en, btn);
            break;
        case 'star':
            toggleFavorite(item.en);
            if (glossaryFilterSelect.value === 'favorites') {
                renderGlossary();
            } else {
                const fav = starredSet.has(item.en);
                btn.textContent = fav ? '⭐' : '☆';
                btn.setAttribute('aria-pressed', String(fav));
                updateGlossaryCount();
            }
            break;
    }
});

let searchDebounce = null;
glossarySearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderGlossary, 120);
});
glossaryFilterSelect.addEventListener('change', renderGlossary);
sortGlossaryBy.addEventListener('change', renderGlossary);

$('showGlossaryBtn').addEventListener('click', () => {
    renderGlossary();
    openModal(glossaryModal, glossarySearchInput);
});
$('glossaryCloseBtn').addEventListener('click', () => closeModal(glossaryModal));
$('glossaryCloseXBtn').addEventListener('click', () => closeModal(glossaryModal));
glossaryModal.addEventListener('click', (e) => {
    if (e.target === glossaryModal) closeModal(glossaryModal);
});

// =========================================================
// EXPORT / IMPORT PROGRESS
// =========================================================
$('exportProgressBtn').addEventListener('click', () => {
    const data = {
        app: 'technical-english-glossary',
        version: 1,
        exportedAt: new Date().toISOString(),
        favorites: [...starredSet],
        wordStats,
        daily,
        bests
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `english-progress-${dayKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('⬇️ Progress file downloaded.');
});

$('importProgressInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!isPlainObject(data) || data.app !== 'technical-english-glossary') throw new Error('format');
        const known = new Set(UNIFIED_GLOSSARY.map(i => i.en));
        const favs = Array.isArray(data.favorites) ? data.favorites.filter(f => known.has(f)) : [];
        starredSet = new Set(favs);
        if (isPlainObject(data.wordStats)) wordStats = data.wordStats;
        if (isPlainObject(data.daily)) daily = data.daily;
        if (isPlainObject(data.bests) && isPlainObject(data.bests.match)) bests = data.bests;
        storageSet(KEYS.fav, [...starredSet]);
        storageSet(KEYS.stats, wordStats);
        storageSet(KEYS.daily, daily);
        storageSet(KEYS.best, bests);
        renderGlossary();
        updatePoolCountLabel();
        updateSpotlightStarBtn();
        renderStats();
        showToast(`⬆️ Imported ${favs.length} favorites and your progress.`);
    } catch (err) {
        showToast("⚠️ That file isn't a valid progress export.", 3500);
    }
});

// =========================================================
// GLOBAL KEYBOARD SHORTCUTS (ONE LISTENER)
// =========================================================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        trapFocus(e);
        return;
    }

    if (e.key === 'Escape') {
        if (isOpen(glossaryModal)) closeModal(glossaryModal);
        else if (isOpen(gameOverModal)) goHome();
        return;
    }

    if (isOpen(glossaryModal) || isOpen(gameOverModal)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    // Home: arrows move the carousel
    if (!welcomeScreen.classList.contains('hidden')) {
        if (inField) return;
        if (e.key === 'ArrowLeft') moveCarousel(-1);
        else if (e.key === 'ArrowRight') moveCarousel(1);
        return;
    }

    if (gameSection.classList.contains('hidden') || inField) return;

    // Enter advances when "Next" is visible but something else has focus
    if (e.key === 'Enter' && answerChecked && !nextButton.classList.contains('hidden') && active !== nextButton && tag !== 'BUTTON') {
        e.preventDefault();
        nextButton.click();
        return;
    }

    if (answerChecked) return;

    if (selectedGameType === 'hangman') {
        const key = e.key.toUpperCase();
        if (/^[A-Z]$/.test(key)) {
            const btn = hangmanKeyboard.querySelector(`.kb-key[data-letter="${key}"]`);
            if (btn && !btn.disabled) handleHangmanGuess(key, btn);
        }
    } else if (selectedGameType === 'trivia') {
        const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
        const idx = map[e.key.toLowerCase()];
        if (idx !== undefined) {
            const btn = triviaOptionsGrid.children[idx];
            if (btn && !btn.disabled) btn.click();
        }
    }
});

// =========================================================
// INITIAL BOOT
// =========================================================
syncVolumeUI();
syncNarratorUI();
renderCarousel();
renderStats();
renderSpotlight('word');
resetSpotlightTimer();

// Offline support (only over http/https; service workers don't run from file://)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
}
