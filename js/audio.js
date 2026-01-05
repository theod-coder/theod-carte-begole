import { showToast } from './utils.js';

// --- État interne du module Audio ---
let isSoundActive = false;
let currentAudioTrack = null;
let currentEnvWeather = ""; // Stocke la dernière météo reçue

// --- Chargement des pistes ---
// Les chemins sont relatifs à la racine (index.html)
const audioTracks = {
    day: new Audio('../audios/sound_day.mp3'),
    rain: new Audio('../audios/sound_rain.mp3'),
    night: new Audio('../audios/sound_night.mp3')
};

// Configuration initiale : boucle et volume à 0 pour les fondus
Object.values(audioTracks).forEach(a => {
    a.loop = true;
    a.volume = 0;
});

/**
 * Initialise l'audio au démarrage de l'app
 * Vérifie si l'utilisateur avait activé le son précédemment
 */
export function initAudio() {
    const savedPref = localStorage.getItem('begole_sound_pref');
    if (savedPref === 'true') {
        isSoundActive = true;
        updateSoundBtnUI(true);
        // Note: Le navigateur peut bloquer l'autoplay ici sans interaction utilisateur
        // On tente quand même, sinon ça marchera au premier clic
        checkAndPlayAmbiance();
    }
}

/**
 * Active ou désactive l'ambiance sonore (Action bouton)
 */
export function toggleSoundscape() {
    isSoundActive = !isSoundActive;
    localStorage.setItem('begole_sound_pref', isSoundActive);

    updateSoundBtnUI(isSoundActive);

    if (isSoundActive) {
        showToast("🔈 Ambiance activée...");
        checkAndPlayAmbiance();
    } else {
        stopAllSounds();
        showToast("🔇 Son coupé");
    }
}

/**
 * Met à jour la météo connue par le système audio
 * Doit être appelé par le module météo (weather widget)
 * @param {string} weatherString - ex: "Pluie", "Soleil", "Orage"
 */
export function updateAudioWeather(weatherString) {
    currentEnvWeather = weatherString || "";
    // Si le son est actif, on vérifie si on doit changer de piste (ex: il commence à pleuvoir)
    if (isSoundActive) {
        checkAndPlayAmbiance();
    }
}

/**
 * Logique principale : Choisit la bonne piste selon l'heure (Nuit) ou la Météo (Pluie)
 */
export function checkAndPlayAmbiance() {
    if (!isSoundActive) return;

    let targetTrack = 'day';
    
    // Détection Nuit basée sur la classe CSS du body (source de vérité du thème)
    const isNight = document.body.classList.contains('theme-dark');
    const weatherText = currentEnvWeather.toLowerCase();
    
    // Détection Pluie
    const isRaining = weatherText.includes('pluie') || 
                      weatherText.includes('averse') || 
                      weatherText.includes('orage');

    // Priorité : Nuit > Pluie > Jour (ou l'inverse selon préférence, ici Nuit gagne)
    if (isNight) {
        targetTrack = 'night';
    } else if (isRaining) {
        targetTrack = 'rain';
    }

    playTrack(targetTrack);
}

/**
 * Joue la piste demandée avec un effet de fondu enchaîné (Crossfade)
 * @param {string} trackName - 'day', 'night', ou 'rain'
 */
function playTrack(trackName) {
    const newAudio = audioTracks[trackName];
    
    // Si c'est déjà la piste qui joue, on ne fait rien
    if (currentAudioTrack === newAudio && !newAudio.paused) return;

    // 1. Fade Out de l'ancienne piste
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

    // 2. Fade In de la nouvelle piste
    currentAudioTrack = newAudio;
    
    // Promesse play() pour gérer les blocages navigateurs
    const playPromise = newAudio.play();
    
    if (playPromise !== undefined) {
        playPromise.then(() => {
            let fadeIn = setInterval(() => {
                if (newAudio.volume < 0.5) { // Volume max à 50% pour ne pas être agressif
                    newAudio.volume += 0.05;
                } else {
                    clearInterval(fadeIn);
                }
            }, 100);
        }).catch(error => {
            console.warn("Autoplay audio empêché par le navigateur :", error);
            // On ne désactive pas forcément le bouton, l'utilisateur recliquera
        });
    }
}

/**
 * Arrête tous les sons immédiatement
 */
function stopAllSounds() {
    Object.values(audioTracks).forEach(a => {
        a.pause();
        a.currentTime = 0;
    });
    currentAudioTrack = null;
}

/**
 * Met à jour l'apparence du bouton Son dans le DOM
 * @param {boolean} active 
 */
function updateSoundBtnUI(active) {
    const btn = document.getElementById('btn-sound');
    if (btn) {
        const icon = btn.querySelector('.grid-icon');
        if (active) {
            btn.style.background = "#e67e22";
            if(icon) icon.innerText = "🔊";
        } else {
            btn.style.background = "#34495e";
            if(icon) icon.innerText = "🔇";
        }
    }
}