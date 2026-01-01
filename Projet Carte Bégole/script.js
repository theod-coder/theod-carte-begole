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

// --- Frontières Village (ACTIVÉES PAR DÉFAUT) ---
var villageLayer = null;
fetch('village.json').then(r => r.json()).then(data => {
    villageLayer = L.geoJSON(data, { 
        style: { color: '#ff3333', weight: 4, opacity: 0.9, fillOpacity: 0.05, dashArray: '10, 10' } 
    });
    villageLayer.addTo(map);
}).catch(e => console.log("Note: Pas de fichier village.json détecté"));


// ============================================================
// --- 2. VARIABLES GLOBALES ---
// ============================================================
var savedPoints = [], savedParcels = [], savedTrips = [];

// Calques Leaflet
var markersLayer = L.layerGroup().addTo(map);
var tracksLayer = L.layerGroup().addTo(map);
var parcelsLayer = L.layerGroup(); 
var heatLayer = null; 

// Tracking & Boussole & Radar
var isTracking = false, trackWatchId = null; 
var currentPath = [], currentStartTime = null, currentDistance = 0, currentPolyline = null;
var timerInterval = null, wakeLock = null;
var isCompassMode = false;
var isRadarActive = false, alertedPoints = new Set(); 

// Filtres & UI
var currentFilterEmoji = null, currentFilterText = null, currentFilterYear = 'all', currentFilterMonth = 'all'; 
var isAutoCentering = true, isCadastreMode = false, currentParcelGeoJSON = null, selectedParcelColor = '#95a5a6'; 
var tempLatLng = null, currentEditingIndex = -1, currentEditingTripId = null;
var userMarker = null, userAccuracyCircle = null;

// --- DONNÉES ENVIRONNEMENT (LIVE) ---
var currentEnv = {
    moon: "",       // Ex: "🌔 Gibbeuse 78%"
    temp: "--",     // Ex: 12
    weather: "",    // Ex: "🌧️ Pluie"
    fullString: ""  // Chaîne complète
};


// ============================================================
// --- 3. GESTION DE LA BASE DE DONNÉES (INDEXED DB) ---
// ============================================================
const DB_NAME = "BegoleMapDB"; const DB_VERSION = 1; let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        if (!("vibrate" in navigator)) console.warn("Vibrations non supportées.");
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => { db = e.target.result; 
            if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('parcels')) db.createObjectStore('parcels', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' });
        };
        req.onsuccess = e => { db = e.target.result; resolve(db); };
        req.onerror = e => reject("Erreur DB");
    });
}
function saveToDB(s, d) { return new Promise((r, j) => { const tx = db.transaction([s], "readwrite"); tx.objectStore(s).put(d); tx.oncomplete = r; }); }
function deleteFromDB(s, id) { return new Promise((r, j) => { const tx = db.transaction([s], "readwrite"); tx.objectStore(s).delete(id); tx.oncomplete = r; }); }
function loadAllFromDB(s) { return new Promise((r, j) => { const tx = db.transaction([s], "readonly"); const req = tx.objectStore(s).getAll(); req.onsuccess = () => r(req.result); }); }
function clearStoreDB(s) { return new Promise((r, j) => { const tx = db.transaction([s], "readwrite"); tx.objectStore(s).clear(); tx.oncomplete = r; }); }

async function startApp() {
    await initDB();
    // Migration old data
    const oldP = localStorage.getItem('myMapPoints');
    if (oldP) { for (let p of JSON.parse(oldP)) { if(!p.id)p.id=Date.now()+Math.random(); await saveToDB('points', p); } localStorage.removeItem('myMapPoints'); }
    
    savedPoints = await loadAllFromDB('points');
    savedParcels = await loadAllFromDB('parcels');
    savedTrips = await loadAllFromDB('trips');

    updateYearFilterOptions(); refreshMap(); displayParcels(); checkCrashRecovery();
    updateAstroWidget(); updateWeatherWidget(); // Init Env
    updateUserLevel(); // Init Gamification
}
startApp();

async function checkStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const pct = (est.usage / est.quota) * 100;
        const bar = document.getElementById('storage-bar');
        if(bar) {
            document.getElementById('storage-text').innerText = `${(est.usage/1048576).toFixed(1)} MB (${pct.toFixed(2)}%)`;
            bar.style.width = pct < 1 ? "1%" : pct + "%"; bar.style.backgroundColor = pct > 80 ? "#e74c3c" : "#2ecc71";
        }
    }
}


// ============================================================
// --- 4. NATURE : ASTRO, MÉTÉO & THÈME DYNAMIQUE ---
// ============================================================

// A. Astro (Lune & Soleil + Thème)
function updateAstroWidget() {
    const date = new Date();
    const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
    let m = month; let y = year; if (m < 3) { y--; m += 12; } ++m;
    let c = 365.25 * y, e = 30.6 * m, jd = c + e + day - 694039.09; 
    jd /= 29.5305882; let b = parseInt(jd); jd -= b; b = Math.round(jd * 8); if (b >= 8) b = 0;
    
    const moons = ['🌑 Nouv.', '🌒 Crois.', '🌓 Premier', '🌔 Gib.', '🌕 Pleine', '🌖 Gib.', '🌗 Dernier', '🌘 Crois.'];
    currentEnv.moon = `${moons[b]} ${(jd*100).toFixed(0)}%`; 
    
    const moonEl = document.getElementById('astro-moon'); if(moonEl) moonEl.innerText = currentEnv.moon;

    // Soleil
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    let sunsetHour = 19.5 + (Math.sin((dayOfYear - 80) * 0.0172) * 2.3); 
    const currentHour = now.getHours() + now.getMinutes()/60;
    let remaining = sunsetHour - currentHour;
    
    const sunEl = document.getElementById('astro-sun');
    if(sunEl) {
        if (remaining < 0) { sunEl.innerText = "🌑 Nuit"; sunEl.classList.remove('sun-alert'); }
        else {
            const h = Math.floor(remaining), m = Math.floor((remaining - h) * 60);
            sunEl.innerText = `☀️ Reste ${h}h${pad(m)}`;
            sunEl.classList.toggle('sun-alert', remaining < 1);
        }
    }

    // --- THÈME DYNAMIQUE (Jour / Golden / Nuit) ---
    document.body.classList.remove('theme-golden', 'theme-dark');
    if (currentHour > sunsetHour || currentHour < 7) { 
        document.body.classList.add('theme-dark'); // Nuit
    } else if (remaining < 1 && remaining > 0) {
        document.body.classList.add('theme-golden'); // Crépuscule
    }
}

// B. Météo (OpenMeteo API)
function updateWeatherWidget() {
    let lat = VILLAGE_COORDS[0], lng = VILLAGE_COORDS[1];
    if (userMarker) { const ll = userMarker.getLatLng(); lat = ll.lat; lng = ll.lng; }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code&timezone=auto`;

    fetch(url).then(r => r.json()).then(data => {
        if (!data || !data.current) return;
        
        const temp = Math.round(data.current.temperature_2m);
        const rain = data.current.precipitation;
        const code = data.current.weather_code;

        document.getElementById('weather-temp').innerText = `🌡️ ${temp}°C`;
        document.getElementById('weather-rain').innerText = `🌧️ ${rain}mm`;
        
        let desc = "Calme";
        if (code === 0) desc = "☀️ Soleil";
        else if (code >= 1 && code <= 3) desc = "⛅ Nuageux";
        else if (code >= 45 && code <= 48) desc = "🌫️ Brouillard";
        else if (code >= 51 && code <= 67) desc = "🌧️ Pluie";
        else if (code >= 71 && code <= 77) desc = "❄️ Neige";
        else if (code >= 80 && code <= 82) desc = "🚿 Averses";
        else if (code >= 95) desc = "⚡ Orage";
        
        document.getElementById('weather-desc').innerText = desc;
        currentEnv.temp = temp;
        currentEnv.weather = desc;
        currentEnv.fullString = `${desc} ${temp}°C • ${currentEnv.moon}`;
        
        // --- LANCEMENT EFFET MÉTÉO (5 SEC) ---
        triggerWeatherEffect(desc);
        
    }).catch(() => { document.getElementById('weather-desc').innerText = "⚠️ Erreur"; currentEnv.weather = "⚠️"; });
}

// C. Radar
function toggleRadar() {
    isRadarActive = document.getElementById('radar-toggle').checked;
    if(isRadarActive) { showToast("📡 Radar activé (40m)"); triggerHaptic('success'); alertedPoints.clear(); }
    else { showToast("Radar coupé"); }
}


// ============================================================
// --- 5. UI & OUTILS TERRAIN ---
// ============================================================

function toggleBorders() {
    if (document.getElementById('borders-toggle').checked) { if(villageLayer) villageLayer.addTo(map); } 
    else { if(villageLayer) map.removeLayer(villageLayer); }
    toggleMenu();
}

function toggleCompass() {
    isCompassMode = !isCompassMode;
    const btn = document.getElementById('btn-compass');
    if (isCompassMode) {
        btn.classList.add('active'); enableAutoCenter(); showToast("🧭 Boussole Active");
        if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
            window.DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') window.addEventListener('deviceorientation', handleOrientation); });
        } else { window.addEventListener('deviceorientation', handleOrientation); }
    } else {
        btn.classList.remove('active'); window.removeEventListener('deviceorientation', handleOrientation);
        if (userMarker) { const ar = userMarker.getElement().querySelector('.user-location-arrow'); if(ar) ar.style.transform = `rotate(0deg)`; }
    }
}
function handleOrientation(e) {
    if (!isCompassMode || !userMarker) return;
    let h = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : 0);
    const ar = userMarker.getElement().querySelector('.user-location-arrow');
    if(ar) ar.style.transform = `rotate(${h}deg)`;
}

// Map Layers
function toggleHeatmap() {
    if (document.getElementById('heatmap-toggle').checked) {
        let pts=[]; savedTrips.forEach(t=>t.points.forEach(p=>pts.push([p[0],p[1],0.5])));
        if(pts.length===0){showToast("Pas de données");document.getElementById('heatmap-toggle').checked=false;return;}
        if(heatLayer)map.removeLayer(heatLayer); heatLayer=L.heatLayer(pts,{radius:20,blur:15}).addTo(map);
    } else { if(heatLayer)map.removeLayer(heatLayer); }
    toggleMenu();
}

function toggleCadastreMode() {
    isCadastreMode=document.getElementById('cadastre-mode-toggle').checked;
    toggleOpacitySlider(isCadastreMode||document.getElementById('show-parcels-toggle').checked);
    if(isCadastreMode){ 
        if(!map.hasLayer(cadastreLayer))map.addLayer(cadastreLayer); 
        if(map.hasLayer(markersLayer))map.removeLayer(markersLayer); 
    }
    else{ 
        if(!document.getElementById('show-parcels-toggle').checked)map.removeLayer(cadastreLayer); 
        if(!map.hasLayer(markersLayer)) map.addLayer(markersLayer); 
    }
}

function toggleSavedParcels() {
    const c=document.getElementById('show-parcels-toggle').checked;
    toggleOpacitySlider(c||isCadastreMode);
    
    if(c){ 
        if(!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer); 
        map.addLayer(cadastreLayer); 
        if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer); 
    }
    else{ 
        map.removeLayer(parcelsLayer); 
        if(!isCadastreMode) map.removeLayer(cadastreLayer); 
        if(!map.hasLayer(markersLayer)) map.addLayer(markersLayer); 
    }
}

function toggleOpacitySlider(s) { document.getElementById('cadastre-opacity-container').classList.toggle('hidden', !s); }
function updateCadastreOpacity(v) { cadastreLayer.setOpacity(v); }

map.on('click', e => { if (isCadastreMode) fetchParcelAt(e.latlng); else { tempLatLng = e.latlng; openModal(); } });
function fetchParcelAt(ll) { document.body.style.cursor='wait'; fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${ll.lng},${ll.lat}]}`).then(r=>r.ok?r.json():null).then(d=>{document.body.style.cursor='default';if(d&&d.features.length){openParcelModal(d.features[0]);triggerHaptic('success');}else{showToast("Rien ici");}}).catch(()=>{document.body.style.cursor='default';}); }
function openParcelModal(p) { currentParcelGeoJSON=p; document.getElementById('parcel-ref').textContent="Ref: "+p.properties.section+" "+p.properties.numero; let a=p.properties.contenance?parseInt(p.properties.contenance):calculateGeoJSONArea(p.geometry); document.getElementById('parcel-area').innerHTML=`${(a/10000).toFixed(4)} ha<br><small>(${Math.round(a)} m²)</small>`; document.getElementById('parcel-note').value=""; document.getElementById('modal-parcel').classList.remove('hidden'); document.getElementById('menu-items').classList.add('hidden-mobile'); }
function closeParcelModal() { document.getElementById('modal-parcel').classList.add('hidden'); currentParcelGeoJSON=null; }
function selectColor(c,el) { selectedParcelColor=c; document.querySelectorAll('.color-option').forEach(e=>e.classList.remove('selected')); el.classList.add('selected'); }
async function confirmSaveParcel() { const n={id:Date.now(),geoJSON:currentParcelGeoJSON,color:selectedParcelColor,note:document.getElementById('parcel-note').value}; await saveToDB('parcels',n); savedParcels.push(n); displayParcels(); closeParcelModal(); showToast("Sauvegardé"); }

function displayParcels() { 
    parcelsLayer.clearLayers(); 
    savedParcels.forEach(p=>{ 
        L.geoJSON(p.geoJSON,{
            style:{color:'#333',weight:1,fillColor:p.color,fillOpacity:0.6},
            onEachFeature:(f,l)=>{
                let a = f.properties.contenance ? parseInt(f.properties.contenance) : calculateGeoJSONArea(f.geometry);
                l.bindPopup(`<b>${p.note||""}</b><br>${(a/10000).toFixed(2)} ha<br><small>${Math.round(a)} m²</small><br><button onclick="deleteParcel(${p.id})">Suppr</button>`);
            }
        }).addTo(parcelsLayer); 
    }); 
}

async function deleteParcel(id) { if(confirm("Supprimer ?")){await deleteFromDB('parcels',id); savedParcels=savedParcels.filter(p=>p.id!==id); displayParcels();} }
async function clearParcels() { if(confirm("Tout effacer ?")){await clearStoreDB('parcels'); savedParcels=[]; displayParcels();} }

// CALCULS SURFACES
function getRingArea(coords) {
    if (!coords || coords.length < 3) return 0;
    let area = 0; const DEG_TO_M = 111319; const meanLat = coords[0][1]*Math.PI/180; const lonScale = Math.cos(meanLat);
    for (let i=0; i<coords.length; i++) {
        let p1=coords[i], p2=coords[(i+1)%coords.length];
        area += (p1[0]*DEG_TO_M*lonScale * p2[1]*DEG_TO_M) - (p2[0]*DEG_TO_M*lonScale * p1[1]*DEG_TO_M);
    }
    return Math.abs(area/2.0);
}
function calculateGeoJSONArea(g) {
    if(!g) return 0; if(g.type==="Polygon") return getRingArea(g.coordinates[0]);
    if(g.type==="MultiPolygon") { let t=0; g.coordinates.forEach(p=>t+=getRingArea(p[0])); return t; } return 0;
}

// Stats Cadastre
function showCadastreStats() {
    let totalCount=0, totalArea=0, statsByColor={};
    savedParcels.forEach(p => {
        totalCount++;
        let area = p.geoJSON.properties.contenance ? parseInt(p.geoJSON.properties.contenance) : calculateGeoJSONArea(p.geoJSON.geometry);
        totalArea += area;
        if (!statsByColor[p.color]) statsByColor[p.color] = { count: 0, area: 0 };
        statsByColor[p.color].count++; statsByColor[p.color].area += area;
    });
    
    let totalHa = (totalArea / 10000).toFixed(2);
    let totalM2 = Math.round(totalArea); // m²
    
    let html = `<div style="text-align:center;margin-bottom:15px;">
        <span style="font-size:24px;font-weight:800;color:var(--text-main);">${totalHa} ha</span><br>
        <span style="font-size:14px;color:var(--text-sub);">(${totalM2} m²)</span><br>
        <span style="font-weight:bold;color:#e67e22;">${totalCount} parcelles</span>
    </div><hr style="margin:10px 0;border-top:1px solid var(--border-color);">`;
    
    for (let c in statsByColor) {
        let s = statsByColor[c];
        html += `<div class="cadastre-stat-row">
            <div style="display:flex;align-items:center;"><span class="color-dot" style="background:${c};"></span><span>${s.count} parcelles</span></div>
            <div style="text-align:right;"><strong>${(s.area/10000).toFixed(2)} ha</strong><br><small>(${Math.round(s.area)} m²)</small></div>
        </div>`;
    }
    
    if (totalCount === 0) html += "<p style='text-align:center;color:#999;'>Aucune parcelle.</p>";
    document.getElementById('cadastre-stats-content').innerHTML = html;
    document.getElementById('modal-cadastre-stats').classList.remove('hidden');
    toggleMenu();
}
function closeCadastreStats() { document.getElementById('modal-cadastre-stats').classList.add('hidden'); }


// ============================================================
// --- 6. TRACEUR GPS & RADAR ---
// ============================================================

map.on('dragstart', () => { if (isTracking && isAutoCentering) { isAutoCentering=false; document.getElementById('btn-recenter').classList.remove('hidden'); } });
function enableAutoCenter() { isAutoCentering=true; document.getElementById('btn-recenter').classList.add('hidden'); if(userMarker) map.setView(userMarker.getLatLng()); }
function toggleMenu() { 
    checkStorageUsage(); 
    document.getElementById('menu-items').classList.toggle('hidden-mobile'); 
    updateAstroWidget(); updateWeatherWidget(); 
    updateUserLevel(); 
}

async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    if (!isTracking) {
        isTracking=true; isAutoCentering=true; document.getElementById('btn-recenter').classList.add('hidden');
        currentPath=[]; currentDistance=0; currentStartTime=new Date(); alertedPoints.clear();
        btn.innerHTML="⏹️ Stop"; btn.className="btn-stop-track"; 
        document.getElementById('recording-container').classList.remove('hidden'); document.getElementById('dashboard').classList.remove('hidden');
        startTimer(); await requestWakeLock();
        currentPolyline=L.polyline([],{color:'red',weight:5}).addTo(map);
        trackWatchId=navigator.geolocation.watchPosition(updateTrackingPosition,null,{enableHighAccuracy:true});
        toggleMenu(); showToast("REC démarré"); triggerHaptic('start');
    } else {
        isTracking=false; navigator.geolocation.clearWatch(trackWatchId); stopTimer(); await releaseWakeLock();
        localStorage.removeItem('begole_temp_track');
        btn.innerHTML="▶️ Démarrer"; btn.className="btn-start-track"; 
        document.getElementById('recording-container').classList.add('hidden'); document.getElementById('dashboard').classList.add('hidden');
        if(currentPath.length>0) { const end=new Date(); await saveTrip(currentPath,currentStartTime,end,currentDistance,calculateElevation(currentPath)); alert(`Distance: ${currentDistance.toFixed(2)}km`); }
        if(currentPolyline) map.removeLayer(currentPolyline);
    }
}

function updateTrackingPosition(pos) {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const newLL = [lat, lng, pos.coords.altitude||0];
    
    if (isRadarActive) {
        savedPoints.forEach(p => {
            if (!alertedPoints.has(p.id)) {
                if (map.distance([lat, lng], [p.lat, p.lng]) < 40) {
                    triggerHaptic('radar'); showToast(`🍄 Point proche : ${p.emoji}`); alertedPoints.add(p.id);
                }
            }
        });
    }

    if (currentPath.length>0) currentDistance += (map.distance([currentPath[currentPath.length-1][0],currentPath[currentPath.length-1][1]], [lat,lng])/1000);
    updateDashboard(pos.coords.altitude, pos.coords.speed, currentDistance);
    if (isAutoCentering) map.setView([lat, lng]);
    updateUserMarker(lat, lng, pos.coords.accuracy, pos.coords.heading);
    currentPath.push(newLL); currentPolyline.setLatLngs(currentPath);
    localStorage.setItem('begole_temp_track', JSON.stringify({path:currentPath, startTime:currentStartTime, distance:currentDistance}));
}

function checkCrashRecovery() {
    const t=JSON.parse(localStorage.getItem('begole_temp_track'));
    if(t&&t.path.length>0 && confirm("Reprendre tracé interrompu ?")) {
        currentPath=t.path; currentStartTime=new Date(t.startTime); currentDistance=t.distance;
        isTracking=true; isAutoCentering=true;
        document.getElementById('btn-tracking').innerHTML="⏹️ Stop"; document.getElementById('btn-tracking').className="btn-stop-track";
        document.getElementById('recording-container').classList.remove('hidden'); document.getElementById('dashboard').classList.remove('hidden');
        currentPolyline=L.polyline(currentPath,{color:'red',weight:5}).addTo(map);
        startTimer(); requestWakeLock();
        trackWatchId=navigator.geolocation.watchPosition(updateTrackingPosition,null,{enableHighAccuracy:true});
    } else localStorage.removeItem('begole_temp_track');
}

function updateDashboard(a,s,d) { document.getElementById('dash-alt').innerText=a?Math.round(a):"--"; document.getElementById('dash-speed').innerText=s?Math.round(s*3.6):0; document.getElementById('dash-dist').innerText=d.toFixed(2); }
function startTimer() { const e=document.getElementById('recording-timer'); timerInterval=setInterval(()=>{e.innerText=formatDuration(new Date()-currentStartTime);},1000); }
function stopTimer() { clearInterval(timerInterval); document.getElementById('recording-timer').innerText="00:00"; }
function calculateElevation(p) { let g=0,l=0;if(p.length<2)return{gain:0,loss:0};let la=p[0][2];for(let i=1;i<p.length;i++){let ca=p[i][2];if(ca!==null&&la!==null){let d=ca-la;if(Math.abs(d)>5){if(d>0)g+=d;else l+=Math.abs(d);la=ca;}}}return{gain:Math.round(g),loss:Math.round(l)};}
async function saveTrip(p,s,e,d,el) { const trip={id:Date.now(),date:s.toISOString(),duration:e-s,distance:d,points:p,elevationGain:el.gain}; await saveToDB('trips',trip); savedTrips.push(trip); }


// ============================================================
// --- 7. HISTORIQUE, GRAPHIQUES & POINTS ---
// ============================================================

function openHistory() { renderHistoryList(); document.getElementById('history-overlay').classList.remove('hidden'); toggleMenu(); }
function closeHistory() { document.getElementById('history-overlay').classList.add('hidden'); }

function renderHistoryList() {
    const div = document.getElementById('tripList'); div.innerHTML = "";
    const filterDist = document.getElementById('filter-trip-class').value;
    savedTrips.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(t => {
        const dKm = t.distance || 0; 
        if(filterDist==='blue' && dKm>=2) return; if(filterDist==='green' && (dKm<2||dKm>=5)) return;
        if(filterDist==='orange' && (dKm<5||dKm>=10)) return; if(filterDist==='red' && dKm<10) return;
        
        const d = new Date(t.date);
        let color = dKm<2?'#3498db':dKm<5?'#2ecc71':dKm<10?'#f39c12':'#e74c3c';
        
        div.innerHTML += `
            <div class="trip-item">
                <div style="flex-grow:1; cursor:pointer;" onclick="showSingleTrip(${t.id})">
                    <span class="trip-date" style="border-left: 4px solid ${color}; padding-left:5px;">${d.toLocaleDateString()}</span>
                    <span class="trip-info">📏 ${(t.distance||0).toFixed(2)}km 🏔️ +${t.elevationGain||0}m</span>
                </div>
                <div style="display:flex;gap:5px;">
                    <button class="btn-graph-trip" style="background:#e67e22;" onclick="startReplay(${t.id})" title="Rejouer le trajet">▶️</button>
                    
                    <button class="btn-graph-trip" onclick="openElevationModal(${t.id})">📈</button>
                    <button class="btn-delete-trip" style="background:#8e44ad;" onclick="openEditTripModal(${t.id})">✏️</button>
                    <button class="btn-delete-trip" onclick="deleteTrip(${t.id})">🗑️</button>
                </div>
            </div>`;
    });
    if(div.innerHTML==="") div.innerHTML="<div style='text-align:center;padding:20px;color:#999;'>Vide</div>";
}

function showSingleTrip(id) { 
    clearMapLayers(); 
    // HIDE POINTS WHEN SHOWING TRACKS
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);

    const t=savedTrips.find(x=>x.id===id); 
    if(t){
        const d = t.distance || 0;
        const color = d < 2 ? '#3498db' : d < 5 ? '#2ecc71' : d < 10 ? '#f39c12' : '#e74c3c';
        L.polyline(t.points,{color: color, weight:5}).addTo(tracksLayer); 
        map.fitBounds(L.polyline(t.points).getBounds()); 
        closeHistory();
    } 
}

function showAllTrips() { 
    clearMapLayers(); 
    // HIDE POINTS WHEN SHOWING TRACKS
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);

    savedTrips.forEach(t => {
        const d = t.distance || 0;
        const color = d < 2 ? '#3498db' : d < 5 ? '#2ecc71' : d < 10 ? '#f39c12' : '#e74c3c';
        L.polyline(t.points, {color: color, weight:3, opacity:0.8}).addTo(tracksLayer);
    }); 
    closeHistory(); 
}

async function deleteTrip(id) { if(confirm("Supprimer ?")) { await deleteFromDB('trips', id); savedTrips = savedTrips.filter(t=>t.id!==id); renderHistoryList(); clearMapLayers(); } }

function clearMapLayers() { 
    tracksLayer.clearLayers(); 
    if(heatLayer) map.removeLayer(heatLayer); 
    // RESET : Remet les points si parcelles désactivées
    if(!document.getElementById('show-parcels-toggle').checked) map.addLayer(markersLayer); 
}

// Graphique
function openElevationModal(tripId) {
    const t = savedTrips.find(x => x.id === tripId);
    if (!t || !t.points || t.points.length < 2) { showToast("Pas de données"); return; }
    document.getElementById('modal-elevation').classList.remove('hidden');
    setTimeout(() => drawElevationProfile(t.points), 100);
}
function closeElevationModal() { document.getElementById('modal-elevation').classList.add('hidden'); }
function drawElevationProfile(pts) {
    const canvas = document.getElementById('elevation-canvas');
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    const alts = pts.map(p => p[2] || 0);
    const min = Math.min(...alts), max = Math.max(...alts), rng = max - min || 1;
    document.getElementById('elev-min').innerText = `Min: ${Math.round(min)}m`;
    document.getElementById('elev-max').innerText = `Max: ${Math.round(max)}m`;
    
    ctx.beginPath(); ctx.moveTo(0, h);
    const step = w / (alts.length - 1);
    alts.forEach((a, i) => { ctx.lineTo(i * step, h - ((a - min) / rng * (h - 20)) - 10); });
    ctx.lineTo(w, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(46,204,113,0.8)"); g.addColorStop(1, "rgba(46,204,113,0.1)");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#27ae60"; ctx.lineWidth = 2; ctx.stroke();
}

// ============================================================
// --- 8. POINTS (AJOUT ET EDITION) ---
// ============================================================

function updateModalEnvInfo() {
    currentEnv.fullString = `${currentEnv.weather} ${currentEnv.temp!="--"?currentEnv.temp+"°C":""} • ${currentEnv.moon}`;
    const el1 = document.getElementById('point-env-info'), el2 = document.getElementById('history-env-info');
    if(el1) el1.innerText = "Conditions : " + currentEnv.fullString;
    if(el2) el2.innerText = "Météo : " + currentEnv.fullString;
}

function openModal() { updateModalEnvInfo(); document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

async function confirmAddPoint() {
    const newPoint = { id:Date.now(), lat:tempLatLng.lat, lng:tempLatLng.lng, note:document.getElementById('input-note').value, emoji:document.getElementById('input-emoji').value||"📍", date:new Date().toLocaleDateString(), weather:currentEnv.fullString, history:[] };
    await saveToDB('points', newPoint); savedPoints.push(newPoint);
    refreshMap(); closeModal(); showToast("Point ajouté !");
}

function refreshMap() {
    markersLayer.clearLayers();
    savedPoints.forEach((p,i) => {
        if (currentFilterEmoji && p.emoji !== currentFilterEmoji) return;
        if (currentFilterText && !p.note.toLowerCase().includes(currentFilterText)) return;
        if (currentFilterYear !== 'all' && p.date.split('/')[2].substring(0,4) !== currentFilterYear) return;
        if (currentFilterMonth !== 'all' && parseInt(p.date.split('/')[1]) !== parseInt(currentFilterMonth)) return;

        L.marker([p.lat, p.lng], { icon: L.divIcon({className:'emoji-icon', html:p.emoji, iconSize:[30,30]}) })
        .bindPopup(`<div style="text-align:center;"><b>${p.emoji} ${p.note}</b><br><small style="color:#8e44ad;">${p.weather||""}</small><br><small>${p.history?p.history.length:0} entrées</small><br><button class="btn-popup-edit" onclick="openEditModal(${i})">📝 Carnet</button></div>`).addTo(markersLayer);
    });
    // On ne remet les markers que si le mode cadastre "Mes Parcelles" n'est pas actif
    if(!document.getElementById('show-parcels-toggle').checked && !map.hasLayer(markersLayer)) map.addLayer(markersLayer);
}

function openEditModal(i) { currentEditingIndex=i; const p=savedPoints[i]; document.getElementById('edit-emoji').value=p.emoji; document.getElementById('edit-note').value=p.note; renderPointHistory(p.history); updateModalEnvInfo(); document.getElementById('modal-edit-point').classList.remove('hidden'); map.closePopup(); }
function openEditTripModal(id) { const t=savedTrips.find(x=>x.id===id); if(t){ currentEditingTripId=id; document.getElementById('edit-trip-note').value=t.note||""; document.getElementById('modal-edit-trip').classList.remove('hidden'); }}
function closeEditTripModal() { document.getElementById('modal-edit-trip').classList.add('hidden'); }
async function confirmSaveTripNote() { if(currentEditingTripId){ const i=savedTrips.findIndex(x=>x.id===currentEditingTripId); if(i>-1){savedTrips[i].note=document.getElementById('edit-trip-note').value; await saveToDB('trips',savedTrips[i]); renderHistoryList(); closeEditTripModal(); showToast("Sauvé");}} }

// ============================================================
// --- 9. FONCTIONS UTILITAIRES (FILTRES, IMAGES, ETC.) ---
// ============================================================
function updateYearFilterOptions() { const s=document.getElementById('filter-year'); const cur=s.value; s.innerHTML='<option value="all">Toutes</option>'; const yrs=new Set(savedPoints.map(p=>p.date.split('/')[2].substring(0,4))); Array.from(yrs).sort().reverse().forEach(y=>{const o=document.createElement('option');o.value=y;o.innerText=y;s.appendChild(o);}); s.value=cur; }
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

// --- MODIFICATION : CONFIRMATION AVANT SUPPRESSION ---
function deleteCurrentPoint(){
    if(confirm("Voulez-vous vraiment supprimer ce point définitivement ?")) {
        deletePoint(currentEditingIndex);
        document.getElementById('modal-edit-point').classList.add('hidden');
    }
}

async function deletePoint(i){await deleteFromDB('points',savedPoints[i].id);savedPoints.splice(i,1);refreshMap();}
function exportData(){const d={points:savedPoints,trips:savedTrips,parcels:savedParcels};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'}));a.download='Begole_Backup.json';a.click();}
function importData(i){const f=new FileReader();f.onload=async e=>{const d=JSON.parse(e.target.result);if(d.points)for(let p of d.points){if(!p.id)p.id=Date.now()+Math.random();await saveToDB('points',p);}location.reload();};f.readAsText(i.files[0]);}
function toggleLocation(){const b=document.getElementById('btn-loc');if(trackWatchId){navigator.geolocation.clearWatch(trackWatchId);trackWatchId=null;b.innerHTML="📍 Pos. Off";if(userMarker)map.removeLayer(userMarker);}else{b.innerHTML="🛑 Stop";trackWatchId=navigator.geolocation.watchPosition(p=>updateUserMarker(p.coords.latitude,p.coords.longitude,p.coords.accuracy,p.coords.heading),e=>{},{enableHighAccuracy:true});}}
function updateUserMarker(lat,lng,acc,h){if(!userMarker){userMarker=L.marker([lat,lng],{icon:L.divIcon({className:'custom-container',html:'<div class="user-location-arrow">⬆️</div>',iconSize:[40,40]})}).addTo(map);userAccuracyCircle=L.circle([lat,lng],{radius:acc,color:'#3498db',fillOpacity:0.15}).addTo(map);}else{userMarker.setLatLng([lat,lng]);userAccuracyCircle.setLatLng([lat,lng]);userAccuracyCircle.setRadius(acc);if(!isCompassMode&&h){const a=userMarker.getElement().querySelector('.user-location-arrow');if(a)a.style.transform=`rotate(${h}deg)`;}}}
function showToast(m){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className='toast';t.textContent=m;c.appendChild(t);setTimeout(()=>t.classList.add('show'),10);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},3000);}
function triggerHaptic(t){if(navigator.vibrate)try{navigator.vibrate(t==='radar'?[100,50,100]:(t==='success'?50:200));}catch(e){}}
async function clearData(){if(confirm("Tout effacer ?")){await clearStoreDB('points');await clearStoreDB('parcels');await clearStoreDB('trips');location.reload();}}

// --- FONCTION STATS GLOBALES RESTAURÉE ---
function showStats(){
    let tD=0, tDur=0, tEl=0; 
    savedTrips.forEach(t=>{ tD+=(t.distance||0); tDur+=(t.duration||0); tEl+=(t.elevationGain||0); });
    const spd = tDur>0 ? tD/(tDur/3600000) : 0;
    
    let html = `<div class="stats-summary">
        <div class="stat-card"><span class="stat-value">${savedTrips.length}</span><span class="stat-label">Trajets</span></div>
        <div class="stat-card"><span class="stat-value">${tD.toFixed(1)}</span><span class="stat-label">Km</span></div>
        <div class="stat-card"><span class="stat-value">${spd.toFixed(1)}</span><span class="stat-label">Km/h</span></div>
        <div class="stat-card"><span class="stat-value">${tEl.toFixed(0)}m</span><span class="stat-label">D+</span></div>
    </div><hr style="margin:15px 0;border-top:1px solid var(--border-color);">`;
    
    let st={}; 
    savedPoints.forEach(p=>{ st[p.emoji||"?"] = (st[p.emoji||"?"]||0)+1; });
    
    Object.keys(st).sort((a,b)=>st[b]-st[a]).forEach(k => { 
        html += `<div class="stat-row"><span class="stat-emoji">${k}</span><span class="stat-count">${st[k]}</span></div>`; 
    });
    
    if(savedPoints.length === 0) html += "<div style='text-align:center;color:var(--text-sub);'>Aucun point enregistré</div>";

    document.getElementById('stats-content').innerHTML = html; 
    document.getElementById('stats-overlay').classList.remove('hidden'); 
    toggleMenu();
}

function closeStats(){document.getElementById('stats-overlay').classList.add('hidden');}
function formatDuration(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h${m}`:`${pad(m)}:${pad(s%60)}`;}
function pad(n){return n<10?'0'+n:n;}
async function requestWakeLock(){try{if('wakeLock'in navigator)wakeLock=await navigator.wakeLock.request('screen');}catch(e){}}
async function releaseWakeLock(){if(wakeLock){await wakeLock.release();wakeLock=null;}}
var lastClick=0; function togglePocketMode(){const e=document.getElementById('pocket-overlay');if(e.classList.contains('hidden-poche')){e.classList.remove('hidden-poche');toggleMenu();}else{if(Date.now()-lastClick<500)e.classList.add('hidden-poche');lastClick=Date.now();}}

// ============================================================
// --- 11. SUCCES & BADGES ---
// ============================================================

function showAchievements() {
    const content = document.getElementById('achievements-content');
    content.innerHTML = "";

    const totalPoints = savedPoints.length;
    const totalDist = savedTrips.reduce((acc, t) => acc + (t.distance || 0), 0);
    const totalElevation = savedTrips.reduce((acc, t) => acc + (t.elevationGain || 0), 0);
    const totalPhotos = savedPoints.reduce((acc, p) => acc + (p.history ? p.history.filter(h => h.photo).length : 0), 0);
    const totalHistory = savedPoints.reduce((acc, p) => acc + (p.history ? p.history.length : 0), 0);
    
    // Définition des Badges (LISTE ENRICHIE)
    const badges = [
        // --- Points & Découvertes ---
        { id: 'start', icon: '🌱', title: 'Débutant', desc: '1er point enregistré', check: () => totalPoints >= 1 },
        { id: 'collec', icon: '🍄', title: 'Collectionneur', desc: '50 points trouvés', check: () => totalPoints >= 50 },
        { id: 'master', icon: '🧙', title: 'Expert Mycologue', desc: '100 points trouvés', check: () => totalPoints >= 100 },

        // --- Marche & Sport ---
        { id: 'walker', icon: '🚶', title: 'Promeneur', desc: '10 km parcourus', check: () => totalDist >= 10 },
        { id: 'marathon', icon: '🏃', title: 'Marathonien', desc: '50 km parcourus', check: () => totalDist >= 50 },
        { id: 'ultra', icon: '🏋️', title: 'Ultra-Trail', desc: '100 km parcourus', check: () => totalDist >= 100 },
        { id: 'climber', icon: '⛰️', title: 'Grimpeur', desc: '500m de dénivelé cumulé', check: () => totalElevation >= 500 },
        { id: 'sherpa', icon: '🏔️', title: 'Sherpa', desc: '2000m de dénivelé cumulé', check: () => totalElevation >= 2000 },

        // --- Environnement & Météo ---
        { id: 'night', icon: '🌑', title: 'Oiseau de Nuit', desc: 'Sortie nocturne (22h-5h)', check: () => savedPoints.some(p => { const h = new Date(p.id).getHours(); return h >= 22 || h < 5; }) },
        { id: 'rain', icon: '🌧️', title: 'Botte de Pluie', desc: 'Braver la pluie', check: () => savedPoints.some(p => (p.weather || "").match(/Pluie|Averses|Orage/)) },
        { id: 'fog', icon: '👻', title: 'Fantôme', desc: 'Trouvaille dans le brouillard', check: () => savedPoints.some(p => (p.weather || "").match(/Brouillard/)) },
        { id: 'winter', icon: '❄️', title: 'Hivernal', desc: 'Sortie en Hiver (Déc-Fév)', check: () => savedPoints.some(p => { const m = new Date(p.id).getMonth(); return m === 11 || m === 0 || m === 1; }) },
        { id: 'autumn', icon: '🍂', title: 'Automnal', desc: 'Sortie en Automne (Sept-Nov)', check: () => savedPoints.some(p => { const m = new Date(p.id).getMonth(); return m >= 8 && m <= 10; }) },

        // --- Utilisation de l'App ---
        { id: 'paparazzi', icon: '📷', title: 'Paparazzi', desc: '10 photos dans le carnet', check: () => totalPhotos >= 10 },
        { id: 'writer', icon: '📝', title: 'Écrivain', desc: '20 notes d\'historique', check: () => totalHistory >= 20 }
    ];

    let html = '<div class="achievements-grid">';
    badges.forEach(b => {
        const unlocked = b.check();
        html += `
            <div class="badge-card ${unlocked ? 'unlocked' : ''}">
                <span class="badge-icon">${b.icon}</span>
                <span class="badge-title">${b.title}</span>
                <span class="badge-desc">${b.desc}</span>
            </div>
        `;
    });
    html += '</div>';
    
    content.innerHTML = html;
    document.getElementById('modal-achievements').classList.remove('hidden');
    toggleMenu(); 
}

function closeAchievements() {
    document.getElementById('modal-achievements').classList.add('hidden');
}


// ============================================================
// --- 12. SYSTÈME DE NIVEAUX & PARTICULES ---
// ============================================================

function updateUserLevel() {
    // Calcul de l'XP : 100 XP par point, 50 XP par km
    const totalPoints = savedPoints.length;
    const totalKm = savedTrips.reduce((acc, t) => acc + (t.distance || 0), 0);
    
    const xp = Math.floor((totalPoints * 100) + (totalKm * 50));
    
    // Logique de niveaux (Formule simple : Niveaux tous les 1000 XP au début)
    let level = 1;
    let nextLevelXp = 1000;
    
    // Courbe de progression
    if (xp < 1000) { level = 1; nextLevelXp = 1000; }
    else if (xp < 3000) { level = 2; nextLevelXp = 3000; }
    else if (xp < 6000) { level = 3; nextLevelXp = 6000; }
    else if (xp < 10000) { level = 4; nextLevelXp = 10000; }
    else { level = Math.floor(xp / 2500); nextLevelXp = (level + 1) * 2500; }

    // Titres
    const titles = ["Vagabond", "Explorateur", "Traqueur", "Ranger", "Druide", "Gardien", "Légende"];
    const titleIndex = Math.min(level - 1, titles.length - 1);
    const title = titles[titleIndex];

    // Mise à jour UI
    const elTitle = document.getElementById('user-title');
    const elLvl = document.getElementById('user-lvl');
    const elXpText = document.getElementById('user-xp-text');
    const elBar = document.getElementById('user-xp-bar');

    if(elTitle) elTitle.innerText = title;
    if(elLvl) elLvl.innerText = `Niv. ${level}`;
    
    // Calcul barre de progression (XP restant pour le prochain niveau)
    let prevLevelXp = level === 1 ? 0 : (level === 2 ? 1000 : (level === 3 ? 3000 : (level === 4 ? 6000 : level * 2500)));
    if (level > 4) prevLevelXp = level * 2500; // Ajustement courbe linéaire après niv 5

    const range = nextLevelXp - prevLevelXp;
    const current = xp - prevLevelXp;
    const percent = Math.min(100, Math.max(0, (current / range) * 100));

    if(elXpText) elXpText.innerText = `${Math.round(current)} / ${Math.round(range)} XP`;
    if(elBar) elBar.style.width = `${percent}%`;
}

// Gestion des Particules Météo (5 secondes)
function triggerWeatherEffect(weatherDesc) {
    const container = document.getElementById('weather-overlay');
    if(!container) return; 
    
    container.innerHTML = ''; 
    document.body.classList.remove('weather-active', 'weather-fading');
    container.style.opacity = '1';

    if (!weatherDesc) return;
    const w = weatherDesc.toLowerCase();

    // Détection du type de météo
    let type = null;
    if (w.includes('pluie') || w.includes('averse') || w.includes('orage')) type = 'rain';
    if (w.includes('neige') || w.includes('flocon')) type = 'snow';

    if (type) {
        document.body.classList.add('weather-active');
        
        // Création des particules (50 gouttes ou 30 flocons)
        const count = type === 'rain' ? 50 : 30;

        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.classList.add(type);
            p.style.left = Math.random() * 100 + 'vw';
            p.style.animationDuration = (Math.random() * 1 + 0.5) + 's'; // Vitesse aléatoire
            
            if(type === 'snow') {
                p.style.width = p.style.height = (Math.random() * 5 + 3) + 'px';
                p.style.animationDuration = (Math.random() * 3 + 2) + 's';
            }
            container.appendChild(p);
        }

        // Minuteur 5 secondes
        setTimeout(() => { document.body.classList.add('weather-fading'); }, 4000);
        setTimeout(() => {
            document.body.classList.remove('weather-active', 'weather-fading');
            container.innerHTML = ''; 
        }, 5000);
    }
}


// ============================================================
// --- 13. REPLAY DE RANDO (ANIMATION 20s MAX) ---
// ============================================================

var replayTimer = null;
var replayMarker = null;
var replayPolyline = null;
var replayBgPolyline = null;

function startReplay(tripId) {
    // 1. Récupérer le trajet
    const t = savedTrips.find(x => x.id === tripId);
    if (!t || !t.points || t.points.length < 2) { showToast("Trajet invalide"); return; }

    // 2. Préparer l'interface
    closeHistory();
    clearMapLayers(); 
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer); 
    document.getElementById('replay-controls').classList.remove('hidden');
    toggleMenu(); 

    // 3. Dessiner le tracé "fantôme" (gris)
    replayBgPolyline = L.polyline(t.points, { color: '#bdc3c7', weight: 4, opacity: 0.5, dashArray: '5, 10' }).addTo(map);
    map.fitBounds(replayBgPolyline.getBounds(), { padding: [50, 50] });

    // 4. Initialiser le tracé coloré et le randonneur
    const color = (t.distance < 2) ? '#3498db' : (t.distance < 5) ? '#2ecc71' : (t.distance < 10) ? '#f39c12' : '#e74c3c';
    
    replayPolyline = L.polyline([], { color: color, weight: 5 }).addTo(map);
    
    const startPt = t.points[0];
    const hikerIcon = L.divIcon({
        className: 'hiker-icon-marker',
        html: '🚶',
        iconSize: [30, 30],
        iconAnchor: [15, 28] 
    });

    replayMarker = L.marker([startPt[0], startPt[1]], { icon: hikerIcon, zIndexOffset: 1000 }).addTo(map);

    // 5. CALCUL DE LA VITESSE (Cible = 20 secondes)
    const TARGET_DURATION = 20000; // 20 000 ms
    const totalPoints = t.points.length;
    
    // Combien de temps doit durer chaque étape ?
    let delay = TARGET_DURATION / totalPoints;
    let stepIncrement = 1;

    // Si le délai est trop court (< 15ms), le navigateur va laguer.
    // On garde un délai correct (15ms) mais on saute des points.
    const MIN_DELAY = 15;

    if (delay < MIN_DELAY) {
        stepIncrement = Math.ceil(MIN_DELAY / delay);
        delay = MIN_DELAY;
    }

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

        // Déplace le bonhomme
        replayMarker.setLatLng(latLng);
        
        // Allonge la ligne (On ajoute le point actuel)
        // Note : Si on saute des points (stepIncrement > 1), on tire une ligne droite
        // entre les points sautés. C'est acceptable pour un replay rapide.
        replayPolyline.addLatLng(latLng);

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
    if (replayPolyline) { map.removeLayer(replayPolyline); replayPolyline = null; }
    
    if (!document.getElementById('show-parcels-toggle').checked) map.addLayer(markersLayer);
}