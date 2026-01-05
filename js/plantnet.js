import { PLANTNET_API_URL } from './config.js';
import { compressImage, showToast } from './utils.js';

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
        // 1. Compression de l'image (l'API est limitée en taille)
        const compressedDataUrl = await compressImage(file, 1000, 0.8);
        const blob = await (await fetch(compressedDataUrl)).blob();

        // 2. Préparation du FormData
        const formData = new FormData();
        formData.append('images', blob);
        
        // Récupération de l'organe choisi (feuille, fleur...)
        const organ = document.getElementById('plant-organ').value || 'auto';
        formData.append('organs', organ);

        // 3. Appel API
        const response = await fetch(PLANTNET_API_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error("Erreur API PlantNet");

        const data = await response.json();
        displayResults(data);

    } catch (error) {
        console.error(error);
        showToast("Erreur d'identification 😢");
        resetPlantNetUI();
    }
}

/**
 * Affiche les résultats dans la modale
 */
function displayResults(data) {
    const container = document.getElementById('plantnet-results');
    container.innerHTML = "";
    
    if (!data.results || data.results.length === 0) {
        container.innerHTML = "<p>Aucune plante reconnue...</p>";
    } else {
        // On prend les 3 meilleurs résultats
        data.results.slice(0, 3).forEach(res => {
            const score = Math.round(res.score * 100);
            const name = res.species.scientificNameWithoutAuthor;
            const common = res.species.commonNames[0] || name;
            const image = res.images && res.images.length > 0 ? res.images[0].url.m : '';

            const card = document.createElement('div');
            card.className = 'plant-result-card';
            card.innerHTML = `
                <img src="${image}" class="plant-thumb">
                <div class="plant-info">
                    <span class="plant-name">${common}</span><br>
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