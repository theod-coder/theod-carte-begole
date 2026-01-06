import { VILLAGE_COORDS } from '../config.js';
import { appState, updateEnv } from '../state.js';
import { updateAudioWeather } from '../audio.js';
import { triggerWeatherEffect, updateWindVisuals } from '../ui.js';
import { pad } from '../utils.js';

// --- LOGIQUE ASTRO (LUNE & SOLEIL) ---
export function updateAstroWidget() {
    const date = new Date();
    
    // Calcul Phase de Lune
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

    // Mise à jour Soleil
    if (appState.currentEnv.sunrise && appState.currentEnv.sunset) {
        updateSunUI();
    }
}

function updateSunUI() {
    const now = new Date();
    const sunrise = new Date(appState.currentEnv.sunrise);
    const sunset = new Date(appState.currentEnv.sunset);
    const sunEl = document.getElementById('astro-sun');
    
    if (!sunEl) return;

    if (now < sunrise) {
        const diff = (sunrise - now) / (1000 * 60 * 60);
        sunEl.innerText = `🌅 Aube ds ${Math.max(0, Math.round(diff))}h`;
        sunEl.classList.remove('sun-alert');
    } else if (now < sunset) {
        const diff = (sunset - now) / (1000 * 60 * 60);
        const h = Math.floor(diff);
        const m = Math.floor((diff - h) * 60);
        sunEl.innerText = `☀️ Reste ${h}h${pad(m)}`;
        sunEl.classList.toggle('sun-alert', diff < 1);
    } else {
        sunEl.innerText = "🌑 Nuit";
        sunEl.classList.remove('sun-alert');
    }
}

// --- LOGIQUE API MÉTÉO ---
export function updateWeatherWidget() {
    let lat = VILLAGE_COORDS[0], lng = VILLAGE_COORDS[1];
    if (appState.userPosition) {
        lat = appState.userPosition.lat;
        lng = appState.userPosition.lng;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=auto`;

    fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || !data.current) return;
            
            const temp = Math.round(data.current.temperature_2m);
            const code = data.current.weather_code;
            const wind = data.current.wind_speed_10m;
            const isDay = data.current.is_day === 1;

            const sunrise = data.daily.sunrise[0];
            const sunset = data.daily.sunset[0];

            let desc = "Calme";
            if (code === 0) desc = "☀️ Soleil";
            else if (code <= 3) desc = "⛅ Nuageux";
            else if (code >= 45 && code <= 48) desc = "🌫️ Brouillard";
            else if (code >= 51 && code <= 67) desc = "🌧️ Pluie";
            else if (code >= 71 && code <= 77) desc = "❄️ Neige";
            else if (code >= 95) desc = "⚡ Orage";

            // --- MISE À JOUR ROBUSTE DE L'INTERFACE ---
            // On reconstruit le HTML du widget pour être sûr que le vent s'affiche
            const widget = document.getElementById('weather-widget-btn');
            if (widget) {
                // On force le style colonne ici aussi par sécurité
                widget.style.flexDirection = 'column';
                widget.style.justifyContent = 'center';
                widget.style.padding = '5px';

                widget.innerHTML = `
                    <div class="env-row" style="margin:0; width: 100%; justify-content: space-around; display:flex;">
                        <div style="font-size:11px;">${desc}</div>
                        <div style="font-size:12px;">🌡️ ${temp}°C</div>
                    </div>
                    <div style="font-size:10px; width: 100%; text-align:center; border-top:1px solid rgba(255,255,255,0.3); margin-top:3px; padding-top:2px;">
                        💨 ${Math.round(wind)} km/h
                    </div>
                `;
            }

            // Mise à jour État Global
            updateEnv('temp', temp);
            updateEnv('weather', desc);
            updateEnv('wind', wind);
            updateEnv('isDay', isDay);
            updateEnv('sunrise', sunrise);
            updateEnv('sunset', sunset);

            updateAudioWeather(desc);
            
            // Thèmes & Effets
            applyDynamicTheme(sunrise, sunset, isDay);
            triggerWeatherEffect(desc);
            updateWindVisuals(wind > 20);

            // Mise à jour Astro (soleil) maintenant qu'on a les heures
            updateAstroWidget();
        })
        .catch(console.error);
}

function applyDynamicTheme(sunriseIso, sunsetIso, isDayApi) {
    const now = new Date();
    const sunrise = new Date(sunriseIso);
    const sunset = new Date(sunsetIso);
    const transitionDuration = 45; 
    
    const minFromSunrise = (now - sunrise) / 60000;
    const minToSunset = (sunset - now) / 60000;

    document.body.classList.remove('theme-dawn', 'theme-golden', 'theme-dark');
    
    if (minFromSunrise > -30 && minFromSunrise < transitionDuration) {
        document.body.classList.add('theme-dawn');
        toggleDeepNightUI(false);
    } else if (minToSunset > 0 && minToSunset < 60) {
        document.body.classList.add('theme-golden');
        toggleDeepNightUI(false);
    } else if (!isDayApi || minToSunset <= 0) {
        document.body.classList.add('theme-dark');
        toggleDeepNightUI(true); 
    } else {
        toggleDeepNightUI(false);
    }
}

function toggleDeepNightUI(autoActive) {
    const deepPref = localStorage.getItem('begole_deep_night_pref');
    const isActive = (deepPref !== null) ? (deepPref === 'true') : autoActive;
    
    const toggle = document.getElementById('deep-night-toggle');
    if (toggle) toggle.checked = isActive;
    
    if (isActive) document.body.classList.add('deep-night-active');
    else document.body.classList.remove('deep-night-active');
}