import { VILLAGE_COORDS } from './config.js';
import { showToast, triggerHaptic, pad } from './utils.js';

// --- État interne Trophée ---
let trophyMarker = null;
let dailyTrophyCoords = null;
let isTrophyClaimed = false;
let trophyInterval = null;

// --- NIVEAUX & XP ---

/**
 * Calcule et met à jour l'affichage du niveau utilisateur
 * @param {Array} points - Liste des points enregistrés
 * @param {Array} trips - Liste des trajets enregistrés
 */
export function updateUserLevel(points = [], trips = []) {
    // Calcul de l'XP
    const totalPoints = points.length;
    const totalKm = trips.reduce((acc, t) => acc + (t.distance || 0), 0);
    const totalHistory = points.reduce((acc, p) => acc + (p.history ? p.history.length : 0), 0);

    // Formule : 100xp par point, 50xp par km, 10xp par note
    const xp = Math.floor((totalPoints * 100) + (totalKm * 50) + (totalHistory * 10));

    // Calcul du niveau (Palier tous les 500 + increment)
    let level = 1;
    let xpForNext = 500;
    let xpForCurrent = 0;
    let increment = 500;

    while (xp >= xpForNext) {
        level++;
        xpForCurrent = xpForNext;
        increment += 500; // La difficulté augmente
        xpForNext += increment;
    }

    // Titres
    const titles = [
        "Vagabond", "Promeneur", "Eclaireur", "Pisteur", "Traqueur", 
        "Aventurier", "Explorateur", "Ranger", "Sentinelle", "Garde-Forestier", 
        "Druide", "Chamane", "Maître des Bois", "Gardien Ancestral", 
        "Ermite Légendaire", "Esprit de la Forêt", "Seigneur Sauvage", 
        "Roi de Bégole", "Demi-Dieu", "Légende Vivante"
    ];
    const titleIndex = Math.min(level - 1, titles.length - 1);
    const title = titles[titleIndex];

    // Mise à jour UI
    const elTitle = document.getElementById('user-title');
    const elLvl = document.getElementById('user-lvl');
    const elBar = document.getElementById('user-xp-bar');

    if (elTitle) elTitle.innerText = title;
    if (elLvl) elLvl.innerText = `Niv. ${level}`;

    // Barre de progression
    const range = xpForNext - xpForCurrent;
    const currentInLevel = xp - xpForCurrent;
    const percent = Math.min(100, Math.max(0, (currentInLevel / range) * 100));

    if (elBar) {
        elBar.style.width = `${percent}%`;
        // Couleur selon le tier
        if (level < 5) elBar.style.background = "#2ecc71"; // Vert
        else if (level < 10) elBar.style.background = "#3498db"; // Bleu
        else if (level < 15) elBar.style.background = "#9b59b6"; // Violet
        else elBar.style.background = "linear-gradient(90deg, #f1c40f, #e67e22)"; // Or
    }
}

// --- SUCCÈS (BADGES) ---

/**
 * Vérifie et affiche les badges débloqués
 * @param {Array} points 
 * @param {Array} trips 
 */
export function showAchievements(points = [], trips = []) {
    try {
        const content = document.getElementById('achievements-content');
        if (!content) return;

        content.innerHTML = "";

        // Pré-calculs pour les conditions
        const totalPoints = points.length;
        const totalTrips = trips.length;
        const totalDist = trips.reduce((acc, t) => acc + (t.distance || 0), 0);
        const totalElevation = trips.reduce((acc, t) => acc + (t.elevationGain || 0), 0);
        
        const totalPhotos = points.reduce((acc, p) => {
            return acc + (p.history ? p.history.filter(h => h.photo).length : 0);
        }, 0);
        const totalHistory = points.reduce((acc, p) => acc + (p.history ? p.history.length : 0), 0);

        let daysSinceStart = 0;
        if (totalPoints > 0) {
            const validIds = points.map(p => p.id).filter(id => id && !isNaN(id));
            if (validIds.length > 0) {
                const firstDate = new Date(Math.min(...validIds));
                daysSinceStart = (Date.now() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
            }
        }

        // Liste des Badges
        const badges = [
            { id: 'start', icon: '🌱', title: 'Premiers Pas', desc: '1er point enregistré', check: () => totalPoints >= 1 },
            { id: 'walker', icon: '🥾', title: 'Promeneur', desc: '10 km parcourus', check: () => totalDist >= 10 },
            { id: 'paparazzi', icon: '📷', title: 'Paparazzi', desc: '5 photos prises', check: () => totalPhotos >= 5 },
            { id: 'collec', icon: '🍄', title: 'Collectionneur', desc: '50 points trouvés', check: () => totalPoints >= 50 },
            { id: 'master', icon: '🧙', title: 'Grand Sage', desc: '100 points trouvés', check: () => totalPoints >= 100 },
            { id: 'ecureuil', icon: '🌰', title: 'Écureuil', desc: '20 trouvailles (Cèpes, Châtaignes...)', check: () => points.filter(p => p.emoji && ["🍄","🌰","🍂"].includes(p.emoji)).length >= 20 },
            { id: 'marathon', icon: '🏃', title: 'Marathonien', desc: '42 km cumulés', check: () => totalDist >= 42 },
            { id: 'ultra', icon: '🚀', title: 'Ultra-Trail', desc: '100 km cumulés', check: () => totalDist >= 100 },
            { id: 'climber', icon: '⛰️', title: 'Grimpeur', desc: '500m D+ cumulé', check: () => totalElevation >= 500 },
            { id: 'sherpa', icon: '🏔️', title: 'Sherpa', desc: '2000m D+ cumulé', check: () => totalElevation >= 2000 },
            { id: 'longtrip', icon: '⏱️', title: 'Longue Marche', desc: 'Une rando de plus de 3h', check: () => trips.some(t => t.duration > 10800000) },
            { id: 'earlybird', icon: '🌅', title: 'Lève-tôt', desc: 'Point créé entre 5h et 8h', check: () => points.some(p => { const h = new Date(p.id).getHours(); return h >= 5 && h < 8; }) },
            { id: 'night', icon: '🦉', title: 'Oiseau de Nuit', desc: 'Sortie nocturne (22h-5h)', check: () => points.some(p => { const h = new Date(p.id).getHours(); return h >= 22 || h < 5; }) },
            { id: 'rain', icon: '🌧️', title: 'Botte de Pluie', desc: 'Sortie sous la pluie', check: () => points.some(p => (p.weather || "").match(/Pluie|Averses|Orage/)) },
            { id: 'winter', icon: '❄️', title: 'Yéti', desc: 'Sortie en Hiver (Déc-Fév)', check: () => points.some(p => { const m = new Date(p.id).getMonth(); return m === 11 || m === 0 || m === 1; }) },
            { id: 'writer', icon: '✍️', title: 'Romancier', desc: '20 notes dans le carnet', check: () => totalHistory >= 20 },
            { id: 'veteran', icon: '🎖️', title: 'Vétéran', desc: 'Utilise l\'app depuis 1 an', check: () => daysSinceStart >= 365 },
            { id: 'addict', icon: '🔥', title: 'Accro', desc: '50 trajets enregistrés', check: () => totalTrips >= 50 }
        ];

        // Génération HTML
        let html = '<div class="achievements-grid">';
        let unlockedCount = 0;
        
        badges.forEach(b => {
            const unlocked = b.check();
            if (unlocked) unlockedCount++;
            html += `
                <div class="badge-card ${unlocked ? 'unlocked' : ''}">
                    <span class="badge-icon">${b.icon}</span>
                    <span class="badge-title">${b.title}</span>
                    <span class="badge-desc">${b.desc}</span>
                </div>`;
        });
        html += '</div>';

        // Barre de progression globale
        const percent = (unlockedCount / badges.length) * 100;
        const summary = `
            <div style="text-align:center; margin-bottom:15px; color:#555; font-weight:bold;">
                🏆 Progression : ${unlockedCount} / ${badges.length} badges
                <div style="background:#eee; height:8px; border-radius:4px; margin-top:5px; overflow:hidden;">
                    <div style="background:#f1c40f; height:100%; width:${percent}%"></div>
                </div>
            </div>`;

        content.innerHTML = summary + html;
        
        // Affichage Modal
        document.getElementById('modal-achievements').classList.remove('hidden');

    } catch (e) {
        console.error("Erreur Succès : ", e);
        showToast("Erreur d'affichage des succès 😢");
    }
}

// --- TROPHÉE DU JOUR ---

/**
 * Initialise le marqueur trophée sur la carte
 * @param {L.Map} map - Instance Leaflet
 * @param {Object} villageGeoJson - Données du village pour les limites
 */
export function initDailyTrophy(map, villageGeoJson) {
    if (!villageGeoJson) return;

    const today = new Date().toLocaleDateString();
    const storedData = JSON.parse(localStorage.getItem('begole_daily_trophy'));

    // Est-ce qu'on a déjà un trophée pour aujourd'hui ?
    if (storedData && storedData.date === today) {
        dailyTrophyCoords = storedData.coords;
        isTrophyClaimed = storedData.claimed;
    } else {
        // Nouveau jour, nouveau point
        dailyTrophyCoords = generateRandomPointInVillage(villageGeoJson);
        isTrophyClaimed = false;
        localStorage.setItem('begole_daily_trophy', JSON.stringify({
            date: today,
            coords: dailyTrophyCoords,
            claimed: false
        }));
    }

    // Affichage sur la carte si pas encore réclamé
    if (dailyTrophyCoords && !isTrophyClaimed) {
        const icon = L.divIcon({
            className: 'custom-trophy-wrapper',
            html: '<div class="trophy-anim">🏆</div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        const popupContent = `
            <div style="text-align:center;">
                <b>🏆 Objectif du Jour</b><br>
                Rejoins ce point pour gagner !<br>
                <div id="trophy-countdown" style="font-weight:800; color:#c0392b; font-size:14px; margin:5px 0; border:1px solid #eee; padding:2px; border-radius:5px; background:#fff;">
                    ⏳ Calcul...
                </div>
                <small>(Distance < 30m)</small>
            </div>
        `;

        trophyMarker = L.marker(dailyTrophyCoords, { icon: icon, zIndexOffset: 2000 })
            .addTo(map)
            .bindPopup(popupContent);

        // Timer dans la popup
        trophyMarker.on('popupopen', () => {
            const updateTimer = () => {
                const el = document.getElementById('trophy-countdown');
                if (el) el.innerText = "⏳ Fin dans : " + getTimeUntilMidnight();
            };
            updateTimer();
            trophyInterval = setInterval(updateTimer, 1000);
        });

        trophyMarker.on('popupclose', () => {
            if (trophyInterval) clearInterval(trophyInterval);
        });
    }
}

/**
 * Appelé par le tracking pour vérifier si on est proche du trophée
 */
export function checkTrophyProximity(map, userLat, userLng) {
    if (!dailyTrophyCoords || isTrophyClaimed) return;

    const distToTrophy = map.distance([userLat, userLng], dailyTrophyCoords);
    if (distToTrophy < 30) { // 30 mètres de tolérance
        claimTrophy(map);
    }
}

function claimTrophy(map) {
    if (isTrophyClaimed) return;
    
    isTrophyClaimed = true;
    const today = new Date().toLocaleDateString();
    
    // Mise à jour stockage
    localStorage.setItem('begole_daily_trophy', JSON.stringify({
        date: today,
        coords: dailyTrophyCoords,
        claimed: true
    }));

    // Suppression marqueur
    if (trophyMarker) map.removeLayer(trophyMarker);

    // Feedback
    triggerHaptic('success');
    showToast("🏆 TROPHÉE GAGNÉ ! +50 XP");
    
    // Petit délai pour l'alerte native
    setTimeout(() => {
        alert("🎉 BRAVO !\nTu as atteint l'objectif du jour.");
    }, 500);
}

// --- UTILITAIRES GÉOMÉTRIQUES ---

function getTimeUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const diff = midnight - now;
    if (diff <= 0) return "Expiré !";
    
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    return `${h}h ${pad(m)}m ${pad(s)}s`;
}

function generateRandomPointInVillage(geoJson) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    const coords = geoJson.coordinates;
    const flatCoords = coords.flat(Infinity);
    
    // Calcul Bounding Box
    for (let i = 0; i < flatCoords.length; i+=2) {
        const lng = flatCoords[i];
        const lat = flatCoords[i+1];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    }

    // Essayer 100 fois de trouver un point dans le polygone
    for (let i = 0; i < 100; i++) {
        const randLat = minLat + Math.random() * (maxLat - minLat);
        const randLng = minLng + Math.random() * (maxLng - minLng);
        const point = [randLng, randLat]; // GeoJSON est [Lng, Lat]
        
        if (isPointInMultiPolygon(point, coords)) {
            return [randLat, randLng]; // Leaflet est [Lat, Lng]
        }
    }
    
    // Fallback : Centre du village
    return VILLAGE_COORDS;
}

function isPointInMultiPolygon(point, multiPolyCoords) {
    let inside = false;
    const x = point[0], y = point[1];
    
    multiPolyCoords.forEach(polygon => {
        polygon.forEach(ring => {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const xi = ring[i][0], yi = ring[i][1];
                const xj = ring[j][0], yj = ring[j][1];
                
                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
        });
    });
    return inside;
}