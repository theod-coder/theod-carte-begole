import { DB_NAME } from './config.js';

const DB_VERSION = 1;
let db = null;

/**
 * Initialise la connexion à IndexedDB
 * Crée les "tables" (ObjectStores) si elles n'existent pas
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            // Création des tables si elles n'existent pas
            if (!db.objectStoreNames.contains('points')) {
                db.createObjectStore('points', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('parcels')) {
                db.createObjectStore('parcels', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('trips')) {
                db.createObjectStore('trips', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log(`✅ DB "${DB_NAME}" ouverte avec succès.`);
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("❌ Erreur IndexedDB :", event.target.error);
            reject("Erreur lors de l'ouverture de la base de données.");
        };
    });
}

/**
 * Sauvegarde ou met à jour un objet dans un store donné
 * @param {string} storeName - 'points', 'parcels', ou 'trips'
 * @param {object} data - L'objet à stocker (doit avoir un champ 'id')
 */
export function saveToDB(storeName, data) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée");
        
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Supprime un élément par son ID
 * @param {string} storeName 
 * @param {number|string} id 
 */
export function deleteFromDB(storeName, id) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée");

        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Charge toutes les données d'un store
 * @param {string} storeName 
 * @returns {Promise<Array>} Liste des objets
 */
export function loadAllFromDB(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée");

        const transaction = db.transaction([storeName], "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Vide entièrement un store (Attention !)
 * @param {string} storeName 
 */
export function clearStoreDB(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("DB non initialisée");

        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Vérifie l'espace de stockage utilisé par l'application
 * Met à jour la barre de progression dans l'UI si elle existe
 */
export async function checkStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const estimate = await navigator.storage.estimate();
            // Conversion en pourcentage
            const percentage = (estimate.usage / estimate.quota) * 100;
            // Conversion en Mégaoctets
            const usageMB = (estimate.usage / (1024 * 1024)).toFixed(1);

            const bar = document.getElementById('storage-bar');
            const text = document.getElementById('storage-text');

            if (bar && text) {
                text.innerText = `${usageMB} MB (${percentage.toFixed(2)}%)`;
                bar.style.width = percentage < 1 ? "1%" : `${percentage}%`;
                
                // Couleur changeante selon l'usage
                bar.style.backgroundColor = percentage > 80 ? "#e74c3c" : "#2ecc71";
            }
        } catch (err) {
            console.warn("Impossible d'estimer le stockage:", err);
        }
    }
}