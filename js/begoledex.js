import { saveToDB, deleteFromDB } from './db.js';
import { appState } from './state.js';
import { showToast, triggerHaptic } from './utils.js';

/**
 * Tente d'ajouter une plante au Bégoledex
 * @param {Object} plantData { name, sciName, image, score }
 */
export async function tryAddToBegoledex(plantData) {
    // Vérification doublon (basé sur le nom scientifique)
    // On vérifie si la plante existe déjà dans la liste chargée en mémoire
    const exists = appState.begoledex.find(p => p.sciName === plantData.sciName);
    
    if (exists) {
        showToast(`Déjà dans le Bégoledex : ${plantData.name} 📒`);
        return;
    }

    const newEntry = {
        id: Date.now(),
        name: plantData.name,
        sciName: plantData.sciName,
        image: plantData.image, // Stocké en Base64 ou URL
        date: new Date().toLocaleDateString(),
        score: plantData.score
    };

    // Sauvegarde en base de données et mise à jour de l'état
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
    
    // Mise à jour du compteur
    if (countEl) {
        countEl.innerText = `${appState.begoledex.length} plante${appState.begoledex.length > 1 ? 's' : ''} trouvée${appState.begoledex.length > 1 ? 's' : ''}`;
    }

    // Nettoyage de la grille
    grid.innerHTML = "";

    if (appState.begoledex.length === 0) {
        // État vide
        grid.innerHTML = `
            <div style="text-align:center; padding:30px; color:#888; grid-column: 1 / -1; font-style: italic;">
                <div style="font-size: 40px; margin-bottom: 10px;">🍃</div>
                Ton herbier est vide...<br>
                <small>Utilise l'outil "Identifier Plante" et obtiens un score > 40% pour collectionner !</small>
            </div>`;
    } else {
        // Tri par date (le plus récent en premier)
        const sorted = [...appState.begoledex].sort((a,b) => b.id - a.id);

        sorted.forEach(plant => {
            const card = document.createElement('div');
            card.className = "begoledex-card";
            
            // Structure de la carte
            card.innerHTML = `
                <img src="${plant.image}" loading="lazy" alt="${plant.name}">
                <div class="begoledex-info">
                    <div class="begoledex-name">${plant.name}</div>
                    <div class="begoledex-sci">${plant.sciName}</div>
                    <div class="begoledex-date">📅 ${plant.date} • ${plant.score}%</div>
                </div>
                <button class="btn-del-plant" title="Supprimer">×</button>
            `;

            // Gestion de la suppression
            const btnDel = card.querySelector('.btn-del-plant');
            if (btnDel) {
                btnDel.addEventListener('click', async (e) => {
                    e.stopPropagation(); // Empêche le zoom de s'activer
                    if(confirm(`Retirer ${plant.name} de ta collection définitivement ?`)) {
                        await deleteFromDB('begoledex', plant.id);
                        // Mise à jour de l'état local
                        appState.begoledex = appState.begoledex.filter(p => p.id !== plant.id);
                        // Recharger la vue pour voir la disparition
                        openBegoledexModal(); 
                        showToast("Plante retirée 🗑️");
                    }
                });
            }

            // Gestion du zoom (Lightbox)
            card.addEventListener('click', () => {
                const lightboxImg = document.getElementById('lightbox-img');
                const lightboxOverlay = document.getElementById('lightbox-overlay');
                if (lightboxImg && lightboxOverlay) {
                    lightboxImg.src = plant.image;
                    lightboxOverlay.classList.remove('hidden');
                    
                    // Fermeture au clic sur l'overlay
                    lightboxOverlay.onclick = () => {
                        lightboxOverlay.classList.add('hidden');
                        lightboxImg.src = ""; // Nettoyage mémoire
                    };
                }
            });

            grid.appendChild(card);
        });
    }

    // Afficher la modale
    modal.classList.remove('hidden');
    
    // Fermer le menu mobile s'il est ouvert, pour une meilleure UX
    const menu = document.getElementById('menu-items');
    if (menu) menu.classList.add('hidden-mobile');
}