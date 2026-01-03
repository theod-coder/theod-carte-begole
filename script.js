// ============================================================
// --- 1. CONFIGURATION & INITIALISATION CARTE ---
// ============================================================
const VILLAGE_COORDS = [43.1565, 0.3235]; 
const DEFAULT_ZOOM = 13;

var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
var satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', { maxZoom: 19, attribution: '© IGN' });
var cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { maxZoom: 20, attribution: '© IGN' });

var map = L.map('map', { center: VILLAGE_COORDS, zoom: DEFAULT_ZOOM, layers: [satelliteLayer] }); 
var baseMaps = { "Satellite IGN 🇫🇷": satelliteLayer, "Plan Route 🗺️": osmLayer };
var overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
L.control.scale({imperial: false, metric: true}).addTo(map); 

var villageLayer = null;
fetch('village.json').then(r => r.json()).then(data => {
    villageLayer = L.geoJSON(data, { style: { color: '#ff3333', weight: 4, opacity: 0.9, fillOpacity: 0.05, dashArray: '10, 10' } });
    villageLayer.addTo(map);
}).catch(e => console.log("Note: Pas de fichier village.json détecté"));

// ============================================================
// --- 2. VARIABLES GLOBALES ---
// ============================================================
var savedPoints = [], savedParcels = [], savedTrips = [];
var tempImportedPhoto = null; 
const SECRET_EMOJIS = ["🍄", "🍄‍🟫", "🤫"]; 
var isIntruderMode = false; 
var currentAvatar = localStorage.getItem('begole_avatar') || 'man';

var markersLayer = L.markerClusterGroup({
    maxClusterRadius: 50, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true,
    iconCreateFunction: function(cluster) {
        var count = cluster.getChildCount(); var maxVal = 20; var hue = (1 - Math.min(count, maxVal) / maxVal) * 120; if (count > 50) hue = 0;
        return L.divIcon({ html: `<div style="background-color: hsla(${hue}, 100%, 40%, 0.9); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.5); box-shadow: 0 4px 8px rgba(0,0,0,0.4); color: white; font-weight: bold; font-family: sans-serif; font-size: 14px;">${count}</div>`, className: 'marker-cluster-custom', iconSize: L.point(40, 40) });
    }
});
map.addLayer(markersLayer);

var tracksLayer = L.layerGroup().addTo(map);
var parcelsLayer = L.layerGroup(); 
var heatLayer = null; 

var isTracking = false, trackWatchId = null; 
var currentPath = [], currentStartTime = null, currentDistance = 0, currentTraceLayer = null;
var timerInterval = null, wakeLock = null;
var autoSaveInterval = null; 
var isCompassMode = false;
var isRadarActive = false, alertedPoints = new Set(); 
var lastPositionTime = null;

var currentFilterEmoji = null, currentFilterText = null, currentFilterYear = 'all', currentFilterMonth = 'all'; 
var isAutoCentering = true, isCadastreMode = false, currentParcelGeoJSON = null, selectedParcelColor = '#95a5a6'; 
var tempLatLng = null, currentEditingIndex = -1, currentEditingTripId = null;
var userMarker = null, userAccuracyCircle = null;

var currentEnv = { moon: "", temp: "--", weather: "", fullString: "" };

// ============================================================
// --- 3. DB & DEMARRAGE ---
// ============================================================
const DB_NAME = "BegoleMapDB"; const DB_VERSION = 1; let db = null;
function initDB() { return new Promise((r, j) => { const req = indexedDB.open(DB_NAME, DB_VERSION); req.onupgradeneeded = e => { db = e.target.result; if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' }); if (!db.objectStoreNames.contains('parcels')) db.createObjectStore('parcels', { keyPath: 'id' }); if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' }); }; req.onsuccess = e => { db = e.target.result; r(db); }; req.onerror = e => j("Erreur DB"); }); }
function saveToDB(s, d) { return new Promise((r, j) => { const tx = db.transaction([s], "readwrite"); tx.objectStore(s).put(d); tx.oncomplete = r; }); }
function deleteFromDB(s, id) { return new Promise((r, j) => { const tx = db.transaction([s], "readwrite"); tx.objectStore(s).delete(id); tx.oncomplete = r; }); }
function loadAllFromDB(s) { return new Promise((r, j) => { const tx = db.transaction([s], "readonly"); const req = tx.objectStore(s).getAll(); req.onsuccess = () => r(req.result); }); }
function clearStoreDB(s) { return new Promise((r, j) => { const tx = db.transaction([s], "readwrite"); tx.objectStore(s).clear(); tx.oncomplete = r; }); }

async function cleanDuplicates() { const seen = new Set(); const duplicates = []; const cleanList = []; savedPoints.forEach(p => { const key = `${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|${p.emoji}`; if (seen.has(key)) { duplicates.push(p.id); } else { seen.add(key); cleanList.push(p); } }); if (duplicates.length > 0) { for (let id of duplicates) { await deleteFromDB('points', id); } savedPoints = cleanList; showToast(`🧹 Nettoyage : ${duplicates.length} doublons supprimés.`); } }
async function checkStorageUsage() { if (navigator.storage && navigator.storage.estimate) { const est = await navigator.storage.estimate(); const pct = (est.usage / est.quota) * 100; const bar = document.getElementById('storage-bar'); if(bar) { document.getElementById('storage-text').innerText = `${(est.usage/1048576).toFixed(1)} MB (${pct.toFixed(2)}%)`; bar.style.width = pct < 1 ? "1%" : pct + "%"; bar.style.backgroundColor = pct > 80 ? "#e74c3c" : "#2ecc71"; } } }

// ============================================================
// --- 4. NATURE : ASTRO & MÉTÉO (AVEC VENT) ---
// ============================================================
function updateAstroWidget() {
    const date = new Date(); 
    const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
    
    // --- 1. CALCUL DE LA LUNE ---
    let m = month; let y = year; 
    if (m < 3) { y--; m += 12; } 
    ++m;
    let c = 365.25 * y, e = 30.6 * m, jd = c + e + day - 694039.09; 
    jd /= 29.5305882; 
    let b = parseInt(jd); 
    jd -= b; 
    b = Math.round(jd * 8); 
    if (b >= 8) b = 0;
    
    const moons = ['🌑 Nouv.', '🌒 Crois.', '🌓 Premier', '🌔 Gib.', '🌕 Pleine', '🌖 Gib.', '🌗 Dernier', '🌘 Crois.'];
    currentEnv.moon = `Lune : ${moons[b]} ${(jd*100).toFixed(0)}%`; 
    
    const moonEl = document.getElementById('astro-moon'); 
    if(moonEl) moonEl.innerText = currentEnv.moon;
    
    // --- 2. CALCUL DU SOLEIL (Approx) ---
    const now = new Date(); 
    const start = new Date(now.getFullYear(), 0, 0); 
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    
    // Heure de coucher approximative selon le jour de l'année
    let sunsetHour = 19.5 + (Math.sin((dayOfYear - 80) * 0.0172) * 2.3); 
    const currentHour = now.getHours() + now.getMinutes()/60; 
    let remaining = sunsetHour - currentHour;
    
    const sunEl = document.getElementById('astro-sun'); 
    if(sunEl) { 
        if (remaining < 0) { 
            sunEl.innerText = "🌑 Nuit"; 
            sunEl.classList.remove('sun-alert'); 
        } else { 
            const h = Math.floor(remaining), m = Math.floor((remaining - h) * 60); 
            sunEl.innerText = `☀️ Reste ${h}h${pad(m)}`; 
            sunEl.classList.toggle('sun-alert', remaining < 1); 
        } 
    }
    
    // --- 3. GESTION DES THÈMES & EFFETS ---
    document.body.classList.remove('theme-golden', 'theme-dark'); 
    
    let isNight = false; // Variable pour savoir s'il fait nuit
    if (currentHour > sunsetHour || currentHour < 7) { 
        document.body.classList.add('theme-dark'); 
        isNight = true;
    } else if (remaining < 1 && remaining > 0) { 
        document.body.classList.add('theme-golden'); 
    }

    // --- 4. GESTION DEEP NIGHT (AUTO OU SAUVÉ) ---
    const deepPref = localStorage.getItem('begole_deep_night_pref');
    const deepToggle = document.getElementById('deep-night-toggle');
    
    let shouldEnableDeep = false;

    if (deepPref !== null) {
        // A. L'utilisateur a choisi (ON ou OFF explicitement)
        shouldEnableDeep = (deepPref === 'true');
    } else {
        // B. Par défaut : ON si c'est la nuit, OFF sinon
        shouldEnableDeep = isNight;
    }

    if (shouldEnableDeep) {
        document.body.classList.add('deep-night-active');
        if (deepToggle) deepToggle.checked = true;
    } else {
        document.body.classList.remove('deep-night-active');
        if (deepToggle) deepToggle.checked = false;
    }

    // --- 5. MISE À JOUR CONTINUE DES EFFETS ---
    if (typeof manageFireflies === 'function') manageFireflies();
    if (typeof checkAndPlayAmbiance === 'function') checkAndPlayAmbiance();
    if (typeof managePollen === 'function') managePollen();
}

function updateWeatherWidget() {
    let lat = VILLAGE_COORDS[0], lng = VILLAGE_COORDS[1];
    if (userMarker) { const ll = userMarker.getLatLng(); lat = ll.lat; lng = ll.lng; }
    
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m&timezone=auto`;
    
    fetch(url).then(r => r.ok ? r.json() : null).then(data => {
        if (!data || !data.current) return;
        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;
        const windSpeed = Math.round(data.current.wind_speed_10m);
        const windDir = data.current.wind_direction_10m; 

        let desc = "Calme"; 
        if (code === 0) desc = "☀️ Soleil"; else if (code >= 1 && code <= 3) desc = "⛅ Nuageux"; else if (code >= 45 && code <= 48) desc = "🌫️ Brouillard"; else if (code >= 51 && code <= 67) desc = "🌧️ Pluie"; else if (code >= 71 && code <= 77) desc = "❄️ Neige"; else if (code >= 80 && code <= 82) desc = "🚿 Averses"; else if (code >= 95) desc = "⚡ Orage";
        
        const elDesc = document.getElementById('weather-desc');
        const elTemp = document.getElementById('weather-temp');
        const elWind = document.getElementById('weather-wind');
        const elArrow = document.getElementById('wind-arrow');
        
        if(elDesc) elDesc.innerText = desc;
        if(elTemp) elTemp.innerText = `🌡️ ${temp}°C`;
        
        if(elWind && elArrow) {
            elArrow.style.transform = `rotate(${windDir + 180}deg)`; 
            elWind.innerHTML = `🌬️ ${windSpeed} km/h <span id="wind-arrow" style="display:inline-block; transform:rotate(${windDir + 180}deg)">⬇️</span>`;
        }
        
        currentEnv.temp = temp; currentEnv.weather = desc; currentEnv.fullString = `${desc} ${temp}°C • ${currentEnv.moon}`;
        triggerWeatherEffect(desc);
        
        // MAJ Effets
        if (typeof checkAndPlayAmbiance === 'function') checkAndPlayAmbiance();
        if (typeof managePollen === 'function') managePollen();
        
        // Auto-nuages si mauvais temps (et si pas désactivé explicitement)
        if ((code >= 1 && code <= 3) || (code >= 45 && code <= 48)) {
            // On vérifie si l'utilisateur n'a pas explicitement désactivé les nuages
            const savedClouds = localStorage.getItem('begole_clouds_pref');
            if (savedClouds !== 'false') {
                const toggle = document.getElementById('clouds-toggle');
                if (toggle && !toggle.checked) {
                    toggle.checked = true;
                    if(typeof toggleClouds === 'function') toggleClouds();
                }
            }
        }

    }).catch((e) => { console.error(e); });
}

function toggleRadar() { isRadarActive = document.getElementById('radar-toggle').checked; if(isRadarActive) { showToast("📡 Radar activé (40m)"); triggerHaptic('success'); alertedPoints.clear(); } else { showToast("Radar coupé"); } }
function toggleIntruderMode() { isIntruderMode = document.getElementById('intruder-toggle').checked; refreshMap(); showToast(isIntruderMode ? "🙈 Points secrets cachés" : "👁️ Points secrets visibles"); }

// ============================================================
// --- 5. UI ---
// ============================================================
function toggleBorders() { if (document.getElementById('borders-toggle').checked) { if(villageLayer) villageLayer.addTo(map); } else { if(villageLayer) map.removeLayer(villageLayer); } toggleMenu(); }
function toggleCompass() { isCompassMode = !isCompassMode; const btn = document.getElementById('btn-compass'); if (isCompassMode) { btn.classList.add('active'); enableAutoCenter(); showToast("🧭 Boussole Active"); if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') { window.DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') window.addEventListener('deviceorientation', handleOrientation); }); } else { window.addEventListener('deviceorientation', handleOrientation); } } else { btn.classList.remove('active'); window.removeEventListener('deviceorientation', handleOrientation); if (userMarker) { const ar = userMarker.getElement().querySelector('.user-location-arrow'); if(ar) ar.style.transform = `rotate(0deg)`; } } }
function handleOrientation(e) { if (!isCompassMode || !userMarker) return; let h = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : 0); const ar = userMarker.getElement().querySelector('.user-location-arrow'); if(ar) ar.style.transform = `rotate(${h}deg)`; }
function toggleHeatmap() { if (document.getElementById('heatmap-toggle').checked) { let pts=[]; savedTrips.forEach(t=>t.points.forEach(p=>pts.push([p[0],p[1],0.5]))); if(pts.length===0){showToast("Pas de données");document.getElementById('heatmap-toggle').checked=false;return;} if(heatLayer)map.removeLayer(heatLayer); heatLayer=L.heatLayer(pts,{radius:20,blur:15}).addTo(map); } else { if(heatLayer)map.removeLayer(heatLayer); } toggleMenu(); }
function toggleCadastreMode() { isCadastreMode=document.getElementById('cadastre-mode-toggle').checked; toggleOpacitySlider(isCadastreMode||document.getElementById('show-parcels-toggle').checked); if(isCadastreMode){ if(!map.hasLayer(cadastreLayer))map.addLayer(cadastreLayer); if(map.hasLayer(markersLayer))map.removeLayer(markersLayer); } else{ if(!document.getElementById('show-parcels-toggle').checked)map.removeLayer(cadastreLayer); if(!map.hasLayer(markersLayer)) map.addLayer(markersLayer); } }
function toggleSavedParcels() { const c=document.getElementById('show-parcels-toggle').checked; toggleOpacitySlider(c||isCadastreMode); if(c){ if(!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer); map.addLayer(cadastreLayer); if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer); } else{ map.removeLayer(parcelsLayer); if(!isCadastreMode) map.removeLayer(cadastreLayer); if(!map.hasLayer(markersLayer)) map.addLayer(markersLayer); } }
function toggleOpacitySlider(s) { document.getElementById('cadastre-opacity-container').classList.toggle('hidden', !s); }
function updateCadastreOpacity(v) { cadastreLayer.setOpacity(v); }
map.on('click', e => { if (isCadastreMode) fetchParcelAt(e.latlng); else { tempLatLng = e.latlng; openModal(); } });
function fetchParcelAt(ll) { document.body.style.cursor='wait'; fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${ll.lng},${ll.lat}]}`).then(r=>r.ok?r.json():null).then(d=>{document.body.style.cursor='default';if(d&&d.features.length){openParcelModal(d.features[0]);triggerHaptic('success');}else{showToast("Rien ici");}}).catch(()=>{document.body.style.cursor='default';}); }
function openParcelModal(p) { currentParcelGeoJSON=p; document.getElementById('parcel-ref').textContent="Ref: "+p.properties.section+" "+p.properties.numero; let a=p.properties.contenance?parseInt(p.properties.contenance):calculateGeoJSONArea(p.geometry); document.getElementById('parcel-area').innerHTML=`${(a/10000).toFixed(4)} ha<br><small>(${Math.round(a)} m²)</small>`; document.getElementById('parcel-note').value=""; document.getElementById('modal-parcel').classList.remove('hidden'); document.getElementById('menu-items').classList.add('hidden-mobile'); }
function closeParcelModal() { document.getElementById('modal-parcel').classList.add('hidden'); currentParcelGeoJSON=null; }
function selectColor(c,el) { selectedParcelColor=c; document.querySelectorAll('.color-option').forEach(e=>e.classList.remove('selected')); el.classList.add('selected'); }
async function confirmSaveParcel() { const n={id:Date.now(),geoJSON:currentParcelGeoJSON,color:selectedParcelColor,note:document.getElementById('parcel-note').value}; await saveToDB('parcels',n); savedParcels.push(n); displayParcels(); closeParcelModal(); showToast("Sauvegardé"); }
function displayParcels() { parcelsLayer.clearLayers(); savedParcels.forEach(p=>{ L.geoJSON(p.geoJSON,{ style:{color:'#333',weight:1,fillColor:p.color,fillOpacity:0.6}, onEachFeature:(f,l)=>{ let a = f.properties.contenance ? parseInt(f.properties.contenance) : calculateGeoJSONArea(f.geometry); l.bindPopup(`<div style="text-align:center;"><b style="font-size:14px; color:${p.color}; text-shadow:0 1px 1px rgba(0,0,0,0.2);">${p.note||"Parcelle"}</b><br><span style="font-size:16px; font-weight:800;">${(a/10000).toFixed(2)} ha</span><br><small style="color:#666;">(${Math.round(a)} m²)</small><br><button class="btn-popup-delete" onclick="deleteParcel(${p.id})">🗑️ Supprimer</button></div>`); } }).addTo(parcelsLayer); }); }
async function deleteParcel(id) { if(confirm("Supprimer ?")){await deleteFromDB('parcels',id); savedParcels=savedParcels.filter(p=>p.id!==id); displayParcels();} }
async function clearParcels() { if(confirm("Tout effacer ?")){await clearStoreDB('parcels'); savedParcels=[]; displayParcels();} }
function getRingArea(coords) { if (!coords || coords.length < 3) return 0; let area = 0; const DEG_TO_M = 111319; const meanLat = coords[0][1]*Math.PI/180; const lonScale = Math.cos(meanLat); for (let i=0; i<coords.length; i++) { let p1=coords[i], p2=coords[(i+1)%coords.length]; area += (p1[0]*DEG_TO_M*lonScale * p2[1]*DEG_TO_M) - (p2[0]*DEG_TO_M*lonScale * p1[1]*DEG_TO_M); } return Math.abs(area/2.0); }
function calculateGeoJSONArea(g) { if(!g) return 0; if(g.type==="Polygon") return getRingArea(g.coordinates[0]); if(g.type==="MultiPolygon") { let t=0; g.coordinates.forEach(p=>t+=getRingArea(p[0])); return t; } return 0; }
function showCadastreStats() { let totalCount=0, totalArea=0, statsByColor={}; savedParcels.forEach(p => { totalCount++; let area = p.geoJSON.properties.contenance ? parseInt(p.geoJSON.properties.contenance) : calculateGeoJSONArea(p.geoJSON.geometry); totalArea += area; if (!statsByColor[p.color]) statsByColor[p.color] = { count: 0, area: 0 }; statsByColor[p.color].count++; statsByColor[p.color].area += area; }); let totalHa = (totalArea / 10000).toFixed(2); let totalM2 = Math.round(totalArea); let html = `<div style="text-align:center;margin-bottom:15px;"><span style="font-size:24px;font-weight:800;color:var(--text-main);">${totalHa} ha</span><br><span style="font-size:14px;color:var(--text-sub);">(${totalM2} m²)</span><br><span style="font-weight:bold;color:#e67e22;">${totalCount} parcelles</span></div><hr style="margin:10px 0;border-top:1px solid var(--border-color);">`; for (let c in statsByColor) { let s = statsByColor[c]; html += `<div class="cadastre-stat-row"><div style="display:flex;align-items:center;"><span class="color-dot" style="background:${c};"></span><span>${s.count} parcelles</span></div><div style="text-align:right;"><strong>${(s.area/10000).toFixed(2)} ha</strong><br><small>(${Math.round(s.area)} m²)</small></div></div>`; } if (totalCount === 0) html += "<p style='text-align:center;color:#999;'>Aucune parcelle.</p>"; document.getElementById('cadastre-stats-content').innerHTML = html; document.getElementById('modal-cadastre-stats').classList.remove('hidden'); toggleMenu(); }
function closeCadastreStats() { document.getElementById('modal-cadastre-stats').classList.add('hidden'); }

// ============================================================
// --- 6. TRACEUR (ARC-EN-CIEL 🌈) ---
// ============================================================
map.on('dragstart', () => { if (isTracking && isAutoCentering) { isAutoCentering=false; document.getElementById('btn-recenter').classList.remove('hidden'); } });
function enableAutoCenter() { isAutoCentering=true; document.getElementById('btn-recenter').classList.add('hidden'); if(userMarker) map.setView(userMarker.getLatLng()); }
function toggleMenu() { checkStorageUsage(); document.getElementById('menu-items').classList.toggle('hidden-mobile'); updateAstroWidget(); updateWeatherWidget(); updateUserLevel(); }

async function toggleTracking() { 
    const btn = document.getElementById('btn-tracking'); 
    
    if (!isTracking) { 
        // --- DÉMARRAGE ---
        isTracking = true; 
        isAutoCentering = true; 
        document.getElementById('btn-recenter').classList.add('hidden'); 
        
        currentPath = []; 
        currentDistance = 0; 
        currentStartTime = new Date(); 
        lastPositionTime = Date.now(); // Reset du chrono vitesse
        alertedPoints.clear(); 
        
        btn.innerHTML = "⏹️ Stop"; 
        btn.className = "btn-stop-track"; 
        document.getElementById('recording-container').classList.remove('hidden'); 
        document.getElementById('dashboard').classList.remove('hidden'); 
        
        startTimer(); 
        await requestWakeLock(); 
        autoSaveInterval = setInterval(saveTrackState, 10000); 

        // --- INIT CALQUE TRACE ARC-EN-CIEL ---
        if (currentTraceLayer) map.removeLayer(currentTraceLayer);
        currentTraceLayer = L.layerGroup().addTo(map);
        // -------------------------------------

        trackWatchId = navigator.geolocation.watchPosition(updateTrackingPosition, null, {enableHighAccuracy: true}); 
        toggleMenu(); 
        showToast("REC démarré 🌈"); 
        triggerHaptic('start'); 

    } else { 
        // --- ARRÊT ---
        isTracking = false; 
        navigator.geolocation.clearWatch(trackWatchId); 
        stopTimer(); 
        await releaseWakeLock(); 
        
        if (autoSaveInterval) { 
            clearInterval(autoSaveInterval); 
            autoSaveInterval = null; 
        } 
        localStorage.removeItem('begole_temp_track'); 
        
        btn.innerHTML = "▶️ Lancer<br>Trajet"; 
        btn.className = "btn-start-track"; 
        document.getElementById('recording-container').classList.add('hidden'); 
        document.getElementById('dashboard').classList.add('hidden'); 
        
        if (currentPath.length > 0) { 
            const end = new Date(); 
            await saveTrip(currentPath, currentStartTime, end, currentDistance, calculateElevation(currentPath)); 
            alert(`Trajet terminé !\nDistance: ${currentDistance.toFixed(2)}km`); 
        } 
        
        // Nettoyage visuel carte
        if (currentTraceLayer) map.removeLayer(currentTraceLayer); 
    } 
}

function saveTrackState() { if(isTracking && currentPath.length > 0) { localStorage.setItem('begole_temp_track', JSON.stringify({path:currentPath, startTime:currentStartTime, distance:currentDistance})); console.log("💾 Sauvegarde auto du trajet..."); } }

function updateTrackingPosition(pos) { 
    const lat = pos.coords.latitude, lng = pos.coords.longitude; 
    const alt = pos.coords.altitude || 0;
    
    // 1. RECUPERATION INTELLIGENTE DE LA VITESSE
    let speed = pos.coords.speed; // Vitesse GPS native (m/s)
    const now = Date.now();

    // Si le GPS ne donne pas la vitesse, on la calcule !
    if ((speed === null || speed === 0) && lastPositionTime && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const distM = map.distance([lastPt[0], lastPt[1]], [lat, lng]); // Distance mètres
        const timeDiffS = (now - lastPositionTime) / 1000; // Temps secondes
        if (timeDiffS > 0) {
            speed = distM / timeDiffS; // v = d/t
        }
    }
    lastPositionTime = now;

    // Radar
    if (isRadarActive) { 
        savedPoints.forEach(p => { 
            if (!alertedPoints.has(p.id)) { 
                if (map.distance([lat, lng], [p.lat, p.lng]) < 40) { 
                    triggerHaptic('radar'); 
                    showToast(`🍄 Point proche : ${p.emoji}`); 
                    alertedPoints.add(p.id); 
                } 
            } 
        }); 
    } 

    // Dashboard & Distance
    if (currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        currentDistance += (map.distance([lastPt[0], lastPt[1]], [lat, lng]) / 1000); 
    }
    updateDashboard(alt, speed, currentDistance); 
    
    if (isAutoCentering) map.setView([lat, lng]); 
    updateUserMarker(lat, lng, pos.coords.accuracy, pos.coords.heading); 

    // --- DESSIN ARC-EN-CIEL LIVE ---
    if (currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const segmentColor = getSpeedColor(speed);
        L.polyline([[lastPt[0], lastPt[1]], [lat, lng]], {
            color: segmentColor, 
            weight: 5, 
            opacity: 0.8,
            lineCap: 'round'
        }).addTo(currentTraceLayer);
    }
    // -----------------------------

    // On stocke la vitesse (index 3) pour le Replay !
    const newLL = [lat, lng, alt, speed || 0]; 
    currentPath.push(newLL); 
    saveTrackState(); 
}

function checkCrashRecovery() { const t=JSON.parse(localStorage.getItem('begole_temp_track')); if(t&&t.path.length>0 && confirm("Reprendre tracé interrompu ?")) { currentPath=t.path; currentStartTime=new Date(t.startTime); currentDistance=t.distance; isTracking=true; isAutoCentering=true; document.getElementById('btn-tracking').innerHTML="⏹️ Stop"; document.getElementById('btn-tracking').className="btn-stop-track"; document.getElementById('recording-container').classList.remove('hidden'); document.getElementById('dashboard').classList.remove('hidden'); 
    // Recovery simple en rouge (on perd les couleurs précises mais on garde la trace)
    if (currentTraceLayer) map.removeLayer(currentTraceLayer);
    currentTraceLayer = L.layerGroup().addTo(map);
    L.polyline(currentPath.map(p=>[p[0],p[1]]),{color:'red',weight:5}).addTo(currentTraceLayer);
    startTimer(); requestWakeLock(); autoSaveInterval = setInterval(saveTrackState, 10000); trackWatchId=navigator.geolocation.watchPosition(updateTrackingPosition,null,{enableHighAccuracy:true}); } else localStorage.removeItem('begole_temp_track'); }
function updateDashboard(a,s,d) { document.getElementById('dash-alt').innerText=a?Math.round(a):"--"; document.getElementById('dash-speed').innerText=s?Math.round(s*3.6):0; document.getElementById('dash-dist').innerText=d.toFixed(2); }
function startTimer() { const e=document.getElementById('recording-timer'); timerInterval=setInterval(()=>{e.innerText=formatDuration(new Date()-currentStartTime);},1000); }
function stopTimer() { clearInterval(timerInterval); document.getElementById('recording-timer').innerText="00:00"; }
function calculateElevation(p) { let g=0,l=0;if(p.length<2)return{gain:0,loss:0};let la=p[0][2];for(let i=1;i<p.length;i++){let ca=p[i][2];if(ca!==null&&la!==null){let d=ca-la;if(Math.abs(d)>5){if(d>0)g+=d;else l+=Math.abs(d);la=ca;}}}return{gain:Math.round(g),loss:Math.round(l)};}
async function saveTrip(p,s,e,d,el) { const trip={id:Date.now(),date:s.toISOString(),duration:e-s,distance:d,points:p,elevationGain:el.gain}; await saveToDB('trips',trip); savedTrips.push(trip); }

// ============================================================
// --- 7. HISTORIQUE & REPLAY (ARC-EN-CIEL 🌈) ---
// ============================================================
function openHistory() { renderHistoryList(); document.getElementById('history-overlay').classList.remove('hidden'); toggleMenu(); }
function closeHistory() { document.getElementById('history-overlay').classList.add('hidden'); }
function renderHistoryList() { const div = document.getElementById('tripList'); div.innerHTML = ""; const filterDist = document.getElementById('filter-trip-class').value; savedTrips.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(t => { const dKm = t.distance || 0; if(filterDist==='blue' && dKm>=2) return; if(filterDist==='green' && (dKm<2||dKm>=5)) return; if(filterDist==='orange' && (dKm<5||dKm>=10)) return; if(filterDist==='red' && dKm<10) return; const d = new Date(t.date); let color = dKm<2?'#3498db':dKm<5?'#2ecc71':dKm<10?'#f39c12':'#e74c3c'; div.innerHTML += `<div class="trip-item"><div style="flex-grow:1; cursor:pointer;" onclick="showSingleTrip(${t.id})"><span class="trip-date" style="border-left: 4px solid ${color}; padding-left:5px;">${d.toLocaleDateString()}</span><span class="trip-info">📏 ${(t.distance||0).toFixed(2)}km 🏔️ +${t.elevationGain||0}m</span></div><div style="display:flex;gap:5px;"><button class="btn-graph-trip" style="background:#e67e22;" onclick="startReplay(${t.id})" title="Rejouer le trajet">▶️</button><button class="btn-graph-trip" onclick="openElevationModal(${t.id})">📈</button><button class="btn-delete-trip" style="background:#8e44ad;" onclick="openEditTripModal(${t.id})">✏️</button><button class="btn-delete-trip" onclick="deleteTrip(${t.id})">🗑️</button></div></div>`; }); if(div.innerHTML==="") div.innerHTML="<div style='text-align:center;padding:20px;color:#999;'>Vide</div>"; }

function showSingleTrip(id) { 
    clearMapLayers(); 
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer); 
    const t=savedTrips.find(x=>x.id===id); 
    if(t){ 
        // Pour l'aperçu statique, on utilise une simple polyline de la couleur de distance
        const d = t.distance || 0; 
        const color = d < 2 ? '#3498db' : d < 5 ? '#2ecc71' : d < 10 ? '#f39c12' : '#e74c3c'; 
        // Note: t.points est [lat, lng, alt, speed] mais L.polyline gère ça
        L.polyline(t.points.map(p=>[p[0],p[1]]),{color: color, weight:5}).addTo(tracksLayer); 
        map.fitBounds(L.polyline(t.points.map(p=>[p[0],p[1]])).getBounds()); 
        closeHistory(); 
    } 
}
function showAllTrips() { clearMapLayers(); if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer); savedTrips.forEach(t => { const d = t.distance || 0; const color = d < 2 ? '#3498db' : d < 5 ? '#2ecc71' : d < 10 ? '#f39c12' : '#e74c3c'; L.polyline(t.points.map(p=>[p[0],p[1]]), {color: color, weight:3, opacity:0.8}).addTo(tracksLayer); }); closeHistory(); }
async function deleteTrip(id) { if(confirm("Supprimer ?")) { await deleteFromDB('trips', id); savedTrips = savedTrips.filter(t=>t.id!==id); renderHistoryList(); clearMapLayers(); } }
function clearMapLayers() { tracksLayer.clearLayers(); if(heatLayer) map.removeLayer(heatLayer); if(!document.getElementById('show-parcels-toggle').checked) map.addLayer(markersLayer); }
function openElevationModal(tripId) { const t = savedTrips.find(x => x.id === tripId); if (!t || !t.points || t.points.length < 2) { showToast("Pas de données"); return; } document.getElementById('modal-elevation').classList.remove('hidden'); setTimeout(() => drawElevationProfile(t.points), 100); }
function closeElevationModal() { document.getElementById('modal-elevation').classList.add('hidden'); }
function drawElevationProfile(pts) { const canvas = document.getElementById('elevation-canvas'); const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; ctx.clearRect(0,0,w,h); const alts = pts.map(p => p[2] || 0); const min = Math.min(...alts), max = Math.max(...alts), rng = max - min || 1; document.getElementById('elev-min').innerText = `Min: ${Math.round(min)}m`; document.getElementById('elev-max').innerText = `Max: ${Math.round(max)}m`; ctx.beginPath(); ctx.moveTo(0, h); const step = w / (alts.length - 1); alts.forEach((a, i) => { ctx.lineTo(i * step, h - ((a - min) / rng * (h - 20)) - 10); }); ctx.lineTo(w, h); ctx.closePath(); const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(46,204,113,0.8)"); g.addColorStop(1, "rgba(46,204,113,0.1)"); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#27ae60"; ctx.lineWidth = 2; ctx.stroke(); }

// --- REPLAY ARC-EN-CIEL ---
var replayTimer = null; var replayMarker = null; var replayTraceLayer = null; var replayBgPolyline = null;

function startReplay(tripId) { 
    const t = savedTrips.find(x => x.id === tripId); 
    if (!t || !t.points || t.points.length < 2) { showToast("Trajet invalide"); return; } 
    closeHistory(); 
    clearMapLayers(); 
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer); 
    document.getElementById('replay-controls').classList.remove('hidden'); 
    toggleMenu(); 
    
    // Trace de fond (grisée)
    replayBgPolyline = L.polyline(t.points.map(p=>[p[0],p[1]]), { color: '#bdc3c7', weight: 4, opacity: 0.5, dashArray: '5, 10' }).addTo(map); 
    map.fitBounds(replayBgPolyline.getBounds(), { padding: [50, 50] }); 
    
    // LayerGroup pour la trace colorée
    if (replayTraceLayer) map.removeLayer(replayTraceLayer);
    replayTraceLayer = L.layerGroup().addTo(map);
    
    const startPt = t.points[0]; 
    const hikerIcon = L.divIcon({ className: 'hiker-icon-marker', html: '🚶', iconSize: [30, 30], iconAnchor: [15, 28] }); 
    replayMarker = L.marker([startPt[0], startPt[1]], { icon: hikerIcon, zIndexOffset: 1000 }).addTo(map); 
    
    const TARGET_DURATION = 20000; 
    const totalPoints = t.points.length; 
    let delay = TARGET_DURATION / totalPoints; 
    let stepIncrement = 1; 
    const MIN_DELAY = 15; 
    if (delay < MIN_DELAY) { stepIncrement = Math.ceil(MIN_DELAY / delay); delay = MIN_DELAY; } 
    
    let i = 0; 
    function nextStep() { 
        if (i >= t.points.length) { 
            stopReplay(); 
            showToast("Replay terminé ! 🏁"); 
            triggerHaptic('success'); 
            return; 
        } 
        
        const pt = t.points[i]; 
        const latLng = [pt[0], pt[1]]; 
        
        // Déplacement du marcheur
        replayMarker.setLatLng(latLng); 
        
        // Dessin du segment coloré (Arc-en-ciel)
        if (i > 0) {
            // On cherche le point précédent dessiné
            let prevIndex = i - stepIncrement;
            if (prevIndex < 0) prevIndex = 0;
            
            const prevPt = t.points[prevIndex];
            
            // On récupère la vitesse (index 3) du point actuel. 
            // Si pas de vitesse (vieux trajets), ça renvoie undefined -> Bleu.
            const speed = pt[3]; 
            const color = getSpeedColor(speed);
            
            L.polyline([[prevPt[0], prevPt[1]], latLng], {
                color: color, 
                weight: 5, 
                opacity: 0.9,
                lineCap: 'round'
            }).addTo(replayTraceLayer);
        }
        
        i += stepIncrement; 
        replayTimer = setTimeout(nextStep, delay); 
    } 
    nextStep(); 
}

function stopReplay() { 
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; } 
    document.getElementById('replay-controls').classList.add('hidden'); 
    if (replayMarker) { map.removeLayer(replayMarker); replayMarker = null; } 
    if (replayBgPolyline) { map.removeLayer(replayBgPolyline); replayBgPolyline = null; } 
    if (replayTraceLayer) { map.removeLayer(replayTraceLayer); replayTraceLayer = null; } 
    if (!document.getElementById('show-parcels-toggle').checked) map.addLayer(markersLayer); 
}

// ============================================================
// --- 8. POINTS (AVEC POP ANIMATION) ---
// ============================================================
function updateModalEnvInfo() { currentEnv.fullString = `${currentEnv.weather} ${currentEnv.temp!="--"?currentEnv.temp+"°C":""} • ${currentEnv.moon}`; const el1 = document.getElementById('point-env-info'), el2 = document.getElementById('history-env-info'); if(el1) el1.innerText = "Conditions : " + currentEnv.fullString; if(el2) el2.innerText = "Météo : " + currentEnv.fullString; }
function openModal() { updateModalEnvInfo(); document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); tempImportedPhoto = null; }
async function confirmAddPoint() { const newPoint = { id:Date.now(), lat:tempLatLng.lat, lng:tempLatLng.lng, note:document.getElementById('input-note').value, emoji:document.getElementById('input-emoji').value||"📍", date:new Date().toLocaleDateString(), weather:currentEnv.fullString, history:[] }; await saveToDB('points', newPoint); savedPoints.push(newPoint); updateYearFilterOptions(); refreshMap(); closeModal(); showToast("Point ajouté !"); }

function refreshMap() { 
    markersLayer.clearLayers(); 
    
    savedPoints.forEach((p, i) => { 
        // Filtres (inchangés)
        if (isIntruderMode && SECRET_EMOJIS.includes(p.emoji)) return; 
        if (currentFilterEmoji && p.emoji !== currentFilterEmoji) return; 
        if (currentFilterText && !p.note.toLowerCase().includes(currentFilterText)) return; 
        if (currentFilterYear !== 'all' && p.date.split('/')[2].substring(0,4) !== currentFilterYear) return; 
        if (currentFilterMonth !== 'all' && parseInt(p.date.split('/')[1]) !== parseInt(currentFilterMonth)) return; 

        // --- MAGIE DU POP ---
        // On calcule un petit délai aléatoire entre 0s et 0.3s
        const delay = Math.random() * 0.3; 
        
        // On crée le HTML avec la nouvelle classe "marker-bubble" et le délai
        const customHtml = `<div class="marker-bubble" style="animation-delay: ${delay}s">${p.emoji}</div>`;

        L.marker([p.lat, p.lng], { 
            icon: L.divIcon({
                className: 'emoji-icon', // Classe vide (juste conteneur Leaflet)
                html: customHtml,        // Notre bulle animée dedans
                iconSize: [34, 34],      // Taille légèrement ajustée
                iconAnchor: [17, 17]     // Centré
            }) 
        }).bindPopup(`<div style="text-align:center;"><b style="font-size:14px;">${p.emoji} ${p.note}</b><br><span style="font-size:11px; color:#555;">📅 ${p.date}</span><br><small style="color:#8e44ad; font-weight:bold;">${p.weather||""}</small><br><small style="color:#666;">${p.history?p.history.length:0} entrées carnet</small><div style="margin-top:8px; display:flex; flex-direction:column; gap:5px;"><a href="http://googleusercontent.com/maps.google.com/maps?q=${p.lat},${p.lng}" target="_blank" class="popup-btn-go">🚀 Y aller</a><button class="btn-popup-edit" onclick="openEditModal(${i})">📝 Carnet / Modif</button></div></div>`)
        .addTo(markersLayer); 
    }); 

    if(!document.getElementById('show-parcels-toggle').checked && !map.hasLayer(markersLayer)) {
        map.addLayer(markersLayer); 
    }
}

function openEditModal(i) { currentEditingIndex=i; const p=savedPoints[i]; document.getElementById('edit-emoji').value=p.emoji; document.getElementById('edit-note').value=p.note; renderPointHistory(p.history); updateModalEnvInfo(); document.getElementById('modal-edit-point').classList.remove('hidden'); map.closePopup(); }
function openEditTripModal(id) { const t=savedTrips.find(x=>x.id===id); if(t){ currentEditingTripId=id; document.getElementById('edit-trip-note').value=t.note||""; document.getElementById('modal-edit-trip').classList.remove('hidden'); }}
function closeEditTripModal() { document.getElementById('modal-edit-trip').classList.add('hidden'); }
async function confirmSaveTripNote() { if(currentEditingTripId){ const i=savedTrips.findIndex(x=>x.id===currentEditingTripId); if(i>-1){savedTrips[i].note=document.getElementById('edit-trip-note').value; await saveToDB('trips',savedTrips[i]); renderHistoryList(); closeEditTripModal(); showToast("Sauvé");}} }

// ============================================================
// --- 9. UTILS & FILTRES ---
// ============================================================
function getSpeedColor(speedMs) {
    // Conversion m/s vers km/h (si speedMs est null, on considère 0)
    const kmh = (speedMs || 0) * 3.6; 
    
    // ÉCHELLE RANDO
    if (kmh < 1.0) return '#3498db'; // Bleu  : Arrêt (< 1 km/h)
    if (kmh < 3.0) return '#2ecc71'; // Vert  : Marche lente (1 - 3 km/h)
    if (kmh < 5.0) return '#f1c40f'; // Jaune : Marche normale (3 - 5 km/h)
    return '#e74c3c';                // Rouge : Marche rapide (> 5 km/h)
}

function updateYearFilterOptions() { 
    const s = document.getElementById('filter-year'); 
    if (!s) return; // --- FIX : SI L'ELEMENT N'EXISTE PAS, ON ARRÊTE ---
    const cur = s.value; 
    s.innerHTML = '<option value="all">Toutes</option>'; 
    const yrs = new Set(savedPoints.map(p => p.date.split('/')[2].substring(0,4))); 
    Array.from(yrs).sort().reverse().forEach(y => {
        const o = document.createElement('option');
        o.value = y; 
        o.innerText = y; 
        s.appendChild(o);
    }); 
    s.value = cur; 
}

function applyYearFilter(){ currentFilterYear=document.getElementById('filter-year').value; refreshMap(); toggleMenu(); }
function applyMonthFilter(){ currentFilterMonth=document.getElementById('filter-month').value; refreshMap(); toggleMenu(); }
function applyFilter(){ currentFilterEmoji=document.getElementById('filter-input').value.trim(); refreshMap(); toggleMenu(); }
function applyTextFilter(){ currentFilterText=document.getElementById('text-filter-input').value.trim().toLowerCase(); refreshMap(); toggleMenu(); }
function resetFilter(){ currentFilterEmoji=null; currentFilterText=null; currentFilterYear='all'; currentFilterMonth='all'; refreshMap(); toggleMenu(); }
function compressImage(f,w,q){return new Promise((r,j)=>{const d=new FileReader();d.readAsDataURL(f);d.onload=e=>{const i=new Image();i.src=e.target.result;i.onload=()=>{const c=document.createElement('canvas');let wr=i.width,hr=i.height;if(wr>w){hr*=w/wr;wr=w;}c.width=wr;c.height=hr;c.getContext('2d').drawImage(i,0,0,wr,hr);r(c.toDataURL('image/jpeg',q));};};});}
function previewPhotoCount(){const i=document.getElementById('history-photo-input');document.getElementById('photo-status').style.display=i.files&&i.files[0]?'block':'none';}
function renderPointHistory(h){const c=document.getElementById('history-list-container');c.innerHTML="";if(!h||!h.length){c.innerHTML="<small>Vide</small>";return;}for(let i=h.length-1;i>=0;i--){const e=h[i];const w=e.weather?`<div style="font-size:10px;color:#8e44ad;">${e.weather}</div>`:"";c.innerHTML+=`<div class="history-item"><div class="history-header"><span>${e.date}: ${e.text}</span><button class="btn-history-delete-row" onclick="deleteHistoryEntry(${i})">🗑️</button></div>${w}${e.photo?`<img src="${e.photo}" class="history-img-thumb" onclick="viewFullImage(this.src)">`:""}</div>`;}}
function viewFullImage(s){document.getElementById('lightbox-img').src=s;document.getElementById('lightbox-overlay').classList.remove('hidden');}
function closeLightbox(){document.getElementById('lightbox-overlay').classList.add('hidden');}
async function addHistoryToCurrentPoint(){const t=document.getElementById('new-history-entry').value;const p=document.getElementById('history-photo-input');if(!t&&(!p.files||!p.files[0]))return;let ph=null;if(p.files[0])ph=await compressImage(p.files[0],800,0.7);savedPoints[currentEditingIndex].history.push({date:new Date().toLocaleDateString(),text:t,photo:ph,weather:currentEnv.fullString});await saveToDB('points',savedPoints[currentEditingIndex]);renderPointHistory(savedPoints[currentEditingIndex].history);document.getElementById('new-history-entry').value="";p.value="";previewPhotoCount();}
async function deleteHistoryEntry(i){if(confirm("Effacer ?")){savedPoints[currentEditingIndex].history.splice(i,1);await saveToDB('points',savedPoints[currentEditingIndex]);renderPointHistory(savedPoints[currentEditingIndex].history);}}
async function savePointEdits(){if(currentEditingIndex>-1){savedPoints[currentEditingIndex].emoji=document.getElementById('edit-emoji').value;savedPoints[currentEditingIndex].note=document.getElementById('edit-note').value;await saveToDB('points',savedPoints[currentEditingIndex]);refreshMap();document.getElementById('modal-edit-point').classList.add('hidden');}}
function deleteCurrentPoint(){ if(confirm("Voulez-vous vraiment supprimer ce point définitivement ?")) { deletePoint(currentEditingIndex); document.getElementById('modal-edit-point').classList.add('hidden'); } }
async function deletePoint(i){await deleteFromDB('points',savedPoints[i].id);savedPoints.splice(i,1);refreshMap();}
function exportData(){const d={points:savedPoints,trips:savedTrips,parcels:savedParcels};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'}));a.download='Begole_Backup.json';a.click();}

// =========================================
// --- FONCTION DE SELECTION AVATAR ---
// =========================================
function initAvatarSelection() {
    document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
    const el = document.getElementById('av-' + currentAvatar);
    if(el) el.classList.add('selected');
}

function setAvatar(type) {
    currentAvatar = type;
    localStorage.setItem('begole_avatar', type);
    
    // Mise à jour visuelle du menu
    document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
    document.getElementById('av-' + type).classList.add('selected');
    
    // Force la mise à jour immédiate du marqueur si on a une position
    if (userMarker) {
        const ll = userMarker.getLatLng();
        // On relance la création du marqueur avec les mêmes coordonnées
        map.removeLayer(userMarker);
        userMarker = null;
        let acc = userAccuracyCircle ? userAccuracyCircle.getRadius() : 20;
        updateUserMarker(ll.lat, ll.lng, acc, 0); 
    }
    showToast("Avatar changé !");
}

// --- FONCTION D'IMPORT CORRIGÉE (RESTAURO AUSSI LES TRAJETS) ---
function importData(i) {
    const f = new FileReader();
    f.onload = async e => {
        try {
            const d = JSON.parse(e.target.result);

            // 1. Importer les Points
            if (d.points && Array.isArray(d.points)) {
                for (let p of d.points) {
                    if (!p.id) p.id = Date.now() + Math.random();
                    await saveToDB('points', p);
                }
            }

            // 2. Importer les Trajets (C'est ce qui manquait !)
            if (d.trips && Array.isArray(d.trips)) {
                for (let t of d.trips) {
                    if (!t.id) t.id = Date.now() + Math.random();
                    await saveToDB('trips', t);
                }
            }

            // 3. Importer les Parcelles (Cadastre)
            if (d.parcels && Array.isArray(d.parcels)) {
                for (let pa of d.parcels) {
                    if (!pa.id) pa.id = Date.now() + Math.random();
                    await saveToDB('parcels', pa);
                }
            }

            showToast("✅ Données restaurées avec succès !");
            setTimeout(() => location.reload(), 1000); 

        } catch (err) {
            alert("Erreur lors de l'importation : " + err);
        }
    };
    f.readAsText(i.files[0]);
}

function toggleLocation(){const b=document.getElementById('btn-loc');if(trackWatchId){navigator.geolocation.clearWatch(trackWatchId);trackWatchId=null;b.innerHTML="📍 Pos. Off";if(userMarker)map.removeLayer(userMarker);}else{b.innerHTML="🛑 Stop";trackWatchId=navigator.geolocation.watchPosition(p=>updateUserMarker(p.coords.latitude,p.coords.longitude,p.coords.accuracy,p.coords.heading),e=>{},{enableHighAccuracy:true});}}

// --- FONCTION DE MARQUEUR MISE À JOUR (AVATAR) ---
function updateUserMarker(lat, lng, acc, h) {
    // 1. Définition de l'icône selon l'avatar choisi
    const avatars = {
        'man': '🚶',
        'boar': '🐗',
        'deer': '🦌',
        'bird': '🦅'
    };
    const iconChar = avatars[currentAvatar] || '🚶';
    
    // 2. Choix de l'animation
    // La buse vole tout le temps, les autres marchent
    let animClass = (currentAvatar === 'bird') ? 'anim-fly' : 'anim-walk';
    
    // ASTUCE : Orientation gauche/droite
    // Les émojis regardent souvent vers la GAUCHE par défaut.
    // Si on va vers l'Est (h entre 0 et 180), on inverse l'image (scaleX(-1))
    // Note : Si h est null (pas de boussole), on laisse par défaut.
    let flipStyle = "";
    if (h !== null && h !== undefined) {
        // Si cap vers l'Est (droite), on retourne l'émoji pour qu'il regarde devant
        if (h > 0 && h < 180) flipStyle = "transform: scaleX(-1);"; 
    }

    const customIcon = L.divIcon({
        className: 'custom-avatar-wrapper', // Classe vide pour éviter les styles par défaut Leaflet
        // On insère l'émoji dans une div qui porte l'animation
        html: `<div class="user-avatar-marker ${animClass}" style="${flipStyle}">${iconChar}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 30] // Ancré au niveau des pieds
    });

    // 3. Création ou Mise à jour sur la carte
    if (!userMarker) {
        userMarker = L.marker([lat, lng], {icon: customIcon, zIndexOffset: 1000}).addTo(map);
        userAccuracyCircle = L.circle([lat, lng], {radius: acc, color: '#3498db', fillOpacity: 0.15}).addTo(map);
    } else {
        userMarker.setLatLng([lat, lng]);
        userMarker.setIcon(customIcon); // Important : met à jour l'icône (et donc l'orientation)
        
        if (userAccuracyCircle) {
            userAccuracyCircle.setLatLng([lat, lng]);
            userAccuracyCircle.setRadius(acc);
        }
    }
}

function showToast(m){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className='toast';t.textContent=m;c.appendChild(t);setTimeout(()=>t.classList.add('show'),10);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},3000);}
function triggerHaptic(t){if(navigator.vibrate)try{navigator.vibrate(t==='radar'?[100,50,100]:(t==='success'?50:200));}catch(e){}}
async function clearData(){if(confirm("Tout effacer ?")){await clearStoreDB('points');await clearStoreDB('parcels');await clearStoreDB('trips');location.reload();}}
function showStats(){ let tD=0, tDur=0, tEl=0; savedTrips.forEach(t=>{ tD+=(t.distance||0); tDur+=(t.duration||0); tEl+=(t.elevationGain||0); }); const spd = tDur>0 ? tD/(tDur/3600000) : 0; let html = `<div class="stats-summary"><div class="stat-card"><span class="stat-value">${savedTrips.length}</span><span class="stat-label">Trajets</span></div><div class="stat-card"><span class="stat-value">${tD.toFixed(1)}</span><span class="stat-label">Km</span></div><div class="stat-card"><span class="stat-value">${spd.toFixed(1)}</span><span class="stat-label">Km/h</span></div><div class="stat-card"><span class="stat-value">${tEl.toFixed(0)}m</span><span class="stat-label">D+</span></div></div><hr style="margin:15px 0;border-top:1px solid var(--border-color);">`; let st={}; savedPoints.forEach(p=>{ st[p.emoji||"?"] = (st[p.emoji||"?"]||0)+1; }); Object.keys(st).sort((a,b)=>st[b]-st[a]).forEach(k => { html += `<div class="stat-row"><span class="stat-emoji">${k}</span><span class="stat-count">${st[k]}</span></div>`; }); if(savedPoints.length === 0) html += "<div style='text-align:center;color:var(--text-sub);'>Aucun point enregistré</div>"; document.getElementById('stats-content').innerHTML = html; document.getElementById('stats-overlay').classList.remove('hidden'); toggleMenu(); }
function closeStats(){document.getElementById('stats-overlay').classList.add('hidden');}
function formatDuration(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h${m}`:`${pad(m)}:${pad(s%60)}`;}
function pad(n){return n<10?'0'+n:n;}
async function requestWakeLock(){try{if('wakeLock'in navigator)wakeLock=await navigator.wakeLock.request('screen');}catch(e){}}
async function releaseWakeLock(){if(wakeLock){await wakeLock.release();wakeLock=null;}}
var lastClick=0; function togglePocketMode(){const e=document.getElementById('pocket-overlay');if(e.classList.contains('hidden-poche')){e.classList.remove('hidden-poche');toggleMenu();}else{if(Date.now()-lastClick<500)e.classList.add('hidden-poche');lastClick=Date.now();}}

// =========================================
// --- 20. GESTION DES LUCIOLES ---
// =========================================
function manageFireflies() {
    const isNight = document.body.classList.contains('theme-dark');
    
    // On cible le NOUVEAU conteneur dédié
    const container = document.getElementById('firefly-overlay');
    if (!container) return;

    // On s'assure que le conteneur a les bonnes propriétés CSS (au cas où)
    container.style.position = 'fixed';
    container.style.top = '0'; 
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '502'; // Juste au-dessus de la pluie (500)

    // A. IL FAIT NUIT : On active les lucioles
    if (isNight) {
        // Vérification : Sont-elles déjà là ? (On évite les doublons)
        if (container.querySelectorAll('.firefly').length > 0) return;

        // On génère 30 lucioles
        for (let i = 0; i < 30; i++) {
            const f = document.createElement('div');
            f.classList.add('firefly');
            
            // Position de départ aléatoire
            f.style.left = Math.random() * 100 + 'vw';
            f.style.top = Math.random() * 100 + 'vh';
            
            // Mouvement aléatoire
            const moveX = (Math.random() * 160 - 80) + 'px';
            const moveY = (Math.random() * 160 - 80) + 'px';
            f.style.setProperty('--moveX', moveX);
            f.style.setProperty('--moveY', moveY);
            
            // Animation décalée et durée variable
            f.style.animationDelay = (Math.random() * -6) + 's'; 
            f.style.animationDuration = (4 + Math.random() * 4) + 's';

            container.appendChild(f);
        }
    
    // B. IL FAIT JOUR : On nettoie
    } else {
        container.innerHTML = '';
    }
}

// =========================================
// --- 22. AMBIANCE SONORE DYNAMIQUE ---
// =========================================
var isSoundActive = false;
var currentAudioTrack = null;

const audioTracks = {
    day: new Audio('sound_day.mp3'),
    rain: new Audio('sound_rain.mp3'),
    night: new Audio('sound_night.mp3')
};

Object.values(audioTracks).forEach(a => {
    a.loop = true;
    a.volume = 0; 
});

function toggleSoundscape() {
    isSoundActive = !isSoundActive;
    const btn = document.getElementById('btn-sound');
    
    // --- SAUVEGARDE L'ÉTAT ---
    localStorage.setItem('begole_sound_pref', isSoundActive); 

    if (isSoundActive) {
        if(btn) {
            btn.style.background = "#e67e22"; 
            btn.querySelector('.grid-icon').innerText = "🔊";
        }
        showToast("🔈 Ambiance activée...");
        checkAndPlayAmbiance(); 
    } else {
        if(btn) {
            btn.style.background = "#34495e";
            btn.querySelector('.grid-icon').innerText = "🔇";
        }
        stopAllSounds();
    }
}

function checkAndPlayAmbiance() {
    if (!isSoundActive) return;

    let targetTrack = 'day'; 
    const isNight = document.body.classList.contains('theme-dark');
    const weatherText = currentEnv.weather ? currentEnv.weather.toLowerCase() : "";
    const isRaining = weatherText.includes('pluie') || weatherText.includes('averse') || weatherText.includes('orage');

    if (isNight) {
        targetTrack = 'night';
    } else if (isRaining) {
        targetTrack = 'rain';
    }

    playTrack(targetTrack);
}

function playTrack(trackName) {
    const newAudio = audioTracks[trackName];
    if (currentAudioTrack === newAudio && !newAudio.paused) return;

    if (currentAudioTrack) {
        const oldTrack = currentAudioTrack;
        let fadeOut = setInterval(() => {
            if (oldTrack.volume > 0.1) {
                oldTrack.volume -= 0.1;
            } else {
                oldTrack.pause();
                oldTrack.volume = 0;
                clearInterval(fadeOut);
            }
        }, 100);
    }

    currentAudioTrack = newAudio;
    newAudio.play().then(() => {
        let fadeIn = setInterval(() => {
            if (newAudio.volume < 0.5) { 
                newAudio.volume += 0.05;
            } else {
                clearInterval(fadeIn);
            }
        }, 100);
    }).catch(e => {
        console.log("Erreur lecture audio : " + e);
    });
}

function stopAllSounds() {
    Object.values(audioTracks).forEach(a => {
        a.pause();
        a.currentTime = 0;
    });
    currentAudioTrack = null;
}

// =========================================
// --- 23. GESTION DES NUAGES ---
// =========================================
function toggleClouds() {
    const isActive = document.getElementById('clouds-toggle').checked;
    
    // --- SAUVEGARDE ---
    localStorage.setItem('begole_clouds_pref', isActive);

    const container = document.getElementById('cloud-overlay');
    if (!container) return;

    if (isActive) {
        container.classList.add('active');
        if (container.children.length > 0) return;

        for (let i = 0; i < 8; i++) {
            const c = document.createElement('div');
            c.classList.add('cloud');
            const size = 150 + Math.random() * 300; 
            c.style.width = size + 'px';
            c.style.height = (size * 0.6) + 'px'; 
            c.style.top = (Math.random() * 80 - 10) + 'vh'; 
            const duration = 30 + Math.random() * 40; 
            c.style.animationDuration = duration + 's';
            c.style.animationDelay = (Math.random() * -50) + 's';
            container.appendChild(c);
        }
    } else {
        container.classList.remove('active');
        setTimeout(() => {
            if(!document.getElementById('clouds-toggle').checked) {
                container.innerHTML = '';
            }
        }, 2000);
    }
}

// =========================================
// --- 24. GESTION DU MODE NUIT PROFONDE ---
// =========================================
function toggleDeepNight() {
    const isActive = document.getElementById('deep-night-toggle').checked;
    
    // Sauvegarde de la préférence
    localStorage.setItem('begole_deep_night_pref', isActive);

    if (isActive) {
        document.body.classList.add('deep-night-active');
        showToast("🌑 Mode Nuit Profonde activé");
    } else {
        document.body.classList.remove('deep-night-active');
    }
}

// =========================================
// --- 25. GESTION DU POLLEN (JOUR) ---
// =========================================
function managePollen() {
    const container = document.getElementById('pollen-overlay');
    if (!container) return;

    // 1. Conditions : Il doit faire JOUR et BEAU (pas de pluie/neige)
    const isNight = document.body.classList.contains('theme-dark');
    const weatherText = currentEnv.weather ? currentEnv.weather.toLowerCase() : "";
    const isRaining = weatherText.includes('pluie') || weatherText.includes('averse') || weatherText.includes('orage') || weatherText.includes('neige');

    // S'il fait jour et sec
    if (!isNight && !isRaining) {
        // Si déjà généré, on ne fait rien
        if (container.children.length > 0) return;

        // Génération de 40 particules
        for (let i = 0; i < 40; i++) {
            const p = document.createElement('div');
            p.classList.add('pollen');
            
            // Position aléatoire sur tout l'écran
            p.style.left = Math.random() * 100 + 'vw';
            p.style.top = Math.random() * 100 + 'vh';
            
            // Dérive latérale aléatoire (-50px à +50px) pour pas qu'elles montent tout droit
            const drift = (Math.random() * 100 - 50) + 'px';
            p.style.setProperty('--drift', drift);
            
            // Vitesse lente et variée (5s à 15s)
            p.style.animationDuration = (5 + Math.random() * 10) + 's';
            
            // Délai négatif pour qu'elles soient déjà là au lancement
            p.style.animationDelay = (Math.random() * -15) + 's';
            
            container.appendChild(p);
        }
    } else {
        // S'il pleut ou fait nuit, on nettoie
        container.innerHTML = '';
    }
}

// --- 11. SUCCES (VERSION CORRIGÉE & SÉCURISÉE) ---
function showAchievements() { 
    try {
        const content = document.getElementById('achievements-content'); 
        if(!content) { console.error("Err: Div achievements-content manquante"); return; }
        
        content.innerHTML = ""; 
        
        // Sécurisation des données
        const safePoints = Array.isArray(savedPoints) ? savedPoints : [];
        const safeTrips = Array.isArray(savedTrips) ? savedTrips : [];

        const totalPoints = safePoints.length; 
        const totalTrips = safeTrips.length; 
        
        // Calculs sécurisés
        const totalDist = safeTrips.reduce((acc, t) => acc + (t && t.distance ? t.distance : 0), 0); 
        const totalElevation = safeTrips.reduce((acc, t) => acc + (t && t.elevationGain ? t.elevationGain : 0), 0); 
        
        const totalPhotos = safePoints.reduce((acc, p) => {
            if(!p) return acc;
            const hist = Array.isArray(p.history) ? p.history : [];
            return acc + hist.filter(h => h && h.photo).length;
        }, 0); 
        
        const totalHistory = safePoints.reduce((acc, p) => {
            if(!p) return acc;
            return acc + (Array.isArray(p.history) ? p.history.length : 0);
        }, 0); 

        let daysSinceStart = 0; 
        if (totalPoints > 0) { 
            // On filtre les points invalides pour le min
            const validIds = safePoints.map(p => p ? p.id : Date.now()).filter(id => id);
            const firstDate = new Date(Math.min(...validIds)); 
            daysSinceStart = (Date.now() - firstDate) / (1000 * 60 * 60 * 24); 
        } 
        
        const badges = [ 
            { id: 'start', icon: '🌱', title: 'Premiers Pas', desc: '1er point enregistré', check: () => totalPoints >= 1 }, 
            { id: 'walker', icon: '🥾', title: 'Promeneur', desc: '10 km parcourus', check: () => totalDist >= 10 }, 
            { id: 'paparazzi', icon: '📷', title: 'Paparazzi', desc: '5 photos prises', check: () => totalPhotos >= 5 }, 
            { id: 'collec', icon: '🍄', title: 'Collectionneur', desc: '50 points trouvés', check: () => totalPoints >= 50 }, 
            { id: 'master', icon: '🧙', title: 'Grand Sage', desc: '100 points trouvés', check: () => totalPoints >= 100 }, 
            { id: 'ecureuil', icon: '🌰', title: 'Écureuil', desc: '20 trouvailles (Cèpes, Châtaignes...)', check: () => safePoints.filter(p => p && p.emoji && ["🍄","🌰","🍂"].includes(p.emoji)).length >= 20 }, 
            { id: 'marathon', icon: '🏃', title: 'Marathonien', desc: '42 km cumulés', check: () => totalDist >= 42 }, 
            { id: 'ultra', icon: '🚀', title: 'Ultra-Trail', desc: '100 km cumulés', check: () => totalDist >= 100 }, 
            { id: 'climber', icon: '⛰️', title: 'Grimpeur', desc: '500m D+ cumulé', check: () => totalElevation >= 500 }, 
            { id: 'sherpa', icon: '🏔️', title: 'Sherpa', desc: '2000m D+ cumulé', check: () => totalElevation >= 2000 }, 
            { id: 'longtrip', icon: '⏱️', title: 'Longue Marche', desc: 'Une rando de plus de 3h', check: () => safeTrips.some(t => t && t.duration > 10800000) }, 
            { id: 'earlybird', icon: '🌅', title: 'Lève-tôt', desc: 'Point créé entre 5h et 8h du matin', check: () => safePoints.some(p => { if(!p) return false; const h = new Date(p.id).getHours(); return h >= 5 && h < 8; }) }, 
            { id: 'night', icon: '🦉', title: 'Oiseau de Nuit', desc: 'Sortie nocturne (22h-5h)', check: () => safePoints.some(p => { if(!p) return false; const h = new Date(p.id).getHours(); return h >= 22 || h < 5; }) }, 
            { id: 'rain', icon: '🌧️', title: 'Botte de Pluie', desc: 'Sortie sous la pluie', check: () => safePoints.some(p => p && (p.weather || "").match(/Pluie|Averses|Orage/)) }, 
            { id: 'winter', icon: '❄️', title: 'Yéti', desc: 'Sortie en Hiver (Déc-Fév)', check: () => safePoints.some(p => { if(!p) return false; const m = new Date(p.id).getMonth(); return m === 11 || m === 0 || m === 1; }) }, 
            { id: 'writer', icon: '✍️', title: 'Romancier', desc: '20 notes dans le carnet', check: () => totalHistory >= 20 }, 
            { id: 'veteran', icon: '🎖️', title: 'Vétéran', desc: 'Utilise l\'app depuis 1 an', check: () => daysSinceStart >= 365 }, 
            { id: 'addict', icon: '🔥', title: 'Accro', desc: '50 trajets enregistrés', check: () => totalTrips >= 50 } 
        ]; 
        
        let html = '<div class="achievements-grid">'; 
        let unlockedCount = 0; 
        badges.forEach(b => { 
            const unlocked = b.check(); 
            if(unlocked) unlockedCount++; 
            html += `<div class="badge-card ${unlocked ? 'unlocked' : ''}"><span class="badge-icon">${b.icon}</span><span class="badge-title">${b.title}</span><span class="badge-desc">${b.desc}</span></div>`; 
        }); 
        html += '</div>'; 
        
        const summary = `<div style="text-align:center; margin-bottom:15px; color:#555; font-weight:bold;">🏆 Progression : ${unlockedCount} / ${badges.length} badges<div style="background:#eee; height:8px; border-radius:4px; margin-top:5px; overflow:hidden;"><div style="background:#f1c40f; height:100%; width:${(unlockedCount/badges.length)*100}%"></div></div></div>`; 
        content.innerHTML = summary + html; 
        
        document.getElementById('modal-achievements').classList.remove('hidden'); 
        toggleMenu();
        
    } catch(e) {
        console.error("Erreur Succès : ", e);
        showToast("Erreur d'affichage des succès 😢");
    }
}
function closeAchievements() { document.getElementById('modal-achievements').classList.add('hidden'); }

// --- 12. NIVEAUX & PARTICULES ---
function updateUserLevel() { const totalPoints = savedPoints.length; const totalKm = savedTrips.reduce((acc, t) => acc + (t.distance || 0), 0); const totalHistory = savedPoints.reduce((acc, p) => acc + (p.history ? p.history.length : 0), 0); const xp = Math.floor((totalPoints * 100) + (totalKm * 50) + (totalHistory * 10)); let level = 1; let xpForNext = 500; let xpForCurrent = 0; let increment = 500; while (xp >= xpForNext) { level++; xpForCurrent = xpForNext; increment += 500; xpForNext += increment; } const titles = [ "Vagabond", "Promeneur", "Eclaireur", "Pisteur", "Traqueur", "Aventurier", "Explorateur", "Ranger", "Sentinelle", "Garde-Forestier", "Druide", "Chamane", "Maître des Bois", "Gardien Ancestral", "Ermite Légendaire", "Esprit de la Forêt", "Seigneur Sauvage", "Roi de Bégole", "Demi-Dieu", "Légende Vivante" ]; const titleIndex = Math.min(level - 1, titles.length - 1); const title = titles[titleIndex]; const elTitle = document.getElementById('user-title'); const elLvl = document.getElementById('user-lvl'); const elXpText = document.getElementById('user-xp-text'); const elBar = document.getElementById('user-xp-bar'); if(elTitle) elTitle.innerText = title; if(elLvl) elLvl.innerText = `Niv. ${level}`; const range = xpForNext - xpForCurrent; const currentInLevel = xp - xpForCurrent; const percent = Math.min(100, Math.max(0, (currentInLevel / range) * 100)); if(elXpText) elXpText.innerText = `${Math.round(currentInLevel)} / ${Math.round(range)} XP (Total: ${xp})`; if(elBar) elBar.style.width = `${percent}%`; if (level < 5) elBar.style.background = "#2ecc71"; else if (level < 10) elBar.style.background = "#3498db"; else if (level < 15) elBar.style.background = "#9b59b6"; else elBar.style.background = "linear-gradient(90deg, #f1c40f, #e67e22)"; }
function triggerWeatherEffect(weatherDesc) { const container = document.getElementById('weather-overlay'); if(!container) return; container.innerHTML = ''; document.body.classList.remove('weather-active', 'weather-fading'); container.style.opacity = '1'; if (!weatherDesc) return; const w = weatherDesc.toLowerCase(); let type = null; if (w.includes('pluie') || w.includes('averse') || w.includes('orage')) type = 'rain'; if (w.includes('neige') || w.includes('flocon')) type = 'snow'; if (type) { document.body.classList.add('weather-active'); const count = type === 'rain' ? 50 : 30; for (let i = 0; i < count; i++) { const p = document.createElement('div'); p.classList.add(type); p.style.left = Math.random() * 100 + 'vw'; p.style.animationDuration = (Math.random() * 1 + 0.5) + 's'; if(type === 'snow') { p.style.width = p.style.height = (Math.random() * 5 + 3) + 'px'; p.style.animationDuration = (Math.random() * 3 + 2) + 's'; } container.appendChild(p); } setTimeout(() => { document.body.classList.add('weather-fading'); }, 4000); setTimeout(() => { document.body.classList.remove('weather-active', 'weather-fading'); container.innerHTML = ''; }, 5000); } }

// ============================================================
// --- 14. PLANTNET (API CORRIGÉE & COMPRESSION) ---
// ============================================================
// --- METS TA CLÉ ICI (SANS ESPACES) ---
const PLANTNET_API_KEY = "2b10FAmoTbTZwVvtpZFrsy9su"; 

function openPlantNetModal() { document.getElementById('modal-plantnet').classList.remove('hidden'); document.getElementById('plantnet-results').innerHTML = ""; document.getElementById('plantnet-upload-area').classList.remove('hidden'); document.getElementById('plantnet-loading').classList.add('hidden'); toggleMenu(); }
function closePlantNetModal() { document.getElementById('modal-plantnet').classList.add('hidden'); }
async function handlePlantUpload(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const organ = document.getElementById('plant-organ').value || 'auto';

    document.getElementById('plantnet-upload-area').classList.add('hidden');
    document.getElementById('plantnet-loading').classList.remove('hidden');

    try {
        const compressedDataUrl = await compressImage(file, 1024, 0.6); 
        const res = await fetch(compressedDataUrl);
        const blob = await res.blob();

        const formData = new FormData();
        formData.append('images', blob);
        formData.append('organs', organ); 

        const url = `https://my-api.plantnet.org/v2/identify/all?include-related-images=true&no-reject=false&lang=fr&api-key=${PLANTNET_API_KEY}`;
        
        const response = await fetch(url, { method: 'POST', body: formData });
        
        // --- MODIFICATION POUR LE DIAGNOSTIC ---
        if (!response.ok) {
            const errorText = await response.text(); // On lit le message caché du serveur
            // On nettoie le message pour qu'il soit lisible dans l'alerte
            let cleanError = errorText.replace(/"/g, '').substring(0, 100);
            throw new Error(`Code ${response.status} : ${cleanError}`);
        }
        // ---------------------------------------
        
        const data = await response.json();
        
        document.getElementById('plantnet-loading').classList.add('hidden');
        document.getElementById('plantnet-results').classList.remove('hidden');
        
        if (data.results && data.results.length > 0) { 
            displayPlantResults(data.results); 
        } else { 
            document.getElementById('plantnet-results').innerHTML = "<p>🌱 Aucune plante reconnue.<br>Essaie de te rapprocher.</p><button onclick='openPlantNetModal()' class='btn-confirm'>Réessayer</button>"; 
        }

    } catch (error) { 
        console.error(error); 
        document.getElementById('plantnet-loading').classList.add('hidden');
        document.getElementById('plantnet-upload-area').classList.remove('hidden');
        // Affiche le vrai message d'erreur à l'écran
        alert("🚨 ERREUR DÉTECTÉE :\n" + error.message); 
    }
    input.value = "";
}

function displayPlantResults(results) { const container = document.getElementById('plantnet-results'); container.innerHTML = "<h4 style='margin:0 0 10px 0;'>Résultats probables :</h4>"; const top3 = results.slice(0, 3); top3.forEach(res => { const scorePct = Math.round(res.score * 100); const scientificName = res.species.scientificNameWithoutAuthor; const commonName = (res.species.commonNames && res.species.commonNames.length > 0) ? res.species.commonNames[0] : scientificName; const refImage = (res.images && res.images.length > 0) ? res.images[0].url.m : ""; const html = `<div class="plant-result-card">${refImage ? `<img src="${refImage}" class="plant-thumb">` : ""}<div class="plant-info"><span class="plant-name">${commonName}</span><span class="plant-sci">${scientificName}</span><div class="score-container"><div class="score-bar" style="width:${scorePct}%"></div></div><small style="color:${scorePct>80?'green':'orange'}">${scorePct}% de confiance</small><br><button class="btn-add-plant" onclick="addIdentifiedPlant('${commonName.replace(/'/g, "\\'")}')">📍 Ajouter à la carte</button></div></div>`; container.innerHTML += html; }); container.innerHTML += "<button onclick='openPlantNetModal()' style='width:100%; margin-top:10px; padding:10px;'>🔄 Nouvelle Photo</button>"; }
function addIdentifiedPlant(plantName) { closePlantNetModal(); if(userMarker) { tempLatLng = userMarker.getLatLng(); } else { tempLatLng = map.getCenter(); showToast("Point placé au centre de l'écran"); } openModal(); document.getElementById('input-emoji').value = "🌿"; document.getElementById('input-note').value = plantName; }

// ============================================================
// --- 18. GUIDE DU PISTEUR ---
// ============================================================
const animalTracks = [ { name: "Sanglier", icon: "🐗", desc: "Deux gros sabots + deux 'gardes' marqués à l'arrière. Lourd.", size: "6 - 9 cm" }, { name: "Chevreuil", icon: "🦌", desc: "Sabots fins en cœur ❤️. Les gardes ne marquent que dans la boue.", size: "4 - 5 cm" }, { name: "Renard", icon: "🦊", desc: "Forme ovale. 4 doigts. Les griffes sont visibles.", size: "5 cm" }, { name: "Blaireau", icon: "🦡", desc: "5 doigts alignés (petite main d'ours). Longues griffes.", size: "5 - 7 cm" }, { name: "Lièvre / Lapin", icon: "🐇", desc: "Déplacement en 'Y'. Grandes pattes arrière devant.", size: "Variable" }, { name: "Chien", icon: "🐕", desc: "Pattes rondes, 4 doigts. Moins symétrique que le renard.", size: "Variable" }, { name: "Oiseau", icon: "🐦", desc: "3 doigts devant, 1 derrière.", size: "Petit" }, { name: "Écureuil", icon: "🐿️", desc: "4 doigts avant, 5 arrière. Au pied des arbres.", size: "3 - 4 cm" } ];
function openPisteur() { const grid = document.getElementById('pisteur-grid'); grid.innerHTML = ""; animalTracks.forEach(t => { const html = `<div class="track-card"><div class="track-icon">${t.icon}</div><div class="track-name">${t.name}</div><div class="track-desc">${t.desc}</div><div class="track-size">📏 ${t.size}</div></div>`; grid.innerHTML += html; }); document.getElementById('modal-pisteur').classList.remove('hidden'); toggleMenu(); }
function closePisteur() { document.getElementById('modal-pisteur').classList.add('hidden'); }

// ============================================================
// --- 19. SHAKE TO POINT ---
// ============================================================
var lastShakeX = 0, lastShakeY = 0, lastShakeZ = 0; var lastShakeTime = 0; const SHAKE_THRESHOLD = 25; 
function initShakeListener() { if (window.DeviceMotionEvent) { window.addEventListener('devicemotion', handleShake, false); } }
function handleShake(e) { var acc = e.accelerationIncludingGravity; if (!acc) return; var currTime = Date.now(); if ((currTime - lastShakeTime) > 2000) { var diff = Math.abs(acc.x + acc.y + acc.z - lastShakeX - lastShakeY - lastShakeZ); if (diff > SHAKE_THRESHOLD) { triggerShakeAction(); lastShakeTime = currTime; } lastShakeX = acc.x; lastShakeY = acc.y; lastShakeZ = acc.z; } }
function triggerShakeAction() { triggerHaptic('success'); if (userMarker) { tempLatLng = userMarker.getLatLng(); } else { tempLatLng = map.getCenter(); showToast("⚠️ GPS non fixé : Point au centre"); } openModal(); document.getElementById('input-emoji').value = "📍"; document.getElementById('input-note').value = "Point Shake 🫨"; showToast("📍 Shake ! Nouveau point créé."); }

// =========================================
// --- 20. GESTION DES LUCIOLES ---
// =========================================
function manageFireflies() {
    const isNight = document.body.classList.contains('theme-dark');
    
    // On cible le NOUVEAU conteneur dédié
    const container = document.getElementById('firefly-overlay');
    if (!container) return;

    // On s'assure que le conteneur a les bonnes propriétés CSS (au cas où)
    container.style.position = 'fixed';
    container.style.top = '0'; 
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '502'; // Juste au-dessus de la pluie (500)

    // A. IL FAIT NUIT : On active les lucioles
    if (isNight) {
        // Vérification : Sont-elles déjà là ? (On évite les doublons)
        if (container.querySelectorAll('.firefly').length > 0) return;

        // On génère 30 lucioles
        for (let i = 0; i < 30; i++) {
            const f = document.createElement('div');
            f.classList.add('firefly');
            
            // Position de départ aléatoire
            f.style.left = Math.random() * 100 + 'vw';
            f.style.top = Math.random() * 100 + 'vh';
            
            // Mouvement aléatoire
            const moveX = (Math.random() * 160 - 80) + 'px';
            const moveY = (Math.random() * 160 - 80) + 'px';
            f.style.setProperty('--moveX', moveX);
            f.style.setProperty('--moveY', moveY);
            
            // Animation décalée et durée variable
            f.style.animationDelay = (Math.random() * -6) + 's'; 
            f.style.animationDuration = (4 + Math.random() * 4) + 's';

            container.appendChild(f);
        }
    
    // B. IL FAIT JOUR : On nettoie
    } else {
        container.innerHTML = '';
    }
}

// =========================================
// --- 22. AMBIANCE SONORE DYNAMIQUE ---
// =========================================
var isSoundActive = false;
var currentAudioTrack = null;

Object.values(audioTracks).forEach(a => {
    a.loop = true;
    a.volume = 0; 
});

function toggleSoundscape() {
    isSoundActive = !isSoundActive;
    const btn = document.getElementById('btn-sound');
    
    // --- SAUVEGARDE L'ÉTAT ---
    localStorage.setItem('begole_sound_pref', isSoundActive); 

    if (isSoundActive) {
        if(btn) {
            btn.style.background = "#e67e22"; 
            btn.querySelector('.grid-icon').innerText = "🔊";
        }
        showToast("🔈 Ambiance activée...");
        checkAndPlayAmbiance(); 
    } else {
        if(btn) {
            btn.style.background = "#34495e";
            btn.querySelector('.grid-icon').innerText = "🔇";
        }
        stopAllSounds();
    }
}

function checkAndPlayAmbiance() {
    if (!isSoundActive) return;

    let targetTrack = 'day'; 
    const isNight = document.body.classList.contains('theme-dark');
    const weatherText = currentEnv.weather ? currentEnv.weather.toLowerCase() : "";
    const isRaining = weatherText.includes('pluie') || weatherText.includes('averse') || weatherText.includes('orage');

    if (isNight) {
        targetTrack = 'night';
    } else if (isRaining) {
        targetTrack = 'rain';
    }

    playTrack(targetTrack);
}

function playTrack(trackName) {
    const newAudio = audioTracks[trackName];
    if (currentAudioTrack === newAudio && !newAudio.paused) return;

    if (currentAudioTrack) {
        const oldTrack = currentAudioTrack;
        let fadeOut = setInterval(() => {
            if (oldTrack.volume > 0.1) {
                oldTrack.volume -= 0.1;
            } else {
                oldTrack.pause();
                oldTrack.volume = 0;
                clearInterval(fadeOut);
            }
        }, 100);
    }

    currentAudioTrack = newAudio;
    newAudio.play().then(() => {
        let fadeIn = setInterval(() => {
            if (newAudio.volume < 0.5) { 
                newAudio.volume += 0.05;
            } else {
                clearInterval(fadeIn);
            }
        }, 100);
    }).catch(e => {
        console.log("Erreur lecture audio : " + e);
    });
}

function stopAllSounds() {
    Object.values(audioTracks).forEach(a => {
        a.pause();
        a.currentTime = 0;
    });
    currentAudioTrack = null;
}

// =========================================
// --- 23. GESTION DES NUAGES ---
// =========================================
function toggleClouds() {
    const isActive = document.getElementById('clouds-toggle').checked;
    
    // --- SAUVEGARDE ---
    localStorage.setItem('begole_clouds_pref', isActive);

    const container = document.getElementById('cloud-overlay');
    if (!container) return;

    if (isActive) {
        container.classList.add('active');
        if (container.children.length > 0) return;

        for (let i = 0; i < 8; i++) {
            const c = document.createElement('div');
            c.classList.add('cloud');
            const size = 150 + Math.random() * 300; 
            c.style.width = size + 'px';
            c.style.height = (size * 0.6) + 'px'; 
            c.style.top = (Math.random() * 80 - 10) + 'vh'; 
            const duration = 30 + Math.random() * 40; 
            c.style.animationDuration = duration + 's';
            c.style.animationDelay = (Math.random() * -50) + 's';
            container.appendChild(c);
        }
    } else {
        container.classList.remove('active');
        setTimeout(() => {
            if(!document.getElementById('clouds-toggle').checked) {
                container.innerHTML = '';
            }
        }, 2000);
    }
}

// =========================================
// --- 24. GESTION DU MODE NUIT PROFONDE ---
// =========================================
function toggleDeepNight() {
    const isActive = document.getElementById('deep-night-toggle').checked;
    
    // Sauvegarde de la préférence
    localStorage.setItem('begole_deep_night_pref', isActive);

    if (isActive) {
        document.body.classList.add('deep-night-active');
        showToast("🌑 Mode Nuit Profonde activé");
    } else {
        document.body.classList.remove('deep-night-active');
    }
}

// =========================================
// --- 25. GESTION DU POLLEN (JOUR) ---
// =========================================
function managePollen() {
    const container = document.getElementById('pollen-overlay');
    if (!container) return;

    // 1. Conditions : Il doit faire JOUR et BEAU (pas de pluie/neige)
    const isNight = document.body.classList.contains('theme-dark');
    const weatherText = currentEnv.weather ? currentEnv.weather.toLowerCase() : "";
    const isRaining = weatherText.includes('pluie') || weatherText.includes('averse') || weatherText.includes('orage') || weatherText.includes('neige');

    // S'il fait jour et sec
    if (!isNight && !isRaining) {
        // Si déjà généré, on ne fait rien
        if (container.children.length > 0) return;

        // Génération de 40 particules
        for (let i = 0; i < 40; i++) {
            const p = document.createElement('div');
            p.classList.add('pollen');
            
            // Position aléatoire sur tout l'écran
            p.style.left = Math.random() * 100 + 'vw';
            p.style.top = Math.random() * 100 + 'vh';
            
            // Dérive latérale aléatoire (-50px à +50px) pour pas qu'elles montent tout droit
            const drift = (Math.random() * 100 - 50) + 'px';
            p.style.setProperty('--drift', drift);
            
            // Vitesse lente et variée (5s à 15s)
            p.style.animationDuration = (5 + Math.random() * 10) + 's';
            
            // Délai négatif pour qu'elles soient déjà là au lancement
            p.style.animationDelay = (Math.random() * -15) + 's';
            
            container.appendChild(p);
        }
    } else {
        // S'il pleut ou fait nuit, on nettoie
        container.innerHTML = '';
    }
}

// --- DÉMARRAGE DE L'APPLICATION ---
async function startApp() {
    await initDB();
    
    // Récupération des données existantes (ancien format localStorage vers IndexedDB)
    const oldP = localStorage.getItem('myMapPoints');
    if (oldP) { try { const parsed = JSON.parse(oldP); const existing = await loadAllFromDB('points'); if (existing.length === 0) { for (let p of parsed) { if(!p.id) p.id = Date.now() + Math.random(); await saveToDB('points', p); } } localStorage.removeItem('myMapPoints'); } catch(e) {} }
    
    // Chargement des données
    savedPoints = await loadAllFromDB('points'); 
    savedParcels = await loadAllFromDB('parcels'); 
    savedTrips = await loadAllFromDB('trips');
    
    await cleanDuplicates();
    
    // Initialisation Interface
    updateYearFilterOptions(); 
    refreshMap(); 
    displayParcels(); 
    checkCrashRecovery(); 
    updateAstroWidget(); 
    updateWeatherWidget(); 
    updateUserLevel(); 
    initAvatarSelection(); 
    initShakeListener();

    // --- RESTAURATION DES PRÉFÉRENCES UTILISATEUR ---
    
    // 1. Nuages
    if (localStorage.getItem('begole_clouds_pref') === 'true') {
        const cloudToggle = document.getElementById('clouds-toggle');
        if (cloudToggle) {
            cloudToggle.checked = true;
            toggleClouds(); // Lance l'effet visuel
        }
    }

    // 2. Son (Note : Les navigateurs bloquent parfois le son automatique sans clic)
    if (localStorage.getItem('begole_sound_pref') === 'true') {
        // On appelle la fonction qui va activer la variable et mettre le bouton en orange
        toggleSoundscape(); 
    }
}
startApp();

// --- ENREGISTREMENT PWA (SERVICE WORKER) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker enregistré !', reg))
            .catch(err => console.log('Erreur SW :', err));
    });
}