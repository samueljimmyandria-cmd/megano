/* ============================================================
   PalmID - App logic
   ============================================================
   Fix du bug MediaPipe "Module.arguments has been replaced" :
   - Instance Hands UNIQUE partagée entre toutes les vues
   - Pas de recréation lors des changements de vue
   - Gestion propre du cycle de vie caméra
   ============================================================ */

(() => {
'use strict';

// ==================== CONFIG ====================
const MEDIAPIPE_VERSION = '0.4.1675469240';
const CAMERA_UTILS_VERSION = '0.3.1675466862';
const FACEAPI_VERSION = '0.22.2';
const FACEAPI_MODELS_URL = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@main/models/faceapi/';

// ==================== DOM ====================
const $ = (id) => document.getElementById(id);

const burgerBtn = $('burgerBtn');
const drawerOverlay = $('drawerOverlay');
const drawer = $('drawer');
const closeDrawer = $('closeDrawer');
const drawerList = $('drawerList');

const homeView = $('homeView');
const enrollView = $('enrollView');
const loginView = $('loginView');

const navHomeBtn = $('navHomeBtn');
const navAddBtn = $('navAddBtn');
const navListBtn = $('navListBtn');
const navLoginBtn = $('navLoginBtn');
const navSettingsBtn = $('navSettingsBtn');

const usernameInput = $('username');
const nameDisplay = $('nameDisplay');
const pinEnrollInput = $('pinEnroll');
const videoEnroll = $('videoEnroll');
const overlayEnroll = $('overlayEnroll');
const overlayFaceEnroll = $('overlayFaceEnroll');
const capHandBtn = $('capHandBtn');
const capHandLabel = $('capHandLabel');
const saveEnrollBtn = $('saveEnrollBtn');
const statusMsgEnroll = $('statusMsgEnroll');
const faceCaptureSection = $('faceCaptureSection');
const handCaptureSection = $('handCaptureSection');
const capFaceBtn = $('capFaceBtn');
const enrollTitle = $('enrollTitle');
const enrollSubtitle = $('enrollSubtitle');
const faceCaptureStatus = $('faceCaptureStatus');
const cancelEnrollBtn = $('cancelEnrollBtn');
const heroAddBtn = $('heroAddBtn');
const goToLoginBtn = $('goToLoginBtn');
const stepPills = $('stepPills');
const videoHint = $('videoHint');
const videoHintLogin = $('videoHintLogin');

const videoLogin = $('videoLogin');
const overlayLogin = $('overlayLogin');
const overlayFaceLogin = $('overlayFaceLogin');
const startLoginBtn = $('startLoginBtn');
const startLoginFastBtn = $('startLoginFastBtn');
const statusMsgLogin = $('statusMsgLogin');
const loginScoresDiv = $('loginScores');
const loginPinInput = $('loginPinInput');
const loginIdentityDiv = $('loginIdentity');
const loginIdentityText = $('loginIdentityText');
const countdownDisplay = $('countdownDisplay');
const cancelLoginBtn = $('cancelLoginBtn');

const modelStatus = $('modelStatus');
const toastContainer = $('toastContainer');

// ==================== STATE ====================
let hands = null;                  // Instance MediaPipe Hands UNIQUE
let cameraEnroll = null;
let cameraLogin = null;
let lastHandVectorEnroll = null;
let lastHandVectorLogin = null;
let activeMode = null;             // 'enroll' | 'face' | 'login' | null
let activeVideo = null;            // video element currently driving Hands
let handRemaining = 3;
let tempHandVectors = [];
let tempFaceDescriptors = [];
let loginTimer = null;
let pendingFaceUpgradeUser = null;
let isLoggingIn = false;
let handPipelineRunning = false;

let liveFaceInterval = null;
let liveFaceVideo = null;
let liveFaceOverlay = null;
let lastLiveDescriptor = null;

// Init promises
let mediaPipeReadyPromise = null;
let faceApiReadyPromise = null;

// ==================== TOAST ====================
function toast(message, kind = 'info', icon = null, duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const iconName = icon || (kind === 'success' ? 'check_circle' : kind === 'error' ? 'error' : 'info');
    el.innerHTML = `
        <span class="material-symbols-outlined">${iconName}</span>
        <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 300);
    }, duration);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function setStatus(target, msg, kind = '') {
    target.className = 'status-banner' + (kind ? ' ' + kind : '');
    target.textContent = msg;
}

function setModelStatus(kind, text) {
    modelStatus.className = 'header-status ' + kind;
    modelStatus.innerHTML = `<span class="dot dot-${kind === 'ready' ? 'ready' : 'loading'}"></span><span>${text}</span>`;
}

// ==================== SCRIPT LOADER ====================
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Si déjà chargé, ne pas recharger
        if (document.querySelector(`script[data-src="${src}"]`)) {
            if (src.includes('face-api') && typeof faceapi !== 'undefined') return resolve();
            if (src.includes('hands.js') && typeof window.Hands === 'function') return resolve();
            if (src.includes('camera_utils.js') && typeof window.Camera === 'function') return resolve();
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.dataset.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Échec chargement ${src}`));
        document.head.appendChild(script);
    });
}

// ==================== MEDIAPIPE INIT (singleton) ====================
async function initMediaPipe() {
    if (mediaPipeReadyPromise) return mediaPipeReadyPromise;

    mediaPipeReadyPromise = (async () => {
        setModelStatus('', 'MediaPipe…');
        try {
            await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MEDIAPIPE_VERSION}/hands.js`);
            await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@${CAMERA_UTILS_VERSION}/camera_utils.js`);
            if (typeof window.Hands !== 'function' || typeof window.Camera !== 'function') {
                throw new Error('Modules MediaPipe manquants');
            }
            console.log('MediaPipe chargé');
            return true;
        } catch (err) {
            console.error('Erreur MediaPipe', err);
            setModelStatus('error', 'Erreur MP');
            mediaPipeReadyPromise = null; // allow retry
            throw err;
        }
    })();

    return mediaPipeReadyPromise;
}

// ==================== HANDS PIPELINE (singleton) ====================
async function ensureHandsPipeline() {
    if (hands) return true; // déjà créé
    if (!await initMediaPipe()) return false;

    hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MEDIAPIPE_VERSION}/${file}`
    });
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6
    });
    hands.onResults(onHandResults);
    console.log('Hands pipeline initialisé');
    return true;
}

function onHandResults(results) {
    const isEnroll = (activeMode === 'enroll' || activeMode === 'face');
    const video = isEnroll ? videoEnroll : videoLogin;
    const overlay = isEnroll ? overlayEnroll : overlayLogin;
    const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

    if (hasHand) {
        const vec = extractHandGeometry(results.multiHandLandmarks[0]);
        if (isEnroll) lastHandVectorEnroll = vec;
        else lastHandVectorLogin = vec;
        drawHandOverlay(results.multiHandLandmarks[0], overlay, video);
    } else {
        if (isEnroll) lastHandVectorEnroll = null;
        else lastHandVectorLogin = null;
        overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    }
}

// ==================== FACE-API INIT ====================
async function initFaceApi() {
    if (faceApiReadyPromise) return faceApiReadyPromise;

    faceApiReadyPromise = (async () => {
        try {
            if (typeof faceapi === 'undefined') {
                await loadScript(`https://cdn.jsdelivr.net/npm/face-api.js@${FACEAPI_VERSION}/dist/face-api.min.js`);
            }
            await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODELS_URL);
            await faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODELS_URL);
            await faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODELS_URL);
            await faceapi.nets.ssdMobilenetv1.loadFromUri(FACEAPI_MODELS_URL);
            console.log('FaceAPI chargé');
            return true;
        } catch (err) {
            console.error('Erreur FaceAPI', err);
            faceApiReadyPromise = null;
            throw err;
        }
    })();

    return faceApiReadyPromise;
}

// ==================== HAND GEOMETRY ====================
// Note: les canvas sont retournés par CSS (scaleX(-1)), donc on utilise x tel quel
function extractHandGeometry(landmarks) {
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const dx = indexMcp.x - wrist.x;
    const dy = indexMcp.y - wrist.y;
    const angle = Math.atan2(dy, dx);

    const rotate = (p, a) => {
        const x = p.x - wrist.x;
        const y = p.y - wrist.y;
        const cos = Math.cos(-a);
        const sin = Math.sin(-a);
        return { x: x * cos - y * sin, y: x * sin + y * cos };
    };

    const rotated = landmarks.map(p => rotate(p, angle));
    const baseDist = Math.hypot(rotated[5].x, rotated[5].y);
    if (baseDist < 1e-4) return [];

    const tips = [4, 8, 12, 16, 20];
    const bases = [1, 5, 9, 13, 17];

    const fingerLengths = tips.map((t, i) => {
        const tip = rotated[t];
        const base = rotated[bases[i]];
        return Math.hypot(tip.x - base.x, tip.y - base.y) / baseDist;
    });

    const pinkyMcp = rotated[17];
    const palmWidth = Math.hypot(rotated[5].x - pinkyMcp.x, rotated[5].y - pinkyMcp.y) / baseDist;

    const fingerAngles = [];
    for (let i = 0; i < bases.length - 1; i++) {
        const b1 = rotated[bases[i]];
        const t1 = rotated[tips[i]];
        const b2 = rotated[bases[i + 1]];
        const t2 = rotated[tips[i + 1]];
        const v1 = { x: t1.x - b1.x, y: t1.y - b1.y };
        const v2 = { x: t2.x - b2.x, y: t2.y - b2.y };
        const dot = v1.x * v2.x + v1.y * v2.y;
        const norm = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
        if (norm < 1e-4) fingerAngles.push(0);
        else {
            let cosA = Math.max(-1, Math.min(1, dot / norm));
            fingerAngles.push(Math.acos(cosA));
        }
    }

    return [...fingerLengths, palmWidth, ...fingerAngles];
}

function drawHandOverlay(landmarks, canvas, video) {
    const ctx = canvas.getContext('2d');
    const w = video.videoWidth || 320;
    const h = video.videoHeight || 240;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 8;

    const connections = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [0,9],[9,10],[10,11],[11,12],
        [0,13],[13,14],[14,15],[15,16],
        [0,17],[17,18],[18,19],[19,20]
    ];

    ctx.beginPath();
    for (const [i, j] of connections) {
        ctx.moveTo(landmarks[i].x * canvas.width, landmarks[i].y * canvas.height);
        ctx.lineTo(landmarks[j].x * canvas.width, landmarks[j].y * canvas.height);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fbbf24';
    for (const lm of landmarks) {
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==================== STORAGE ====================
function loadUsers() {
    try { return JSON.parse(localStorage.getItem('palmid_users') || '[]'); }
    catch { return []; }
}

function saveUsers(users) {
    localStorage.setItem('palmid_users', JSON.stringify(users));
    renderDrawerList();
}

function getInitials(name) {
    return name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function renderDrawerList() {
    const users = loadUsers();
    if (users.length === 0) {
        drawerList.innerHTML = `
            <div class="muted" style="padding: 24px; text-align: center;">
                <span class="material-symbols-outlined" style="font-size: 40px; opacity: 0.4; display:block; margin-bottom: 8px;">group_off</span>
                Aucun utilisateur enregistré
            </div>`;
        return;
    }

    drawerList.innerHTML = users.map((u, i) => {
        const hasFace = u.faceDescriptors && u.faceDescriptors.length > 0;
        return `
        <div class="user-item">
            <div class="user-item-main">
                <div class="avatar">${escapeHtml(getInitials(u.name))}</div>
                <div>
                    <div class="user-item-name">
                        ${escapeHtml(u.name)}
                        ${hasFace ? '<span class="face-badge">👤</span>' : ''}
                    </div>
                </div>
            </div>
            <div class="user-item-actions">
                <button class="btn-face-${hasFace ? 'remove' : 'add'}" data-idx="${i}" data-action="face">
                    <span class="material-symbols-outlined" style="font-size: 14px;">${hasFace ? 'delete' : 'add'}</span>
                </button>
                <button class="btn-delete" data-idx="${i}" data-action="del">
                    <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
                </button>
            </div>
        </div>`;
    }).join('');

    drawerList.querySelectorAll('button[data-action]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.idx);
            const users = loadUsers();
            const user = users[idx];
            if (!user) return;
            if (btn.dataset.action === 'del') {
                if (confirm(`Supprimer ${user.name} ?`)) {
                    users.splice(idx, 1);
                    saveUsers(users);
                    toast(`${user.name} supprimé`, 'success', 'delete');
                }
            } else if (btn.dataset.action === 'face') {
                if (user.faceDescriptors && user.faceDescriptors.length > 0) {
                    if (confirm(`Supprimer les données faciales de ${user.name} ?`)) {
                        delete user.faceDescriptors;
                        saveUsers(users);
                        toast('Visage supprimé', 'success', 'face');
                    }
                } else {
                    pendingFaceUpgradeUser = user.name;
                    closeDrawerFunc();
                    switchView('enrollView');
                }
            }
        };
    });
}

function closeDrawerFunc() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('show');
}

// ==================== NAVIGATION ====================
function stopFaceLive() {
    if (liveFaceInterval) {
        clearInterval(liveFaceInterval);
        liveFaceInterval = null;
    }
    liveFaceVideo = null;
    liveFaceOverlay = null;
    lastLiveDescriptor = null;
    overlayFaceEnroll.classList.add('hidden');
    overlayFaceLogin.classList.add('hidden');
    [overlayFaceEnroll, overlayFaceLogin].forEach(c => {
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
    });
}

async function stopAllCameras() {
    activeMode = null;
    activeVideo = null;
    if (loginTimer) {
        clearInterval(loginTimer);
        loginTimer = null;
        countdownDisplay.classList.add('hidden');
    }
    stopFaceLive();

    const stops = [];
    if (cameraEnroll) {
        const cam = cameraEnroll;
        cameraEnroll = null;
        try { await cam.stop(); } catch (e) { /* ignore */ }
    }
    if (cameraLogin) {
        const cam = cameraLogin;
        cameraLogin = null;
        try { await cam.stop(); } catch (e) { /* ignore */ }
    }
    await Promise.all(stops);
    // laisser une frame pour que MediaPipe finisse son traitement
    await new Promise(r => setTimeout(r, 100));
}

function switchView(viewId) {
    [homeView, enrollView, loginView].forEach(v => v.classList.remove('active'));
    $(viewId).classList.add('active');

    [navHomeBtn, navListBtn, navLoginBtn, navSettingsBtn].forEach(b => b.classList.remove('active'));
    if (viewId === 'homeView') navHomeBtn.classList.add('active');
    else if (viewId === 'enrollView') navListBtn.classList.add('active'); // onglet "+" map sur list pour l'effet visuel
    else if (viewId === 'loginView') navLoginBtn.classList.add('active');

    stopFaceLive();

    if (viewId === 'enrollView') {
        if (pendingFaceUpgradeUser) {
            enrollTitle.textContent = `Ajout visage · ${pendingFaceUpgradeUser}`;
            enrollSubtitle.textContent = 'Positionnez votre visage face à la caméra.';
            usernameInput.classList.add('hidden');
            nameDisplay.textContent = pendingFaceUpgradeUser;
            nameDisplay.classList.remove('hidden');
            handCaptureSection.classList.add('hidden');
            faceCaptureSection.classList.remove('hidden');
            capFaceBtn.disabled = false;
            faceCaptureStatus.textContent = '';
            activeMode = 'face';
            setStatus(statusMsgEnroll, 'Placez votre visage dans le cadre.');
            updateStepPills(2);
            startEnrollCamera();
        } else {
            enrollTitle.textContent = 'Nouvelle inscription';
            enrollSubtitle.textContent = 'Capturez 3 fois votre main pour créer votre profil.';
            usernameInput.value = '';
            usernameInput.classList.remove('hidden');
            nameDisplay.classList.add('hidden');
            handCaptureSection.classList.remove('hidden');
            faceCaptureSection.classList.add('hidden');
            handRemaining = 3;
            tempHandVectors = [];
            tempFaceDescriptors = [];
            capHandLabel.textContent = 'Capturer main (3 restantes)';
            capHandBtn.disabled = true;
            setStatus(statusMsgEnroll, 'Caméra en initialisation…');
            activeMode = 'enroll';
            updateStepPills(1);
            startEnrollCamera();
        }
    } else if (viewId === 'loginView') {
        activeMode = 'login';
        loginIdentityDiv.classList.add('hidden');
        loginScoresDiv.innerHTML = '<p class="muted small">Aucun score pour l\'instant.</p>';
        statusMsgLogin.textContent = 'Caméra en initialisation…';
        startLoginCamera();
    } else {
        activeMode = null;
        pendingFaceUpgradeUser = null;
    }
}

function updateStepPills(current) {
    stepPills.querySelectorAll('.step-pill').forEach((pill, i) => {
        pill.classList.remove('active', 'done');
        const step = i + 1;
        if (step < current) pill.classList.add('done');
        else if (step === current) pill.classList.add('active');
    });
}

navHomeBtn.onclick = () => { pendingFaceUpgradeUser = null; switchView('homeView'); stopAllCameras(); };
navAddBtn.onclick = () => { pendingFaceUpgradeUser = null; switchView('enrollView'); };
navListBtn.onclick = () => { drawer.classList.add('open'); drawerOverlay.classList.add('show'); renderDrawerList(); };
navLoginBtn.onclick = () => { pendingFaceUpgradeUser = null; switchView('loginView'); };
navSettingsBtn.onclick = () => toast('Réglages à venir', 'info', 'settings');
burgerBtn.onclick = () => { drawer.classList.add('open'); drawerOverlay.classList.add('show'); renderDrawerList(); };
closeDrawer.onclick = closeDrawerFunc;
drawerOverlay.onclick = closeDrawerFunc;
goToLoginBtn.onclick = () => switchView('loginView');
heroAddBtn.onclick = () => switchView('enrollView');
cancelEnrollBtn.onclick = () => switchView('homeView');
cancelLoginBtn.onclick = () => switchView('homeView');

// ==================== CAMERAS ====================
async function startEnrollCamera() {
    if (cameraEnroll) return;
    if (!await ensureHandsPipeline()) {
        setStatus(statusMsgEnroll, 'Erreur MediaPipe', 'error');
        return;
    }
    try {
        cameraEnroll = new window.Camera(videoEnroll, {
            onFrame: async () => {
                if (activeVideo === videoEnroll && hands && (activeMode === 'enroll' || activeMode === 'face')) {
                    try { await hands.send({ image: videoEnroll }); }
                    catch (e) { /* swallow transient */ }
                }
            },
            width: 640,
            height: 480
        });
        activeVideo = videoEnroll;
        await cameraEnroll.start();
        videoHint.classList.add('hidden');
        if (activeMode === 'enroll') {
            capHandBtn.disabled = false;
            setStatus(statusMsgEnroll, 'Main dans le cadre, puis cliquez sur Capturer.', 'success');
        } else if (activeMode === 'face') {
            setStatus(statusMsgEnroll, 'Placez votre visage dans le cadre.', 'success');
            faceCaptureStatus.textContent = 'Repères en direct. Cliquez sur Capturer quand prêt.';
            startFaceLiveVisualization(videoEnroll, overlayFaceEnroll);
        }
    } catch (err) {
        console.error(err);
        setStatus(statusMsgEnroll, 'Erreur caméra : ' + err.message, 'error');
    }
}

async function startLoginCamera() {
    if (cameraLogin) return;
    if (!await ensureHandsPipeline()) {
        setStatus(statusMsgLogin, 'Erreur MediaPipe', 'error');
        return;
    }
    try {
        cameraLogin = new window.Camera(videoLogin, {
            onFrame: async () => {
                if (activeVideo === videoLogin && hands && activeMode === 'login') {
                    try { await hands.send({ image: videoLogin }); }
                    catch (e) { /* swallow transient */ }
                }
            },
            width: 640,
            height: 480
        });
        activeVideo = videoLogin;
        await cameraLogin.start();
        videoHintLogin.classList.add('hidden');
        setStatus(statusMsgLogin, 'Caméra prête. Choisissez un mode.', 'success');
    } catch (err) {
        console.error(err);
        setStatus(statusMsgLogin, 'Erreur caméra : ' + err.message, 'error');
    }
}

// ==================== HAND CAPTURE ====================
capHandBtn.onclick = () => {
    if (activeMode !== 'enroll' || handRemaining <= 0) return;
    if (!lastHandVectorEnroll || lastHandVectorEnroll.length === 0) {
        setStatus(statusMsgEnroll, '⚠️ Main non détectée. Écartez/doigts devant la caméra.', 'warn');
        return;
    }
    tempHandVectors.push([...lastHandVectorEnroll]);
    handRemaining--;
    capHandLabel.textContent = `Capturer main (${handRemaining} restante${handRemaining > 1 ? 's' : ''})`;
    const done = 3 - handRemaining;
    setStatus(statusMsgEnroll, `✔️ Main ${done}/3 capturée${done > 1 ? 's' : ''}.`, 'success');
    if (handRemaining === 0) {
        capHandBtn.disabled = true;
        capHandLabel.textContent = '✔️ Mains capturées';
        faceCaptureSection.classList.remove('hidden');
        tempFaceDescriptors = [];
        capFaceBtn.disabled = false;
        faceCaptureStatus.textContent = 'Optionnel : repères en direct.';
        activeMode = 'face';
        updateStepPills(2);
        // démarrer la visualisation faciale live
        initFaceApi().then(ok => {
            if (ok && activeMode === 'face' && activeVideo === videoEnroll) {
                startFaceLiveVisualization(videoEnroll, overlayFaceEnroll);
            }
        });
    }
};

// ==================== FACE LIVE VISUALIZATION ====================
function startFaceLiveVisualization(videoElement, overlayCanvas) {
    if (typeof faceapi === 'undefined') return;
    stopFaceLive();
    liveFaceVideo = videoElement;
    liveFaceOverlay = overlayCanvas;
    overlayCanvas.classList.remove('hidden');

    const sizeCanvas = () => {
        const w = videoElement.videoWidth || 640;
        const h = videoElement.videoHeight || 480;
        if (overlayCanvas.width !== w) overlayCanvas.width = w;
        if (overlayCanvas.height !== h) overlayCanvas.height = h;
    };
    sizeCanvas();

    liveFaceInterval = setInterval(async () => {
        if (!liveFaceVideo || liveFaceVideo.readyState < 2) return;
        sizeCanvas();
        try {
            const detection = await faceapi.detectSingleFace(liveFaceVideo,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })
            ).withFaceLandmarks().withFaceDescriptor();

            if (!liveFaceOverlay) return;

            const ctx = liveFaceOverlay.getContext('2d');
            ctx.clearRect(0, 0, liveFaceOverlay.width, liveFaceOverlay.height);

            if (detection) {
                lastLiveDescriptor = Array.from(detection.descriptor);
                const box = detection.detection.box;
                ctx.strokeStyle = '#a855f7';
                ctx.lineWidth = 3;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                faceapi.draw.drawFaceLandmarks(liveFaceOverlay, detection.landmarks);
            } else {
                lastLiveDescriptor = null;
                ctx.fillStyle = 'rgba(168, 85, 247, 0.85)';
                ctx.font = '16px Inter';
                ctx.fillText('Recherche visage…', 12, 28);
            }
        } catch (e) {
            // silencieux
        }
    }, 500);
}

// ==================== FACE CAPTURE ====================
capFaceBtn.onclick = async () => {
    if (activeMode !== 'face') return;
    faceCaptureStatus.textContent = 'Capture…';
    capFaceBtn.disabled = true;

    if (lastLiveDescriptor) {
        tempFaceDescriptors = [lastLiveDescriptor];
        stopFaceLive();
        faceCaptureStatus.textContent = '✅ Visage enregistré.';
        updateStepPills(3);
        setStatus(statusMsgEnroll, 'Visage capturé. Cliquez sur Enregistrer.', 'success');
        return;
    }

    if (!faceApiReadyPromise) {
        faceCaptureStatus.textContent = '⏳ Chargement des modèles visage…';
        try { await initFaceApi(); } catch (e) { faceCaptureStatus.textContent = '❌ ' + e.message; capFaceBtn.disabled = false; return; }
    }
    stopFaceLive();
    try {
        const descriptor = await advancedCaptureFace(videoEnroll);
        if (!descriptor) {
            faceCaptureStatus.textContent = '❌ Aucun visage détecté';
            capFaceBtn.disabled = false;
            return;
        }
        tempFaceDescriptors = [descriptor];
        faceCaptureStatus.textContent = '✅ Visage enregistré.';
        updateStepPills(3);
        setStatus(statusMsgEnroll, 'Visage capturé. Cliquez sur Enregistrer.', 'success');
    } catch (e) {
        faceCaptureStatus.textContent = '❌ ' + e.message;
        capFaceBtn.disabled = false;
    }
};

function autoContrastCanvas(canvas, lowP = 0.02, highP = 0.98) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        histogram[Math.round(lum)]++;
    }
    const total = data.length / 4;
    let lo = 0, hi = 255, cum = 0;
    for (let i = 0; i < 256; i++) {
        cum += histogram[i];
        if (cum / total >= lowP) { lo = i; break; }
    }
    cum = 0;
    for (let i = 255; i >= 0; i--) {
        cum += histogram[i];
        if (cum / total >= (1 - highP)) { hi = i; break; }
    }
    if (hi <= lo) return;
    const scale = 255 / (hi - lo);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.max(0, (data[i] - lo) * scale));
        data[i+1] = Math.min(255, Math.max(0, (data[i+1] - lo) * scale));
        data[i+2] = Math.min(255, Math.max(0, (data[i+2] - lo) * scale));
    }
    ctx.putImageData(imageData, 0, 0);
}

async function tryDetectOnCanvas(canvas) {
    let detection = null;
    try {
        detection = await faceapi.detectSingleFace(canvas,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.2 })
        ).withFaceLandmarks().withFaceDescriptor();
    } catch (e) {}
    if (!detection) {
        try {
            detection = await faceapi.detectSingleFace(canvas,
                new faceapi.SsdMobilenetv1Options({ minConfidence: 0.1 })
            ).withFaceLandmarks().withFaceDescriptor();
        } catch (e) {}
    }
    return detection;
}

async function advancedCaptureFace(videoElement) {
    if (videoElement.readyState < 2) throw new Error('Vidéo pas prête');
    const base = document.createElement('canvas');
    base.width = videoElement.videoWidth || 640;
    base.height = videoElement.videoHeight || 480;
    base.getContext('2d').drawImage(videoElement, 0, 0);

    let det = await tryDetectOnCanvas(base);
    if (det) return Array.from(det.descriptor);

    autoContrastCanvas(base, 0.02, 0.98);
    det = await tryDetectOnCanvas(base);
    if (det) return Array.from(det.descriptor);

    const zooms = [0.8, 0.6, 0.4, 0.3];
    const w = base.width, h = base.height;
    for (const zoom of zooms) {
        const cw = w * zoom, ch = h * zoom;
        const ox = (w - cw) / 2, oy = (h - ch) / 2;
        const crop = document.createElement('canvas');
        crop.width = 416;
        crop.height = 416;
        crop.getContext('2d').drawImage(base, ox, oy, cw, ch, 0, 0, 416, 416);
        det = await tryDetectOnCanvas(crop);
        if (det) return Array.from(det.descriptor);
    }
    return null;
}

// ==================== SAVE ====================
saveEnrollBtn.onclick = async () => {
    // Cas : ajout visage à un utilisateur existant
    if (pendingFaceUpgradeUser) {
        if (!tempFaceDescriptors || tempFaceDescriptors.length === 0) {
            setStatus(statusMsgEnroll, '⚠️ Capturez d\'abord un visage.', 'warn');
            return;
        }
        const users = loadUsers();
        const user = users.find(u => u.name === pendingFaceUpgradeUser);
        if (!user) {
            setStatus(statusMsgEnroll, 'Utilisateur introuvable.', 'error');
            return;
        }
        user.faceDescriptors = tempFaceDescriptors;
        saveUsers(users);
        toast(`Visage ajouté à ${pendingFaceUpgradeUser}`, 'success', 'face');
        pendingFaceUpgradeUser = null;
        tempFaceDescriptors = [];
        faceCaptureSection.classList.add('hidden');
        nameDisplay.classList.add('hidden');
        usernameInput.classList.remove('hidden');
        await stopAllCameras();
        switchView('homeView');
        return;
    }

    // Cas : nouvel utilisateur
    const name = usernameInput.value.trim();
    if (!name) { setStatus(statusMsgEnroll, '⚠️ Entrez un nom.', 'warn'); return; }
    if (tempHandVectors.length < 3) { setStatus(statusMsgEnroll, '⚠️ 3 captures de main requises.', 'warn'); return; }

    const users = loadUsers();
    if (users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
        setStatus(statusMsgEnroll, '⚠️ Ce nom est déjà utilisé.', 'warn');
        return;
    }

    users.push({
        name,
        pin: pinEnrollInput.value || null,
        handVectors: tempHandVectors,
        faceDescriptors: tempFaceDescriptors.length > 0 ? tempFaceDescriptors : undefined,
        createdAt: Date.now()
    });
    saveUsers(users);

    toast(`${name} enregistré !`, 'success', 'check_circle');
    usernameInput.value = '';
    pinEnrollInput.value = '';
    handRemaining = 3;
    tempHandVectors = [];
    tempFaceDescriptors = [];
    capHandLabel.textContent = 'Capturer main (3 restantes)';
    capFaceBtn.disabled = false;
    faceCaptureSection.classList.add('hidden');
    handCaptureSection.classList.remove('hidden');
    updateStepPills(1);
    await stopAllCameras();
    switchView('homeView');
};

// ==================== LOGIN ====================
function startLoginCountdown(durationSec) {
    const users = loadUsers();
    if (users.length === 0) {
        setStatus(statusMsgLogin, 'Aucun utilisateur enregistré.', 'warn');
        return;
    }
    if (!cameraLogin) {
        setStatus(statusMsgLogin, 'Caméra non démarrée.', 'error');
        return;
    }
    if (loginTimer || isLoggingIn) return;

    isLoggingIn = true;
    startLoginBtn.disabled = true;
    startLoginFastBtn.disabled = true;
    loginPinInput.classList.add('hidden');
    loginIdentityDiv.classList.add('hidden');
    loginScoresDiv.innerHTML = '<p class="muted small">Analyse…</p>';
    countdownDisplay.classList.remove('hidden');

    const hasAnyFace = users.some(u => u.faceDescriptors && u.faceDescriptors.length > 0);
    if (hasAnyFace) {
        initFaceApi().then(ok => {
            if (ok && activeMode === 'login') startFaceLiveVisualization(videoLogin, overlayFaceLogin);
        });
    }

    let secondsLeft = durationSec;
    countdownDisplay.textContent = `⏳ ${secondsLeft}`;

    loginTimer = setInterval(async () => {
        secondsLeft--;
        if (secondsLeft > 0) {
            countdownDisplay.textContent = `⏳ ${secondsLeft}`;
            if (lastLiveDescriptor) {
                clearInterval(loginTimer);
                loginTimer = null;
                countdownDisplay.classList.add('hidden');
                stopFaceLive();
                await performLogin(lastLiveDescriptor);
                isLoggingIn = false;
                startLoginBtn.disabled = false;
                startLoginFastBtn.disabled = false;
            }
        } else {
            clearInterval(loginTimer);
            loginTimer = null;
            countdownDisplay.classList.add('hidden');
            stopFaceLive();

            let faceDesc = lastLiveDescriptor;
            if (!faceDesc && hasAnyFace) {
                setStatus(statusMsgLogin, 'Capture avancée du visage…');
                try { faceDesc = await advancedCaptureFace(videoLogin); } catch (e) {}
            }
            await performLogin(faceDesc);
            isLoggingIn = false;
            startLoginBtn.disabled = false;
            startLoginFastBtn.disabled = false;
        }
    }, 1000);
}

startLoginBtn.onclick = () => startLoginCountdown(5);
startLoginFastBtn.onclick = () => startLoginCountdown(1);

async function performLogin(queryFaceDescriptor = null) {
    const users = loadUsers();
    const handDetected = lastHandVectorLogin && lastHandVectorLogin.length > 0;

    if (!handDetected && !queryFaceDescriptor) {
        setStatus(statusMsgLogin, '❌ Aucune biométrie détectée.', 'error');
        loginScoresDiv.innerHTML = '<p class="muted small">Présentez une main ou un visage.</p>';
        loginIdentityDiv.classList.add('hidden');
        return;
    }

    const scores = users.map(u => {
        let handScore = null, faceScore = null;

        if (handDetected && u.handVectors && u.handVectors.length > 0) {
            let total = 0;
            for (const v of u.handVectors) total += compareHandVectors(lastHandVectorLogin, v);
            handScore = total / u.handVectors.length;
        }

        if (queryFaceDescriptor && u.faceDescriptors && u.faceDescriptors.length > 0) {
            let total = 0;
            for (const descArr of u.faceDescriptors) {
                const dist = faceapiEuclidean(queryFaceDescriptor, descArr);
                total += Math.max(0, 1 - dist / 0.6);
            }
            faceScore = total / u.faceDescriptors.length;
        }

        return { name: u.name, score: (handScore || 0) + (faceScore || 0), handScore, faceScore };
    });

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    const second = scores.length > 1 ? scores[1] : null;

    const minScore = 0.2;
    const minGap = 0.002;
    let needPin = false;
    let reason = '';

    if (best.score < minScore) { needPin = true; reason = 'score trop bas'; }
    else if (second) {
        const gap = best.score - second.score;
        if (gap < minGap) { needPin = true; reason = `écart serré (${(gap * 100).toFixed(2)}%)`; }
    }

    const handPct = best.handScore !== null ? `👋 ${(best.handScore * 100).toFixed(0)}%` : '';
    const facePct = best.faceScore !== null ? `🧑 ${(best.faceScore * 100).toFixed(0)}%` : '';
    loginIdentityText.innerHTML = `<strong>${escapeHtml(best.name)}</strong> · ${(best.score * 100).toFixed(1)}%<br><span style="font-size:0.75rem; opacity:0.8;">${[handPct, facePct].filter(Boolean).join(' · ') || '—'}</span>`;
    loginIdentityDiv.classList.remove('hidden');
    loginIdentityDiv.classList.toggle('warn', needPin);

    if (!needPin) {
        loginPinInput.classList.add('hidden');
        setStatus(statusMsgLogin, `✅ Identifié : ${best.name}`, 'success');
        toast(`Bienvenue ${best.name}`, 'success', 'check_circle');
    } else {
        loginPinInput.classList.remove('hidden');
        loginPinInput.value = '';
        loginPinInput.focus();
        setStatus(statusMsgLogin, `⚠️ ${reason}. Confirmez avec le PIN.`, 'warn');
    }

    loginScoresDiv.innerHTML = scores.map((s, i) => `
        <div class="score-item ${i === 0 ? 'top' : ''}">
            <div>
                <div class="score-name">${escapeHtml(s.name)}</div>
                <div class="score-detail">
                    ${s.handScore !== null ? `👋 ${(s.handScore * 100).toFixed(0)}%` : ''}
                    ${s.faceScore !== null ? `🧑 ${(s.faceScore * 100).toFixed(0)}%` : ''}
                </div>
            </div>
            <div class="score-bar-bg"><div class="score-bar-fill" style="width:${Math.min(s.score * 100, 100)}%"></div></div>
            <div class="score-pct">${(s.score * 100).toFixed(1)}%</div>
        </div>
    `).join('');

    loginPinInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            const pin = loginPinInput.value;
            const found = users.find(u => u.pin === pin);
            if (found) {
                setStatus(statusMsgLogin, `✅ Connexion PIN : ${found.name}`, 'success');
                loginPinInput.classList.add('hidden');
                loginIdentityText.innerHTML = `<strong>${escapeHtml(found.name)}</strong> · PIN validé`;
                loginIdentityDiv.classList.remove('warn');
                toast(`Bienvenue ${found.name}`, 'success', 'check_circle');
            } else {
                setStatus(statusMsgLogin, '❌ PIN incorrect', 'error');
            }
        }
    };
}

// ==================== SCORING ====================
function compareHandVectors(v1, v2) {
    if (v1.length !== v2.length || v1.length === 0) return 0;
    let dist = 0;
    for (let i = 0; i < v1.length; i++) dist += (v1[i] - v2[i]) ** 2;
    return Math.max(0, 1 - Math.sqrt(dist) / 0.8);
}

function faceapiEuclidean(d1, d2) {
    let dist = 0;
    for (let i = 0; i < d1.length; i++) dist += (d1[i] - d2[i]) ** 2;
    return Math.sqrt(dist);
}

// ==================== ERROR HANDLING ====================
window.addEventListener('error', (e) => {
    console.error('Erreur globale:', e.error);
    const target = statusMsgEnroll || statusMsgLogin;
    if (target && !target.textContent) {
        setStatus(target, 'Erreur : ' + (e.message || 'inconnue'), 'error');
    }
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejetée:', e.reason);
    e.preventDefault();
});

// ==================== INIT ====================
async function initAll() {
    setModelStatus('', 'Chargement…');
    try {
        await initMediaPipe();
        await initFaceApi();
        setModelStatus('ready', 'IA prête');
        toast('Modèles chargés', 'success', 'check_circle', 2500);
    } catch (err) {
        setModelStatus('error', 'Erreur');
        toast('Erreur chargement modèles', 'error', 'error');
    }
    renderDrawerList();
}

initAll();

// Nettoyage avant fermeture
window.addEventListener('beforeunload', () => {
    if (cameraEnroll) try { cameraEnroll.stop(); } catch (e) {}
    if (cameraLogin) try { cameraLogin.stop(); } catch (e) {}
    if (hands) try { hands.close(); } catch (e) {}
});

})();
