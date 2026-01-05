import { saveToDB } from './db.js';
import { showToast, triggerHaptic, formatDuration, getSpeedColor } from './utils.js';
import { updateDashboard } from './ui.js';
import { checkTrophyProximity } from './gamification.js';
import { getMapInstance, getTracksLayer } from './map.js';

// --- État interne du Tracking ---
let isTracking = false;
let trackWatchId = null;
let currentPath = []; // [lat, lng, alt, speed]
let currentStartTime = null;
let currentDistance = 0;
let lastPositionTime = null;
let timerInterval = null;
let wakeLock = null;
let autoSaveInterval = null;

// Calque spécifique pour le tracé en cours (différent de tracksLayer global)
let currentTraceLayer = null;

// --- Initialisation ---

/**
 * Prépare le module tracking
 * @param {L.Map} mapInstance - Référence à la carte (optionnel si on utilise getMapInstance)
 */
export function initTracking(mapInstance) {
    // On s'assure que le calque de tracé est prêt
    if (!currentTraceLayer && mapInstance) {
        currentTraceLayer = L.layerGroup().addTo(mapInstance);
    }
}

// --- Fonctions Principales ---

/**
 * Active ou désactive l'enregistrement
 * Gère le bouton UI, le WakeLock et le GPS
 */
export async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const map = getMapInstance();

    if (!isTracking) {
        // --- DÉMARRAGE ---
        isTracking = true;
        
        // Reset des variables
        currentPath = [];
        currentDistance = 0;
        currentStartTime = new Date();
        lastPositionTime = Date.now();
        
        // UI
        if (btn) {
            btn.innerHTML = "⏹️ Stop";
            btn.className = "btn-stop-track"; // Change la couleur en rouge (CSS)
        }
        document.getElementById('recording-container').classList.remove('hidden');
        document.getElementById('dashboard').classList.remove('hidden');

        // Outils système
        startTimer();
        await requestWakeLock();
        
        // Sauvegarde de secours toutes les 10s
        autoSaveInterval = setInterval(saveTrackState, 10000);

        // Carte
        if (!currentTraceLayer && map) {
            currentTraceLayer = L.layerGroup().addTo(map);
        } else if (currentTraceLayer) {
            currentTraceLayer.clearLayers();
        }

        // Géolocalisation
        trackWatchId = navigator.geolocation.watchPosition(
            updateTrackingPosition, 
            (err) => console.warn("Erreur GPS", err), 
            { enableHighAccuracy: true }
        );

        showToast("REC démarré 🌈");
        triggerHaptic('start');

    } else {
        // --- ARRÊT ---
        isTracking = false;
        
        // Stop GPS
        navigator.geolocation.clearWatch(trackWatchId);
        trackWatchId = null;

        // Stop Outils
        stopTimer();
        await releaseWakeLock();
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = null;
        }
        
        // Nettoyage sauvegarde temporaire
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
            
            // On envoie un événement pour dire à l'historique de se rafraîchir
            document.dispatchEvent(new CustomEvent('trip-saved'));
        }

        // Nettoyage carte
        if (currentTraceLayer) currentTraceLayer.clearLayers();
    }
}

/**
 * Callback appelé à chaque nouvelle position GPS
 */
function updateTrackingPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const alt = pos.coords.altitude || 0;
    let speed = pos.coords.speed;
    const now = Date.now();

    // Calcul de vitesse manuel si le GPS renvoie null (arrive souvent)
    if ((speed === null || speed === 0) && lastPositionTime && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const map = getMapInstance();
        if (map) {
            const distM = map.distance([lastPt[0], lastPt[1]], [lat, lng]);
            const timeDiffS = (now - lastPositionTime) / 1000;
            if (timeDiffS > 0) speed = distM / timeDiffS;
        }
    }
    lastPositionTime = now;

    // Gamification : Vérifier si on a atteint le trophée
    const map = getMapInstance();
    if (map) {
        checkTrophyProximity(map, lat, lng);
    }

    // Calcul distance cumulée
    if (map && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const distSeg = map.distance([lastPt[0], lastPt[1]], [lat, lng]);
        currentDistance += (distSeg / 1000); // km
    }

    // Mise à jour UI Dashboard
    updateDashboard(alt, speed, currentDistance);

    // Dessin sur la carte (Ligne colorée selon vitesse)
    if (currentTraceLayer && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const segmentColor = getSpeedColor(speed);
        
        L.polyline([[lastPt[0], lastPt[1]], [lat, lng]], {
            color: segmentColor,
            weight: 5,
            opacity: 0.8,
            lineCap: 'round'
        }).addTo(currentTraceLayer);
    }

    // Ajout aux données
    // Format compact: [lat, lng, alt, speed]
    const newPoint = [lat, lng, alt, speed || 0];
    currentPath.push(newPoint);

    // Centrage automatique (si l'utilisateur n'a pas bougé la carte manuellement)
    // Pour simplifier ici, on émet un event custom, ou on importe isAutoCentering de UI si besoin
    // Mais pour garder tracking.js pur, on émet un événement de mise à jour position
    document.dispatchEvent(new CustomEvent('tracking-update', { 
        detail: { lat, lng, acc: pos.coords.accuracy, head: pos.coords.heading } 
    }));
}

/**
 * Sauvegarde l'état actuel dans le LocalStorage (Recovery)
 */
export function saveTrackState() {
    if (isTracking && currentPath.length > 0) {
        localStorage.setItem('begole_temp_track', JSON.stringify({
            path: currentPath,
            startTime: currentStartTime,
            distance: currentDistance
        }));
    }
}

/**
 * Vérifie au chargement si un trajet a été interrompu brutalement (crash/refresh)
 */
export function checkCrashRecovery(mapInstance) {
    const temp = localStorage.getItem('begole_temp_track');
    if (!temp) return;

    try {
        const data = JSON.parse(temp);
        if (data && data.path && data.path.length > 0) {
            if (confirm("Un trajet en cours a été interrompu. Voulez-vous le reprendre ?")) {
                // Restauration des données
                currentPath = data.path;
                currentStartTime = new Date(data.startTime);
                currentDistance = data.distance;
                
                // Relance Tracking
                isTracking = true;
                const btn = document.getElementById('btn-tracking');
                if (btn) {
                    btn.innerHTML = "⏹️ Stop";
                    btn.className = "btn-stop-track";
                }
                document.getElementById('recording-container').classList.remove('hidden');
                document.getElementById('dashboard').classList.remove('hidden');

                // Restauration Visuelle sur la carte
                if (!currentTraceLayer && mapInstance) {
                    currentTraceLayer = L.layerGroup().addTo(mapInstance);
                }
                if (currentTraceLayer) {
                    // On redessine tout le tracé d'un coup en rouge pour simplifier la restauration
                    L.polyline(currentPath.map(p => [p[0], p[1]]), {
                        color: 'red',
                        weight: 5
                    }).addTo(currentTraceLayer);
                }

                // Relance des processus
                startTimer();
                requestWakeLock();
                autoSaveInterval = setInterval(saveTrackState, 10000);
                trackWatchId = navigator.geolocation.watchPosition(
                    updateTrackingPosition, 
                    null, 
                    { enableHighAccuracy: true }
                );
                
                showToast("Trajet restauré ♻️");
            } else {
                localStorage.removeItem('begole_temp_track');
            }
        }
    } catch (e) {
        console.error("Erreur récupération trajet", e);
        localStorage.removeItem('begole_temp_track');
    }
}

// --- Utilitaires Internes ---

function startTimer() {
    const el = document.getElementById('recording-timer');
    if (!el) return;
    
    // Mise à jour immédiate
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
    } catch (e) {
        console.warn("Wake Lock non supporté ou refusé", e);
    }
}

async function releaseWakeLock() {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
}

function calculateElevation(points) {
    let gain = 0;
    let loss = 0;
    
    if (points.length < 2) return { gain: 0, loss: 0 };
    
    // Index 2 est l'altitude dans notre tableau [lat, lng, alt, speed]
    let lastAlt = points[0][2];
    
    for (let i = 1; i < points.length; i++) {
        let currAlt = points[i][2];
        
        // Filtrage simple : on ignore les sauts bizarres ou nuls
        if (currAlt !== null && lastAlt !== null && currAlt !== 0 && lastAlt !== 0) {
            let diff = currAlt - lastAlt;
            
            // Seuil de 2m pour éviter le bruit GPS
            if (Math.abs(diff) > 2) {
                if (diff > 0) gain += diff;
                else loss += Math.abs(diff);
                
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
        note: "" // Pourra être édité plus tard
    };
    
    await saveToDB('trips', trip);
}