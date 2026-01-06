// État global de l'application
export const appState = {
    points: [],
    trips: [],
    parcels: [],
    begoledex: [], // --- NOUVEAU : Stockage des plantes trouvées ---
    currentEnv: { 
        moon: "", 
        temp: "--", 
        weather: "", 
        wind: 0,           // Vitesse du vent
        isDay: true,       // Jour/Nuit API
        sunrise: null,     // Heure lever
        sunset: null,      // Heure coucher
        fullString: "" 
    },
    userPosition: null // { lat, lng, acc, heading }
};

// Metteurs à jour simples (Setters)
export function setPoints(data) { appState.points = data; }
export function setTrips(data) { appState.trips = data; }
export function setParcels(data) { appState.parcels = data; }
export function setBegoledex(data) { appState.begoledex = data; } // --- NOUVEAU ---

// Met à jour l'environnement et notifie si besoin
export function updateEnv(key, value) {
    if (appState.currentEnv[key] !== undefined) {
        appState.currentEnv[key] = value;
    }
    
    // Construction de la chaîne complète
    const tempStr = appState.currentEnv.temp !== "--" ? `${appState.currentEnv.temp}°C` : "";
    const windStr = appState.currentEnv.wind > 20 ? "💨 Vent" : "";
    
    appState.currentEnv.fullString = `${appState.currentEnv.weather} ${tempStr} ${windStr} • ${appState.currentEnv.moon}`.trim();
}