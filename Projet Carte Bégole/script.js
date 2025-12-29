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

// --- FRONTIÈRES ---
fetch('village.json')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, {
            style: { color: '#ff3333', weight: 3, opacity: 0.8, fillOpacity: 0.1 }
        }).addTo(map);
    })
    .catch(e => console.log("Frontières non chargées"));

// --- DONNÉES & CLUSTER ---
var savedPoints = [];

// CHANGEMENT ICI : On utilise markerClusterGroup au lieu de layerGroup
var markersLayer = L.markerClusterGroup({
    showCoverageOnHover: false, // N'affiche pas le polygone bleu au survol (plus propre)
    maxClusterRadius: 50        // Rayon de regroupement (plus petit = plus précis)
});
map.addLayer(markersLayer);

var currentFilterEmoji = null; 
var currentFilterText = null;

loadFromLocalStorage();

var tempLatLng = null;

map.on('click', function(e) {
    tempLatLng = e.latlng;
    openModal();
});

// --- MENU ---
function toggleMenu() {
    var menu = document.getElementById('menu-items');
    if (menu.classList.contains('hidden-mobile')) {
        menu.classList.remove('hidden-mobile');
    } else {
        menu.classList.add('hidden-mobile');
    }
}

// --- LOGIQUE FILTRES ---
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

// --- STATISTIQUES (NOUVEAU) ---
function showStats() {
    // 1. Calcul des stats
    var stats = {};
    savedPoints.forEach(p => {
        var emoji = p.emoji || "❓";
        if (stats[emoji]) { stats[emoji]++; } else { stats[emoji] = 1; }
    });

    // 2. Génération HTML
    var htmlContent = "";
    if (Object.keys(stats).length === 0) {
        htmlContent = "<p>Aucun point enregistré pour le moment.</p>";
    } else {
        for (var key in stats) {
            htmlContent += `
                <div class="stat-row">
                    <span><span class="stat-emoji">${key}</span></span>
                    <span class="stat-count">${stats[key]} points</span>
                </div>`;
        }
        // Total
        htmlContent += `<div style="margin-top:15px; font-weight:bold; border-top:2px solid #333; padding-top:10px;">
            Total : ${savedPoints.length} points
        </div>`;
    }

    // 3. Affichage
    document.getElementById('stats-content').innerHTML = htmlContent;
    document.getElementById('stats-overlay').classList.remove('hidden');
    toggleMenu();
}

function closeStats() {
    document.getElementById('stats-overlay').classList.add('hidden');
}


// --- GPS ---
var userMarker = null; var userAccuracyCircle = null; var watchId = null;

function toggleLocation() {
    var btn = document.getElementById('btn-loc');
    if (watchId) {
        navigator.geolocation.clearWatch(watchId); watchId = null;
        if (userMarker) map.removeLayer(userMarker);
        if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);
        btn.innerHTML = "📍 Activer GPS"; btn.style.backgroundColor = "#9b59b6";
        toggleMenu(); 
    } else {
        if (!navigator.geolocation) { alert("Pas de GPS"); return; }
        btn.innerHTML = "🛑 Arrêter GPS"; btn.style.backgroundColor = "#7f8c8d";
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude; const lng = position.coords.longitude; const accuracy = position.coords.accuracy;
                if (!userMarker) {
                    var pulsingIcon = L.divIcon({ className: 'user-location-dot', iconSize: [20, 20] });
                    userMarker = L.marker([lat, lng], {icon: pulsingIcon}).addTo(map);
                    userAccuracyCircle = L.circle([lat, lng], {radius: accuracy, color: '#3498db', fillOpacity: 0.15}).addTo(map);
                    map.setView([lat, lng], 16); toggleMenu();
                } else {
                    userMarker.setLatLng([lat, lng]); userAccuracyCircle.setLatLng([lat, lng]); userAccuracyCircle.setRadius(accuracy);
                }
            },
            (error) => { alert("Erreur GPS"); toggleLocation(); },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
        );
    }
}

// --- MODALE AJOUT ---
function openModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    var emojiInput = document.getElementById('input-emoji');
    emojiInput.value = "📍"; emojiInput.focus(); emojiInput.select();
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

// --- CRUD ---
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
    var marker = L.marker([lat, lng], { icon: customIcon, draggable: true });

    marker.on('dragend', function(event) {
        var newPos = event.target.getLatLng();
        savedPoints[index].lat = newPos.lat;
        savedPoints[index].lng = newPos.lng;
        saveToLocalStorage();
    });

    var dateDisplay = date ? `<div style="color:#888; font-size:11px; margin-top:4px;">📅 ${date}</div>` : "";
    var googleMapsLink = `http://googleusercontent.com/maps.google.com/maps?q=${lat},${lng}`; // Corrigé format URL

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
            <div style="font-size:10px; color:#aaa; margin-top:5px;">(Maintenez pour déplacer)</div>
        </div>
    `;
    marker.bindPopup(popupContent);
    markersLayer.addLayer(marker); // On ajoute au cluster, pas directement à la carte
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
    if(confirm("Tout effacer ?")) {
        savedPoints = []; saveToLocalStorage(); refreshMap(); toggleMenu();
    }
}
function exportData() {
    const dataStr = JSON.stringify(savedPoints, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `carte-begole-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); toggleMenu();
}
function importData(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try { savedPoints = JSON.parse(e.target.result); saveToLocalStorage(); refreshMap(); alert("Points importés !"); } 
        catch (err) { alert("Erreur fichier"); }
    };
    reader.readAsText(file); toggleMenu();
}