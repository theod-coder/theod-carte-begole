// --- CONFIGURATION ---
const VILLAGE_COORDS = [43.1565, 0.3235]; 
const DEFAULT_ZOOM = 13;

// --- 1. INITIALISATION DES FONDS DE CARTE ---
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });

var satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', {
    maxZoom: 19,
    attribution: '© IGN'
});

var cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { maxZoom: 20, attribution: '© IGN' });

var map = L.map('map', { center: VILLAGE_COORDS, zoom: DEFAULT_ZOOM, layers: [satelliteLayer] }); 

// Gestion des calques
var baseMaps = { "Satellite IGN 🇫🇷": satelliteLayer, "Plan Route 🗺️": osmLayer };
var overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
L.control.scale({imperial: false, metric: true}).addTo(map); 

// FRONTIÈRES BÉGOLE
fetch('village.json').then(r => r.json()).then(data => {
    L.geoJSON(data, { style: { color: '#ff3333', weight: 3, opacity: 0.8, fillOpacity: 0.05 } }).addTo(map);
}).catch(e => console.log("Pas de village.json"));


// --- VARIABLES GLOBALES ---
var savedPoints = []; 
var savedParcels = []; 
var markersLayer = L.layerGroup().addTo(map);
var tracksLayer = L.layerGroup().addTo(map);
var parcelsLayer = L.layerGroup(); 

var isTracking = false; var trackWatchId = null; 
var currentPath = []; var currentStartTime = null; 
var currentDistance = 0; 
var timerInterval = null; 
var savedTrips = JSON.parse(localStorage.getItem('begole_gps_trips')) || [];
var wakeLock = null;

// Variables Filtres
var currentFilterEmoji = null; 
var currentFilterText = null;
var currentFilterYear = 'all'; // Par défaut : toutes les années

// Variables Gestion
var isAutoCentering = true; 
var isCadastreMode = false;
var currentParcelGeoJSON = null; 
var selectedParcelColor = '#95a5a6'; 
var tempLatLng = null;
var currentEditingIndex = -1;

loadFromLocalStorage();

// ============================================================
// --- LOGIQUE SMART FOLLOW (SUIVI INTELLIGENT) ---
// ============================================================

map.on('dragstart', function() {
    if (isTracking && isAutoCentering) {
        isAutoCentering = false; 
        document.getElementById('btn-recenter').classList.remove('hidden'); 
    }
});

function enableAutoCenter() {
    isAutoCentering = true;
    document.getElementById('btn-recenter').classList.add('hidden');
    if (userMarker) {
        map.setView(userMarker.getLatLng());
    }
}


// ============================================================
// --- UTILITAIRES : TOASTS & HAPTIQUE ---
// ============================================================

function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { toast.remove(); }, 300);
    }, duration);
}

function triggerHaptic(type) {
    if (!navigator.vibrate) return;
    switch (type) {
        case 'success': navigator.vibrate(50); break; 
        case 'warning': navigator.vibrate([50, 50, 50]); break; 
        case 'error': navigator.vibrate([100, 50, 100, 50, 100]); break; 
        case 'start': navigator.vibrate(200); break; 
        case 'stop': navigator.vibrate([200, 100, 200]); break; 
        default: navigator.vibrate(50);
    }
}


// ============================================================
// --- GESTION DU CADASTRE ---
// ============================================================

function toggleCadastreMode() {
    isCadastreMode = document.getElementById('cadastre-mode-toggle').checked;
    const isParcelsOn = document.getElementById('show-parcels-toggle').checked;
    
    toggleOpacitySlider(isCadastreMode || isParcelsOn);

    if(isCadastreMode) {
        if(!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
        if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
        showToast("🏠 Mode Sélection Activé"); 
        triggerHaptic('success');
    } else {
        if(!isParcelsOn && map.hasLayer(cadastreLayer)) map.removeLayer(cadastreLayer);
        if(!isParcelsOn && !map.hasLayer(markersLayer)) map.addLayer(markersLayer);
    }
}

function toggleSavedParcels() {
    const isChecked = document.getElementById('show-parcels-toggle').checked;
    toggleOpacitySlider(isChecked || isCadastreMode);

    if (isChecked) {
        if (!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer);
        if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
    } else {
        if (map.hasLayer(parcelsLayer)) map.removeLayer(parcelsLayer);
        if (!isCadastreMode && map.hasLayer(cadastreLayer)) map.removeLayer(cadastreLayer);
        if (!isCadastreMode && !map.hasLayer(markersLayer)) map.addLayer(markersLayer);
    }
}

function toggleOpacitySlider(show) {
    const slider = document.getElementById('cadastre-opacity-container');
    if(show) slider.classList.remove('hidden'); else slider.classList.add('hidden');
}
function updateCadastreOpacity(val) { cadastreLayer.setOpacity(val); }

map.on('click', function(e) {
    if (isCadastreMode) { fetchParcelAt(e.latlng); } 
    else { tempLatLng = e.latlng; openModal(); }
});

function fetchParcelAt(latlng) {
    const lat = latlng.lat; const lng = latlng.lng;
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${lng},${lat}]}`;
    document.body.style.cursor = 'wait';

    fetch(url).then(r => r.ok ? r.json() : null).then(data => {
        document.body.style.cursor = 'default';
        if (data && data.features && data.features.length > 0) {
            openParcelModal(data.features[0]);
            triggerHaptic('success');
        } else {
            showToast("⚠️ Aucune parcelle trouvée ici");
            triggerHaptic('warning');
        }
    }).catch(e => { 
        document.body.style.cursor = 'default'; 
        showToast("❌ Erreur connexion IGN"); 
    });
}

function openParcelModal(parcelGeoJSON) {
    currentParcelGeoJSON = parcelGeoJSON;
    document.getElementById('parcel-ref').textContent = "Ref: " + (parcelGeoJSON.properties.section + " " + parcelGeoJSON.properties.numero);
    document.getElementById('parcel-note').value = "";
    document.getElementById('modal-parcel').classList.remove('hidden');
    toggleMenu(); 
}
function closeParcelModal() { document.getElementById('modal-parcel').classList.add('hidden'); currentParcelGeoJSON = null; }
function selectColor(color, element) { selectedParcelColor = color; document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected')); element.classList.add('selected'); }

function confirmSaveParcel() {
    if (!currentParcelGeoJSON) return;
    const note = document.getElementById('parcel-note').value;
    savedParcels.push({ id: Date.now(), geoJSON: currentParcelGeoJSON, color: selectedParcelColor, note: note });
    saveToLocalStorage(); displayParcels(); 
    if (!document.getElementById('show-parcels-toggle').checked) {
        document.getElementById('show-parcels-toggle').checked = true;
        toggleSavedParcels(); 
    }
    closeParcelModal();
    showToast("🏠 Parcelle coloriée !");
    triggerHaptic('success');
}

function displayParcels() {
    parcelsLayer.clearLayers(); 
    savedParcels.forEach(p => {
        L.geoJSON(p.geoJSON, {
            style: { color: '#333', weight: 1, fillColor: p.color, fillOpacity: 0.6 },
            onEachFeature: function(f, l) {
                l.bindPopup(`<div style="text-align:center;"><b>${p.note || "Sans nom"}</b><br><small>Ref: ${f.properties.section} ${f.properties.numero}</small><br><button onclick="deleteParcel(${p.id})" style="background:#e74c3c; color:white; border:none; border-radius:4px; margin-top:5px; padding:4px 8px;">Supprimer</button></div>`);
            }
        }).addTo(parcelsLayer);
    });
}
function deleteParcel(id) {
    if(confirm("Supprimer ce coloriage ?")) {
        savedParcels = savedParcels.filter(p => p.id !== id);
        saveToLocalStorage(); displayParcels();
        triggerHaptic('warning');
    }
}
function clearParcels() {
    if(confirm("Tout effacer les parcelles ?")) {
        savedParcels = []; saveToLocalStorage(); displayParcels(); toggleMenu();
        showToast("🗑️ Parcelles effacées");
        triggerHaptic('warning');
    }
}


// ============================================================
// --- TRACEUR GPS & DASHBOARD ---
// ============================================================

function toggleMenu() { document.getElementById('menu-items').classList.toggle('hidden-mobile'); }

async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const container = document.getElementById('recording-container');
    const dashboard = document.getElementById('dashboard');

    if (!isTracking) {
        // START
        isTracking = true; 
        isAutoCentering = true; 
        document.getElementById('btn-recenter').classList.add('hidden'); 
        
        currentPath = []; currentDistance = 0; currentStartTime = new Date();
        btn.innerHTML = "⏹️ Arrêter REC"; btn.className = "btn-stop-track"; 
        container.classList.remove('hidden'); dashboard.classList.remove('hidden'); 
        startTimer(); await requestWakeLock();
        currentPolyline = L.polyline([], {color: 'red', weight: 5}).addTo(map);
        if (navigator.geolocation) trackWatchId = navigator.geolocation.watchPosition(updateTrackingPosition, null, {enableHighAccuracy:true});
        toggleMenu();
        showToast("🚀 Enregistrement démarré !");
        triggerHaptic('start');
    } else {
        // STOP
        isTracking = false; 
        document.getElementById('btn-recenter').classList.add('hidden'); 
        
        navigator.geolocation.clearWatch(trackWatchId); stopTimer(); await releaseWakeLock();
        btn.innerHTML = "▶️ Démarrer Trajet"; btn.className = "btn-start-track"; 
        container.classList.add('hidden'); dashboard.classList.add('hidden'); 

        if (currentPath.length > 0) {
            const endTime = new Date();
            saveTrip(currentPath, currentStartTime, endTime, currentDistance);
            alert(`Trajet terminé !\nDistance : ${currentDistance.toFixed(2)} km\nDurée : ${formatDuration(endTime - currentStartTime)}`);
            triggerHaptic('stop');
        }
        if (currentPolyline) map.removeLayer(currentPolyline);
    }
}

function updateTrackingPosition(pos) {
    const newLatLng = [pos.coords.latitude, pos.coords.longitude];
    if (currentPath.length > 0) currentDistance += (map.distance(currentPath[currentPath.length - 1], newLatLng) / 1000);
    updateDashboard(pos.coords.altitude, pos.coords.speed, currentDistance);
    
    if (isAutoCentering) {
        map.setView(newLatLng);
    }
    updateUserMarker(newLatLng[0], newLatLng[1], pos.coords.accuracy, pos.coords.heading);
    currentPath.push(newLatLng); currentPolyline.setLatLngs(currentPath); 
}

function updateDashboard(alt, speedMs, distKm) {
    document.getElementById('dash-alt').innerText = alt ? Math.round(alt) : "--";
    document.getElementById('dash-speed').innerText = speedMs ? Math.round(speedMs * 3.6) : 0;
    document.getElementById('dash-dist').innerText = distKm.toFixed(2);
}

function startTimer() {
    const timerEl = document.getElementById('recording-timer');
    timerInterval = setInterval(() => {
        timerEl.innerText = formatDuration(new Date() - currentStartTime);
    }, 1000);
}
function stopTimer() { clearInterval(timerInterval); document.getElementById('recording-timer').innerText = "00:00"; }

function saveTrip(path, start, end, distKm) {
    const dur = end - start;
    const avgSpeed = (dur > 0 && distKm > 0) ? distKm / (dur / 3600000) : 0;
    savedTrips.push({ id: Date.now(), date: start.toISOString(), duration: dur, distance: distKm, avgSpeed: avgSpeed, points: path });
    localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
}

// --- HISTORIQUE TRAJETS ---
function openHistory() { renderHistoryList(); document.getElementById('history-overlay').classList.remove('hidden'); toggleMenu(); }
function closeHistory() { document.getElementById('history-overlay').classList.add('hidden'); }

function renderHistoryList() {
    const div = document.getElementById('tripList'); div.innerHTML = "";
    savedTrips.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(trip => {
        const d = new Date(trip.date);
        const distStr = trip.distance ? `${trip.distance.toFixed(2)} km` : "";
        const speedStr = trip.avgSpeed ? `${trip.avgSpeed.toFixed(1)} km/h` : "";
        
        div.innerHTML += `
            <div class="trip-item" onclick="showSingleTrip(${trip.id})">
                <div style="flex-grow:1;">
                    <span class="trip-date">${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0,5)}</span>
                    <span class="trip-info">📏 ${distStr} ⏱️ ${formatDuration(trip.duration)} 🚀 ${speedStr}</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;"><button class="btn-delete-trip" onclick="deleteTrip(${trip.id}, event)">🗑️</button><div class="trip-action-icon">👁️</div></div>
            </div>`;
    });
}

function formatDuration(ms) {
    if (!ms) return "00:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${pad(m)}:${pad(sec)}`;
}
function pad(n) { return n < 10 ? '0'+n : n; }

function showSingleTrip(id) {
    clearMapLayers(); const trip = savedTrips.find(t=>t.id===id);
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
function deleteTrip(id, e) { 
    e.stopPropagation(); 
    if(confirm("Supprimer ce trajet ?")) { 
        savedTrips=savedTrips.filter(t=>t.id!==id); 
        localStorage.setItem('begole_gps_trips',JSON.stringify(savedTrips)); 
        renderHistoryList(); clearMapLayers(); 
        triggerHaptic('warning');
    } 
}
function clearMapLayers() { 
    tracksLayer.clearLayers(); 
    const isParcelsOn = document.getElementById('show-parcels-toggle').checked;
    const isSelectOn = document.getElementById('cadastre-mode-toggle').checked;
    if(!isParcelsOn && !isSelectOn && !map.hasLayer(markersLayer)) map.addLayer(markersLayer);
}

// --- FONCTIONS GENERALES ---
async function requestWakeLock() { try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){} }
async function releaseWakeLock() { if(wakeLock) { await wakeLock.release(); wakeLock=null; } }

function openModal() { document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

// CREATION NOUVEAU POINT
function confirmAddPoint() {
    const emoji = document.getElementById('input-emoji').value || "📍";
    const note = document.getElementById('input-note').value;
    
    savedPoints.push({ 
        lat: tempLatLng.lat, 
        lng: tempLatLng.lng, 
        note: note, 
        emoji: emoji, 
        date: new Date().toLocaleDateString(),
        history: [] 
    });
    
    // Mise à jour de la liste des années au cas où
    updateYearFilterOptions();
    
    saveToLocalStorage(); refreshMap(); closeModal();
    showToast("📍 Point ajouté !");
    triggerHaptic('success');
}

// ============================================================
// --- GESTION EDITION & FILTRES ---
// ============================================================

function updateYearFilterOptions() {
    const select = document.getElementById('filter-year');
    
    // On extrait toutes les années des points
    const years = new Set();
    savedPoints.forEach(p => {
        if(p.date) {
            // p.date format: "DD/MM/YYYY" -> split('/')[2] = YYYY
            const parts = p.date.split('/');
            if(parts.length === 3) years.add(parts[2]);
        }
    });
    
    // On garde la valeur sélectionnée actuelle
    const currentVal = select.value;
    
    // On vide sauf "all"
    select.innerHTML = '<option value="all">Toutes les années</option>';
    
    // On trie du plus récent au plus vieux
    const sortedYears = Array.from(years).sort().reverse();
    
    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        select.appendChild(option);
    });
    
    // On remet la sélection si elle existe encore
    if (sortedYears.includes(currentVal) || currentVal === 'all') {
        select.value = currentVal;
    } else {
        select.value = 'all'; // Reset si l'année a disparu (ex: supression point)
    }
}

function applyYearFilter() {
    currentFilterYear = document.getElementById('filter-year').value;
    refreshMap();
    toggleMenu();
}

function refreshMap() {
    markersLayer.clearLayers();
    savedPoints.forEach((p,i) => {
        // FILTRES
        if (currentFilterEmoji && p.emoji !== currentFilterEmoji) return;
        if (currentFilterText && !p.note.toLowerCase().includes(currentFilterText)) return;
        
        // FILTRE ANNEE
        if (currentFilterYear !== 'all') {
            const pointYear = p.date.split('/')[2];
            if (pointYear !== currentFilterYear) return;
        }
        
        if (!p.history) p.history = [];

        L.marker([p.lat, p.lng], { icon: L.divIcon({className:'emoji-icon', html:p.emoji, iconSize:[30,30]}) })
        .bindPopup(`
            <div style="text-align:center;min-width:140px;">
                <div style="font-size:28px;">${p.emoji}</div>
                <b>${p.note}</b><br>
                <div style="font-size:10px;color:#666;margin:3px;">${p.history.length} entrées carnet</div>
                <a href="http://maps.google.com/maps?q=${p.lat},${p.lng}" class="popup-btn-go">Y aller</a>
                <button class="btn-popup-edit" onclick="openEditModal(${i})">📝 Carnet & Modif</button>
            </div>
        `).addTo(markersLayer);
    });
}

function openEditModal(index) {
    currentEditingIndex = index;
    const p = savedPoints[index];
    
    document.getElementById('edit-emoji').value = p.emoji;
    document.getElementById('edit-note').value = p.note;
    document.getElementById('new-history-entry').value = ""; 
    
    renderPointHistory(p.history);
    
    document.getElementById('modal-edit-point').classList.remove('hidden');
    map.closePopup(); 
}

function renderPointHistory(history) {
    const container = document.getElementById('history-list-container');
    container.innerHTML = "";
    
    if (!history || history.length === 0) {
        container.innerHTML = "<div style='text-align:center;color:#999;padding:10px;'>Carnet vide.</div>";
        return;
    }

    for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i];
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div style="flex:1;"><span>${entry.date} :</span> ${entry.text}</div>
            <button class="btn-history-delete-row" onclick="deleteHistoryEntry(${i})">🗑️</button>
        `;
        container.appendChild(div);
    }
}

function deleteHistoryEntry(historyIndex) {
    if(confirm("Effacer cette ligne du carnet ?")) {
        savedPoints[currentEditingIndex].history.splice(historyIndex, 1);
        saveToLocalStorage();
        renderPointHistory(savedPoints[currentEditingIndex].history);
        triggerHaptic('warning');
    }
}

function addHistoryToCurrentPoint() {
    const text = document.getElementById('new-history-entry').value.trim();
    if (!text) return;
    
    if (currentEditingIndex > -1) {
        const today = new Date().toLocaleDateString();
        savedPoints[currentEditingIndex].history.push({
            date: today,
            text: text
        });
        
        saveToLocalStorage();
        renderPointHistory(savedPoints[currentEditingIndex].history);
        document.getElementById('new-history-entry').value = ""; 
        triggerHaptic('success');
    }
}

function savePointEdits() {
    if (currentEditingIndex > -1) {
        savedPoints[currentEditingIndex].emoji = document.getElementById('edit-emoji').value;
        savedPoints[currentEditingIndex].note = document.getElementById('edit-note').value;
        
        saveToLocalStorage();
        refreshMap(); 
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("✅ Point mis à jour");
    }
}

function deleteCurrentPoint() {
    if (currentEditingIndex > -1) {
        deletePoint(currentEditingIndex); 
        document.getElementById('modal-edit-point').classList.add('hidden');
    }
}

function deletePoint(i) { 
    savedPoints.splice(i,1); saveToLocalStorage(); refreshMap(); 
    showToast("Point supprimé");
    triggerHaptic('warning');
    updateYearFilterOptions(); // Mise à jour filtres
}

function saveToLocalStorage() { localStorage.setItem('myMapPoints', JSON.stringify(savedPoints)); localStorage.setItem('myMapParcels', JSON.stringify(savedParcels)); }

function loadFromLocalStorage() { 
    savedPoints = JSON.parse(localStorage.getItem('myMapPoints')) || []; 
    savedParcels = JSON.parse(localStorage.getItem('myMapParcels')) || []; 
    
    updateYearFilterOptions(); // Initialisation des années
    refreshMap(); 
    displayParcels(); 
}

function clearData() { 
    if(confirm("TOUT SUPPRIMER ? (Irréversible)")) { 
        localStorage.clear(); location.reload(); 
        triggerHaptic('error');
    } 
}

function exportData() {
    const data = { points: savedPoints, trips: savedTrips, parcels: savedParcels };
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
    
    const now = new Date();
    const dateStr = now.toISOString().slice(0,10); 
    const timeStr = now.getHours() + "h" + now.getMinutes(); 
    a.download = `Begole_Backup_${dateStr}_${timeStr}.json`;
    
    a.click();
    showToast("💾 Sauvegarde téléchargée !");
    triggerHaptic('success');
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

function toggleLocation() {
    var btn = document.getElementById('btn-loc');
    if (trackWatchId) {
         if(userMarker) map.removeLayer(userMarker); 
         if(userAccuracyCircle) map.removeLayer(userAccuracyCircle);
         navigator.geolocation.clearWatch(trackWatchId); trackWatchId=null;
         btn.innerHTML = "📍 Ma position (Simple)";
         return; 
    }
    if (!navigator.geolocation) { showToast("⚠️ Pas de GPS"); return; }
    btn.innerHTML = "🛑 Stop";
    trackWatchId = navigator.geolocation.watchPosition(
        (pos) => updateUserMarker(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading),
        (err) => console.error(err), {enableHighAccuracy:true}
    );
}

var userMarker=null; var userAccuracyCircle=null;
function updateUserMarker(lat, lng, acc, heading) {
    if(!userMarker) {
        var icon = L.divIcon({ 
            className: 'custom-container', 
            html: '<div class="user-location-arrow">⬆️</div>', 
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        userMarker = L.marker([lat, lng], {icon: icon}).addTo(map);
        userAccuracyCircle = L.circle([lat, lng], {radius: acc, color: '#3498db', fillOpacity: 0.15}).addTo(map);
    } else {
        userMarker.setLatLng([lat, lng]);
        userAccuracyCircle.setLatLng([lat, lng]);
        userAccuracyCircle.setRadius(acc);
        
        if (heading !== null && !isNaN(heading)) {
            var arrowEl = userMarker.getElement().querySelector('.user-location-arrow');
            if(arrowEl) {
                arrowEl.style.transform = `rotate(${heading}deg)`;
            }
        }
    }
}

function applyFilter() { currentFilterEmoji = document.getElementById('filter-input').value.trim(); refreshMap(); toggleMenu(); }
function applyTextFilter() { currentFilterText = document.getElementById('text-filter-input').value.trim().toLowerCase(); refreshMap(); toggleMenu(); }
function resetFilter() { 
    currentFilterEmoji = null; 
    currentFilterText = null; 
    currentFilterYear = 'all';
    
    document.getElementById('filter-input').value = ""; 
    document.getElementById('text-filter-input').value = ""; 
    document.getElementById('filter-year').value = "all";
    
    refreshMap(); toggleMenu(); 
}

function showStats() {
    var stats = {}; savedPoints.forEach(p => { stats[p.emoji||"❓"] = (stats[p.emoji||"❓"]||0)+1; });
    var html = ""; for(var k in stats) html+=`<div class="stat-row"><span class="stat-emoji">${k}</span><span class="stat-count">${stats[k]}</span></div>`;
    document.getElementById('stats-content').innerHTML = html || "Aucun point.";
    document.getElementById('stats-overlay').classList.remove('hidden'); toggleMenu();
}
function closeStats() { document.getElementById('stats-overlay').classList.add('hidden'); }

var lastClick=0; function togglePocketMode() { 
    const el=document.getElementById('pocket-overlay'); 
    if(el.classList.contains('hidden-poche')) { el.classList.remove('hidden-poche'); toggleMenu(); }
    else { if(Date.now()-lastClick<500) el.classList.add('hidden-poche'); lastClick=Date.now(); }
}