import { VILLAGE_COORDS, DEFAULT_ZOOM, SECRET_EMOJIS } from './config.js';
import { showToast, triggerHaptic, getSpeedColor } from './utils.js';

// --- Variables Globales du Module ---
let map = null;
let markersLayer = null;
let cadastreLayer = null;
let parcelsLayer = null;
let villageLayer = null;
let heatLayer = null;
let tracksLayer = null;

// Variables Replay
let replayTimer = null;
let replayMarker = null;
let replayTraceLayer = null;
let replayBgPolyline = null;

// Callbacks pour communiquer avec l'UI (évite les dépendances circulaires)
let uiCallbacks = {
    onEditPoint: () => console.warn("Callback onEditPoint non défini"),
    onParcelFound: () => console.warn("Callback onParcelFound non défini"),
    onDeleteParcel: () => console.warn("Callback onDeleteParcel non défini"),
    onReplayFinished: () => {}
};

/**
 * Enregistre les fonctions de l'UI nécessaires à la carte
 */
export function registerMapCallbacks(callbacks) {
    uiCallbacks = { ...uiCallbacks, ...callbacks };
}

/**
 * Initialise la carte Leaflet
 */
export function initMap() {
    // 1. Calques
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        maxZoom: 19, 
        attribution: '© OpenStreetMap' 
    });
    
    const satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', { 
        maxZoom: 19, 
        attribution: '© IGN' 
    });
    
    cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { 
        maxZoom: 20, 
        attribution: '© IGN' 
    });

    // 2. Carte
    map = L.map('map', { 
        center: VILLAGE_COORDS, 
        zoom: DEFAULT_ZOOM, 
        layers: [satelliteLayer], // Satellite par défaut
        zoomControl: false 
    });

    // 3. Contrôles
    const baseMaps = { "Satellite IGN 🇫🇷": satelliteLayer, "Plan Route 🗺️": osmLayer };
    const overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
    L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, metric: true }).addTo(map);

    // 4. Groupes de Calques
    markersLayer = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            const maxVal = 20;
            let hue = (1 - Math.min(count, maxVal) / maxVal) * 120; 
            if (count > 50) hue = 0;
            
            return L.divIcon({ 
                html: `<div style="background-color: hsla(${hue}, 100%, 40%, 0.9); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.5); box-shadow: 0 4px 8px rgba(0,0,0,0.4); color: white; font-weight: bold; font-family: sans-serif; font-size: 14px;">${count}</div>`, 
                className: 'marker-cluster-custom', 
                iconSize: L.point(40, 40) 
            });
        }
    });
    map.addLayer(markersLayer);

    tracksLayer = L.layerGroup().addTo(map);
    parcelsLayer = L.layerGroup();

    // 5. Clics
    map.on('click', (e) => {
        const isCadastreActive = map.hasLayer(cadastreLayer) && document.getElementById('cadastre-mode-toggle').checked;
        
        if (isCadastreActive) {
            fetchParcelAt(e.latlng);
        } else {
            const event = new CustomEvent('map-click-point', { detail: { latlng: e.latlng } });
            document.dispatchEvent(event);
        }
    });

    return map;
}

/**
 * Affiche les limites du village (JSON)
 */
export function setVillageData(geoJsonData) {
    if (villageLayer) map.removeLayer(villageLayer);
    
    villageLayer = L.geoJSON(geoJsonData, { 
        style: { 
            color: '#ff3333', 
            weight: 4, 
            opacity: 0.9, 
            fillOpacity: 0.05, 
            dashArray: '10, 10' 
        } 
    });
    
    if (document.getElementById('borders-toggle')?.checked) {
        villageLayer.addTo(map);
    }
}

/**
 * Rafraîchit l'affichage des points (SÉCURISÉ)
 */
export function refreshMap(points, filters = {}) {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    points.forEach((p, index) => {
        if (!filters.intruderMode && SECRET_EMOJIS.includes(p.emoji)) return;
        if (filters.emoji && p.emoji !== filters.emoji) return;
        if (filters.text && !p.note.toLowerCase().includes(filters.text)) return;
        
        const [day, month, year] = p.date.split('/');
        if (filters.year && filters.year !== 'all' && year !== filters.year) return;
        if (filters.month && filters.month !== 'all' && parseInt(month) !== parseInt(filters.month)) return;

        const delay = Math.random() * 0.3;
        const customHtml = `<div class="marker-bubble" style="animation-delay: ${delay}s">${p.emoji}</div>`;
        
        const marker = L.marker([p.lat, p.lng], { 
            icon: L.divIcon({ 
                className: 'emoji-icon', 
                html: customHtml, 
                iconSize: [34, 34], 
                iconAnchor: [17, 17] 
            }) 
        });

        // --- CONSTRUCTION SÉCURISÉE DE LA POPUP ---
        const popupDiv = document.createElement('div');
        popupDiv.style.textAlign = 'center';

        // Titre : Emoji + Note (SÉCURISÉ via textContent)
        const title = document.createElement('b');
        title.style.fontSize = '14px';
        title.textContent = `${p.emoji} ${p.note}`;
        popupDiv.appendChild(title);
        
        popupDiv.appendChild(document.createElement('br'));

        // Date
        const dateSpan = document.createElement('span');
        dateSpan.style.fontSize = '11px';
        dateSpan.style.color = '#555';
        dateSpan.textContent = `📅 ${p.date}`;
        popupDiv.appendChild(dateSpan);
        
        popupDiv.appendChild(document.createElement('br'));

        // Météo
        if (p.weather) {
            const weatherSmall = document.createElement('small');
            weatherSmall.style.color = '#8e44ad';
            weatherSmall.style.fontWeight = 'bold';
            weatherSmall.textContent = p.weather;
            popupDiv.appendChild(weatherSmall);
            popupDiv.appendChild(document.createElement('br'));
        }

        // Compteur Historique
        const historySmall = document.createElement('small');
        historySmall.style.color = '#666';
        const histCount = p.history ? p.history.length : 0;
        historySmall.textContent = `${histCount} entrées carnet`;
        popupDiv.appendChild(historySmall);

        // Conteneur Boutons
        const btnContainer = document.createElement('div');
        btnContainer.style.marginTop = '8px';
        btnContainer.style.display = 'flex';
        btnContainer.style.flexDirection = 'column';
        btnContainer.style.gap = '5px';

        // Bouton GPS
        const btnGo = document.createElement('a');
        btnGo.href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
        btnGo.target = '_blank';
        btnGo.className = 'popup-btn-go';
        btnGo.textContent = '🚀 Y aller';
        btnContainer.appendChild(btnGo);

        // Bouton Édition
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-popup-edit';
        btnEdit.textContent = '📝 Carnet / Modif';
        btnEdit.onclick = () => {
            uiCallbacks.onEditPoint(p, index); 
            map.closePopup();
        };
        btnContainer.appendChild(btnEdit);

        popupDiv.appendChild(btnContainer);

        marker.bindPopup(popupDiv);
        markersLayer.addLayer(marker);
    });
}

/**
 * Affiche les parcelles sauvegardées (SÉCURISÉ)
 */
export function displayParcels(savedParcels) {
    if (!parcelsLayer) return;
    parcelsLayer.clearLayers();

    savedParcels.forEach(p => {
        L.geoJSON(p.geoJSON, {
            style: {
                color: '#333',
                weight: 1,
                fillColor: p.color,
                fillOpacity: 0.6
            },
            onEachFeature: (feature, layer) => {
                const area = feature.properties.contenance 
                    ? parseInt(feature.properties.contenance) 
                    : calculateGeoJSONArea(feature.geometry);
                
                // --- POPUP PARCELLE SÉCURISÉE ---
                const div = document.createElement('div');
                div.style.textAlign = 'center';

                const title = document.createElement('b');
                title.style.fontSize = '14px';
                title.style.color = p.color;
                title.style.textShadow = '0 1px 1px rgba(0,0,0,0.2)';
                title.textContent = p.note || "Parcelle";
                div.appendChild(title);

                div.appendChild(document.createElement('br'));

                const areaSpan = document.createElement('span');
                areaSpan.style.fontSize = '16px';
                areaSpan.style.fontWeight = '800';
                areaSpan.textContent = `${(area / 10000).toFixed(2)} ha`;
                div.appendChild(areaSpan);

                div.appendChild(document.createElement('br'));

                const areaSmall = document.createElement('small');
                areaSmall.style.color = '#666';
                areaSmall.textContent = `(${Math.round(area)} m²)`;
                div.appendChild(areaSmall);

                div.appendChild(document.createElement('br'));

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn-popup-delete';
                btnDelete.textContent = '🗑️ Supprimer';
                btnDelete.onclick = () => {
                    uiCallbacks.onDeleteParcel(p.id);
                };
                div.appendChild(btnDelete);

                layer.bindPopup(div);
            }
        }).addTo(parcelsLayer);
    });
}

// --- Fonctions Cadastre ---

export function toggleCadastreMode(isActive) {
    if (isActive) {
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
        if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    } else {
        const showParcels = document.getElementById('show-parcels-toggle')?.checked;
        if (!showParcels) map.removeLayer(cadastreLayer);
        if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer);
    }
}

export function toggleSavedParcels(isActive) {
    if (isActive) {
        if (!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer);
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
    } else {
        map.removeLayer(parcelsLayer);
        const cadastreMode = document.getElementById('cadastre-mode-toggle')?.checked;
        if (!cadastreMode) map.removeLayer(cadastreLayer);
    }
}

export function updateCadastreOpacity(val) {
    if (cadastreLayer) cadastreLayer.setOpacity(val);
}

function fetchParcelAt(latlng) {
    document.body.style.cursor = 'wait';
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${latlng.lng},${latlng.lat}]}`;
    
    fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            document.body.style.cursor = 'default';
            if (data && data.features && data.features.length > 0) {
                triggerHaptic('success');
                uiCallbacks.onParcelFound(data.features[0]);
            } else {
                showToast("Pas de parcelle ici");
            }
        })
        .catch(() => {
            document.body.style.cursor = 'default';
            showToast("Erreur API Cadastre");
        });
}

// --- Heatmap & Borders ---

/**
 * Affiche une Heatmap basée sur la densité des TRAJETS
 * @param {boolean} isActive 
 * @param {Array} trips - Liste des trajets (et non plus des points)
 */
export function toggleHeatmap(isActive, trips) {
    // Nettoyage préventif
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
    }

    if (isActive) {
        // 1. Extraction de TOUS les points de TOUS les trajets
        let heatData = [];
        
        if (!trips || trips.length === 0) {
            showToast("Aucun trajet enregistré pour la Heatmap");
            // On décoche le bouton pour la cohérence UI
            document.getElementById('heatmap-toggle').checked = false;
            return;
        }

        trips.forEach(trip => {
            if (trip.points && trip.points.length > 0) {
                trip.points.forEach(pt => {
                    // On ajoute chaque point gps enregistré dans la heatmap
                    // [lat, lng, intensité]
                    // Une intensité faible (0.2) permet de voir la "chaleur" monter
                    // seulement quand on repasse souvent au même endroit.
                    heatData.push([pt[0], pt[1], 0.2]); 
                });
            }
        });

        if (heatData.length === 0) {
            showToast("Données de trajets vides");
            return;
        }

        // 2. Création de la couche Heatmap optimisée pour des lignes
        heatLayer = L.heatLayer(heatData, { 
            radius: 12,   // Rayon plus fin pour dessiner des "routes"
            blur: 15,     // Flou pour l'effet chaleur
            maxZoom: 16,  // Zoom où l'intensité est maximale
            minOpacity: 0.05,
            gradient: {
                0.2: 'blue',
                0.4: 'lime',
                0.6: 'yellow',
                0.8: 'orange',
                1.0: 'red'
            }
        }).addTo(map);
        
        showToast(`Heatmap générée : ${trips.length} trajets 👣`);

    } else {
        // Désactivation (déjà géré par le nettoyage au début)
        if (heatLayer) map.removeLayer(heatLayer);
    }
}

export function toggleBorders(isActive) {
    if (isActive && villageLayer) villageLayer.addTo(map);
    else if (villageLayer) map.removeLayer(villageLayer);
}

// ============================================================
// --- LOGIQUE REPLAY & AFFICHAGE TRAJET ---
// ============================================================

/**
 * Affiche un trajet unique en statique sur la carte
 */
export function displaySingleTrip(trip, colorCode = '#e74c3c') {
    if (!trip || !trip.points || trip.points.length < 2) return;

    // 1. Nettoyage
    tracksLayer.clearLayers();
    if(replayTraceLayer) map.removeLayer(replayTraceLayer);
    if(replayMarker) map.removeLayer(replayMarker);
    if(replayBgPolyline) map.removeLayer(replayBgPolyline);
    
    // On cache les points pour la clarté
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);

    // 2. Dessin
    const pathCoords = trip.points.map(p => [p[0], p[1]]);
    
    const polyline = L.polyline(pathCoords, { 
        color: colorCode, 
        weight: 6, 
        opacity: 0.9, 
        lineJoin: 'round'
    }).addTo(tracksLayer);

    // 3. Zoom
    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    showToast("Trajet affiché 🗺️");
}

/**
 * Lance l'animation de replay d'un trajet
 */
export function startReplay(trip) {
    if (!trip || !trip.points || trip.points.length < 2) return;

    // Nettoyage préalable
    tracksLayer.clearLayers();
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    if(replayTraceLayer) map.removeLayer(replayTraceLayer);
    if(replayMarker) map.removeLayer(replayMarker);
    if(replayBgPolyline) map.removeLayer(replayBgPolyline);

    // Fond gris (trajet complet)
    replayBgPolyline = L.polyline(trip.points.map(p=>[p[0],p[1]]), { 
        color: '#bdc3c7', weight: 4, opacity: 0.5, dashArray: '5, 10' 
    }).addTo(map);
    map.fitBounds(replayBgPolyline.getBounds(), { padding: [50, 50] });

    // Calque d'animation
    replayTraceLayer = L.layerGroup().addTo(map);
    
    // Marqueur Randonneur
    const startPt = trip.points[0];
    const hikerIcon = L.divIcon({ 
        className: 'hiker-icon-marker', 
        html: '🚶', // Emoji simple, safe
        iconSize: [30, 30], 
        iconAnchor: [15, 28] 
    });
    replayMarker = L.marker([startPt[0], startPt[1]], { icon: hikerIcon, zIndexOffset: 1000 }).addTo(map);

    // Paramètres Animation
    const TARGET_DURATION = 20000;
    const totalPoints = trip.points.length;
    let delay = TARGET_DURATION / totalPoints;
    let stepIncrement = 1;
    const MIN_DELAY = 15;

    if (delay < MIN_DELAY) {
        stepIncrement = Math.ceil(MIN_DELAY / delay);
        delay = MIN_DELAY;
    }

    let i = 0;
    function nextStep() {
        if (i >= trip.points.length) {
            stopReplay();
            uiCallbacks.onReplayFinished();
            return;
        }

        const pt = trip.points[i];
        const latLng = [pt[0], pt[1]];
        replayMarker.setLatLng(latLng);

        // On trace le segment parcouru coloré selon la vitesse
        if (i > 0) {
            let prevIndex = i - stepIncrement;
            if (prevIndex < 0) prevIndex = 0;
            const prevPt = trip.points[prevIndex];
            const speed = pt[3]; // Vitesse enregistrée
            const color = getSpeedColor(speed);
            
            L.polyline([[prevPt[0], prevPt[1]], latLng], { 
                color: color, weight: 5, opacity: 0.9, lineCap: 'round' 
            }).addTo(replayTraceLayer);
        }

        i += stepIncrement;
        replayTimer = setTimeout(nextStep, delay);
    }
    nextStep();
}

/**
 * Arrête le replay et nettoie les éléments d'animation
 */
export function stopReplay() {
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
    
    if (replayMarker) { map.removeLayer(replayMarker); replayMarker = null; }
    if (replayBgPolyline) { map.removeLayer(replayBgPolyline); replayBgPolyline = null; }
    if (replayTraceLayer) { map.removeLayer(replayTraceLayer); replayTraceLayer = null; }
}

/**
 * Nettoie tous les tracés et réaffiche les points
 */
export function clearTracksAndShowPoints() {
    // 1. On efface les tracés statiques
    if (tracksLayer) tracksLayer.clearLayers();
    
    // 2. On arrête le replay et nettoie ses calques
    stopReplay();
    
    // 3. On réaffiche les points (si le mode cadastre ne l'interdit pas)
    const isCadastreActive = document.getElementById('cadastre-mode-toggle')?.checked;
    const isParcelsActive = document.getElementById('show-parcels-toggle')?.checked;
    
    if (!isCadastreActive && !isParcelsActive) {
        if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer);
    }
    
    showToast("Carte nettoyée ✨");
}

// --- Utilitaires Géométrie ---

function getRingArea(coords) {
    if (!coords || coords.length < 3) return 0;
    let area = 0;
    const DEG_TO_M = 111319; 
    const meanLat = coords[0][1] * Math.PI / 180;
    const lonScale = Math.cos(meanLat);
    
    for (let i = 0; i < coords.length; i++) {
        let p1 = coords[i];
        let p2 = coords[(i + 1) % coords.length];
        area += (p1[0] * DEG_TO_M * lonScale * p2[1] * DEG_TO_M) - 
                (p2[0] * DEG_TO_M * lonScale * p1[1] * DEG_TO_M);
    }
    return Math.abs(area / 2.0);
}

export function calculateGeoJSONArea(geometry) {
    if (!geometry) return 0;
    if (geometry.type === "Polygon") return getRingArea(geometry.coordinates[0]);
    if (geometry.type === "MultiPolygon") {
        let total = 0;
        geometry.coordinates.forEach(poly => total += getRingArea(poly[0]));
        return total;
    }
    return 0;
}

// Getters
export function getMapInstance() { return map; }
export function getTracksLayer() { return tracksLayer; }