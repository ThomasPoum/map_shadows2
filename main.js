// main.js

// Tom’s Sun is a mobile app that helps you instantly discover the
// sunniest terraces nearby. Using your location, it tells you all cafés and
// restaurants whose outdoor seating is bathed in sunlight at your chosen time.
// You can filter results by distance, venue type or user ratings, and even
// schedule your sunny break in advance. At the end, you can even know how long
// you will get sunlight for each terrace.

// Récupération de la clé Mapbox depuis config.js
mapboxgl.accessToken = window.MAPBOX_TOKEN;

// Assure-toi d'avoir inclus Luxon dans index.html :
// <script src="https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js"></script>
// Inclure config.js avant main.js :
// <script src="config.js"></script>
// Inclure Mapbox, Turf, SunCalc puis main.js

// Initialisation de la carte Mapbox GL JS
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v10",
  center: [2.3522, 48.8566], // Paris
  zoom: 17,
  pitch: 30,
  bearing: -17.6,
});

let popup;

// Stockage des empreintes des bâtiments
let buildings = [];

map.on("load", () => {
  // Désactive le layer d'extrusion par défaut
  const style = map.getStyle();
  const defaultExtrusion = style.layers.find(
    (l) => l.type === "fill-extrusion"
  );
  if (defaultExtrusion) {
    map.setLayoutProperty(defaultExtrusion.id, "visibility", "none");
  }

  // Récupère les footprints des bâtiments
  const feats = map.querySourceFeatures("composite", {
    sourceLayer: "building",
    filter: ["has", "height"],
  });
  buildings = feats.map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: {
      height: Number(f.properties.height),
      min_height: Number(f.properties.min_height) || 0,
    },
  }));

  // Trouve le premier layer de labels pour y insérer la 3D dessous
  const labelLayerId = style.layers.find(
    (l) => l.type === "symbol" && l.layout && l.layout["text-field"]
  ).id;

  // Ajoute le layer 3D personnalisé
  map.addLayer(
    {
      id: "custom-3d-buildings",
      type: "fill-extrusion",
      source: "composite",
      "source-layer": "building",
      filter: ["has", "height"],
      paint: {
        "fill-extrusion-color": "#dbdbdb",
        "fill-extrusion-height": ["to-number", ["get", "height"]],
        "fill-extrusion-base": ["to-number", ["get", "min_height"]],
        "fill-extrusion-opacity": 1.0,
      },
    },
    labelLayerId
  );

  // Ajoute la source et le layer pour les ombres sous le 3D
  map.addSource("shadows", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer(
    {
      id: "shadows-fill",
      type: "fill",
      source: "shadows",
      paint: { "fill-color": "rgba(0,0,0,0.3)" },
    },
    "custom-3d-buildings"
  );

  // Ajoute la source pour le GeoJSON des terrasses
  map.addSource("terraces", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Ajoute un layer pour afficher les terrasses
  map.addLayer({
    id: "terraces-fill",
    type: "fill",
    source: "terraces",
    paint: {
      "fill-color": [
        "match",
        ["get", "libelle_type"],
        "TERRASSE OUVERTE",
        "rgba(50, 180, 50, 0.7)",
        "TERRASSE FERMEE",
        "rgba(30, 100, 30, 0.7)",
        "ETALAGE",
        "rgba(180, 80, 80, 0.7)",
        "COMMERCE ACCESSOIRE",
        "rgba(80, 80, 180, 0.7)",
        "rgba(200, 200, 80, 0.7)", // couleur par défaut
      ],
      "fill-outline-color": "#000",
      "fill-opacity": 0.8,
    },
  });

  // Ajoute une couche pour les contours des terrasses
  map.addLayer({
    id: "terraces-outline",
    type: "line",
    source: "terraces",
    paint: {
      "line-color": "#000",
      "line-width": 1,
    },
  });

  // Charge le GeoJSON des terrasses
  loadTerraces();

  // Initialise le module des autorisations
  try {
    if (typeof initAuthorizations === 'function') {
      console.log('Initialisation du module des autorisations');
      // Passer explicitement la référence à la carte
      initAuthorizations(map);
    } else {
      console.error('Fonction initAuthorizations non disponible');
    }
  } catch (error) {
    console.error('Erreur lors de l\'initialisation des autorisations:', error);
  }

  // Premier rendu d'ombres
  updateShadows();
  
  // Positionner le marqueur à l'emplacement de l'utilisateur
  setUserLocation();
});

// Recalcul des ombres après un pan / zoom de la carte
map.on("moveend", () => {
  // (Re)charge les footprints visibles si besoin
  const feats = map.querySourceFeatures("composite", {
    sourceLayer: "building",
    filter: ["has", "height"],
  });
  buildings = feats.map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: {
      height: Number(f.properties.height),
      min_height: Number(f.properties.min_height) || 0,
    },
  }));
  // Mise à jour de l’ombre au nouveau centre
  updateShadows();
});

// Optionnel : idem si tu veux prendre en compte les changements de zoom
map.on("zoomend", () => {
  map.fire("moveend");
});

/**
 * Calcule les ombres projetées et tente de nettoyer/générer une géométrie valide
 */
function computeProjectedShadows(buildings, date, lat, lon) {
  const pos = SunCalc.getPosition(date, lat, lon);
  if (pos.altitude <= 0) return turf.featureCollection([]);

  const azDeg = (pos.azimuth * 180) / Math.PI;
  const shadowsIndividuelles = buildings.map((feat) => {
    const exterior =
      feat.geometry.type === "Polygon"
        ? feat.geometry.coordinates[0]
        : feat.geometry.coordinates[0][0];
    const L = feat.properties.height / Math.tan(pos.altitude);
    const proj = exterior.map(
      (pt) =>
        turf.destination(pt, L, azDeg, { units: "meters" }).geometry.coordinates
    );
    const pts = [
      ...exterior.map((c) => turf.point(c)),
      ...proj.map((c) => turf.point(c)),
    ];
    const hull = turf.convex(turf.featureCollection(pts));
    const poly =
      hull ||
      turf.polygon([[...exterior, ...proj.slice().reverse(), exterior[0]]]);
    // Nettoyage des coordonnées pour éviter les points dupliqués
    return turf.cleanCoords(poly);
  });

  // return turf.dissolve(turf.featureCollection(shadowsIndividuelles));
  return turf.featureCollection(shadowsIndividuelles);
}

/**
 * Met à jour le layer d'ombres en heure locale Paris
 */
function updateShadows() {
  const picker = document.getElementById("datetime-picker");
  const date = luxon.DateTime.fromISO(picker.value, {
    zone: "Europe/Paris",
  }).toJSDate();
  const center = map.getCenter();
  const shadows = computeProjectedShadows(
    buildings,
    date,
    center.lat,
    center.lng
  );
  map.getSource("shadows").setData(shadows);
}

// 1. Ajouter un marker draggable à la position de l'utilisateur ou au centre de Paris par défaut
const marker = new mapboxgl.Marker({ draggable: true });

// Fonction pour positionner le marqueur et la carte à la position actuelle de l'utilisateur
function setUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLocation = [position.coords.longitude, position.coords.latitude];
        marker.setLngLat(userLocation).addTo(map);
        map.flyTo({ center: userLocation, zoom: 17 });
        
        // Met à jour les ombres et les terrasses après avoir positionné le marqueur
        setTimeout(() => {
          updateShadows();
          updateMarkerShadowStatus();
          updateSunnyTerraces();
        }, 500);
      },
      (error) => {
        console.warn("Erreur de géolocalisation:", error.message);
        // Position par défaut sur Paris si la géolocalisation échoue
        marker.setLngLat([2.3522, 48.8566]).addTo(map);
        updateMarkerShadowStatus();
        updateSunnyTerraces();
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  } else {
    console.warn("La géolocalisation n'est pas supportée par ce navigateur.");
    // Position par défaut sur Paris si la géolocalisation n'est pas supportée
    marker.setLngLat([2.3522, 48.8566]).addTo(map);
    updateMarkerShadowStatus();
    updateSunnyTerraces();
  }
}

// 2. Fonction qui vérifie l'état (ombre/soleil) et affiche un popup
function updateMarkerShadowStatus() {
  const { lng, lat } = marker.getLngLat();
  const inShadow = isPointInShadow([lng, lat]);

  // changer le style du marker si tu veux
  marker.getElement().style.opacity = inShadow ? 0.6 : 1.0;

  // afficher un popup
  marker
    .setPopup(
      new mapboxgl.Popup({ offset: 25 }).setText(
        inShadow ? "🕶️ Ombre" : "☀️ Soleil"
      )
    )
    .togglePopup();

  // Mise à jour des terrasses au soleil à proximité
  updateSunnyTerraces();
}

/**
 * Retourne true si [lng, lat] est dans l’ombre au dateTime ISO donné.
 */
function isPointInShadow([lng, lat]) {
  const shadows = map.getSource("shadows")._data;

  const pt = turf.point([lng, lat]);

  // Si c'est une FeatureCollection, tester chaque Feature
  if (shadows.type === "FeatureCollection" && Array.isArray(shadows.features)) {
    return shadows.features.some((f) => turf.booleanPointInPolygon(pt, f));
  }

  // Si c'est une Feature de type Polygon/MultiPolygon
  if (
    shadows.type === "Feature" &&
    (shadows.geometry.type === "Polygon" ||
      shadows.geometry.type === "MultiPolygon")
  ) {
    return turf.booleanPointInPolygon(pt, shadows);
  }

  // Si c'est directement une géométrie Polygon/MultiPolygon
  if (shadows.type === "Polygon" || shadows.type === "MultiPolygon") {
    return turf.booleanPointInPolygon(pt, turf.feature(shadows));
  }

  // Par défaut : pas d'ombre
  return false;
}

// 3. Déclencher la vérif au relâchement du drag
marker.on("dragend", updateMarkerShadowStatus);

document
  .getElementById("datetime-picker")
  .addEventListener("input", updateShadows);

/**
 * Charge le fichier GeoJSON des terrasses et l'affiche sur la carte
 * après avoir converti ses coordonnées de Lambert 93 vers WGS84
 */
async function loadTerraces() {
  try {
    // Charger le GeoJSON
    const response = await fetch("./Geojson_final.geojson");
    if (!response.ok) {
      throw new Error(
        `Erreur lors du chargement du GeoJSON: ${response.status}`
      );
    }

    const geojsonData = await response.json();

    // Reprojeter les coordonnées de Lambert 93 vers WGS84
    const reprojectedGeoJSON = reprojectGeoJSON(geojsonData);

    // Mettre à jour la source de données dans la carte
    if (map.getSource("terraces")) {
      map.getSource("terraces").setData(reprojectedGeoJSON);

      // Afficher un message avec le nombre de terrasses chargées
      console.log(
        `${reprojectedGeoJSON.features.length} terrasses chargées et affichées sur la carte`
      );

      // Optionnel: ajuster la vue pour voir toutes les terrasses
      // Note: cela peut déplacer la carte loin de la position initiale
      // const bounds = turf.bbox(reprojectedGeoJSON);
      // map.fitBounds(bounds, { padding: 50 });
    }
  } catch (error) {
    console.error("Erreur lors du chargement des terrasses:", error);
  }
}

/**
 * Ajoute une interaction au clic sur les terrasses pour afficher leurs informations
 */
map.on("click", "terraces-fill", (e) => {
  if (!e.features || e.features.length === 0) return;

  const feature = e.features[0];
  const props = feature.properties;

  // Créer le contenu HTML du popup
  const html = `
    <h3>${props.libelle_type}</h3>
    <p><strong>Adresse:</strong> ${props.lieu}</p>
    <p><strong>Dimensions:</strong> ${props.longueur}m x ${
    props.largeurmax
  }m</p>
    <p>Distance: ${props.distance}m | Surface: ${(
      props["st_area(shape)"] || 0
    ).toFixed(1)}m² | % Sun: ${(props.sunPercentage || 0).toFixed(1)}%</p>
    ${
      props.observations
        ? `<p><strong>Observations:</strong> ${props.observations}</p>`
        : ""
    }
    ${
      props.affichette
        ? `<p><a href="${props.affichette}" target="_blank">Voir l'affichette</a></p>`
        : ""
    }
  `;

  // Afficher le popup
  new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(map);
});

// Changer le curseur au survol des terrasses
map.on("mouseenter", "terraces-fill", () => {
  map.getCanvas().style.cursor = "pointer";
});

map.on("mouseleave", "terraces-fill", () => {
  map.getCanvas().style.cursor = "";
});

/**
 * Trouve les terrasses au soleil dans un rayon de 100m autour du marqueur
 * et affiche la liste dans le panneau
 */
function updateSunnyTerraces() {
  const markerPosition = marker.getLngLat();
  const markerPoint = turf.point([markerPosition.lng, markerPosition.lat]);

  // Récupérer toutes les terrasses
  const terraces = map.getSource("terraces")._data;
  if (!terraces || !terraces.features || terraces.features.length === 0) {
    console.log("Aucune terrasse disponible");
    updateSunnyTerracesList([]);
    return;
  }

  // Filtrer les terrasses dans un rayon de 100m et qui sont au soleil
  const nearbyTerraces = [];

  terraces.features.forEach((terrace) => {
    // Calcul du centre approximatif de la terrasse
    let terraceCentroid;
    try {
      terraceCentroid = turf.centroid(terrace);
    } catch (error) {
      // Si le calcul du centroïde échoue, on prend le premier point du polygone
      if (
        terrace.geometry.type === "Polygon" &&
        terrace.geometry.coordinates &&
        terrace.geometry.coordinates.length > 0 &&
        terrace.geometry.coordinates[0].length > 0
      ) {
        terraceCentroid = turf.point(terrace.geometry.coordinates[0][0]);
      } else {
        // Si on ne peut pas trouver de point valide, on saute cette terrasse
        return;
      }
    }

    // Calculer la distance entre le marker et la terrasse
    const distance = turf.distance(markerPoint, terraceCentroid, {
      units: "meters",
    });

    // Vérifier si la terrasse est à moins de 100m
    if (distance <= 100) {
      // Calculer le pourcentage d'ensoleillement de la terrasse
      const sunPercentage = computeSunPercentage(terrace);

      if (sunPercentage > 0) {
        // C'est une terrasse partiellement ou totalement au soleil et à proximité
        nearbyTerraces.push({
          ...terrace,
          properties: {
            ...terrace.properties,
            distance: Math.round(distance),
            sunPercentage: sunPercentage,
          },
        });
      }
    }
  });

  // Trier par distance (la plus proche d'abord)
  nearbyTerraces.sort((a, b) => a.properties.distance - b.properties.distance);

  // Mettre à jour la liste dans l'interface
  updateSunnyTerracesList(nearbyTerraces);
}

/**
 * Met à jour la liste des terrasses au soleil dans l'interface
 */
function updateSunnyTerracesList(terraces) {
  const listElement = document.getElementById("sunny-terraces-list");
  const countElement = document.getElementById("terraces-count");

  // Mise à jour du compteur
  countElement.textContent = `${terraces.length} trouvée(s)`;

  // Vider la liste actuelle
  listElement.innerHTML = "";

  if (terraces.length === 0) {
    // Message si aucune terrasse trouvée
    listElement.innerHTML =
      '<li class="terrace-item">Aucune terrasse au soleil trouvée dans un rayon de 100m</li>';
    return;
  }

  // Ajouter chaque terrasse à la liste
  terraces.forEach((terrace) => {
    const props = terrace.properties;

    // Déterminer la classe du badge en fonction du type de terrasse
    let badgeClass = "badge-default";
    if (props.libelle_type) {
      const type = props.libelle_type.toLowerCase();
      if (type.includes("terrasse ouverte"))
        badgeClass = "badge-terrasse-ouverte";
      else if (type.includes("terrasse fermee"))
        badgeClass = "badge-terrasse-fermee";
      else if (type.includes("etalage")) badgeClass = "badge-etalage";
      else if (type.includes("commerce")) badgeClass = "badge-commerce";
    }

    // Créer l'élément de liste
    const li = document.createElement("li");
    li.className = "terrace-item";
    li.innerHTML = `
      <h3>
        <span class="terrace-badge ${badgeClass}">${
      props.libelle_type || "Terrasse"
    }</span>
        ${props.nom_enseigne || "Nom inconnu"}
      </h3>
      <p>Distance: ${props.distance}m | Surface: ${(
      props["st_area(shape)"] || 0
    ).toFixed(1)}m² | % Sun: ${(props.sunPercentage || 0).toFixed(1)}%</p>
    `;

    // Ajouter un événement de clic pour centrer la carte sur cette terrasse
    li.addEventListener("click", () => {
      try {
        const centroid = turf.centroid(terrace);
        map.flyTo({
          center: centroid.geometry.coordinates,
          zoom: 18,
          duration: 1000,
        });

        if (popup) {
          popup.remove();
        }

        // Affiche un popup avec les détails de la terrasse
        popup = new mapboxgl.Popup()
          .setLngLat(centroid.geometry.coordinates)
          .setHTML(
            `
            <h3>${props.libelle_type}</h3>
            <p><strong>Adresse:</strong> ${props.lieu}</p>
            <p><strong>Dimensions:</strong> ${props.longueur}m x ${
              props.largeurmax
            }m</p>
            <p>Distance: ${props.distance}m | Surface: ${(
              props["st_area(shape)"] || 0
            ).toFixed(1)}m² | % Sun: ${(props.sunPercentage || 0).toFixed(
              1
            )}%</p>
            ${
              props.observations
                ? `<p><strong>Observations:</strong> ${props.observations}</p>`
                : ""
            }
            ${
              props.affichette
                ? `<p><a href="${props.affichette}" target="_blank">Voir l'affichette</a></p>`
                : ""
            }
          `
          )
          .addTo(map);
      } catch (e) {
        console.error("Erreur lors du centrage sur la terrasse:", e);
      }
    });

    listElement.appendChild(li);
  });
}

function computeSunPercentage(terrace) {
  // Calcul précis du pourcentage d'ensoleillement en utilisant un échantillonnage de points
  try {
    // Vérifier que la terrasse est un objet GeoJSON valide
    if (!terrace || !terrace.geometry) {
      console.log("Terrasse invalide pour le calcul d'ensoleillement:", terrace);
      return 100;
    }

    // Créer une grille de points à l'intérieur de la terrasse pour l'échantillonnage
    const terraceBbox = turf.bbox(terrace);
    const cellSize = 0.5; // Taille des cellules en mètres (réduite à 0.5m pour un échantillonnage plus dense)
    const options = { units: 'meters' };
    const pointGrid = turf.pointGrid(terraceBbox, cellSize, options);
    
    // Ajouter un log pour voir le nombre de points dans la grille
    console.log(`Grille de points créée avec ${pointGrid.features.length} points pour la terrasse`);

    // Filtrer pour ne garder que les points qui sont vraiment à l'intérieur de la terrasse
    const pointsInTerrasse = turf.pointsWithinPolygon(pointGrid, terrace);

    if (!pointsInTerrasse || pointsInTerrasse.features.length === 0) {
      // Si aucun point n'est dans la terrasse, utiliser le centroïde
      const center = turf.center(terrace);
      const isInShadow = isPointInShadow(center.geometry.coordinates);
      return isInShadow ? 0 : 100;
    }

    // Compter combien de points sont au soleil
    let pointsInSun = 0;
    const totalPoints = pointsInTerrasse.features.length;

    for (const point of pointsInTerrasse.features) {
      const isInShadow = isPointInShadow(point.geometry.coordinates);
      if (!isInShadow) {
        pointsInSun++;
      }
    }

    // Calcul du pourcentage au soleil
    const sunPercentage = Math.round((pointsInSun / totalPoints) * 100);
    return sunPercentage;
  } catch (e) {
    console.log("Erreur dans le calcul du pourcentage d'ensoleillement:", e);
    return 100; // Par défaut en cas d'erreur
  }
}

// Déclencher une mise à jour de la liste de terrasses au soleil lors du changement d'heure
document.getElementById("datetime-picker").addEventListener("input", () => {
  updateShadows(); // Met à jour les ombres
  updateSunnyTerraces(); // Met à jour la liste des terrasses au soleil
});

/**
 * Gestion du toggle entre les vues liste et carte
 */
document.addEventListener("DOMContentLoaded", () => {
  // Récupération des éléments de l'interface
  const listViewBtn = document.getElementById("list-view-btn");
  const mapViewBtn = document.getElementById("map-view-btn");
  const listView = document.querySelector(".list-view");
  const mapView = document.querySelector(".map-view");
  const recenterMapBtn = document.getElementById("recenter-map");
  
  // Fonction pour basculer vers la vue liste
  function showListView() {
    listView.style.display = "block";
    mapView.style.display = "none";
    listViewBtn.classList.add("active");
    mapViewBtn.classList.remove("active");
  }
  
  // Fonction pour basculer vers la vue carte
  function showMapView() {
    listView.style.display = "none";
    mapView.style.display = "block";
    listViewBtn.classList.remove("active");
    mapViewBtn.classList.add("active");
    
    // Trigger a resize event to ensure the map renders correctly
    window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      // Recalcul des ombres après un changement de vue
      updateShadows();
    }, 100);
  }
  
  // Écouteurs d'événements pour les boutons
  listViewBtn.addEventListener("click", showListView);
  mapViewBtn.addEventListener("click", showMapView);
  
  // Bouton pour recentrer la carte sur la position actuelle du marqueur
  if (recenterMapBtn) {
    recenterMapBtn.addEventListener("click", () => {
      const markerPosition = marker.getLngLat();
      map.flyTo({
        center: [markerPosition.lng, markerPosition.lat],
        zoom: 17,
        duration: 1000
      });
    });
  }
  
  // Bouton pour géolocaliser l'utilisateur
  const geolocateBtn = document.getElementById("geolocate-user");
  if (geolocateBtn) {
    geolocateBtn.addEventListener("click", () => {
      setUserLocation();
    });
  }
  
  // Quand on clique sur une terrasse dans la liste, passer automatiquement en vue carte
  document.getElementById("sunny-terraces-list").addEventListener("click", (e) => {
    if (e.target.closest(".terrace-item")) {
      showMapView();
    }
  });
  
  // Afficher la vue liste par défaut au chargement
  showListView();
});