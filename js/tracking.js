import { saveToDB } from './db.js';
import { showToast, triggerHaptic, formatDuration, getSpeedColor } from './utils.js';
import { updateDashboard } from './ui.js';
import { checkTrophyProximity } from './gamification.js';
import { getMapInstance } from './map.js'; // getTracksLayer n'est plus importé ici car géré localement ou via map

// --- État interne du Tracking ---
let isRecording = false; // "isTracking" renommé en "isRecording" pour la clarté
let trackWatchId = null;
let currentPath = []; // [lat, lng, alt, speed]
let currentStartTime = null;
let currentDistance = 0;
let lastPositionTime = null;
let timerInterval = null;
let wakeLock = null;
let autoSaveInterval = null;

// Calque spécifique pour le tracé en cours
let currentTraceLayer = null;

// --- Initialisation ---

/**
 * Prépare le module tracking et lance le suivi GPS passif (Point Bleu)
 * @param {L.Map} mapInstance
 */
export function initTracking(mapInstance) {
    // 1. Initialiser le calque de tracé
    if (!currentTraceLayer && mapInstance) {
        currentTraceLayer = L.layerGroup().addTo(mapInstance);
    }

    // 2. Lancer le GPS immédiatement (Mode Passif)
    startPassiveGPS();
}

// --- Fonctions GPS ---

function startPassiveGPS() {
    if (trackWatchId) return; // Déjà lancé

    if ('geolocation' in navigator) {
        trackWatchId = navigator.geolocation.watchPosition(
            onLocationUpdate, 
            (err) => {
                console.warn("Erreur GPS", err);
                if(err.code === 1) showToast("⚠️ GPS refusé par l'utilisateur");
                else showToast("⚠️ Signal GPS introuvable");
            }, 
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
        );
    } else {
        showToast("Géolocalisation non supportée");
    }
}

/**
 * Callback appelé à chaque nouvelle position GPS
 * Gère à la fois l'affichage (Point Bleu) et l'enregistrement (Si REC actif)
 */
function onLocationUpdate(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const alt = pos.coords.altitude || 0;
    const acc = pos.coords.accuracy;
    const head = pos.coords.heading;
    let speed = pos.coords.speed;
    const now = Date.now();

    // 1. TOUJOURS mettre à jour l'UI (Point Bleu & Boussole)
    document.dispatchEvent(new CustomEvent('tracking-update', { 
        detail: { lat, lng, acc, head } 
    }));

    // Gamification (Trophée) - Marche tout le temps
    const map = getMapInstance();
    if (map) checkTrophyProximity(map, lat, lng);

    // 2. SI ON N'ENREGISTRE PAS, ON S'ARRÊTE LÀ
    if (!isRecording) return;

    // --- LOGIQUE D'ENREGISTREMENT (REC) ---

    // Calcul de vitesse manuel si null
    if ((speed === null || speed === 0) && lastPositionTime && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        if (map) {
            const distM = map.distance([lastPt[0], lastPt[1]], [lat, lng]);
            const timeDiffS = (now - lastPositionTime) / 1000;
            if (timeDiffS > 0) speed = distM / timeDiffS;
        }
    }
    lastPositionTime = now;

    // Calcul distance cumulée
    if (map && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const distSeg = map.distance([lastPt[0], lastPt[1]], [lat, lng]);
        currentDistance += (distSeg / 1000); // km
    }

    // Mise à jour Dashboard
    updateDashboard(alt, speed, currentDistance);

    // Dessin sur la carte
    if (currentTraceLayer && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const segmentColor = getSpeedColor(speed);
        
        L.polyline([[lastPt[0], lastPt[1]], [lat, lng]], {
            color: segmentColor, weight: 5, opacity: 0.8, lineCap: 'round'
        }).addTo(currentTraceLayer);
    }

    // Ajout aux données [lat, lng, alt, speed]
    const newPoint = [lat, lng, alt, speed || 0];
    currentPath.push(newPoint);
}

// --- Fonctions Publiques (Boutons UI) ---

/**
 * Active ou désactive l'ENREGISTREMENT (REC)
 */
export async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const map = getMapInstance();

    if (!isRecording) {
        // --- DÉMARRAGE REC ---
        isRecording = true;
        
        // Reset données
        currentPath = [];
        currentDistance = 0;
        currentStartTime = new Date();
        lastPositionTime = Date.now();
        
        // UI
        if (btn) {
            btn.innerHTML = "⏹️ Stop";
            btn.className = "btn-stop-track";
        }
        document.getElementById('recording-container').classList.remove('hidden');
        document.getElementById('dashboard').classList.remove('hidden');

        // Outils système
        startTimer();
        await requestWakeLock();
        autoSaveInterval = setInterval(saveTrackState, 10000);

        // Nettoyage visuel précédent
        if (currentTraceLayer) currentTraceLayer.clearLayers();

        showToast("REC démarré 🌈");
        triggerHaptic('start');

        // On s'assure que le GPS est bien lancé (si jamais)
        startPassiveGPS();

    } else {
        // --- ARRÊT REC ---
        isRecording = false;
        
        // Note : On NE COUPE PAS le GPS (trackWatchId), on arrête juste d'enregistrer !

        // Stop Outils
        stopTimer();
        await releaseWakeLock();
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = null;
        }
        localStorage.removeItem('begole_temp_track');

        // UI
        if (btn) {
            btn.innerHTML = "▶️ Lancer Trajet";
            btn.className = "btn-start-track";
        }
        document.getElementById('recording-container').classList.add('hidden');
        document.getElementById('dashboard').classList.add('hidden');

        // Sauvegarde finale
        if (currentPath.length > 0) {
            const endTime = new Date();
            const elevationData = calculateElevation(currentPath);
            await saveTrip(currentPath, currentStartTime, endTime, currentDistance, elevationData);
            alert(`Trajet terminé !\nDistance: ${currentDistance.toFixed(2)}km\nDénivelé: +${elevationData.gain}m`);
            document.dispatchEvent(new CustomEvent('trip-saved'));
        }

        if (currentTraceLayer) currentTraceLayer.clearLayers();
    }
}

/**
 * Sauvegarde l'état (Recovery)
 */
export function saveTrackState() {
    if (isRecording && currentPath.length > 0) {
        localStorage.setItem('begole_temp_track', JSON.stringify({
            path: currentPath,
            startTime: currentStartTime,
            distance: currentDistance
        }));
    }
}

/**
 * Vérifie Crash Recovery
 */
export function checkCrashRecovery(mapInstance) {
    const temp = localStorage.getItem('begole_temp_track');
    if (!temp) return;

    try {
        const data = JSON.parse(temp);
        if (data && data.path && data.path.length > 0) {
            if (confirm("Un trajet en cours a été interrompu. Voulez-vous le reprendre ?")) {
                // Restauration
                currentPath = data.path;
                currentStartTime = new Date(data.startTime);
                currentDistance = data.distance;
                
                // Relance REC
                isRecording = true;
                const btn = document.getElementById('btn-tracking');
                if (btn) {
                    btn.innerHTML = "⏹️ Stop";
                    btn.className = "btn-stop-track";
                }
                document.getElementById('recording-container').classList.remove('hidden');
                document.getElementById('dashboard').classList.remove('hidden');

                if (!currentTraceLayer && mapInstance) {
                    currentTraceLayer = L.layerGroup().addTo(mapInstance);
                }
                if (currentTraceLayer) {
                    L.polyline(currentPath.map(p => [p[0], p[1]]), {
                        color: 'red', weight: 5
                    }).addTo(currentTraceLayer);
                }

                startTimer();
                requestWakeLock();
                autoSaveInterval = setInterval(saveTrackState, 10000);
                startPassiveGPS(); // Relance GPS
                
                showToast("Trajet restauré ♻️");
            } else {
                localStorage.removeItem('begole_temp_track');
            }
        }
    } catch (e) {
        console.error("Erreur récupération", e);
        localStorage.removeItem('begole_temp_track');
    }
}

// --- Utilitaires Internes ---

function startTimer() {
    const el = document.getElementById('recording-timer');
    if (!el) return;
    el.innerText = formatDuration(new Date() - currentStartTime);
    timerInterval = setInterval(() => {
        el.innerText = formatDuration(new Date() - currentStartTime);
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    const el = document.getElementById('recording-timer');
    if (el) el.innerText = "00:00";
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (e) { console.warn("Wake Lock fail", e); }
}

async function releaseWakeLock() {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
}

function calculateElevation(points) {
    let gain = 0; let loss = 0;
    if (points.length < 2) return { gain: 0, loss: 0 };
    let lastAlt = points[0][2];
    for (let i = 1; i < points.length; i++) {
        let currAlt = points[i][2];
        if (currAlt !== null && lastAlt !== null && currAlt !== 0 && lastAlt !== 0) {
            let diff = currAlt - lastAlt;
            if (Math.abs(diff) > 2) {
                if (diff > 0) gain += diff; else loss += Math.abs(diff);
                lastAlt = currAlt;
            }
        }
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

async function saveTrip(points, start, end, dist, elevation) {
    const trip = {
        id: Date.now(),
        date: start.toISOString(),
        duration: end - start,
        distance: dist,
        points: points,
        elevationGain: elevation.gain,
        note: ""
    };
    await saveToDB('trips', trip);
}