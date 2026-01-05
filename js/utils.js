/**
 * Affiche une notification temporaire (Toast) en bas de l'écran
 * @param {string} message - Le texte à afficher
 * @param {number} duration - Durée en ms (défaut: 3000)
 */
export function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-msg'; // Assurez-vous d'avoir ce style dans CSS
    toast.innerText = message;
    
    // Style par défaut si pas dans le CSS
    if (!toast.classList.contains('toast-msg')) {
        Object.assign(toast.style, {
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '25px',
            marginTop: '10px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.3s forwards',
            fontSize: '14px',
            backdropFilter: 'blur(4px)'
        });
    }

    container.appendChild(toast);

    // Suppression automatique
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

/**
 * Déclenche un retour haptique (vibration)
 * @param {string} type - 'success', 'warning', 'error', 'start'
 */
export function triggerHaptic(type) {
    if (!navigator.vibrate) return;

    switch (type) {
        case 'success':
            navigator.vibrate([50, 50, 50]); // Deux petits coups
            break;
        case 'warning':
            navigator.vibrate(200); // Un coup moyen
            break;
        case 'error':
            navigator.vibrate([100, 50, 100, 50, 100]); // Trois coups
            break;
        case 'start':
            navigator.vibrate([50, 100, 200]); // Montée en puissance
            break;
        default:
            navigator.vibrate(50); // Touche simple
    }
}

/**
 * Ajoute un zéro devant les chiffres < 10 (ex: 9 -> "09")
 * @param {number} n 
 * @returns {string}
 */
export function pad(n) {
    return n < 10 ? '0' + n : n;
}

/**
 * Formate une durée en millisecondes vers MM:SS ou HH:MM:SS
 * @param {number} ms 
 * @returns {string}
 */
export function formatDuration(ms) {
    if (!ms || ms < 0) return "00:00";
    
    let seconds = Math.floor(ms / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);

    seconds = seconds % 60;
    minutes = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${pad(minutes)}m`;
    } else {
        return `${pad(minutes)}:${pad(seconds)}`;
    }
}

/**
 * Retourne une couleur CSS en fonction de la vitesse (pour les tracés)
 * @param {number} speedMs - Vitesse en m/s
 * @returns {string} Code couleur Hex
 */
export function getSpeedColor(speedMs) {
    if (speedMs === null || speedMs === undefined) return '#95a5a6'; // Gris
    
    const speedKmh = speedMs * 3.6;

    if (speedKmh < 1) return '#bdc3c7'; // À l'arrêt (Gris clair)
    if (speedKmh < 4) return '#3498db'; // Marche lente (Bleu)
    if (speedKmh < 7) return '#2ecc71'; // Marche active (Vert)
    if (speedKmh < 15) return '#f1c40f'; // Course (Jaune)
    if (speedKmh < 30) return '#e67e22'; // Vélo (Orange)
    return '#e74c3c'; // Rapide / Voiture (Rouge)
}

/**
 * Compresse une image avant stockage (Redimensionnement + JPEG)
 * Indispensable pour ne pas saturer le stockage IndexedDB
 * @param {File} file - Fichier image input
 * @param {number} maxWidth - Largeur max (ex: 800px)
 * @param {number} quality - Qualité JPEG (0 à 1)
 * @returns {Promise<string>} DataURL (base64)
 */
export function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Redimensionnement proportionnel
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Export en JPEG compressé
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            
            img.onerror = (err) => reject(err);
        };
        
        reader.onerror = (err) => reject(err);
    });
}

/**
 * Nettoie les doublons dans une liste d'objets basés sur l'ID
 * @param {Array} items 
 * @returns {Promise<void>} (Modifie le tableau en place ou renvoie nettoyé si besoin)
 */
export async function cleanDuplicates(items) {
    const seen = new Set();
    const duplicates = [];
    
    // Identification
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (seen.has(item.id)) {
            duplicates.push(i);
        } else {
            seen.add(item.id);
        }
    }

    // Suppression
    duplicates.forEach(index => {
        items.splice(index, 1);
    });

    if (duplicates.length > 0) {
        console.log(`🧹 Nettoyage : ${duplicates.length} doublons supprimés.`);
    }
}

/**
 * Génère une couleur aléatoire (Hex)
 * @returns {string}
 */
export function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Fonction de nettoyage (à mettre dans utils.js par exemple)
export function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}