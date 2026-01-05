// État global de l'application
export const appState = {
    points: [],
    trips: [],
    parcels: [],
    currentEnv: { 
        moon: "", 
        temp: "--", 
        weather: "", 
        fullString: "" 
    },
    userPosition: null // { lat, lng, acc, heading }
};

// Metteurs à jour simples (Setters)
export function setPoints(data) { appState.points = data; }
export function setTrips(data) { appState.trips = data; }
export function setParcels(data) { appState.parcels = data; }

// Met à jour l'environnement et notifie si besoin (on pourrait ajouter des events ici plus tard)
export function updateEnv(key, value) {
    appState.currentEnv[key] = value;
    appState.currentEnv.fullString = `${appState.currentEnv.weather} ${appState.currentEnv.temp != "--" ? appState.currentEnv.temp + "°C" : ""} • ${appState.currentEnv.moon}`;
}