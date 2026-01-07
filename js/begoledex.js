import { saveToDB, deleteFromDB } from './db.js';
import { appState } from './state.js';
import { showToast, triggerHaptic } from './utils.js';
// --- AJOUT : Import pour contrôler la carte ---
import { getMapInstance } from './map.js';

/**
 * Tente d'ajouter une plante au Bégoledex
 * @param {Object} plantData { name, sciName, image, score, lat, lng }
 */
export async function tryAddToBegoledex(plantData) {
    // Vérification doublon
    const exists = appState.begoledex.find(p => p.sciName === plantData.sciName);
    
    if (exists) {
        showToast(`Déjà dans le Bégoledex : ${plantData.name} 📒`);
        return;
    }

    const newEntry = {
        id: Date.now(),
        name: plantData.name,
        sciName: plantData.sciName,
        image: plantData.image, 
        date: new Date().toLocaleDateString(),
        score: plantData.score,
        // Sauvegarde des coordonnées (si dispos)
        lat: plantData.lat || null,
        lng: plantData.lng || null
    };

    await saveToDB('begoledex', newEntry);
    appState.begoledex.push(newEntry);
    
    triggerHaptic('success');
    showToast(`✨ Nouveau : ${plantData.name} ajouté au Bégoledex !`);
}

/**
 * Ouvre la modale et génère la grille d'affichage
 */
export function openBegoledexModal() {
    const grid = document.getElementById('begoledex-grid');
    const modal = document.getElementById('modal-begoledex');
    const countEl = document.getElementById('begoledex-count');

    if (!grid || !modal) return;
    
    if (countEl) {
        countEl.innerText = `${appState.begoledex.length} plante${appState.begoledex.length > 1 ? 's' : ''} trouvée${appState.begoledex.length > 1 ? 's' : ''}`;
    }

    grid.innerHTML = "";

    if (appState.begoledex.length === 0) {
        grid.innerHTML = `
            <div style="text-align:center; padding:30px; color:#888; grid-column: 1 / -1; font-style: italic;">
                <div style="font-size: 40px; margin-bottom: 10px;">🍃</div>
                Ton herbier est vide...<br>
                <small>Utilise l'outil "Identifier Plante" et obtiens un score > 25% pour collectionner !</small>
            </div>`;
    } else {
        const sorted = [...appState.begoledex].sort((a,b) => b.id - a.id);

        sorted.forEach(plant => {
            const card = document.createElement('div');
            card.className = "begoledex-card";
            
            // On vérifie si on a la géolocalisation pour afficher le bouton carte
            const hasLoc = (plant.lat && plant.lng);
            const locBtnHtml = hasLoc 
                ? `<button class="btn-locate-plant" title="Voir sur la carte" style="position:absolute; bottom:5px; right:5px; background:rgba(255,255,255,0.9); border:none; border-radius:50%; width:30px; height:30px; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.2); font-size:16px;">🗺️</button>`
                : '';

            card.innerHTML = `
                <img src="${plant.image}" loading="lazy" alt="${plant.name}">
                <div class="begoledex-info">
                    <div class="begoledex-name">${plant.name}</div>
                    <div class="begoledex-sci">${plant.sciName}</div>
                    <div class="begoledex-date">📅 ${plant.date} • ${plant.score}%</div>
                </div>
                <button class="btn-del-plant" title="Supprimer">×</button>
                ${locBtnHtml}
            `;

            // Action : Voir sur la carte
            if (hasLoc) {
                const btnLoc = card.querySelector('.btn-locate-plant');
                if (btnLoc) {
                    btnLoc.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 1. On ferme la modale
                        document.getElementById('modal-begoledex').classList.add('hidden');
                        
                        // 2. On centre la carte
                        const map = getMapInstance();
                        if (map) {
                            map.setView([plant.lat, plant.lng], 18);
                            // Petit effet visuel (popup temporaire)
                            L.popup()
                                .setLatLng([plant.lat, plant.lng])
                                .setContent(`<b>${plant.name}</b><br>Trouvée ici le ${plant.date} 🌱`)
                                .openOn(map);
                        }
                    });
                }
            }

            // Action : Supprimer
            const btnDel = card.querySelector('.btn-del-plant');
            if (btnDel) {
                btnDel.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if(confirm(`Retirer ${plant.name} de ta collection définitivement ?`)) {
                        await deleteFromDB('begoledex', plant.id);
                        appState.begoledex = appState.begoledex.filter(p => p.id !== plant.id);
                        openBegoledexModal(); 
                        showToast("Plante retirée 🗑️");
                    }
                });
            }

            // Action : Zoomer image
            card.addEventListener('click', () => {
                const lightboxImg = document.getElementById('lightbox-img');
                const lightboxOverlay = document.getElementById('lightbox-overlay');
                if (lightboxImg && lightboxOverlay) {
                    lightboxImg.src = plant.image;
                    lightboxOverlay.classList.remove('hidden');
                    lightboxOverlay.onclick = () => {
                        lightboxOverlay.classList.add('hidden');
                        lightboxImg.src = "";
                    };
                }
            });

            grid.appendChild(card);
        });
    }

    modal.classList.remove('hidden');
    const menu = document.getElementById('menu-items');
    if (menu) menu.classList.add('hidden-mobile');
}