// ============================================================
// --- 1. CONFIGURATION & INITIALISATION CARTE ---
// ============================================================
const VILLAGE_COORDS = [43.1565, 0.3235]; 
const DEFAULT_ZOOM = 13;

// --- Fonds de carte ---
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });

var satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', {
    maxZoom: 19,
    attribution: '© IGN'
});

var cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { maxZoom: 20, attribution: '© IGN' });

// --- Création de la Carte ---
var map = L.map('map', { center: VILLAGE_COORDS, zoom: DEFAULT_ZOOM, layers: [satelliteLayer] }); 

// --- Contrôle des Calques ---
var baseMaps = { "Satellite IGN 🇫🇷": satelliteLayer, "Plan Route 🗺️": osmLayer };
var overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
L.control.scale({imperial: false, metric: true}).addTo(map); 

// --- Frontières Village ---
fetch('village.json').then(r => r.json()).then(data => {
    L.geoJSON(data, { style: { color: '#ff3333', weight: 3, opacity: 0.8, fillOpacity: 0.05 } }).addTo(map);
}).catch(e => console.log("Pas de village.json"));


// ============================================================
// --- 2. VARIABLES GLOBALES ---
// ============================================================
// Ces tableaux servent de tampon pour l'affichage rapide
var savedPoints = []; 
var savedParcels = []; 
var savedTrips = [];

// Calques Leaflet
var markersLayer = L.layerGroup().addTo(map);
var tracksLayer = L.layerGroup().addTo(map);
var parcelsLayer = L.layerGroup(); 
var heatLayer = null; 

// Tracking GPS
var isTracking = false; var trackWatchId = null; 
var currentPath = []; var currentStartTime = null; 
var currentDistance = 0; 
var currentPolyline = null;
var timerInterval = null; 
var wakeLock = null;

// Filtres & UI
var currentFilterEmoji = null; 
var currentFilterText = null;
var currentFilterYear = 'all'; 

var isAutoCentering = true; 
var isCadastreMode = false;
var currentParcelGeoJSON = null; 
var selectedParcelColor = '#95a5a6'; 
var tempLatLng = null; 
var currentEditingIndex = -1; // Pour les points
var currentEditingTripId = null;
var userMarker = null; 
var userAccuracyCircle = null;


// ============================================================
// --- 3. GESTION DE LA BASE DE DONNÉES (INDEXED DB) ---
// ============================================================

const DB_NAME = "BegoleMapDB";
const DB_VERSION = 1;
let db = null;

// Initialisation & Migration
function initDB() {
    return new Promise((resolve, reject) => {
        // Compatibilité vibrations (Info console)
        if (!("vibrate" in navigator)) {
            console.warn("Vibrations non supportées sur cet appareil (ex: iPhone).");
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function(event) {
            db = event.target.result;
            // Création des tables
            if (!db.objectStoreNames.contains('points')) {
                db.createObjectStore('points', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('parcels')) {
                db.createObjectStore('parcels', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('trips')) {
                db.createObjectStore('trips', { keyPath: 'id' });
            }
        };

        request.onsuccess = function(event) {
            db = event.target.result;
            console.log("Base de données chargée avec succès.");
            resolve(db);
        };

        request.onerror = function(event) {
            console.error("Erreur DB:", event.target.errorCode);
            reject("Erreur ouverture DB");
        };
    });
}

// Fonction générique pour sauvegarder
function saveToDB(storeName, data) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
}

// Fonction générique pour supprimer
function deleteFromDB(storeName, id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
}

// Fonction générique pour tout charger
function loadAllFromDB(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
    });
}

// Fonction pour tout effacer (Reset)
function clearStoreDB(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
}

// --- MIGRATION DU LOCALSTORAGE (UNE SEULE FOIS) ---
async function migrateLocalStorage() {
    const oldPoints = localStorage.getItem('myMapPoints');
    const oldParcels = localStorage.getItem('myMapParcels');
    const oldTrips = localStorage.getItem('begole_gps_trips');

    if (oldPoints || oldParcels || oldTrips) {
        console.log("Migration des données en cours...");
        
        if (oldPoints) {
            const pts = JSON.parse(oldPoints);
            for (let p of pts) { 
                if(!p.id) p.id = Date.now() + Math.random(); 
                await saveToDB('points', p); 
            }
            localStorage.removeItem('myMapPoints');
        }
        if (oldParcels) {
            const prc = JSON.parse(oldParcels);
            for (let p of prc) { await saveToDB('parcels', p); }
            localStorage.removeItem('myMapParcels');
        }
        if (oldTrips) {
            const trps = JSON.parse(oldTrips);
            for (let t of trps) { await saveToDB('trips', t); }
            localStorage.removeItem('begole_gps_trips');
        }
        showToast("✅ Migration des données terminée !");
    }
}

// --- CHARGEMENT APPLICATION ---
async function startApp() {
    await initDB();
    await migrateLocalStorage();
    
    // Chargement en mémoire vive
    savedPoints = await loadAllFromDB('points');
    savedParcels = await loadAllFromDB('parcels');
    savedTrips = await loadAllFromDB('trips');

    updateYearFilterOptions();
    refreshMap();
    displayParcels();
    checkCrashRecovery();
}

startApp();


// ============================================================
// --- JAUGE STOCKAGE (Version DB) ---
// ============================================================
async function checkStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage; 
        const quota = estimate.quota; 
        const percentage = (usage / quota) * 100;
        
        const bar = document.getElementById('storage-bar');
        const text = document.getElementById('storage-text');
        
        if(bar && text) {
            let sizeMb = (usage / (1024 * 1024)).toFixed(1);
            text.innerText = `${sizeMb} MB (${percentage.toFixed(2)}%)`;
            bar.style.width = percentage < 1 ? "1%" : percentage + "%"; 
            
            if(percentage > 80) bar.style.backgroundColor = "#e74c3c";
            else bar.style.backgroundColor = "#2ecc71";
        }
    } else {
        document.getElementById('storage-text').innerText = "Stockage Illimité";
    }
}


// ============================================================
// --- 4. HEATMAP ---
// ============================================================

function toggleHeatmap() {
    const isChecked = document.getElementById('heatmap-toggle').checked;

    if (isChecked) {
        let heatPoints = [];
        savedTrips.forEach(trip => {
            trip.points.forEach(pt => {
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
        }
    } else {
        if(heatLayer) map.removeLayer(heatLayer);
        showToast("Heatmap désactivée");
    }
}


// ============================================================
// --- 5. CALCULS SURFACE & CADASTRE ---
// ============================================================

function getRingArea(coords) {
    if (!coords || coords.length < 3) return 0;
    let area = 0;
    const DEG_TO_M = 111319;
    const meanLat = coords[0][1] * Math.PI / 180;
    const lonScale = Math.cos(meanLat);

    for (let i = 0; i < coords.length; i++) {
        let p1 = coords[i];
        let p2 = coords[(i + 1) % coords.length];
        let x1 = p1[0] * DEG_TO_M * lonScale;
        let y1 = p1[1] * DEG_TO_M;
        let x2 = p2[0] * DEG_TO_M * lonScale;
        let y2 = p2[1] * DEG_TO_M;
        area += (x1 * y2) - (x2 * y1);
    }
    return Math.abs(area / 2.0);
}

function calculateGeoJSONArea(geometry) {
    let totalArea = 0;
    if (!geometry) return 0;
    if (geometry.type === "Polygon") {
        totalArea += getRingArea(geometry.coordinates[0]);
    } else if (geometry.type === "MultiPolygon") {
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
        let area = 0;
        if(p.geoJSON.properties.contenance) {
            area = parseInt(p.geoJSON.properties.contenance);
        } else {
            area = calculateGeoJSONArea(p.geoJSON.geometry);
        }
        totalArea += area;

        if (!statsByColor[p.color]) statsByColor[p.color] = { count: 0, area: 0 };
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
// --- 6. GESTION DU CADASTRE (UI) ---
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
    const refText = "Ref: " + (parcelGeoJSON.properties.section + " " + parcelGeoJSON.properties.numero);
    document.getElementById('parcel-ref').textContent = refText;

    let area = 0;
    try {
        if (parcelGeoJSON.properties.contenance) {
            area = parseInt(parcelGeoJSON.properties.contenance);
        } else {
            area = calculateGeoJSONArea(parcelGeoJSON.geometry);
        }
    } catch (e) { area = 0; }

    const areaEl = document.getElementById('parcel-area');
    if (areaEl) {
        if (area > 0) {
            let areaHa = (area / 10000).toFixed(4);
            let areaM2 = Math.round(area);
            areaEl.innerHTML = `<span style="font-size:18px; color:#27ae60; font-weight:800;">${areaHa} ha</span><br><span style="font-size:13px; color:#7f8c8d;">(${areaM2} m²)</span>`;
        } else {
            areaEl.innerHTML = `<span style="color:#e74c3c;">Surface non disponible</span>`;
        }
    }

    document.getElementById('parcel-note').value = "";
    document.getElementById('modal-parcel').classList.remove('hidden');
    document.getElementById('menu-items').classList.add('hidden-mobile');
}

function closeParcelModal() { document.getElementById('modal-parcel').classList.add('hidden'); currentParcelGeoJSON = null; }
function selectColor(color, element) { selectedParcelColor = color; document.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected')); element.classList.add('selected'); }

async function confirmSaveParcel() {
    if (!currentParcelGeoJSON) return;
    const note = document.getElementById('parcel-note').value;
    
    const newParcel = { 
        id: Date.now(), 
        geoJSON: currentParcelGeoJSON, 
        color: selectedParcelColor, 
        note: note 
    };
    
    // Sauvegarde DB
    await saveToDB('parcels', newParcel);
    savedParcels.push(newParcel);
    
    displayParcels(); 
    
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
                let area = 0;
                if(f.properties.contenance) area = parseInt(f.properties.contenance);
                else area = calculateGeoJSONArea(f.geometry);
                
                let areaHa = (area / 10000).toFixed(4);
                let areaM2 = Math.round(area);

                l.bindPopup(`
                    <div style="text-align:center;">
                        <b>${p.note || "Sans nom"}</b><br>
                        <span style="color:#27ae60; font-weight:800;">${areaHa} ha</span> <small style="color:#7f8c8d;">(${areaM2} m²)</small><br>
                        <small style="color:#333;">Ref: ${f.properties.section} ${f.properties.numero}</small><br>
                        <button onclick="deleteParcel(${p.id})" style="background:#e74c3c; color:white; border:none; border-radius:4px; margin-top:8px; padding:4px 8px; cursor:pointer;">Supprimer</button>
                    </div>
                `);
            }
        }).addTo(parcelsLayer);
    });
}

async function deleteParcel(id) {
    if(confirm("Supprimer ce coloriage ?")) {
        await deleteFromDB('parcels', id);
        savedParcels = savedParcels.filter(p => p.id !== id);
        displayParcels();
        triggerHaptic('warning');
    }
}

async function clearParcels() {
    if(confirm("Tout effacer les parcelles ?")) {
        await clearStoreDB('parcels');
        savedParcels = [];
        displayParcels(); 
        toggleMenu();
        showToast("🗑️ Parcelles effacées");
        triggerHaptic('warning');
    }
}


// ============================================================
// --- 7. TRACEUR GPS & ENREGISTREMENT ---
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

function toggleMenu() { 
    checkStorageUsage();
    document.getElementById('menu-items').classList.toggle('hidden-mobile'); 
}

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
        
        startTimer(); 
        await requestWakeLock();
        
        currentPolyline = L.polyline([], {color: 'red', weight: 5}).addTo(map);
        if (navigator.geolocation) trackWatchId = navigator.geolocation.watchPosition(updateTrackingPosition, null, {enableHighAccuracy:true});
        toggleMenu();
        showToast("🚀 Enregistrement démarré !");
        triggerHaptic('start');
    } else {
        // --- STOP ---
        isTracking = false; 
        document.getElementById('btn-recenter').classList.add('hidden'); 
        
        navigator.geolocation.clearWatch(trackWatchId); 
        stopTimer(); 
        await releaseWakeLock();
        localStorage.removeItem('begole_temp_track'); // Nettoyage Temp

        btn.innerHTML = "▶️ Démarrer Trajet"; btn.className = "btn-start-track"; 
        container.classList.add('hidden'); dashboard.classList.add('hidden'); 

        if (currentPath.length > 0) {
            const endTime = new Date();
            const elevationStats = calculateElevation(currentPath);
            await saveTrip(currentPath, currentStartTime, endTime, currentDistance, elevationStats);
            alert(`Trajet terminé !\nDistance : ${currentDistance.toFixed(2)} km\nDénivelé + : ${elevationStats.gain} m\nDurée : ${formatDuration(endTime - currentStartTime)}`);
            triggerHaptic('stop');
        }
        if (currentPolyline) map.removeLayer(currentPolyline);
    }
}

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

    // Temp Track (Anti-Crash)
    localStorage.setItem('begole_temp_track', JSON.stringify({
        path: currentPath,
        startTime: currentStartTime,
        distance: currentDistance
    }));
}

function checkCrashRecovery() {
    const tempTrack = JSON.parse(localStorage.getItem('begole_temp_track'));
    if (tempTrack && tempTrack.path && tempTrack.path.length > 0) {
        if(confirm("⚠️ Tracé interrompu détecté !\nVoulez-vous le reprendre ?")) {
            currentPath = tempTrack.path;
            currentStartTime = new Date(tempTrack.startTime);
            currentDistance = tempTrack.distance;
            
            isTracking = true;
            isAutoCentering = true;
            document.getElementById('btn-recenter').classList.add('hidden');
            const btn = document.getElementById('btn-tracking');
            btn.innerHTML = "⏹️ Arrêter REC"; 
            btn.className = "btn-stop-track"; 
            document.getElementById('recording-container').classList.remove('hidden');
            document.getElementById('dashboard').classList.remove('hidden');

            currentPolyline = L.polyline(currentPath, {color: 'red', weight: 5}).addTo(map);
            
            startTimer();
            requestWakeLock();
            if (navigator.geolocation) {
                trackWatchId = navigator.geolocation.watchPosition(updateTrackingPosition, null, {enableHighAccuracy:true});
            }
            showToast("✅ Tracé récupéré !");
        } else {
            localStorage.removeItem('begole_temp_track');
        }
    }
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

function calculateElevation(points) {
    let gain = 0;
    let loss = 0;
    if (!points || points.length < 2) return { gain: 0, loss: 0 };
    let lastAlt = points[0][2]; 
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

async function saveTrip(path, start, end, distKm, elevationStats) {
    const dur = end - start;
    const avgSpeed = (dur > 0 && distKm > 0) ? distKm / (dur / 3600000) : 0;
    
    const newTrip = { 
        id: Date.now(), 
        date: start.toISOString(), 
        duration: dur, 
        distance: distKm, 
        avgSpeed: avgSpeed, 
        points: path, 
        note: "",
        elevationGain: elevationStats ? elevationStats.gain : 0, 
        elevationLoss: elevationStats ? elevationStats.loss : 0 
    };
    
    await saveToDB('trips', newTrip);
    savedTrips.push(newTrip);
}


// ============================================================
// --- 8. HISTORIQUE TRAJETS & AFFICHAGE ---
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

async function deleteTrip(id) { 
    if(confirm("Supprimer ce trajet ?")) { 
        await deleteFromDB('trips', id);
        savedTrips = savedTrips.filter(t=>t.id!==id); 
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

async function confirmSaveTripNote() {
    if (currentEditingTripId) {
        const note = document.getElementById('edit-trip-note').value;
        const tripIndex = savedTrips.findIndex(t => t.id === currentEditingTripId);
        if (tripIndex > -1) {
            savedTrips[tripIndex].note = note;
            await saveToDB('trips', savedTrips[tripIndex]);
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
// --- 9. GESTION POINTS, PHOTOS & CARNET ---
// ============================================================

function openModal() { document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

async function confirmAddPoint() {
    const emoji = document.getElementById('input-emoji').value || "📍";
    const note = document.getElementById('input-note').value;
    
    const newPoint = { 
        id: Date.now(),
        lat: tempLatLng.lat, 
        lng: tempLatLng.lng, 
        note: note, 
        emoji: emoji, 
        date: new Date().toLocaleDateString(),
        history: [] 
    };
    
    await saveToDB('points', newPoint);
    savedPoints.push(newPoint);
    
    updateYearFilterOptions();
    refreshMap(); closeModal();
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

// Visionneuse (Lightbox)
function viewFullImage(src) {
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    if(overlay && img) {
        img.src = src;
        overlay.classList.remove('hidden');
    }
}
function closeLightbox() {
    const overlay = document.getElementById('lightbox-overlay');
    if(overlay) {
        overlay.classList.add('hidden');
        setTimeout(() => { document.getElementById('lightbox-img').src = ""; }, 300);
    }
}

// Compression Image
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

function previewPhotoCount() {
    const input = document.getElementById('history-photo-input');
    const status = document.getElementById('photo-status');
    const label = document.querySelector('.btn-photo-label');
    
    if(input.files && input.files[0]) {
        status.style.display = 'block';
        label.style.backgroundColor = '#2ecc71'; 
    } else {
        status.style.display = 'none';
        label.style.backgroundColor = '#bdc3c7'; 
    }
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
        
        let imgHtml = "";
        if (entry.photo) {
            // Clic sur l'image = Lightbox
            imgHtml = `<img src="${entry.photo}" class="history-img-thumb" onclick="viewFullImage(this.src)">`;
        }

        div.innerHTML = `
            <div class="history-header">
                <div><span>${entry.date} :</span> ${entry.text}</div>
                <button class="btn-history-delete-row" onclick="deleteHistoryEntry(${i})">🗑️</button>
            </div>
            ${imgHtml}
        `;
        container.appendChild(div);
    }
}

async function deleteHistoryEntry(historyIndex) {
    if(confirm("Effacer cette ligne du carnet ?")) {
        savedPoints[currentEditingIndex].history.splice(historyIndex, 1);
        await saveToDB('points', savedPoints[currentEditingIndex]);
        renderPointHistory(savedPoints[currentEditingIndex].history);
        triggerHaptic('warning');
    }
}

async function addHistoryToCurrentPoint() {
    const textInput = document.getElementById('new-history-entry');
    const photoInput = document.getElementById('history-photo-input');
    const text = textInput.value.trim();
    
    if (!text && (!photoInput.files || photoInput.files.length === 0)) return;

    if (currentEditingIndex > -1) {
        const now = new Date();
        const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString().slice(0,5);
        let newEntry = { date: dateStr, text: text, photo: null };

        if (photoInput.files && photoInput.files[0]) {
            showToast("📸 Traitement photo...");
            try {
                const compressedDataUrl = await compressImage(photoInput.files[0], 800, 0.7);
                newEntry.photo = compressedDataUrl;
            } catch (e) {
                console.error("Erreur photo", e);
                showToast("❌ Erreur image");
            }
        }

        savedPoints[currentEditingIndex].history.push(newEntry);
        await saveToDB('points', savedPoints[currentEditingIndex]);
        renderPointHistory(savedPoints[currentEditingIndex].history);
        textInput.value = ""; 
        photoInput.value = ""; 
        previewPhotoCount(); 
        triggerHaptic('success');
        showToast("Entrée ajoutée !");
    }
}

async function savePointEdits() {
    if (currentEditingIndex > -1) {
        savedPoints[currentEditingIndex].emoji = document.getElementById('edit-emoji').value;
        savedPoints[currentEditingIndex].note = document.getElementById('edit-note').value;
        await saveToDB('points', savedPoints[currentEditingIndex]);
        refreshMap(); 
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("✅ Point mis à jour");
    }
}

function deleteCurrentPoint() {
    if (currentEditingIndex > -1) { deletePoint(currentEditingIndex); document.getElementById('modal-edit-point').classList.add('hidden'); }
}

async function deletePoint(i) { 
    const p = savedPoints[i];
    await deleteFromDB('points', p.id);
    savedPoints.splice(i,1); 
    refreshMap(); 
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

// GESTION DES VIBRATIONS (HAPTIC)
function triggerHaptic(type) {
    // Vérification de sécurité
    if (!navigator.vibrate) return;
    
    // Patterns de vibration optimisés
    try {
        switch (type) {
            case 'success': navigator.vibrate(50); break; 
            case 'warning': navigator.vibrate([50, 50, 50]); break; 
            case 'error': navigator.vibrate([100, 50, 100, 50, 100]); break; 
            case 'start': navigator.vibrate(200); break; 
            case 'stop': navigator.vibrate([200, 100, 200]); break; 
            default: navigator.vibrate(50);
        }
    } catch(e) {
        console.log("Erreur vibration:", e);
    }
}

async function clearData() { 
    if(confirm("TOUT SUPPRIMER ? (Irréversible)")) { 
        await clearStoreDB('points');
        await clearStoreDB('parcels');
        await clearStoreDB('trips');
        location.reload(); 
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
    fr.onload = async e => {
        const d = JSON.parse(e.target.result);
        if(d.points) {
            for (let p of d.points) {
                if(!p.id) p.id = Date.now() + Math.random();
                await saveToDB('points', p);
            }
        }
        if(d.trips) {
            for (let t of d.trips) { await saveToDB('trips', t); }
        }
        if(d.parcels) {
            for (let p of d.parcels) { await saveToDB('parcels', p); }
        }
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
// --- 10. STATS GLOBALES (4 BLOCS & TRI) ---
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

    sortedStats.sort((a, b) => a.count - b.count);
    
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