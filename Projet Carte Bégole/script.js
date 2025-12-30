// ============================================================
// --- CONFIGURATION & INIT ---
// ============================================================
const VILLAGE_COORDS = [43.1565, 0.3235]; 
const DEFAULT_ZOOM = 13;

// Fonds de carte
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });

var satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', {
    maxZoom: 19,
    attribution: '© IGN'
});

var cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { maxZoom: 20, attribution: '© IGN' });

var map = L.map('map', { center: VILLAGE_COORDS, zoom: DEFAULT_ZOOM, layers: [satelliteLayer] }); 

// Contrôle des calques
var baseMaps = { "Satellite IGN 🇫🇷": satelliteLayer, "Plan Route 🗺️": osmLayer };
var overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
L.control.scale({imperial: false, metric: true}).addTo(map); 

// Frontières Village (Optionnel)
fetch('village.json').then(r => r.json()).then(data => {
    L.geoJSON(data, { style: { color: '#ff3333', weight: 3, opacity: 0.8, fillOpacity: 0.05 } }).addTo(map);
}).catch(e => console.log("Pas de village.json"));


// --- VARIABLES GLOBALES ---
var savedPoints = []; 
var savedParcels = []; 
var savedTrips = JSON.parse(localStorage.getItem('begole_gps_trips')) || [];

// Groupes de calques
var markersLayer = L.layerGroup().addTo(map);
var tracksLayer = L.layerGroup().addTo(map);
var parcelsLayer = L.layerGroup(); 
var heatLayer = null; 

// Variables Tracking
var isTracking = false; var trackWatchId = null; 
var currentPath = []; var currentStartTime = null; 
var currentDistance = 0; 
var currentPolyline = null;
var timerInterval = null; 
var wakeLock = null;

// Variables Filtres & Gestion
var currentFilterEmoji = null; 
var currentFilterText = null;
var currentFilterYear = 'all'; 

var isAutoCentering = true; 
var isCadastreMode = false;
var currentParcelGeoJSON = null; 
var selectedParcelColor = '#95a5a6'; 
var tempLatLng = null; // Position temporaire pour nouveau point
var currentEditingIndex = -1;
var currentEditingTripId = null;
var userMarker = null; 
var userAccuracyCircle = null;

// Chargement initial
loadFromLocalStorage();


// ============================================================
// --- LOGIQUE HEATMAP (CARTE DE CHALEUR) ---
// ============================================================

function toggleHeatmap() {
    const isChecked = document.getElementById('heatmap-toggle').checked;

    if (isChecked) {
        let heatPoints = [];
        savedTrips.forEach(trip => {
            trip.points.forEach(pt => {
                // Leaflet heat attend [lat, lng, intensité]
                heatPoints.push([pt[0], pt[1], 0.5]); 
            });
        });

        if(heatPoints.length === 0) {
            showToast("⚠️ Pas assez de données de trajet");
            document.getElementById('heatmap-toggle').checked = false;
            return;
        }

        if(heatLayer) map.removeLayer(heatLayer);
        
        if (L.heatLayer) {
            heatLayer = L.heatLayer(heatPoints, { radius: 20, blur: 15, maxZoom: 17 }).addTo(map);
            showToast("🔥 Heatmap activée");
            toggleMenu();
        } else {
            showToast("❌ Erreur chargement librairie Heatmap");
        }

    } else {
        if(heatLayer) map.removeLayer(heatLayer);
        showToast("Heatmap désactivée");
    }
}


// ============================================================
// --- LOGIQUE CALCUL SURFACE (CADASTRE) ---
// ============================================================

// Formule Shoelace adaptée aux coord GPS (Lat/Lon) pour obtenir des m²
function getRingArea(coords) {
    if (!coords || coords.length < 3) return 0;
    
    let area = 0;
    const DEG_TO_M = 111319; // approx: 1 deg ~ 111km
    
    // On cale l'échelle de longitude sur la latitude moyenne du terrain pour limiter la distorsion
    const meanLat = coords[0][1] * Math.PI / 180;
    const lonScale = Math.cos(meanLat);

    for (let i = 0; i < coords.length; i++) {
        let p1 = coords[i];
        let p2 = coords[(i + 1) % coords.length]; // Bouclage

        // Projection locale en mètres
        let x1 = p1[0] * DEG_TO_M * lonScale;
        let y1 = p1[1] * DEG_TO_M;
        let x2 = p2[0] * DEG_TO_M * lonScale;
        let y2 = p2[1] * DEG_TO_M;

        area += (x1 * y2) - (x2 * y1);
    }
    return Math.abs(area / 2.0);
}

// Gère Polygone simple ET MultiPolygone (cas fréquent IGN)
function calculateGeoJSONArea(geometry) {
    let totalArea = 0;
    if (!geometry) return 0;

    if (geometry.type === "Polygon") {
        // coordinates[0] est l'anneau extérieur
        totalArea += getRingArea(geometry.coordinates[0]);
    } 
    else if (geometry.type === "MultiPolygon") {
        // Tableau de polygones
        geometry.coordinates.forEach(polygon => {
            totalArea += getRingArea(polygon[0]);
        });
    }
    return totalArea;
}

function showCadastreStats() {
    let totalCount = 0;
    let totalArea = 0;
    let statsByColor = {}; 

    savedParcels.forEach(p => {
        totalCount++;
        let area = calculateGeoJSONArea(p.geoJSON.geometry);
        totalArea += area;

        if (!statsByColor[p.color]) {
            statsByColor[p.color] = { count: 0, area: 0 };
        }
        statsByColor[p.color].count++;
        statsByColor[p.color].area += area;
    });

    let totalHa = (totalArea / 10000).toFixed(2);
    let totalM2 = Math.round(totalArea);

    let html = `
        <div style="text-align:center; margin-bottom:15px;">
            <span style="font-size:24px; font-weight:800; color:#2c3e50;">${totalHa} ha</span><br>
            <span style="font-size:12px; color:#7f8c8d;">(${totalM2} m²)</span><br>
            <span style="font-weight:bold; color:#e67e22;">${totalCount} parcelles</span>
        </div>
        <hr style="margin: 10px 0; border:0; border-top:1px solid #eee;">
    `;

    for (let color in statsByColor) {
        let s = statsByColor[color];
        let sHa = (s.area / 10000).toFixed(2);
        let sM2 = Math.round(s.area);
        
        html += `
            <div class="cadastre-stat-row">
                <div style="display:flex; align-items:center;">
                    <span class="color-dot" style="background:${color};"></span>
                    <span>${s.count} parcelles</span>
                </div>
                <div style="text-align:right;">
                    <strong>${sHa} ha</strong><br>
                    <small style="color:#aaa;">${sM2} m²</small>
                </div>
            </div>
        `;
    }
    if (totalCount === 0) html += "<p style='text-align:center; color:#999;'>Aucune parcelle enregistrée.</p>";

    document.getElementById('cadastre-stats-content').innerHTML = html;
    document.getElementById('modal-cadastre-stats').classList.remove('hidden');
    toggleMenu();
}

function closeCadastreStats() { document.getElementById('modal-cadastre-stats').classList.add('hidden'); }


// ============================================================
// --- GESTION SMART FOLLOW (SUIVI CARTE) ---
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
// --- GESTION DU CADASTRE (SELECTION & COLORIAGE) ---
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
// --- TRACEUR GPS & ENREGISTREMENT ---
// ============================================================

function toggleMenu() { document.getElementById('menu-items').classList.toggle('hidden-mobile'); }

async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const container = document.getElementById('recording-container');
    const dashboard = document.getElementById('dashboard');

    if (!isTracking) {
        // --- START ---
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
        // --- STOP ---
        isTracking = false; 
        document.getElementById('btn-recenter').classList.add('hidden'); 
        
        navigator.geolocation.clearWatch(trackWatchId); stopTimer(); await releaseWakeLock();
        btn.innerHTML = "▶️ Démarrer Trajet"; btn.className = "btn-start-track"; 
        container.classList.add('hidden'); dashboard.classList.add('hidden'); 

        if (currentPath.length > 0) {
            const endTime = new Date();
            // Calcul du Dénivelé
            const elevationStats = calculateElevation(currentPath);
            
            saveTrip(currentPath, currentStartTime, endTime, currentDistance, elevationStats);
            alert(`Trajet terminé !\nDistance : ${currentDistance.toFixed(2)} km\nDénivelé + : ${elevationStats.gain} m\nDurée : ${formatDuration(endTime - currentStartTime)}`);
            triggerHaptic('stop');
        }
        if (currentPolyline) map.removeLayer(currentPolyline);
    }
}

// Mise à jour position pendant le tracking (avec Altitude)
function updateTrackingPosition(pos) {
    const newLatLng = [pos.coords.latitude, pos.coords.longitude, pos.coords.altitude || 0];
    
    if (currentPath.length > 0) {
        currentDistance += (map.distance([currentPath[currentPath.length - 1][0], currentPath[currentPath.length - 1][1]], [newLatLng[0], newLatLng[1]]) / 1000);
    }
    updateDashboard(pos.coords.altitude, pos.coords.speed, currentDistance);
    
    if (isAutoCentering) {
        map.setView([newLatLng[0], newLatLng[1]]);
    }
    updateUserMarker(newLatLng[0], newLatLng[1], pos.coords.accuracy, pos.coords.heading);
    currentPath.push(newLatLng); 
    currentPolyline.setLatLngs(currentPath); 
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

// Algorithme de calcul du Dénivelé (Filtre anti-bruit 5m)
function calculateElevation(points) {
    let gain = 0;
    let loss = 0;
    if (!points || points.length < 2) return { gain: 0, loss: 0 };

    let lastAlt = points[0][2]; // 3ème coordonnée = altitude

    for (let i = 1; i < points.length; i++) {
        let currAlt = points[i][2];
        if (currAlt !== undefined && currAlt !== null && lastAlt !== undefined && lastAlt !== null) {
            let diff = currAlt - lastAlt;
            
            if (Math.abs(diff) > 5) {
                if (diff > 0) gain += diff;
                else loss += Math.abs(diff);
                lastAlt = currAlt;
            }
        }
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

function saveTrip(path, start, end, distKm, elevationStats) {
    const dur = end - start;
    const avgSpeed = (dur > 0 && distKm > 0) ? distKm / (dur / 3600000) : 0;
    
    savedTrips.push({ 
        id: Date.now(), 
        date: start.toISOString(), 
        duration: dur, 
        distance: distKm, 
        avgSpeed: avgSpeed, 
        points: path, 
        note: "",
        elevationGain: elevationStats ? elevationStats.gain : 0, 
        elevationLoss: elevationStats ? elevationStats.loss : 0 
    });
    localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
}


// ============================================================
// --- HISTORIQUE TRAJETS & AFFICHAGE ---
// ============================================================

function openHistory() { renderHistoryList(); document.getElementById('history-overlay').classList.remove('hidden'); toggleMenu(); }
function closeHistory() { document.getElementById('history-overlay').classList.add('hidden'); }

function renderHistoryList() {
    const div = document.getElementById('tripList'); div.innerHTML = "";
    const filterDist = document.getElementById('filter-trip-class').value;

    savedTrips.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(trip => {
        const dKm = trip.distance;
        let isVisible = true;
        if(filterDist === 'blue' && dKm >= 2) isVisible = false;
        if(filterDist === 'green' && (dKm < 2 || dKm >= 5)) isVisible = false;
        if(filterDist === 'orange' && (dKm < 5 || dKm >= 10)) isVisible = false;
        if(filterDist === 'red' && dKm < 10) isVisible = false;

        if(isVisible) {
            const d = new Date(trip.date);
            const distStr = trip.distance ? `${trip.distance.toFixed(2)} km` : "";
            const durStr = trip.duration ? formatDuration(trip.duration) : "";
            const elevStr = trip.elevationGain ? `🏔️ +${trip.elevationGain}m` : ""; 
            const noteDisplay = trip.note ? `<br><small style="color:#e67e22;">📝 ${trip.note}</small>` : "";

            let dotColor = '#e74c3c';
            if (dKm < 2) dotColor = '#3498db';
            else if (dKm < 5) dotColor = '#2ecc71';
            else if (dKm < 10) dotColor = '#f39c12';

            div.innerHTML += `
                <div class="trip-item">
                    <div style="flex-grow:1; cursor:pointer;" onclick="showSingleTrip(${trip.id})">
                        <span class="trip-date" style="border-left: 4px solid ${dotColor}; padding-left:5px;">
                            ${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0,5)}
                        </span>
                        <span class="trip-info">📏 ${distStr} ⏱️ ${durStr} ${elevStr}</span>
                        ${noteDisplay}
                    </div>
                    <div style="display:flex;align-items:center;gap:5px;">
                        <button class="btn-delete-trip" style="background:#8e44ad;" onclick="openEditTripModal(${trip.id})">✏️</button>
                        <button class="btn-delete-trip" onclick="deleteTrip(${trip.id})">🗑️</button>
                    </div>
                </div>`;
        }
    });
    
    if(div.innerHTML === "") div.innerHTML = "<div style='text-align:center;padding:20px;color:#999;'>Aucun trajet trouvé pour ce filtre.</div>";
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
        if(heatLayer) map.removeLayer(heatLayer); 
        L.polyline(trip.points, {color:'#3498db', weight:5}).addTo(tracksLayer); 
        map.fitBounds(L.polyline(trip.points).getBounds()); 
        closeHistory(); 
    }
}

function showAllTrips() {
    clearMapLayers();
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    if(heatLayer) map.removeLayer(heatLayer);
    
    savedTrips.forEach(t => {
        let color = '#e74c3c'; 
        if (t.distance < 2) color = '#3498db'; 
        else if (t.distance < 5) color = '#2ecc71'; 
        else if (t.distance < 10) color = '#f39c12'; 

        L.polyline(t.points, {color: color, weight: 3, opacity: 0.8})
         .bindPopup(`<b>Note:</b> ${t.note || "Aucune"}<br>Dist: ${t.distance.toFixed(2)} km<br>D+: ${t.elevationGain||0}m`)
         .addTo(tracksLayer);
    });
    closeHistory();
    showToast("🌈 Trajets colorés par distance !");
}

function deleteTrip(id) { 
    if(confirm("Supprimer ce trajet ?")) { 
        savedTrips=savedTrips.filter(t=>t.id!==id); 
        localStorage.setItem('begole_gps_trips',JSON.stringify(savedTrips)); 
        renderHistoryList(); clearMapLayers(); 
        triggerHaptic('warning');
    } 
}

function openEditTripModal(id) {
    const trip = savedTrips.find(t => t.id === id);
    if (trip) {
        currentEditingTripId = id;
        document.getElementById('edit-trip-note').value = trip.note || "";
        document.getElementById('modal-edit-trip').classList.remove('hidden');
    }
}

function closeEditTripModal() {
    document.getElementById('modal-edit-trip').classList.add('hidden');
    currentEditingTripId = null;
}

function confirmSaveTripNote() {
    if (currentEditingTripId) {
        const note = document.getElementById('edit-trip-note').value;
        const tripIndex = savedTrips.findIndex(t => t.id === currentEditingTripId);
        if (tripIndex > -1) {
            savedTrips[tripIndex].note = note;
            localStorage.setItem('begole_gps_trips', JSON.stringify(savedTrips));
            renderHistoryList();
            closeEditTripModal();
            showToast("Note enregistrée ! 📝");
            triggerHaptic('success');
        }
    }
}

function clearMapLayers() { 
    tracksLayer.clearLayers(); 
    if(heatLayer) map.removeLayer(heatLayer); 
    const isParcelsOn = document.getElementById('show-parcels-toggle').checked;
    const isSelectOn = document.getElementById('cadastre-mode-toggle').checked;
    if(!isParcelsOn && !isSelectOn && !map.hasLayer(markersLayer)) map.addLayer(markersLayer);
}


// ============================================================
// --- GESTION POINTS, NOTES & FILTRES ---
// ============================================================

function openModal() { document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

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
    
    updateYearFilterOptions();
    saveToLocalStorage(); refreshMap(); closeModal();
    showToast("📍 Point ajouté !");
    triggerHaptic('success');
}

function updateYearFilterOptions() {
    const select = document.getElementById('filter-year');
    const years = new Set();
    savedPoints.forEach(p => {
        if(p.date) {
            const parts = p.date.split('/');
            if(parts.length === 3) {
                const cleanYear = parts[2].substring(0, 4);
                if(cleanYear.length === 4) years.add(cleanYear);
            }
        }
    });
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Toutes les années</option>';
    const sortedYears = Array.from(years).sort().reverse();
    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year; option.textContent = year;
        select.appendChild(option);
    });
    if (sortedYears.includes(currentVal) || currentVal === 'all') select.value = currentVal;
    else select.value = 'all'; 
}

function applyYearFilter() {
    currentFilterYear = document.getElementById('filter-year').value;
    refreshMap(); toggleMenu();
}

function refreshMap() {
    markersLayer.clearLayers();
    savedPoints.forEach((p,i) => {
        if (currentFilterEmoji && p.emoji !== currentFilterEmoji) return;
        if (currentFilterText && !p.note.toLowerCase().includes(currentFilterText)) return;
        if (currentFilterYear !== 'all') {
            const pointYear = p.date.split('/')[2].substring(0,4);
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
        div.innerHTML = `<div style="flex:1;"><span>${entry.date} :</span> ${entry.text}</div><button class="btn-history-delete-row" onclick="deleteHistoryEntry(${i})">🗑️</button>`;
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
        const now = new Date();
        const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString().slice(0,5);
        savedPoints[currentEditingIndex].history.push({ date: dateStr, text: text });
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
        saveToLocalStorage(); refreshMap(); 
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("✅ Point mis à jour");
    }
}

function deleteCurrentPoint() {
    if (currentEditingIndex > -1) { deletePoint(currentEditingIndex); document.getElementById('modal-edit-point').classList.add('hidden'); }
}

function deletePoint(i) { 
    savedPoints.splice(i,1); saveToLocalStorage(); refreshMap(); 
    showToast("Point supprimé");
    triggerHaptic('warning');
    updateYearFilterOptions(); 
}

// --- UTILITAIRES DIVERS ---

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

function saveToLocalStorage() { localStorage.setItem('myMapPoints', JSON.stringify(savedPoints)); localStorage.setItem('myMapParcels', JSON.stringify(savedParcels)); }
function loadFromLocalStorage() { 
    savedPoints = JSON.parse(localStorage.getItem('myMapPoints')) || []; 
    savedParcels = JSON.parse(localStorage.getItem('myMapParcels')) || []; 
    updateYearFilterOptions(); refreshMap(); displayParcels(); 
}

function clearData() { if(confirm("TOUT SUPPRIMER ? (Irréversible)")) { localStorage.clear(); location.reload(); triggerHaptic('error'); } }

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
            if(arrowEl) { arrowEl.style.transform = `rotate(${heading}deg)`; }
        }
    }
}

function applyFilter() { currentFilterEmoji = document.getElementById('filter-input').value.trim(); refreshMap(); toggleMenu(); }
function applyTextFilter() { currentFilterText = document.getElementById('text-filter-input').value.trim().toLowerCase(); refreshMap(); toggleMenu(); }
function resetFilter() { 
    currentFilterEmoji = null; currentFilterText = null; currentFilterYear = 'all';
    document.getElementById('filter-input').value = ""; document.getElementById('text-filter-input').value = ""; document.getElementById('filter-year').value = "all";
    refreshMap(); toggleMenu(); 
}

// ============================================================
// --- STATS GLOBALES (4 BLOCS) ---
// ============================================================
function showStats() {
    const totalTrips = savedTrips.length;
    let totalDist = 0;
    let totalDuration = 0;
    let totalElevationGain = 0;

    savedTrips.forEach(t => {
        totalDist += (t.distance || 0);
        totalDuration += (t.duration || 0);
        totalElevationGain += (t.elevationGain || 0);
    });

    let globalAvgSpeed = 0;
    if (totalDuration > 0) {
        const hours = totalDuration / 3600000;
        globalAvgSpeed = totalDist / hours;
    }
    
    let avgElevation = totalTrips > 0 ? (totalElevationGain / totalTrips) : 0;

    let html = `
        <div class="stats-summary">
            <div class="stat-card">
                <span class="stat-value">${totalTrips}</span>
                <span class="stat-label">Trajets</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${totalDist.toFixed(1)}</span>
                <span class="stat-label">Km Tot.</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${globalAvgSpeed.toFixed(1)}</span>
                <span class="stat-label">Km/h</span>
            </div>
            <div class="stat-card">
                <span class="stat-value">${avgElevation.toFixed(0)}m</span>
                <span class="stat-label">D+ Moy.</span>
            </div>
        </div>
        <hr style="margin: 15px 0; border: 0; border-top: 1px solid #eee;">
        <h4>📍 Points par catégorie (Ordre croissant) :</h4>
    `;

    var stats = {};
    savedPoints.forEach(p => { stats[p.emoji||"❓"] = (stats[p.emoji||"❓"]||0)+1; });
    
    var sortedStats = Object.keys(stats).map(key => {
        return { emoji: key, count: stats[key] };
    });

    sortedStats.sort((a, b) => b.count - a.count);
    
    if(sortedStats.length === 0) {
        html += "<p style='color:#999;font-size:12px;'>Aucun point enregistré.</p>";
    } else {
        sortedStats.forEach(item => {
            html += `<div class="stat-row"><span class="stat-emoji">${item.emoji}</span><span class="stat-count">${item.count}</span></div>`;
        });
    }

    document.getElementById('stats-content').innerHTML = html;
    document.getElementById('stats-overlay').classList.remove('hidden');
    toggleMenu();
}

function closeStats() { document.getElementById('stats-overlay').classList.add('hidden'); }
async function requestWakeLock() { try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){} }
async function releaseWakeLock() { if(wakeLock) { await wakeLock.release(); wakeLock=null; } }

var lastClick=0; function togglePocketMode() { 
    const el=document.getElementById('pocket-overlay'); 
    if(el.classList.contains('hidden-poche')) { el.classList.remove('hidden-poche'); toggleMenu(); }
    else { if(Date.now()-lastClick<500) el.classList.add('hidden-poche'); lastClick=Date.now(); }
}