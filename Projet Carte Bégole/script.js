// --- CONFIGURATION ---
const VILLAGE_COORDS = [43.1565, 0.3235]; 
const DEFAULT_ZOOM = 13;

// 1. Initialisation des FONDS DE CARTE
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
});

var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri'
});

var map = L.map('map', {
    center: VILLAGE_COORDS,
    zoom: DEFAULT_ZOOM,
    layers: [satelliteLayer] 
});

var baseMaps = {
    "Satellite 🛰️": satelliteLayer,
    "Plan Route 🗺️": osmLayer
};
L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(map);
// --- AJOUT ECHELLE ---
L.control.scale({imperial: false, metric: true}).addTo(map);

// --- FRONTIÈRES BÉGOLE ---
fetch('village.json')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, {
            style: { color: '#ff3333', weight: 3, opacity: 0.8, fillOpacity: 0.1 }
        }).addTo(map);
    })
    .catch(e => console.log("Frontières non chargées (fichier village.json manquant ?)"));

// --- VARIABLES GLOBALES DONNÉES ---
var savedPoints = [];
var markersLayer = L.layerGroup().addTo(map); // Pour les champignons
var tracksLayer = L.layerGroup().addTo(map);  // Pour les tracés GPS

var currentFilterEmoji = null; 
var currentFilterText = null;
var tempLatLng = null;

// --- VARIABLES TRACKING (ARIANE) ---
let isTracking = false;
let trackWatchId = null;
let currentPath = [];
let currentPolyline = null;
let wakeLock = null;
let currentStartTime = null; // Pour le chrono
let savedTrips = JSON.parse(localStorage.getItem('begole_gps_trips')) || [];

// Chargement initial
loadFromLocalStorage();

map.on('click', function(e) {
    tempLatLng = e.latlng;
    openModal(); // Ouvre la modale d'ajout de point
});

// --- MENU ---
function toggleMenu() {
    var menu = document.getElementById('menu-items');
    menu.classList.toggle('hidden-mobile');
}

// ============================================================
// --- 1. LOGIQUE WAKE LOCK (GARDER ECRAN ALLUMÉ) ---
// ============================================================
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            document.getElementById('wake-status').textContent = "🔆 Écran maintenu actif";
        }
    } catch (err) {
        console.log("Wake Lock erreur:", err);
    }
}
async function releaseWakeLock() {
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
        document.getElementById('wake-status').textContent = "";
    }
}
// Réactiver le WakeLock si on revient sur l'onglet
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// ============================================================
// --- 2. LOGIQUE TRACEUR GPS (ARIANE) ---
// ============================================================
async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const indicator = document.getElementById('recording-indicator');

    if (!isTracking) {
        // --- DÉMARRAGE ---
        isTracking = true;
        currentPath = [];
        currentStartTime = new Date(); // On lance le chrono
        
        btn.innerHTML = "⏹️ Arrêter Enregistrement";
        btn.className = "btn-stop-track"; // Change en rouge
        indicator.classList.remove('hidden');
        
        // Active le Wake Lock
        await requestWakeLock();

        // Création ligne rouge pour trajet en cours
        currentPolyline = L.polyline([], {color: 'red', weight: 5}).addTo(map);

        if (navigator.geolocation) {
            trackWatchId = navigator.geolocation.watchPosition(
                updateTrackingPosition, 
                (err) => alert("Erreur GPS Traceur"), 
                { enableHighAccuracy: true }
            );
        }
        toggleMenu(); // Fermer le menu pour voir la carte
    } else {
        // --- ARRÊT ---
        isTracking = false;
        navigator.geolocation.clearWatch(trackWatchId);
        
        // Désactive Wake Lock
        await releaseWakeLock();

        btn.innerHTML = "▶️ Démarrer Trajet";
        btn.className = "btn-start-track"; // Revient en vert
        indicator.classList.add('hidden');

        // Sauvegarde avec calcul de durée
        if (currentPath.length > 0) {
            const endTime = new Date();
            saveTrip(currentPath, currentStartTime, endTime);
            alert(`Trajet terminé !\nDurée : ${formatDuration(endTime - currentStartTime)}`);
        }
        
        // Nettoyage visuel immédiat (on pourra le revoir dans l'historique)
        if (currentPolyline) map.removeLayer(currentPolyline);
    }
}

function updateTrackingPosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const newLatLng = [lat, lng];

    // Mise à jour visuelle du marqueur utilisateur
    updateUserMarker(lat, lng, position.coords.accuracy);

    // Ajout au tracé
    currentPath.push(newLatLng);
    currentPolyline.setLatLngs(currentPath);
    map.setView(newLatLng); // Centrer auto
}

function saveTrip(path, startTime, endTime) {
    // Calcul durée (si dispo)
    const duration = (startTime && endTime) ? (endTime - startTime) : 0;

    const trip = {
        id: Date.now(),
        date: (startTime || new Date()).toISOString(),
        duration: duration,
        points: path
    };
    savedTrips.push(trip);
    localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
}

// --- HISTORIQUE DES TRAJETS ---
function openHistory() {
    renderHistoryList();
    document.getElementById('history-overlay').classList.remove('hidden');
    toggleMenu();
}
function closeHistory() {
    document.getElementById('history-overlay').classList.add('hidden');
}

// Convertit des millisecondes en texte lisible
function formatDuration(ms) {
    if (!ms) return "--";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)));

    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes}min ${seconds}s`;
}

// Supprime un trajet spécifique
function deleteTrip(id, event) {
    if (event) event.stopPropagation(); // Empêche d'ouvrir le trajet quand on clique sur la poubelle
    
    if (confirm("Voulez-vous vraiment supprimer ce trajet de l'historique ?")) {
        savedTrips = savedTrips.filter(t => t.id !== id);
        localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
        renderHistoryList(); // Rafraîchit la liste
        clearMapLayers(); // Efface la carte au cas où ce trajet était affiché
    }
}

function renderHistoryList() {
    const container = document.getElementById('tripList');
    container.innerHTML = '';
    
    // Tri par date décroissante
    const sorted = savedTrips.sort((a, b) => new Date(b.date) - new Date(a.date));

    if(sorted.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">Aucun trajet enregistré.</div>';
        return;
    }

    sorted.forEach((trip) => {
        const d = new Date(trip.date);
        const dateStr = d.toLocaleDateString() + ' à ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Affichage Durée ou Points (rétro-compatibilité)
        const infoStr = trip.duration ? `⏱️ ${formatDuration(trip.duration)}` : `📍 ${trip.points.length} points (Ancien)`;

        const div = document.createElement('div');
        div.className = 'trip-item';
        // Tout le bloc est cliquable pour voir le trajet
        div.onclick = () => {
            showSingleTrip(trip);
            closeHistory();
        };

        div.innerHTML = `
            <div style="flex-grow:1;">
                <span class="trip-date">${dateStr}</span>
                <span class="trip-info">${infoStr}</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <button class="btn-delete-trip" onclick="deleteTrip(${trip.id}, event)">🗑️</button>
                <div class="trip-action-icon">👁️</div>
            </div>
        `;
        container.appendChild(div);
    });
}

// --- FONCTIONS D'AFFICHAGE ET NETTOYAGE MODIFIÉES ---

function clearMapLayers() {
    tracksLayer.clearLayers();
    // RÉAPPARITION DES POINTS : On remet les champignons quand on efface les tracés
    if (!map.hasLayer(markersLayer)) {
        map.addLayer(markersLayer);
    }
}

function showSingleTrip(trip) {
    clearMapLayers(); 
    
    // DISPARITION DES POINTS : On cache les champignons pour voir le tracé
    if (map.hasLayer(markersLayer)) {
        map.removeLayer(markersLayer);
    }

    // Affiche le tracé en bleu (Single)
    const poly = L.polyline(trip.points, {color: '#3498db', weight: 5}).addTo(tracksLayer);
    map.fitBounds(poly.getBounds());
}

function showAllTrips() {
    clearMapLayers();
    
    // DISPARITION DES POINTS : On cache les champignons pour voir TOUS les tracés
    if (map.hasLayer(markersLayer)) {
        map.removeLayer(markersLayer);
    }

    const allPoints = [];
    savedTrips.forEach(trip => {
        // --- MODIFICATION ICI : COULEUR BLEU (#2980b9) AU LIEU DE VIOLET ---
        const poly = L.polyline(trip.points, {color: '#2980b9', weight: 3, opacity: 0.8}).addTo(tracksLayer);
        allPoints.push(...trip.points);
    });
    
    if (allPoints.length > 0) {
        map.fitBounds(L.polyline(allPoints).getBounds());
    }
    closeHistory();
}

// ============================================================
// --- 3. LOGIQUE EXISTANTE (POINTS, FILTRES, ETC.) ---
// ============================================================

// --- FILTRES ---
function applyFilter() {
    var inputVal = document.getElementById('filter-input').value.trim();
    if (inputVal) {
        currentFilterEmoji = inputVal;
        refreshMap();
        toggleMenu();
    } else { alert("Entrez un émoji !"); }
}
function applyTextFilter() {
    var textVal = document.getElementById('text-filter-input').value.trim().toLowerCase();
    currentFilterText = textVal;
    refreshMap();
    toggleMenu();
}
function resetFilter() {
    currentFilterEmoji = null; currentFilterText = null;
    document.getElementById('filter-input').value = "";
    document.getElementById('text-filter-input').value = "";
    refreshMap();
    toggleMenu();
}

// --- STATS ---
function showStats() {
    var stats = {};
    savedPoints.forEach(p => {
        var emoji = p.emoji || "❓";
        stats[emoji] = (stats[emoji] || 0) + 1;
    });

    var htmlContent = "";
    if (Object.keys(stats).length === 0) {
        htmlContent = "<p style='text-align:center; color:#999;'>Aucun point enregistré.</p>";
    } else {
        for (var key in stats) {
            htmlContent += `
                <div class="stat-row">
                    <div style="display:flex; align-items:center;">
                        <span class="stat-emoji">${key}</span>
                        <span class="stat-count">${stats[key]} points</span>
                    </div>
                </div>`;
        }
        htmlContent += `<div style="margin-top:15px; text-align:center; font-weight:bold; color:#666; font-size:14px;">
            Total : ${savedPoints.length} points
        </div>`;
    }
    document.getElementById('stats-content').innerHTML = htmlContent;
    document.getElementById('stats-overlay').classList.remove('hidden');
    toggleMenu();
}
function closeStats() {
    document.getElementById('stats-overlay').classList.add('hidden');
}

// --- VISUALISATION SIMPLE GPS (SANS ENREGISTREMENT) ---
var userMarker = null; var userAccuracyCircle = null; var watchId = null;

function toggleLocation() {
    var btn = document.getElementById('btn-loc');
    if (watchId) {
        navigator.geolocation.clearWatch(watchId); watchId = null;
        if (userMarker) map.removeLayer(userMarker);
        if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);
        userMarker = null; 
        btn.innerHTML = "📍 Ma position (Simple)"; btn.style.backgroundColor = "#9b59b6";
        toggleMenu(); 
    } else {
        if (!navigator.geolocation) { alert("Pas de GPS"); return; }
        btn.innerHTML = "🛑 Cacher position"; btn.style.backgroundColor = "#7f8c8d";
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                updateUserMarker(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
                map.setView([position.coords.latitude, position.coords.longitude], 16);
            },
            (error) => { alert("Erreur GPS"); toggleLocation(); },
            { enableHighAccuracy: true }
        );
        toggleMenu();
    }
}

// Fonction partagée pour mettre à jour le point bleu
function updateUserMarker(lat, lng, accuracy) {
    if (!userMarker) {
        var pulsingIcon = L.divIcon({ className: 'user-location-dot', iconSize: [20, 20] });
        userMarker = L.marker([lat, lng], {icon: pulsingIcon}).addTo(map);
        userAccuracyCircle = L.circle([lat, lng], {radius: accuracy, color: '#3498db', fillOpacity: 0.15}).addTo(map);
    } else {
        userMarker.setLatLng([lat, lng]);
        userAccuracyCircle.setLatLng([lat, lng]);
        userAccuracyCircle.setRadius(accuracy);
    }
}

// --- MODALE AJOUT ---
function openModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    var emojiInput = document.getElementById('input-emoji');
    emojiInput.value = "📍"; emojiInput.focus();
}
function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('input-note').value = "";
}
function confirmAddPoint() {
    var emoji = document.getElementById('input-emoji').value || "📍";
    var note = document.getElementById('input-note').value;
    if (note) {
        addPoint(tempLatLng.lat, tempLatLng.lng, note, emoji);
        closeModal();
    } else { alert("Description manquante !"); }
}

// --- CRUD POINTS ---
function deletePoint(index) {
    if (confirm("Supprimer ce point ?")) {
        savedPoints.splice(index, 1); 
        saveToLocalStorage();
        refreshMap(); 
    }
}
function addPoint(lat, lng, note, emoji) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'});
    savedPoints.push({ lat: lat, lng: lng, note: note, emoji: emoji, date: dateStr });
    saveToLocalStorage();
    refreshMap(); 
}
function createMarker(lat, lng, note, emoji, date, index) {
    var customIcon = L.divIcon({
        className: 'emoji-icon', html: emoji, iconSize: [34, 34], iconAnchor: [17, 17]
    });
    
    var marker = L.marker([lat, lng], { icon: customIcon });

    var dateDisplay = date ? `<div style="color:#888; font-size:11px; margin-top:4px;">📅 ${date}</div>` : "";
    var googleMapsLink = `http://googleusercontent.com/maps.google.com/maps?q=${lat},${lng}`;

    var popupContent = `
        <div style="text-align:center; min-width: 140px;">
            <div style="font-size: 28px; margin-bottom: 5px;">${emoji}</div>
            <b style="font-size: 14px; color: #333;">${note}</b>
            ${dateDisplay}
            <div style="margin-top: 8px;">
                <a href="${googleMapsLink}" target="_blank" class="popup-btn-go">🚗 Y aller</a>
            </div>
            <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
                <button onclick="deletePoint(${index})" class="btn-popup-delete">🗑️ Supprimer</button>
            </div>
        </div>
    `;
    marker.bindPopup(popupContent);
    marker.addTo(markersLayer);
}

function saveToLocalStorage() { localStorage.setItem('myMapPoints', JSON.stringify(savedPoints)); }
function loadFromLocalStorage() {
    var data = localStorage.getItem('myMapPoints');
    if (data) { savedPoints = JSON.parse(data); refreshMap(); }
}
function refreshMap() {
    markersLayer.clearLayers();
    savedPoints.forEach((p, i) => {
        if (currentFilterEmoji && p.emoji !== currentFilterEmoji) return;
        if (currentFilterText && !p.note.toLowerCase().includes(currentFilterText)) return;
        createMarker(p.lat, p.lng, p.note, p.emoji, p.date, i);
    });
}
function clearData() {
    if(confirm("Tout effacer ? (Points et Trajets)")) {
        savedPoints = []; 
        savedTrips = [];
        localStorage.removeItem('begole_gps_trips');
        saveToLocalStorage(); 
        refreshMap(); 
        toggleMenu();
    }
}

// --- SAUVEGARDE ET CHARGEMENT (COMPLET : POINTS + TRAJETS) ---

function exportData() {
    // On crée un objet complet avec les deux listes
    const backupData = {
        points: savedPoints,
        trips: savedTrips
    };
    
    const dataStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a'); 
    a.href = url;
    a.download = `backup-begole-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a); 
    toggleMenu();
}

function importData(input) {
    const file = input.files[0]; 
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try { 
            const data = JSON.parse(e.target.result);
            
            // Gestion de la compatibilité
            if (Array.isArray(data)) {
                // Ancien format : liste de points uniquement
                savedPoints = data;
                alert("Ancien format détecté : Seuls les points ont été importés.");
            } else {
                // Nouveau format : objet { points: [], trips: [] }
                if (data.points) savedPoints = data.points;
                if (data.trips) savedTrips = data.trips;
                
                // Sauvegarde immédiate
                localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
                alert(`Import réussi !\n${savedPoints.length} points\n${savedTrips.length} trajets`);
            }

            saveToLocalStorage(); // Sauvegarde les points
            refreshMap(); 
        } 
        catch (err) { 
            console.error(err);
            alert("Erreur : Le fichier est invalide."); 
        }
    };
    reader.readAsText(file); 
    toggleMenu();
    // Reset l'input pour pouvoir réimporter le même fichier si besoin
    input.value = ''; 
}

// --- MODE POCHE ---
// Protection contre les clics accidentels + économie batterie (écran noir)
var lastClickTime = 0;
function togglePocketMode() {
    var overlay = document.getElementById('pocket-overlay');
    var isHidden = overlay.classList.contains('hidden-poche');

    if (isHidden) {
        // ACTIVER
        overlay.classList.remove('hidden-poche');
        toggleMenu(); // Ferme le menu derrière
    } else {
        // DÉSACTIVER (Double clic simulé par le temps)
        var currentTime = new Date().getTime();
        if (currentTime - lastClickTime < 500) {
            overlay.classList.add('hidden-poche');
        } else {
            // Premier clic : attente du 2eme
            lastClickTime = currentTime;
        }
    }
}