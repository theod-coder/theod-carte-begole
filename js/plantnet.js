import { PLANTNET_API_URL } from './config.js';
import { compressImage, showToast } from './utils.js';
// --- IMPORT NOUVEAU : Pour sauvegarder dans la collection ---
import { tryAddToBegoledex } from './begoledex.js';

/**
 * Gère l'upload et l'identification
 * @param {HTMLInputElement} inputElement 
 */
export async function handlePlantUpload(inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    document.getElementById('plantnet-upload-area').classList.add('hidden');
    document.getElementById('plantnet-loading').classList.remove('hidden');
    document.getElementById('plantnet-results').classList.add('hidden');

    try {
        // 1. Version HAUTE QUALITÉ pour l'API (Analyse IA)
        // On garde 1000px et 0.8 pour que l'IA voit bien les détails
        const apiImageData = await compressImage(file, 1000, 0.8);
        const blob = await (await fetch(apiImageData)).blob();

        // 2. Version LÉGÈRE pour le Bégoledex (Stockage)
        // On réduit drastiquement : 600px et 0.6 qualité (suffisant pour écran mobile)
        const storageImageData = await compressImage(file, 600, 0.6);

        // --- Envoi API ---
        const formData = new FormData();
        formData.append('images', blob);
        const organ = document.getElementById('plant-organ').value || 'auto';
        formData.append('organs', organ);

        const response = await fetch(PLANTNET_API_URL, { method: 'POST', body: formData });
        if (!response.ok) throw new Error("Erreur API PlantNet");

        const data = await response.json();
        
        // ⚠️ IMPORTANT : On passe l'image LÉGÈRE à l'affichage et au stockage
        displayResults(data, storageImageData);

    } catch (error) {
        console.error(error);
        showToast("Erreur d'identification 😢");
        resetPlantNetUI();
    }
}

/**
 * Affiche les résultats dans la modale et gère l'ajout au Bégoledex
 * @param {Object} data - Réponse de l'API
 * @param {string} originalImage - L'image prise par l'utilisateur (Base64)
 */
function displayResults(data, originalImage) {
    const container = document.getElementById('plantnet-results');
    container.innerHTML = "";
    
    if (!data.results || data.results.length === 0) {
        container.innerHTML = "<p>Aucune plante reconnue...</p>";
    } else {
        const bestResult = data.results[0];
        const bestScore = Math.round(bestResult.score * 100);

        // --- LOGIQUE BÉGOLEDEX ---
        // SEUIL MODIFIÉ À 25% (au lieu de 40%)
        if (bestScore > 25) {
            const plantData = {
                name: bestResult.species.commonNames[0] || bestResult.species.scientificNameWithoutAuthor,
                sciName: bestResult.species.scientificNameWithoutAuthor,
                image: originalImage, // On garde la photo de l'utilisateur !
                score: bestScore
            };
            tryAddToBegoledex(plantData);
        }
        // -------------------------

        // Affichage des 3 meilleurs résultats
        data.results.slice(0, 3).forEach(res => {
            const score = Math.round(res.score * 100);
            const name = res.species.scientificNameWithoutAuthor;
            const common = res.species.commonNames[0] || name;
            const image = res.images && res.images.length > 0 ? res.images[0].url.m : '';

            // On repère si c'est la plante qui vient d'être sauvegardée
            // IL FAUT BIEN UTILISER LE MÊME SEUIL ICI (25)
            const isSaved = (res === bestResult && score > 25);

            const card = document.createElement('div');
            card.className = 'plant-result-card';
            
            // Petit style spécial si c'est validé
            if (isSaved) {
                card.style.border = "2px solid #2ecc71";
                card.style.background = "#f0fff4";
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
    
    // Bouton retour
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
}