/**
 * authorizations.js
 * Gestion des autorisations voiries pour l'application Map Shadows
 */

// Déclaration explicite que nous utilisons la variable map du scope global
// sans la redéclarer

/**
 * Initialise le module des autorisations avec la référence à la carte Mapbox
 * Cette fonction doit être appelée après l'initialisation de la carte
 */
function initAuthorizations(mapboxMap) {
  console.log("Début de l'initialisation des autorisations");
  
  try {
    // Ajouter la source pour le GeoJSON des autorisations voiries
    mapboxMap.addSource("authorizations", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });

    // Ajouter la couche de remplissage pour les autorisations
    mapboxMap.addLayer({
      id: "authorizations-fill",
      type: "fill",
      source: "authorizations",
      paint: {
        "fill-color": [
          "match",
          ["get", "libelle_type"],
          "TERRASSE OUVERTE",
          "rgba(50, 180, 50, 0.4)",
          "TERRASSE FERMEE",
          "rgba(30, 100, 30, 0.4)",
          "ETALAGE",
          "rgba(180, 80, 80, 0.4)",
          "COMMERCE ACCESSOIRE",
          "rgba(80, 80, 180, 0.4)",
          "rgba(200, 200, 80, 0.4)", // couleur par défaut
        ],
        "fill-outline-color": "#000",
        "fill-opacity": 0.5,
      },
      layout: {
        "visibility": "none" // Caché par défaut
      }
    });

    // Ajouter la couche de contour pour les autorisations
    mapboxMap.addLayer({
      id: "authorizations-outline",
      type: "line",
      source: "authorizations",
      paint: {
        "line-color": "#000",
        "line-width": 1,
      },
      layout: {
        "visibility": "none" // Caché par défaut
      }
    });

    // Charger les données des autorisations
    loadAuthorizationsData(mapboxMap);
    
    // Configurer le bouton toggle
    setupToggleButton(mapboxMap);
    
    console.log("Initialisation des autorisations terminée avec succès");
  } catch (error) {
    console.error("Erreur lors de l'initialisation des autorisations:", error);
  }
}

/**
 * Charge le fichier GeoJSON des autorisations voiries
 */
async function loadAuthorizationsData(mapboxMap) {
  try {
    console.log("Début du chargement des données d'autorisations");
    
    const response = await fetch("./couche_autorisations_voiries_paris_multiploygone_reprojeté.geojson");
    
    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }

    const data = await response.json();
    
    if (mapboxMap.getSource("authorizations")) {
      mapboxMap.getSource("authorizations").setData(data);
      console.log(`${data.features.length} autorisations voiries chargées`);
    } else {
      console.error("Source 'authorizations' non trouvée dans la carte");
    }
  } catch (error) {
    console.error("Erreur lors du chargement des autorisations:", error);
  }
}

/**
 * Configure le bouton de basculement des autorisations
 */
function setupToggleButton(mapboxMap) {
  try {
    // Récupérer le bouton
    const toggleButton = document.getElementById("toggle-authorizations");
    
    if (!toggleButton) {
      console.error("Bouton toggle-authorizations non trouvé");
      return;
    }
    
    console.log("Configuration du bouton toggle-authorizations");
    
    // Ajouter l'événement de clic directement, sans utiliser addEventListener
    toggleButton.onclick = function() {
      toggleAuthorizationsLayers(mapboxMap, toggleButton);
    };
    
    console.log("Bouton des autorisations configuré avec succès");
  } catch (error) {
    console.error("Erreur lors de la configuration du bouton:", error);
  }
}

/**
 * Bascule la visibilité des couches d'autorisations
 */
function toggleAuthorizationsLayers(mapboxMap, button) {
  try {
    console.log("Basculement de la visibilité des couches d'autorisations");
    
    // Vérifier l'état actuel
    const currentVisibility = mapboxMap.getLayoutProperty(
      "authorizations-fill", 
      "visibility"
    );
    
    // Déterminer le nouvel état
    const newVisibility = currentVisibility === "visible" ? "none" : "visible";
    console.log(`Changement de la visibilité: ${currentVisibility} -> ${newVisibility}`);
    
    // Mettre à jour les deux couches
    mapboxMap.setLayoutProperty("authorizations-fill", "visibility", newVisibility);
    mapboxMap.setLayoutProperty("authorizations-outline", "visibility", newVisibility);
    
    // Mettre à jour le texte du bouton
    button.textContent = newVisibility === "visible" 
      ? "Masquer les autorisations" 
      : "Afficher les autorisations";
      
    // Mettre à jour la classe CSS active
    if (newVisibility === "visible") {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
    
    console.log("Visibilité des couches d'autorisations mise à jour avec succès");
  } catch (error) {
    console.error("Erreur lors du basculement des couches:", error);
  }
}

// Configuration immédiate si le document est déjà chargé
if (document.readyState === "complete" || document.readyState === "interactive") {
  console.log("Document déjà chargé, vérification de la présence de la carte");
  setTimeout(function() {
    if (typeof map !== 'undefined' && map) {
      console.log("Carte trouvée, configuration des autorisations");
      setupToggleButton(map);
    } else {
      console.log("Carte non disponible, la configuration sera faite par initAuthorizations");
    }
  }, 100);
}
