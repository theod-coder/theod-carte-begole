import { showToast } from './utils.js';

// Base de données du Pisteur
const TRACKS_DB = [
    { id: 'boar', name: 'Sanglier', icon: '🐗', track: '·· ··', desc: 'Empreinte à 2 doigts + 2 gardes (doigts arrière) bien marqués. Retourne la terre (boutis).' },
    { id: 'deer', name: 'Chevreuil', icon: '🦌', track: '♡', desc: 'Petite empreinte en forme de cœur (4-5 cm). Pas de gardes visibles sauf dans la boue profonde.' },
    { id: 'fox', name: 'Renard', icon: '🦊', track: '🐾', desc: 'Ressemble à un petit chien mais plus ovale. Les griffes sont fines et pointues.' },
    { id: 'badger', name: 'Blaireau', icon: '🦡', track: '🖐️', desc: '5 doigts alignés avec de longues griffes. Ressemble à une petite main d\'ours.' },
    { id: 'hare', name: 'Lièvre', icon: '🐇', track: 'Y', desc: 'Pattes arrière longues devant les pattes avant. Forme souvent un "Y" dans la course.' },
    { id: 'squirrel', name: 'Écureuil', icon: '🐿️', track: '::', desc: '4 doigts à l\'avant, 5 à l\'arrière. Souvent au pied des arbres avec des cônes rongés.' },
    { id: 'bird', name: 'Rapace', icon: '🦅', track: 'Ψ', desc: 'Grandes serres, souvent accompagnées de pelotes de réjection au sol.' },
    { id: 'mushroom', name: 'Cèpe', icon: '🍄', track: 'O', desc: 'Pousse souvent sous les chênes et châtaigniers après la pluie et la lune montante.' }
];

/**
 * Ouvre la modale du guide du pisteur et génère le contenu interactif
 */
export function openPisteurModal() {
    const grid = document.getElementById('pisteur-grid');
    const modal = document.getElementById('modal-pisteur');
    
    if (!grid || !modal) {
        showToast("Erreur : Modale introuvable");
        return;
    }

    // Génération du contenu HTML
    grid.innerHTML = "";
    
    TRACKS_DB.forEach(animal => {
        const card = document.createElement('div');
        // On force quelques styles pour permettre l'expansion verticale
        card.className = 'badge-card unlocked'; 
        card.style.cursor = "pointer";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.alignItems = "center";
        card.style.height = "auto"; // Important pour grandir
        card.style.transition = "all 0.2s ease";
        
        // Structure interne : En-tête (Visible) + Détails (Cachés)
        card.innerHTML = `
            <div style="text-align:center; padding-bottom:5px;">
                <span class="badge-icon" style="font-size:30px; display:block;">${animal.icon}</span>
                <span class="badge-title" style="font-size:14px; font-weight:bold;">${animal.name}</span>
                <div class="expand-hint" style="font-size:10px; color:#aaa; margin-top:2px;">▼ Infos</div>
            </div>
            
            <div class="pisteur-details" style="display:none; margin-top:5px; border-top:1px dashed #ccc; padding-top:8px; width:100%; text-align:center;">
                <div style="font-size:24px; color:#8e44ad; font-weight:bold; letter-spacing:2px; margin-bottom:5px;">${animal.track}</div>
                <div style="font-size:11px; color:#555; line-height:1.4; text-align:left;">${animal.desc}</div>
            </div>
        `;
        
        // Interaction au clic : Toggle affichage
        card.onclick = () => {
            const details = card.querySelector('.pisteur-details');
            const hint = card.querySelector('.expand-hint');
            
            if (details.style.display === "none") {
                // Ouvrir
                details.style.display = "block";
                hint.innerText = "▲ Fermer";
                card.style.backgroundColor = "#fff9c4"; // Fond jaune clair pour mettre en valeur
                card.style.borderColor = "#f1c40f";
            } else {
                // Fermer
                details.style.display = "none";
                hint.innerText = "▼ Infos";
                card.style.backgroundColor = ""; // Reset
                card.style.borderColor = "";
            }
        };

        grid.appendChild(card);
    });

    // Affichage de la modale
    modal.classList.remove('hidden');
    
    // Fermeture du menu si ouvert
    const menu = document.getElementById('menu-items');
    if (menu) menu.classList.add('hidden-mobile');
}