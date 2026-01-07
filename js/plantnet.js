import { PLANTNET_API_URL } from './config.js';
import { compressImage, showToast } from './utils.js';
// --- AJOUT : On importe l'état pour avoir la position GPS ---
import { appState } from './state.js'; 
import { tryAddToBegoledex } from './begoledex.js';

/**
 * Gère l'upload et l'identification
 * @param {HTMLInputElement} inputElement 
 */
export async function handlePlantUpload(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    // UI : Afficher le chargement
    document.getElementById('plantnet-upload-area').classList.add('hidden');
    document.getElementById('plantnet-loading').classList.remove('hidden');
    document.getElementById('plantnet-results').classList.add('hidden');

    try {
        // 1. Version HAUTE QUALITÉ pour l'API (Analyse IA)
        const apiImageData = await compressImage(file, 1000, 0.8);
        const blob = await (await fetch(apiImageData)).blob();

        // 2. Version LÉGÈRE pour le Bégoledex (Stockage)
        const storageImageData = await compressImage(file, 600, 0.6);

        // 3. Préparation du FormData
        const formData = new FormData();
        formData.append('images', blob);
        
        const organ = document.getElementById('plant-organ').value || 'auto';
        formData.append('organs', organ);

        // 4. Appel API
        const response = await fetch(PLANTNET_API_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error("Erreur API PlantNet");

        const data = await response.json();
        
        // On passe l'image LÉGÈRE pour le stockage
        displayResults(data, storageImageData);

    } catch (error) {
        console.error(error);
        showToast("Erreur d'identification 😢");
        resetPlantNetUI();
    }
}

/**
 * Affiche les résultats et gère l'ajout intelligent
 */
function displayResults(data, originalImage) {
    const container = document.getElementById('plantnet-results');
    container.innerHTML = "";
    
    if (!data.results || data.results.length === 0) {
        container.innerHTML = "<p>Aucune plante reconnue...</p>";
    } else {
        const bestResult = data.results[0];
        const bestScore = Math.round(bestResult.score * 100);

        // --- LOGIQUE BÉGOLEDEX GÉOLOCALISÉ ---
        if (bestScore > 25) {
            // Récupération de la position actuelle si disponible
            let userLat = null;
            let userLng = null;
            
            if (appState.userPosition && appState.userPosition.lat) {
                userLat = appState.userPosition.lat;
                userLng = appState.userPosition.lng;
            }

            const plantData = {
                name: bestResult.species.commonNames[0] || bestResult.species.scientificNameWithoutAuthor,
                sciName: bestResult.species.scientificNameWithoutAuthor,
                image: originalImage,
                score: bestScore,
                lat: userLat, // <-- AJOUT GPS
                lng: userLng  // <-- AJOUT GPS
            };
            tryAddToBegoledex(plantData);
        }
        // -------------------------------------

        // Affichage des résultats
        data.results.slice(0, 3).forEach(res => {
            const score = Math.round(res.score * 100);
            const name = res.species.scientificNameWithoutAuthor;
            const common = res.species.commonNames[0] || name;
            const image = res.images && res.images.length > 0 ? res.images[0].url.m : '';

            const isSaved = (res === bestResult && score > 25);

            const card = document.createElement('div');
            card.className = 'plant-result-card';
            
            if (isSaved) {
                card.style.border = "2px solid #2ecc71";
            }

            card.innerHTML = `
                <img src="${image}" class="plant-thumb" alt="${common}">
                <div class="plant-info">
                    <span class="plant-name">
                        ${common} ${isSaved ? '✅' : ''}
                    </span><br>
                    <span class="plant-sci">${name}</span>
                    <div class="score-container">
                        <div class="score-bar" style="width:${score}%"></div>
                    </div>
                    <small>${score}% de confiance</small>
                </div>
            `;
            container.appendChild(card);
        });
    }

    document.getElementById('plantnet-loading').classList.add('hidden');
    container.classList.remove('hidden');
    
    const btnReset = document.createElement('button');
    btnReset.innerText = "🔄 Nouvelle Photo";
    btnReset.className = "btn-cancel";
    btnReset.style.marginTop = "10px";
    btnReset.onclick = resetPlantNetUI;
    container.appendChild(btnReset);
}

export function resetPlantNetUI() {
    document.getElementById('plantnet-upload-area').classList.remove('hidden');
    document.getElementById('plantnet-loading').classList.add('hidden');
    document.getElementById('plantnet-results').classList.add('hidden');
    document.getElementById('plantnet-file-input').value = "";
    
    // Remise à zéro sur "Auto"
    const organSelect = document.getElementById('plant-organ');
    if (organSelect) organSelect.value = "auto";
}