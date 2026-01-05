import { VILLAGE_COORDS } from '../config.js';
import { appState, updateEnv } from '../state.js';
import { updateAudioWeather } from '../audio.js';
import { pad } from '../utils.js';

// --- LOGIQUE ASTRO (LUNE / SOLEIL) ---
export function updateAstroWidget() {
    const date = new Date();
    
    // 1. Calcul Phase de Lune (Algorithme simple)
    let year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
    let m = month, y = year;
    if (m < 3) { y--; m += 12; }
    ++m;
    let c = 365.25 * y, e = 30.6 * m, jd = c + e + day - 694039.09;
    jd /= 29.5305882;
    let b = parseInt(jd); jd -= b; b = Math.round(jd * 8);
    if (b >= 8) b = 0;
    
    const moons = ['🌑 Nouv.', '🌒 Crois.', '🌓 Premier', '🌔 Gib.', '🌕 Pleine', '🌖 Gib.', '🌗 Dernier', '🌘 Crois.'];
    const moonString = `Lune : ${moons[b]} ${(jd * 100).toFixed(0)}%`;
    
    updateEnv('moon', moonString);
    
    const moonEl = document.getElementById('astro-moon');
    if (moonEl) moonEl.innerText = moonString;

    // 2. Calcul Coucher de Soleil
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    // Approximation sinus pour l'heure du coucher
    let sunsetHour = 19.5 + (Math.sin((dayOfYear - 80) * 0.0172) * 2.3);
    const currentHour = date.getHours() + date.getMinutes() / 60;
    let remaining = sunsetHour - currentHour;

    const sunEl = document.getElementById('astro-sun');
    if (sunEl) {
        if (remaining < 0) {
            sunEl.innerText = "🌑 Nuit";
            sunEl.classList.remove('sun-alert');
            document.body.classList.add('theme-dark');
            toggleDeepNightUI(true); // Active mode nuit profonde auto
        } else {
            const h = Math.floor(remaining);
            const min = Math.floor((remaining - h) * 60);
            sunEl.innerText = `☀️ Reste ${h}h${pad(min)}`;
            sunEl.classList.toggle('sun-alert', remaining < 1);
            
            // Golden Hour
            if (remaining < 1) document.body.classList.add('theme-golden');
            else document.body.classList.remove('theme-golden', 'theme-dark');
            
            toggleDeepNightUI(false);
        }
    }
}

// --- LOGIQUE API MÉTÉO ---
export function updateWeatherWidget() {
    // Utilise la position utilisateur si dispo, sinon le village
    let lat = VILLAGE_COORDS[0], lng = VILLAGE_COORDS[1];
    if (appState.userPosition) {
        lat = appState.userPosition.lat;
        lng = appState.userPosition.lng;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code&timezone=auto`;

    fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || !data.current) return;
            
            const temp = Math.round(data.current.temperature_2m);
            const code = data.current.weather_code;
            
            // Traduction code WMO
            let desc = "Calme";
            if (code === 0) desc = "☀️ Soleil";
            else if (code <= 3) desc = "⛅ Nuageux";
            else if (code >= 45 && code <= 48) desc = "🌫️ Brouillard";
            else if (code >= 51 && code <= 67) desc = "🌧️ Pluie";
            else if (code >= 71 && code <= 77) desc = "❄️ Neige";
            else if (code >= 95) desc = "⚡ Orage";

            // Mise à jour UI
            document.getElementById('weather-desc').innerText = desc;
            document.getElementById('weather-temp').innerText = `🌡️ ${temp}°C`;

            // Mise à jour État & Audio
            updateEnv('temp', temp);
            updateEnv('weather', desc);
            updateAudioWeather(desc);
            
            // Effets visuels (Nuages, Pluie) via Custom Event ou appel direct
            triggerWeatherVisuals(desc, code);
        })
        .catch(console.error);
}

// Helpers internes pour les effets visuels (simplifiés ici)
function toggleDeepNightUI(autoActive) {
    const deepPref = localStorage.getItem('begole_deep_night_pref');
    // Si l'utilisateur a forcé une préférence, on la respecte, sinon c'est auto
    const isActive = (deepPref !== null) ? (deepPref === 'true') : autoActive;
    
    const toggle = document.getElementById('deep-night-toggle');
    if (toggle) toggle.checked = isActive;
    
    if (isActive) document.body.classList.add('deep-night-active');
    else document.body.classList.remove('deep-night-active');
}

function triggerWeatherVisuals(desc, code) {
    // Logique pluie/neige/nuages (Tu peux copier la fonction triggerWeatherEffect de ui.js ici)
    // Pour simplifier, on déclenche un event que ui.js peut écouter, ou on importe une fonction de ui.js
    // Ici, pour l'exemple, on suppose que tu déplaces aussi `triggerWeatherEffect` ici ou dans un `visuals.js`
    
    // Gestion Nuages auto
    if ((code >= 1 && code <= 3) && localStorage.getItem('begole_clouds_pref') !== 'false') {
        const cloudToggle = document.getElementById('clouds-toggle');
        if(cloudToggle && !cloudToggle.checked) {
            cloudToggle.click(); // Hack simple pour activer
        }
    }
}