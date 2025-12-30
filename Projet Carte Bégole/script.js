// --- CONFIGURATION ---
const VILLAGE_COORDS = [43.1565, 0.3235]; 
const DEFAULT_ZOOM = 13;

// --- 1. INITIALISATION DES FONDS DE CARTE ---
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });

var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' });

// Fond Cadastre (IGN) - Affichage visuel (Images PNG transparentes)
var cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { maxZoom: 20, attribution: '© IGN' });

var map = L.map('map', { center: VILLAGE_COORDS, zoom: DEFAULT_ZOOM, layers: [satelliteLayer] }); // Sat par défaut

// Gestion des calques
var baseMaps = { "Satellite 🛰️": satelliteLayer, "Plan Route 🗺️": osmLayer };
var overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
L.control.scale({imperial: false, metric: true}).addTo(map); // Echelle

// FRONTIÈRES BÉGOLE
fetch('village.json').then(r => r.json()).then(data => {
    L.geoJSON(data, { style: { color: '#ff3333', weight: 3, opacity: 0.8, fillOpacity: 0.05 } }).addTo(map);
}).catch(e => console.log("Pas de village.json"));


// --- VARIABLES GLOBALES ---
var savedPoints = []; // Champignons
var savedParcels = []; // Parcelles coloriées
var markersLayer = L.layerGroup().addTo(map);
var tracksLayer = L.layerGroup().addTo(map);
var parcelsLayer = L.layerGroup(); // Caché par défaut

var isTracking = false; var trackWatchId = null; var currentPath = []; var currentStartTime = null; 
var savedTrips = JSON.parse(localStorage.getItem('begole_gps_trips')) || [];
var wakeLock = null;

// Variables pour le mode Cadastre
var isCadastreMode = false;
var currentParcelGeoJSON = null; 
var selectedParcelColor = '#95a5a6'; // Gris par défaut
var tempLatLng = null;

// Variables Filtres
var currentFilterEmoji = null; 
var currentFilterText = null;

// Chargement initial
loadFromLocalStorage();


// ============================================================
// --- GESTION DU CADASTRE (CLICK & COLOR) ---
// ============================================================

// 1. Activer le mode "Clic pour sélectionner"
function toggleCadastreMode() {
    isCadastreMode = document.getElementById('cadastre-mode-toggle').checked;
    const isParcelsOn = document.getElementById('show-parcels-toggle').checked;
    
    if(isCadastreMode) {
        // ACTIVATION : On met le fond cadastre et on CACHE les points
        if(!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
        if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
        
        alert("MODE SÉLECTION ACTIVÉ 🏠\nCliquez sur une parcelle pour la colorier.");
    } else {
        // DÉSACTIVATION
        // Si la vue "Mes parcelles" n'est pas active, on retire le cadastre (Retour Satellite)
        if(!isParcelsOn && map.hasLayer(cadastreLayer)) {
            map.removeLayer(cadastreLayer);
        }

        // On REMET les points (sauf si "Mes parcelles" est actif, car ce mode les cache aussi)
        if(!isParcelsOn && !map.hasLayer(markersLayer)) {
            map.addLayer(markersLayer);
        }
    }
}

// 2. Afficher / Cacher les parcelles coloriées
function toggleSavedParcels() {
    const isChecked = document.getElementById('show-parcels-toggle').checked;
    
    if (isChecked) {
        // AFFICHER PARCELLES -> CACHER POINTS -> AFFICHER CADASTRE
        if (!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer);
        if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
        
        // AJOUT : On passe automatiquement en vue Cadastre
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
    } else {
        // CACHER PARCELLES
        if (map.hasLayer(parcelsLayer)) map.removeLayer(parcelsLayer);
        
        // AJOUT : Retour vue Satellite (Enlever Cadastre), sauf si le mode sélection est encore actif
        if (!isCadastreMode && map.hasLayer(cadastreLayer)) {
             map.removeLayer(cadastreLayer);
        }

        // On ne remet les points que si le mode sélection n'est PAS actif
        if (!isCadastreMode && !map.hasLayer(markersLayer)) {
            map.addLayer(markersLayer);
        }
    }
}

// GESTION DU CLIC SUR LA CARTE
map.on('click', function(e) {
    if (isCadastreMode) {
        // Mode Cadastre : On cherche la parcelle
        fetchParcelAt(e.latlng);
    } else {
        // Mode Normal : On ajoute un point
        tempLatLng = e.latlng;
        openModal(); 
    }
});

// Appel API Carto IGN
function fetchParcelAt(latlng) {
    const lat = latlng.lat;
    const lng = latlng.lng;
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${lng},${lat}]}`;

    document.body.style.cursor = 'wait';

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Erreur Service IGN");
            return response.json();
        })
        .then(data => {
            document.body.style.cursor = 'default';
            if (data.features && data.features.length > 0) {
                const parcel = data.features[0]; 
                openParcelModal(parcel);
            } else {
                alert("Aucune parcelle trouvée ici.");
            }
        })
        .catch(err => {
            document.body.style.cursor = 'default';
            console.error(err);
            alert("Erreur connexion IGN.");
        });
}

// Modale et Sauvegarde Parcelle
function openParcelModal(parcelGeoJSON) {
    currentParcelGeoJSON = parcelGeoJSON;
    document.getElementById('parcel-ref').textContent = "Ref: " + (parcelGeoJSON.properties.section + " " + parcelGeoJSON.properties.numero);
    document.getElementById('parcel-note').value = "";
    document.getElementById('modal-parcel').classList.remove('hidden');
    toggleMenu(); 
}
function closeParcelModal() {
    document.getElementById('modal-parcel').classList.add('hidden');
    currentParcelGeoJSON = null;
}

function selectColor(color, element) {
    selectedParcelColor = color;
    document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

function confirmSaveParcel() {
    if (!currentParcelGeoJSON) return;

    const note = document.getElementById('parcel-note').value;
    
    const savedParcel = {
        id: Date.now(),
        geoJSON: currentParcelGeoJSON,
        color: selectedParcelColor,
        note: note
    };

    savedParcels.push(savedParcel);
    saveToLocalStorage(); 
    displayParcels(); 
    
    // AUTO-AFFICHAGE : On force l'interrupteur "Voir mes parcelles" à ON
    if (!document.getElementById('show-parcels-toggle').checked) {
        document.getElementById('show-parcels-toggle').checked = true;
        toggleSavedParcels(); // Ceci va activer le calque et mettre le fond Cadastre
    }
    
    closeParcelModal();
}

function displayParcels() {
    parcelsLayer.clearLayers(); 

    savedParcels.forEach(p => {
        const style = {
            color: '#333', weight: 1,
            fillColor: p.color, fillOpacity: 0.6
        };

        const layer = L.geoJSON(p.geoJSON, {
            style: style,
            onEachFeature: function(feature, layer) {
                layer.bindPopup(`
                    <div style="text-align:center;">
                        <b>${p.note || "Sans nom"}</b><br>
                        <span style="font-size:10px; color:#666;">Ref: ${feature.properties.section} ${feature.properties.numero}</span><br>
                        <button onclick="deleteParcel(${p.id})" style="background:#e74c3c; color:white; border:none; border-radius:4px; margin-top:5px; padding:4px 8px; cursor:pointer;">Supprimer</button>
                    </div>
                `);
            }
        });
        layer.addTo(parcelsLayer);
    });
}

function deleteParcel(id) {
    if(confirm("Supprimer ce coloriage ?")) {
        savedParcels = savedParcels.filter(p => p.id !== id);
        saveToLocalStorage();
        displayParcels();
    }
}
function clearParcels() {
    if(confirm("Tout effacer les parcelles coloriées ?")) {
        savedParcels = [];
        saveToLocalStorage();
        displayParcels();
        toggleMenu();
    }
}


// ============================================================
// --- FONCTIONS EXISTANTES (Traceur, Points, etc.) ---
// ============================================================

// MENU
function toggleMenu() { document.getElementById('menu-items').classList.toggle('hidden-mobile'); }

// TRACEUR GPS
async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const indicator = document.getElementById('recording-indicator');
    if (!isTracking) {
        isTracking = true; currentPath = []; currentStartTime = new Date();
        btn.innerHTML = "⏹️ Arrêter REC"; btn.className = "btn-stop-track"; indicator.classList.remove('hidden');
        await requestWakeLock();
        currentPolyline = L.polyline([], {color: 'red', weight: 5}).addTo(map);
        if (navigator.geolocation) trackWatchId = navigator.geolocation.watchPosition(updateTrackingPosition, null, {enableHighAccuracy:true});
        toggleMenu();
    } else {
        isTracking = false; navigator.geolocation.clearWatch(trackWatchId); await releaseWakeLock();
        btn.innerHTML = "▶️ Démarrer Trajet"; btn.className = "btn-start-track"; indicator.classList.add('hidden');
        if (currentPath.length > 0) {
            saveTrip(currentPath, currentStartTime, new Date());
            alert(`Trajet terminé !\nDurée : ${formatDuration(new Date() - currentStartTime)}`);
        }
        if (currentPolyline) map.removeLayer(currentPolyline);
    }
}
function updateTrackingPosition(pos) {
    const latlng = [pos.coords.latitude, pos.coords.longitude];
    updateUserMarker(latlng[0], latlng[1], pos.coords.accuracy);
    currentPath.push(latlng); currentPolyline.setLatLngs(currentPath); map.setView(latlng);
}
function saveTrip(path, start, end) {
    savedTrips.push({ id: Date.now(), date: start.toISOString(), duration: (end-start), points: path });
    localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
}
function formatDuration(ms) {
    if (!ms) return "--";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)));
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes}min ${seconds}s`;
}

// HISTORIQUE
function openHistory() { renderHistoryList(); document.getElementById('history-overlay').classList.remove('hidden'); toggleMenu(); }
function closeHistory() { document.getElementById('history-overlay').classList.add('hidden'); }
function renderHistoryList() {
    const div = document.getElementById('tripList'); div.innerHTML = "";
    savedTrips.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(trip => {
        const d = new Date(trip.date);
        const infoStr = trip.duration ? `⏱️ ${formatDuration(trip.duration)}` : `📍 ${trip.points.length} points`;
        div.innerHTML += `
            <div class="trip-item" onclick="showSingleTrip(${trip.id})">
                <div style="flex-grow:1;"><span class="trip-date">${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0,5)}</span><span class="trip-info">${infoStr}</span></div>
                <div style="display:flex;align-items:center;gap:10px;"><button class="btn-delete-trip" onclick="deleteTrip(${trip.id}, event)">🗑️</button><div class="trip-action-icon">👁️</div></div>
            </div>`;
    });
}
function showSingleTrip(id) {
    clearMapLayers();
    const trip = savedTrips.find(t=>t.id===id);
    if(trip) { 
        if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
        L.polyline(trip.points, {color:'#3498db', weight:5}).addTo(tracksLayer); 
        map.fitBounds(L.polyline(trip.points).getBounds()); 
        closeHistory(); 
    }
}
function showAllTrips() {
    clearMapLayers();
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    savedTrips.forEach(t => L.polyline(t.points, {color:'#2980b9', weight:3, opacity:0.8}).addTo(tracksLayer));
    closeHistory();
}
function deleteTrip(id, e) { e.stopPropagation(); if(confirm("Supprimer ?")) { savedTrips=savedTrips.filter(t=>t.id!==id); localStorage.setItem('begole_gps_trips',JSON.stringify(savedTrips)); renderHistoryList(); clearMapLayers(); } }

function clearMapLayers() { 
    tracksLayer.clearLayers(); 
    // On remet les points SEULEMENT SI aucun mode cadastre n'est actif
    const isParcelsOn = document.getElementById('show-parcels-toggle').checked;
    const isSelectOn = document.getElementById('cadastre-mode-toggle').checked;
    
    if(!isParcelsOn && !isSelectOn && !map.hasLayer(markersLayer)) {
        map.addLayer(markersLayer);
    }
}

// WAKE LOCK
async function requestWakeLock() { try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){} }
async function releaseWakeLock() { if(wakeLock) { await wakeLock.release(); wakeLock=null; } }

// POINTS & SAUVEGARDE
function openModal() { document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }
function confirmAddPoint() {
    const emoji = document.getElementById('input-emoji').value || "📍";
    const note = document.getElementById('input-note').value;
    savedPoints.push({ lat: tempLatLng.lat, lng: tempLatLng.lng, note: note, emoji: emoji, date: new Date().toLocaleDateString() });
    saveToLocalStorage(); refreshMap(); closeModal();
}
function refreshMap() {
    markersLayer.clearLayers();
    savedPoints.forEach((p,i) => {
        if (currentFilterEmoji && p.emoji !== currentFilterEmoji) return;
        if (currentFilterText && !p.note.toLowerCase().includes(currentFilterText)) return;
        L.marker([p.lat, p.lng], { icon: L.divIcon({className:'emoji-icon', html:p.emoji, iconSize:[30,30]}) })
        .bindPopup(`<div style="text-align:center;min-width:140px;"><div style="font-size:28px;">${p.emoji}</div><b>${p.note}</b><br><a href="http://maps.google.com/maps?q=${p.lat},${p.lng}" class="popup-btn-go">Y aller</a><br><button class="btn-popup-delete" onclick="deletePoint(${i})">Supprimer</button></div>`)
        .addTo(markersLayer);
    });
}
function deletePoint(i) { savedPoints.splice(i,1); saveToLocalStorage(); refreshMap(); }

// DATA MANAGEMENT
function saveToLocalStorage() {
    localStorage.setItem('myMapPoints', JSON.stringify(savedPoints));
    localStorage.setItem('myMapParcels', JSON.stringify(savedParcels));
}
function loadFromLocalStorage() {
    savedPoints = JSON.parse(localStorage.getItem('myMapPoints')) || [];
    savedParcels = JSON.parse(localStorage.getItem('myMapParcels')) || [];
    refreshMap();
    displayParcels(); 
}
function clearData() { if(confirm("TOUT SUPPRIMER ?")) { localStorage.clear(); location.reload(); } }
function exportData() {
    // LES PARCELLES SONT BIEN INCLUSES
    const data = { points: savedPoints, trips: savedTrips, parcels: savedParcels }; 
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
    a.download = "backup_begole.json"; a.click();
}
function importData(input) {
    const fr = new FileReader();
    fr.onload = e => {
        const d = JSON.parse(e.target.result);
        if(d.points) savedPoints = d.points;
        if(d.trips) savedTrips = d.trips;
        if(d.parcels) savedParcels = d.parcels; 
        localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
        saveToLocalStorage();
        location.reload();
    };
    fr.readAsText(input.files[0]);
}

// Position Marker Logic
function toggleLocation() {
    var btn = document.getElementById('btn-loc');
    if (trackWatchId) {
         if(userMarker) map.removeLayer(userMarker); 
         if(userAccuracyCircle) map.removeLayer(userAccuracyCircle);
         navigator.geolocation.clearWatch(trackWatchId); trackWatchId=null;
         btn.innerHTML = "📍 Ma position (Simple)";
         return; 
    }
    if (!navigator.geolocation) { alert("Pas de GPS"); return; }
    btn.innerHTML = "🛑 Stop";
    trackWatchId = navigator.geolocation.watchPosition(
        (pos) => updateUserMarker(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        (err) => console.error(err), {enableHighAccuracy:true}
    );
}
var userMarker=null; var userAccuracyCircle=null;
function updateUserMarker(lat, lng, acc) {
    if(!userMarker) {
        var icon = L.divIcon({ className: 'user-location-dot', iconSize: [20, 20] });
        userMarker = L.marker([lat, lng], {icon: icon}).addTo(map);
        userAccuracyCircle = L.circle([lat, lng], {radius: acc, color: '#3498db', fillOpacity: 0.15}).addTo(map);
    } else {
        userMarker.setLatLng([lat, lng]); userAccuracyCircle.setLatLng([lat, lng]); userAccuracyCircle.setRadius(acc);
    }
}

// Filtres
function applyFilter() { currentFilterEmoji = document.getElementById('filter-input').value.trim(); refreshMap(); toggleMenu(); }
function applyTextFilter() { currentFilterText = document.getElementById('text-filter-input').value.trim().toLowerCase(); refreshMap(); toggleMenu(); }
function resetFilter() { currentFilterEmoji = null; currentFilterText = null; document.getElementById('filter-input').value = ""; document.getElementById('text-filter-input').value = ""; refreshMap(); toggleMenu(); }

// Stats
function showStats() {
    var stats = {}; savedPoints.forEach(p => { stats[p.emoji||"❓"] = (stats[p.emoji||"❓"]||0)+1; });
    var html = ""; for(var k in stats) html+=`<div class="stat-row"><span class="stat-emoji">${k}</span><span class="stat-count">${stats[k]}</span></div>`;
    document.getElementById('stats-content').innerHTML = html || "Aucun point.";
    document.getElementById('stats-overlay').classList.remove('hidden'); toggleMenu();
}
function closeStats() { document.getElementById('stats-overlay').classList.add('hidden'); }

// MODE POCHE
var lastClick=0; function togglePocketMode() { 
    const el=document.getElementById('pocket-overlay'); 
    if(el.classList.contains('hidden-poche')) { el.classList.remove('hidden-poche'); toggleMenu(); }
    else { if(Date.now()-lastClick<500) el.classList.add('hidden-poche'); lastClick=Date.now(); }
}