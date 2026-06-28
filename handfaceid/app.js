/* ============================================
   HAND + FACE ID — Main Application
   Bug fix: SINGLETON MediaPipe Hands instance
   ============================================ */

(function () {
  'use strict';

  // ============================================
  // CONFIG & CONSTANTS
  // ============================================
  const STORAGE_KEY = 'handUsers_v2';
  const STATS_KEY = 'stats_v2';
  const SETTINGS_KEY = 'settings_v2';
  const MP_HANDS_VERSION = '0.4.1675469240';
  const MP_CAMERA_VERSION = '0.3.1675466862';
  const FACEAPI_VERSION = '0.22.2';
  const FACEAPI_MODELS_URL = 'https://justadudewhohacks.github.io/face-api.js/models/';

  // ============================================
  // STATE
  // ============================================
  const state = {
    mode: 'home',          // home | enroll | login
    handCapturesRemaining: 3,
    tempHandVectors: [],
    tempFaceDescriptors: [],
    pendingFaceUpgrade: null,
    isLoggingIn: false,
    mediaPipeReady: false,
    faceApiReady: false,
    cameras: [],
    selectedCameraId: null,
    identificationCount: 0,
    settings: {
      faceThreshold: 0.6,
      handThreshold: 0.8,
      minGap: 0.002,
    }
  };

  // ============================================
  // SINGLETON MEDIAPIPE HANDS — THIS IS THE FIX
  // ============================================
  let handsInstance = null;
  let cameraEnroll = null;
  let cameraLogin = null;
  let lastHandVectorEnroll = null;
  let lastHandVectorLogin = null;

  async function getHands() {
    if (handsInstance) return handsInstance;
    await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_HANDS_VERSION}/hands.js`);
    if (typeof window.Hands !== 'function') {
      throw new Error('MediaPipe Hands non chargé');
    }
    handsInstance = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_HANDS_VERSION}/${file}`
    });
    handsInstance.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6
    });
    console.log('✅ Hands instance created (singleton)');
    return handsInstance;
  }

  // ============================================
  // DOM HELPERS
  // ============================================
  const $ = (id) => document.getElementById(id);

  // ============================================
  // UTILITIES
  // ============================================
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Échec chargement: ${src}`));
      document.head.appendChild(script);
    });
  }

  function toast(msg, duration = 2500) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove('show'), duration);
  }

  function setStatusMsg(elId, msg, type = 'info') {
    const el = $(elId);
    if (!el) return;
    el.textContent = msg;
    el.className = `status-msg ${type}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // ============================================
  // STORAGE
  // ============================================
  function loadUsers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    renderDrawerList();
    updateStats();
  }

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY) || '{"identifications":0}');
    } catch {
      return { identifications: 0 };
    }
  }

  function saveStats(stats) {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      state.settings = { ...state.settings, ...saved };
    } catch {}
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function applySettings() {
    $('settingFaceThreshold').value = state.settings.faceThreshold;
    $('settingHandThreshold').value = state.settings.handThreshold;
    $('settingMinGap').value = state.settings.minGap;
    $('faceThresholdVal').textContent = state.settings.faceThreshold.toFixed(2);
    $('handThresholdVal').textContent = state.settings.handThreshold.toFixed(2);
    $('minGapVal').textContent = state.settings.minGap.toFixed(3);
  }

  // ============================================
  // STATS
  // ============================================
  function updateStats() {
    const users = loadUsers();
    const withFaces = users.filter((u) => u.faceDescriptors && u.faceDescriptors.length > 0).length;
    const stats = loadStats();
    $('statUsers').textContent = users.length;
    $('statFaces').textContent = withFaces;
    $('statIdentifications').textContent = stats.identifications || 0;
  }

  function incIdentifications() {
    const stats = loadStats();
    stats.identifications = (stats.identifications || 0) + 1;
    saveStats(stats);
    updateStats();
  }

  // ============================================
  // USER LIST (DRAWER)
  // ============================================
  function renderDrawerList() {
    const users = loadUsers();
    const list = $('drawerList');
    if (users.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:var(--text-dim);">
          <div style="font-size:48px;margin-bottom:12px;opacity:0.4;">👤</div>
          <p style="font-size:13px;">Aucun utilisateur enregistré</p>
          <p style="font-size:11px;margin-top:8px;">Appuie sur ➕ pour commencer</p>
        </div>`;
      return;
    }
    list.innerHTML = users.map((u, i) => {
      const hasFace = u.faceDescriptors && u.faceDescriptors.length > 0;
      const initial = escapeHtml(u.name.charAt(0).toUpperCase());
      const meta = [];
      if (u.handVectors) meta.push(`${u.handVectors.length} main${u.handVectors.length > 1 ? 's' : ''}`);
      if (u.pin) meta.push('🔒 PIN');
      return `
        <div class="user-item">
          <div class="user-info">
            <div class="user-avatar">${initial}</div>
            <div style="min-width:0;flex:1;">
              <div class="user-name">${escapeHtml(u.name)}</div>
              <div class="user-meta">${meta.join(' · ')}</div>
            </div>
          </div>
          <div class="user-actions">
            ${hasFace
              ? `<button data-idx="${i}" data-action="face-remove" title="Supprimer visage">👤</button>`
              : `<button data-idx="${i}" data-action="face-add" title="Ajouter visage">➕👤</button>`}
            <button data-idx="${i}" data-action="delete" class="danger" title="Supprimer utilisateur">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const action = btn.dataset.action;
        const users = loadUsers();
        const user = users[idx];
        if (!user) return;
        if (action === 'delete') {
          if (confirm(`Supprimer ${user.name} ?`)) {
            users.splice(idx, 1);
            saveUsers(users);
            toast(`🗑 ${user.name} supprimé`);
          }
        } else if (action === 'face-add') {
          startAddFace(user.name);
        } else if (action === 'face-remove') {
          if (confirm(`Supprimer les données faciales de ${user.name} ?`)) {
            delete user.faceDescriptors;
            saveUsers(users);
            toast('👤 Visage supprimé');
          }
        }
      });
    });
  }

  // ============================================
  // FACE-API INITIALIZATION
  // ============================================
  async function loadFaceApi() {
    if (state.faceApiReady) return true;
    if (typeof faceapi === 'undefined') {
      try {
        await loadScript(`https://cdn.jsdelivr.net/npm/face-api.js@${FACEAPI_VERSION}/dist/face-api.min.js`);
      } catch (e) {
        console.error('face-api load failed', e);
        return false;
      }
    }
    if (typeof faceapi === 'undefined') return false;
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODELS_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODELS_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODELS_URL)
      ]);
      state.faceApiReady = true;
      console.log('✅ FaceAPI ready');
      return true;
    } catch (e) {
      console.error('FaceAPI models failed', e);
      return false;
    }
  }

  // ============================================
  // MEDIAPIPE CAMERA UTILS (singletons)
  // ============================================
  async function loadCameraUtils() {
    await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@${MP_CAMERA_VERSION}/camera_utils.js`);
    if (typeof window.Camera !== 'function') throw new Error('Camera utils non chargé');
  }

  async function listCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      state.cameras = devices.filter((d) => d.kind === 'videoinput');
      const sel = $('settingCamera');
      sel.innerHTML = state.cameras
        .map((c, i) => `<option value="${c.deviceId}">${c.label || `Caméra ${i + 1}`}</option>`)
        .join('');
      if (state.cameras.length > 0 && !state.selectedCameraId) {
        state.selectedCameraId = state.cameras[0].deviceId;
      }
    } catch (e) {
      console.warn('enumerateDevices failed', e);
    }
  }

  // ============================================
  // HAND GEOMETRY (same algorithm as original)
  // ============================================
  function extractHandGeometry(landmarks) {
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const dx = indexMcp.x - wrist.x;
    const dy = indexMcp.y - wrist.y;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rotated = landmarks.map((p) => {
      const x = p.x - wrist.x;
      const y = p.y - wrist.y;
      return { x: x * cos - y * sin, y: x * sin + y * cos };
    });
    const baseDist = Math.hypot(rotated[5].x, rotated[5].y);
    if (baseDist < 1e-4) return [];
    const tips = [4, 8, 12, 16, 20];
    const bases = [1, 5, 9, 13, 17];
    const fingerLengths = tips.map((tip, i) => {
      const t = rotated[tip];
      const b = rotated[bases[i]];
      return Math.hypot(t.x - b.x, t.y - b.y) / baseDist;
    });
    const pinkyMcp = rotated[17];
    const palmWidth = Math.hypot(rotated[5].x - pinkyMcp.x, rotated[5].y - pinkyMcp.y) / baseDist;
    const fingerAngles = [];
    for (let i = 0; i < bases.length - 1; i++) {
      const b1 = rotated[bases[i]], t1 = rotated[tips[i]];
      const b2 = rotated[bases[i + 1]], t2 = rotated[tips[i + 1]];
      const v1 = { x: t1.x - b1.x, y: t1.y - b1.y };
      const v2 = { x: t2.x - b2.x, y: t2.y - b2.y };
      const dot = v1.x * v2.x + v1.y * v2.y;
      const norm = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
      if (norm < 1e-4) fingerAngles.push(0);
      else {
        let cosA = dot / norm;
        cosA = Math.max(-1, Math.min(1, cosA));
        fingerAngles.push(Math.acos(cosA));
      }
    }
    return [...fingerLengths, palmWidth, ...fingerAngles];
  }

  function drawHandOverlay(landmarks, canvas, video) {
    const ctx = canvas.getContext('2d');
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#00FF88';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20]];
    ctx.beginPath();
    for (const [i, j] of connections) {
      ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
      ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
    }
    ctx.stroke();
    ctx.fillStyle = '#FF3D88';
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function compareHandVectors(v1, v2) {
    if (!v1 || !v2 || v1.length !== v2.length || v1.length === 0) return 0;
    let dist = 0;
    for (let i = 0; i < v1.length; i++) {
      const d = v1[i] - v2[i];
      dist += d * d;
    }
    dist = Math.sqrt(dist);
    return Math.max(0, 1 - dist / state.settings.handThreshold);
  }

  function faceEuclidean(d1, d2) {
    if (!d1 || !d2) return Infinity;
    let dist = 0;
    for (let i = 0; i < d1.length; i++) {
      const d = d1[i] - d2[i];
      dist += d * d;
    }
    return Math.sqrt(dist);
  }

  // ============================================
  // CAMERA MANAGEMENT
  // ============================================
  async function startCamera(videoEl, onResults, camera) {
    await loadCameraUtils();
    const cam = new window.Camera(videoEl, {
      onFrame: async () => {
        const hands = await getHands().catch(() => null);
        if (hands) await hands.send({ image: videoEl });
      },
      width: 640,
      height: 480
    });
    await cam.start();
    const hands = await getHands();
    hands.onResults(onResults);
    return cam;
  }

  async function startEnrollCamera() {
    if (cameraEnroll) return;
    $('videoStatusEnroll').classList.remove('hidden');
    try {
      const hands = await getHands();
      cameraEnroll = await startCamera($('videoEnroll'), (results) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          lastHandVectorEnroll = extractHandGeometry(results.multiHandLandmarks[0]);
          drawHandOverlay(results.multiHandLandmarks[0], $('overlayEnroll'), $('videoEnroll'));
        } else {
          lastHandVectorEnroll = null;
          const ctx = $('overlayEnroll').getContext('2d');
          ctx.clearRect(0, 0, $('overlayEnroll').width, $('overlayEnroll').height);
        }
      });
      $('videoStatusEnroll').classList.add('hidden');
      setBadge('mpStatus', 'ok', 'OK');
      $('capHandBtn').disabled = false;
      setStatusMsg('statusMsgEnroll', '✓ Caméra prête. Capture ta main 3 fois sous des angles légèrement différents.', 'info');
    } catch (e) {
      $('videoStatusEnroll').classList.add('hidden');
      setBadge('mpStatus', 'error', 'Erreur');
      setStatusMsg('statusMsgEnroll', `❌ ${e.message}`, 'error');
    }
  }

  async function startLoginCamera() {
    if (cameraLogin) return;
    $('videoStatusLogin').classList.remove('hidden');
    try {
      const hands = await getHands();
      cameraLogin = await startCamera($('videoLogin'), (results) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          lastHandVectorLogin = extractHandGeometry(results.multiHandLandmarks[0]);
          drawHandOverlay(results.multiHandLandmarks[0], $('overlayLogin'), $('videoLogin'));
        } else {
          lastHandVectorLogin = null;
          const ctx = $('overlayLogin').getContext('2d');
          ctx.clearRect(0, 0, $('overlayLogin').width, $('overlayLogin').height);
        }
      });
      $('videoStatusLogin').classList.add('hidden');
      setBadge('mpStatus', 'ok', 'OK');
      setStatusMsg('statusMsgLogin', 'Caméra prête. Choisis un mode d\'identification.', 'info');
    } catch (e) {
      $('videoStatusLogin').classList.add('hidden');
      setBadge('mpStatus', 'error', 'Erreur');
      setStatusMsg('statusMsgLogin', `❌ ${e.message}`, 'error');
    }
  }

  function stopCamera(cam) {
    if (cam) {
      try { cam.stop(); } catch {}
    }
  }

  // ============================================
  // ENROLLMENT
  // ============================================
  function setBadge(id, type, text) {
    const el = $(id);
    if (!el) return;
    el.className = `badge ${type}`;
    el.textContent = text;
  }

  function updateCaptureProgress() {
    const pips = document.querySelectorAll('.cap-pip');
    pips.forEach((pip, i) => {
      pip.classList.remove('done', 'active');
      if (i < 3 - state.handCapturesRemaining) {
        pip.classList.add('done');
      } else if (i === 3 - state.handCapturesRemaining && state.handCapturesRemaining > 0) {
        pip.classList.add('active');
      }
    });
  }

  async function captureHand() {
    if (state.handCapturesRemaining <= 0) return;
    if (!lastHandVectorEnroll || lastHandVectorEnroll.length === 0) {
      setStatusMsg('statusMsgEnroll', '⚠️ Aucune main détectée. Place ta main devant la caméra.', 'warning');
      return;
    }
    state.tempHandVectors.push([...lastHandVectorEnroll]);
    state.handCapturesRemaining--;
    updateCaptureProgress();
    const remaining = state.handCapturesRemaining;
    const btn = $('capHandBtn');
    btn.querySelector('.btn-counter').textContent = `${remaining} restante${remaining > 1 ? 's' : ''}`;
    const n = 3 - remaining;
    setStatusMsg('statusMsgEnroll', `✓ Main ${n}/3 capturée${remaining === 0 ? ' — tu peux ajouter un visage ou enregistrer.' : ''}`, 'success');

    if (state.handCapturesRemaining === 0) {
      btn.disabled = true;
      $('faceCaptureSection').classList.remove('hidden');
      setStatusMsg('statusMsgEnroll', '✅ 3 captures enregistrées. Tu peux ajouter un visage (optionnel) puis sauvegarder.', 'success');
    }
  }

  async function captureFace() {
    if (!state.faceApiReady) {
      const ok = await loadFaceApi();
      if (!ok) {
        $('faceCaptureStatus').textContent = '❌ Module visage indisponible';
        return;
      }
    }
    $('faceCaptureStatus').textContent = '🔍 Détection en cours…';
    try {
      const video = $('videoEnroll');
      if (video.readyState < 2) throw new Error('Vidéo pas prête');
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) {
        $('faceCaptureStatus').textContent = '❌ Aucun visage détecté. Place ton visage bien en face.';
        return;
      }
      state.tempFaceDescriptors = [Array.from(detection.descriptor)];
      $('capFaceBtn').disabled = true;
      $('faceCaptureStatus').textContent = '✅ Visage enregistré.';
      setStatusMsg('statusMsgEnroll', '✅ Visage capturé. Tu peux maintenant enregistrer.', 'success');
    } catch (e) {
      $('faceCaptureStatus').textContent = `❌ ${e.message}`;
    }
  }

  function saveEnrollment() {
    if (state.pendingFaceUpgrade) {
      if (!state.tempFaceDescriptors || state.tempFaceDescriptors.length === 0) {
        setStatusMsg('statusMsgEnroll', 'Capture d\'abord un visage.', 'warning');
        return;
      }
      const users = loadUsers();
      const user = users.find((u) => u.name === state.pendingFaceUpgrade);
      if (!user) {
        setStatusMsg('statusMsgEnroll', 'Utilisateur introuvable.', 'error');
        return;
      }
      user.faceDescriptors = state.tempFaceDescriptors;
      saveUsers(users);
      toast(`👤 Visage ajouté pour ${state.pendingFaceUpgrade}`);
      resetEnrollState();
      switchView('home');
      return;
    }

    const name = $('username').value.trim();
    if (!name) { setStatusMsg('statusMsgEnroll', 'Entre un nom.', 'warning'); return; }
    if (state.tempHandVectors.length < 3) { setStatusMsg('statusMsgEnroll', 'Il faut 3 captures de main.', 'warning'); return; }
    const users = loadUsers();
    if (users.find((u) => u.name.toLowerCase() === name.toLowerCase())) {
      setStatusMsg('statusMsgEnroll', 'Nom déjà utilisé.', 'error');
      return;
    }
    users.push({
      name,
      pin: $('pinEnroll').value || null,
      handVectors: state.tempHandVectors,
      faceDescriptors: state.tempFaceDescriptors.length > 0 ? state.tempFaceDescriptors : undefined,
      createdAt: Date.now()
    });
    saveUsers(users);
    toast(`✅ ${name} enregistré !`);
    setStatusMsg('statusMsgEnroll', `✅ ${name} enregistré avec succès !`, 'success');
    resetEnrollState();
    setTimeout(() => switchView('home'), 600);
  }

  function resetEnrollState() {
    state.handCapturesRemaining = 3;
    state.tempHandVectors = [];
    state.tempFaceDescriptors = [];
    state.pendingFaceUpgrade = null;
    $('username').value = '';
    $('pinEnroll').value = '';
    $('username').classList.remove('hidden');
    $('nameDisplay').classList.add('hidden');
    $('handCaptureSection') && $('handCaptureSection').classList.remove('hidden');
    $('faceCaptureSection').classList.add('hidden');
    $('capHandBtn').disabled = false;
    $('capHandBtn').querySelector('.btn-counter').textContent = '3 restantes';
    $('capFaceBtn').disabled = false;
    updateCaptureProgress();
    if (cameraEnroll) { stopCamera(cameraEnroll); cameraEnroll = null; }
  }

  function startAddFace(userName) {
    state.pendingFaceUpgrade = userName;
    closeDrawer();
    $('enrollTitle').textContent = `🧑 Ajout visage pour ${userName}`;
    $('nameDisplay').textContent = userName;
    $('username').classList.add('hidden');
    $('nameDisplay').classList.remove('hidden');
    $('formSection').classList.add('hidden');
    switchView('enroll');
  }

  // ============================================
  // LOGIN
  // ============================================
  let loginTimer = null;

  function startLoginCountdown(duration) {
    const users = loadUsers();
    if (users.length === 0) {
      setStatusMsg('statusMsgLogin', 'Aucun utilisateur enregistré.', 'warning');
      return;
    }
    if (!cameraLogin) {
      setStatusMsg('statusMsgLogin', 'Caméra non démarrée.', 'error');
      return;
    }
    if (loginTimer || state.isLoggingIn) return;

    state.isLoggingIn = true;
    $('startLoginBtn').disabled = true;
    $('startLoginFastBtn').disabled = true;
    $('loginPinInput').classList.add('hidden');
    $('loginIdentity').classList.add('hidden');
    $('loginScores').innerHTML = '';
    $('countdownDisplay').classList.remove('hidden');
    setStatusMsg('statusMsgLogin', '🔍 Analyse en cours…', 'info');

    let secondsLeft = duration;
    $('countdownDisplay').textContent = `⏳ ${secondsLeft}`;

    loginTimer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        $('countdownDisplay').textContent = `⏳ ${secondsLeft}`;
      } else {
        clearInterval(loginTimer);
        loginTimer = null;
        $('countdownDisplay').classList.add('hidden');
        performLogin().finally(() => {
          $('startLoginBtn').disabled = false;
          $('startLoginFastBtn').disabled = false;
          state.isLoggingIn = false;
        });
      }
    }, 1000);
  }

  async function performLogin() {
    const users = loadUsers();
    setStatusMsg('statusMsgLogin', 'Analyse des biométries…', 'info');

    const handVec = lastHandVectorLogin;
    const handDetected = handVec && handVec.length > 0;

    if (!handDetected) {
      setStatusMsg('statusMsgLogin', '❌ Aucune main détectée.', 'error');
      return;
    }

    const scores = users.map((u) => {
      let handScore = null;
      if (u.handVectors && u.handVectors.length > 0) {
        let total = 0;
        for (const v of u.handVectors) total += compareHandVectors(handVec, v);
        handScore = total / u.handVectors.length;
      }
      const sum = handScore || 0;
      return { name: u.name, score: sum, handScore, faceScore: null };
    });

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    const second = scores.length > 1 ? scores[1] : null;

    const minScore = 0.2;
    let needPin = false;
    let reason = '';
    if (best.score < minScore) {
      needPin = true;
      reason = 'score trop bas';
    } else if (second) {
      const gap = best.score - second.score;
      if (gap < state.settings.minGap) {
        needPin = true;
        reason = `écart trop faible (${(gap * 100).toFixed(2)}%)`;
      }
    }

    incIdentifications();

    const handPct = best.handScore !== null ? `👋 ${(best.handScore * 100).toFixed(0)}%` : '👋 —';
    $('loginIdentity').innerHTML = `👤 <strong>${escapeHtml(best.name)}</strong> — ${(best.score * 100).toFixed(1)}% ${handPct}`;
    $('loginIdentity').classList.remove('hidden');

    if (!needPin) {
      $('loginPinInput').classList.add('hidden');
      setStatusMsg('statusMsgLogin', `✅ Identifié : ${best.name}`, 'success');
      toast(`✅ Bienvenue ${best.name}`);
    } else {
      $('loginPinInput').classList.remove('hidden');
      $('loginPinInput').value = '';
      $('loginPinInput').focus();
      $('loginIdentity').innerHTML += ` — <span style="color:var(--warn)">⚠ ${reason}, entre le PIN</span>`;
      setStatusMsg('statusMsgLogin', `⚠ ${reason}. Vérifie avec le PIN de secours.`, 'warning');
    }

    $('loginScores').innerHTML = scores.map((s, i) => {
      const pct = (s.score * 100).toFixed(1);
      const handPart = s.handScore !== null ? `👋 ${(s.handScore * 100).toFixed(0)}%` : '👋 —';
      const cls = i === 0 ? 'score-row best' : 'score-row';
      return `
        <div class="${cls}">
          <span class="score-name">${escapeHtml(s.name)}</span>
          <div class="score-bar-bg"><div class="score-bar-fill" style="width:${Math.min(pct, 100)}%"></div></div>
          <span class="score-pct">${pct}%</span>
          <div class="score-detail">${handPart}</div>
        </div>`;
    }).join('');

    $('loginPinInput').onkeydown = (e) => {
      if (e.key === 'Enter') {
        const pin = $('loginPinInput').value;
        const found = users.find((u) => u.pin === pin);
        if (found) {
          setStatusMsg('statusMsgLogin', `✅ PIN valide — ${found.name}`, 'success');
          $('loginPinInput').classList.add('hidden');
          toast(`✅ Connecté : ${found.name}`);
        } else {
          setStatusMsg('statusMsgLogin', '❌ PIN incorrect.', 'error');
        }
      }
    };
  }

  // ============================================
  // NAVIGATION
  // ============================================
  function switchView(viewId) {
    state.mode = viewId;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    $(viewId + 'View')?.classList.add('active');

    // Camera cleanup — DO NOT touch hands instance
    if (viewId !== 'enroll' && cameraEnroll) { stopCamera(cameraEnroll); cameraEnroll = null; }
    if (viewId !== 'login' && cameraLogin) { stopCamera(cameraLogin); cameraLogin = null; }
    if (loginTimer) { clearInterval(loginTimer); loginTimer = null; }

    if (viewId === 'enroll') {
      if (state.pendingFaceUpgrade) {
        $('enrollTitle').textContent = `🧑 Ajout visage`;
        $('formSection').classList.add('hidden');
      } else {
        $('enrollTitle').textContent = '📝 Inscription';
        $('enrollSubtitle').textContent = 'Capture ta main 3 fois sous des angles légèrement différents.';
        $('formSection').classList.remove('hidden');
        resetEnrollState();
      }
      setTimeout(startEnrollCamera, 100);
    } else if (viewId === 'login') {
      setTimeout(startLoginCamera, 100);
    } else {
      state.pendingFaceUpgrade = null;
      $('formSection').classList.remove('hidden');
    }

    // Update bottom nav active state
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    if (viewId === 'home') $('navHomeBtn').classList.add('active');
    else if (viewId === 'enroll' || viewId === 'login') $('navAddBtn').classList.add('active');
  }

  // ============================================
  // DRAWERS
  // ============================================
  function openDrawer() {
    $('drawer').classList.add('open');
    $('drawerOverlay').classList.add('open');
    renderDrawerList();
  }
  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawerOverlay').classList.remove('open');
  }
  function openSettings() {
    $('settingsDrawer').classList.add('open');
    $('drawerOverlay').classList.add('open');
  }
  function closeSettings() {
    $('settingsDrawer').classList.remove('open');
    $('drawerOverlay').classList.remove('open');
  }

  // ============================================
  // IMPORT / EXPORT
  // ============================================
  function exportUsers() {
    const users = loadUsers();
    const blob = new Blob([JSON.stringify(users, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `handfaceid-users-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`📥 ${users.length} utilisateur(s) exporté(s)`);
  }

  function importUsers() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!Array.isArray(imported)) throw new Error('Format invalide');
        const existing = loadUsers();
        const merged = [...existing];
        let added = 0;
        for (const u of imported) {
          if (!u.name || !u.handVectors) continue;
          if (!merged.find((m) => m.name.toLowerCase() === u.name.toLowerCase())) {
            merged.push(u);
            added++;
          }
        }
        saveUsers(merged);
        toast(`📤 ${added} utilisateur(s) importé(s)`);
        renderDrawerList();
      } catch (err) {
        toast(`❌ Import échoué: ${err.message}`);
      }
    };
    input.click();
  }

  function clearAllUsers() {
    if (!confirm('Supprimer TOUS les utilisateurs ? Cette action est irréversible.')) return;
    localStorage.removeItem(STORAGE_KEY);
    renderDrawerList();
    updateStats();
    toast('🗑 Tous les utilisateurs supprimés');
  }

  // ============================================
  // EVENT WIRING
  // ============================================
  function wireEvents() {
    // Nav
    $('navHomeBtn').onclick = () => switchView('home');
    $('navAddBtn').onclick = () => switchView('enroll');
    $('navListBtn').onclick = openDrawer;
    $('burgerBtn').onclick = openDrawer;
    $('closeDrawer').onclick = closeDrawer;
    $('drawerOverlay').onclick = () => { closeDrawer(); closeSettings(); };
    $('settingsBtn').onclick = openSettings;
    $('closeSettings').onclick = closeSettings;

    // Home
    $('goToLoginBtn').onclick = () => switchView('login');
    $('goToEnrollBtn').onclick = () => switchView('enroll');

    // Enroll
    $('capHandBtn').onclick = captureHand;
    $('capFaceBtn').onclick = captureFace;
    $('saveEnrollBtn').onclick = saveEnrollment;

    // Login
    $('startLoginBtn').onclick = () => startLoginCountdown(5);
    $('startLoginFastBtn').onclick = () => startLoginCountdown(1);

    // Drawer actions
    $('exportUsersBtn').onclick = exportUsers;
    $('importUsersBtn').onclick = importUsers;
    $('clearAllBtn').onclick = clearAllUsers;

    // Settings
    $('settingFaceThreshold').addEventListener('input', (e) => {
      state.settings.faceThreshold = parseFloat(e.target.value);
      $('faceThresholdVal').textContent = state.settings.faceThreshold.toFixed(2);
      saveSettings();
    });
    $('settingHandThreshold').addEventListener('input', (e) => {
      state.settings.handThreshold = parseFloat(e.target.value);
      $('handThresholdVal').textContent = state.settings.handThreshold.toFixed(2);
      saveSettings();
    });
    $('settingMinGap').addEventListener('input', (e) => {
      state.settings.minGap = parseFloat(e.target.value);
      $('minGapVal').textContent = state.settings.minGap.toFixed(3);
      saveSettings();
    });
    $('settingCamera').addEventListener('change', (e) => {
      state.selectedCameraId = e.target.value;
      // Restart active camera
      if (cameraEnroll) { stopCamera(cameraEnroll); cameraEnroll = null; startEnrollCamera(); }
      if (cameraLogin) { stopCamera(cameraLogin); cameraLogin = null; startLoginCamera(); }
    });

    // Modals
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden'));
    });
    document.querySelectorAll('.modal').forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
    });
    $('showTutorialBtn').onclick = () => $('tutorial').classList.remove('hidden');
    $('aboutBtn').onclick = () => $('about').classList.remove('hidden');

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
        if ($('drawer').classList.contains('open')) closeDrawer();
        if ($('settingsDrawer').classList.contains('open')) closeSettings();
      }
    });
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  async function init() {
    const loadingOverlay = $('loadingOverlay');
    const loadingStep = $('loadingStep');
    const loadingBar = $('loadingBar');

    function setStep(text, pct) {
      loadingStep.textContent = text;
      loadingBar.style.width = `${pct}%`;
    }

    try {
      setStep('Lecture des réglages…', 10);
      loadSettings();
      applySettings();
      renderDrawerList();
      updateStats();

      setStep('Démarrage MediaPipe Hands…', 30);
      try {
        await getHands();
        state.mediaPipeReady = true;
        setBadge('mpStatus', 'ok', 'OK');
      } catch (e) {
        setBadge('mpStatus', 'error', 'Erreur');
        console.error(e);
      }

      setStep('Chargement Face-API…', 60);
      const faceOk = await loadFaceApi();
      if (faceOk) {
        setBadge('faStatus', 'ok', 'OK');
      } else {
        setBadge('faStatus', 'error', 'Indispo');
      }

      setStep('Énumération des caméras…', 80);
      await listCameras();
      if (state.cameras.length > 0) setBadge('camStatus', 'ok', 'OK');
      else setBadge('camStatus', 'pending', 'Aucune');

      setStep('Prêt ✓', 100);
      await new Promise((r) => setTimeout(r, 400));
      loadingOverlay.classList.add('hidden');
      wireEvents();
      updateStats();

      // Show tutorial on first visit
      if (!localStorage.getItem('tutorialSeen')) {
        $('tutorial').classList.remove('hidden');
        localStorage.setItem('tutorialSeen', '1');
      }
    } catch (e) {
      loadingStep.textContent = `❌ Erreur d'initialisation: ${e.message}`;
      console.error(e);
    }

    // Global error handler
    window.onerror = (msg, src, line, col, err) => {
      console.error('Global error:', msg, line, err);
      toast(`❌ ${msg}`);
    };
    window.onunhandledrejection = (e) => {
      console.error('Unhandled rejection:', e.reason);
      e.preventDefault();
    };
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();