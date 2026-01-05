// On change le numéro de version pour forcer la mise à jour du cache
const CACHE_NAME = 'begole-map-v10-modular'; 

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './village.json',
  
  // Images
  './logo/logoV2.png',
  
  // Scripts JS (Ajout des nouveaux fichiers !)
  './js/main.js',
  './js/config.js',
  './js/utils.js',
  './js/db.js',
  './js/map.js',
  './js/ui.js',
  './js/tracking.js',
  './js/audio.js',
  './js/gamification.js',
  
  // --- NOUVEAUX FICHIERS ---
  './js/state.js',
  './js/modules/weather.js', 
  // -------------------------

  // Sons
  './audios/sound_day.mp3',
  './audios/sound_night.mp3',
  './audios/sound_rain.mp3',

  // Librairies externes
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Nettoyage ancien cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});