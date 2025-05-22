/**
 * Fichier contenant les fonctions de reprojection des coordonnées
 * pour convertir les données de Lambert 93 (EPSG:2154) vers WGS84 (EPSG:4326)
 */

// Définition des projections
proj4.defs("EPSG:2154", "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

/**
 * Convertit des coordonnées Lambert 93 en coordonnées WGS84
 * @param {number} x - Coordonnée X en Lambert 93
 * @param {number} y - Coordonnée Y en Lambert 93
 * @returns {Array} - Coordonnées [longitude, latitude] en WGS84
 */
function projLambert93ToWGS84(x, y) {
  return proj4("EPSG:2154", "EPSG:4326", [x, y]);
}

/**
 * Convertit un GeoJSON en Lambert 93 vers WGS84
 * @param {Object} geojson - GeoJSON en Lambert 93
 * @returns {Object} - GeoJSON en WGS84
 */
function reprojectGeoJSON(geojson) {
  // Créer une copie profonde du GeoJSON
  const result = JSON.parse(JSON.stringify(geojson));
  
  // Fonction de transformation récursive des coordonnées selon le type de géométrie
  function transformCoords(coords, type) {
    if (type === 'Point') {
      return projLambert93ToWGS84(coords[0], coords[1]);
    } else if (type === 'LineString' || type === 'MultiPoint') {
      return coords.map(point => projLambert93ToWGS84(point[0], point[1]));
    } else if (type === 'Polygon' || type === 'MultiLineString') {
      return coords.map(ring => 
        ring.map(point => projLambert93ToWGS84(point[0], point[1]))
      );
    } else if (type === 'MultiPolygon') {
      return coords.map(polygon => 
        polygon.map(ring => 
          ring.map(point => projLambert93ToWGS84(point[0], point[1]))
        )
      );
    }
    return coords;
  }
  
  // Transformer chaque feature dans la collection
  if (result.type === 'FeatureCollection') {
    result.features.forEach(feature => {
      feature.geometry.coordinates = transformCoords(
        feature.geometry.coordinates, 
        feature.geometry.type
      );
    });
  } else if (result.type === 'Feature') {
    result.geometry.coordinates = transformCoords(
      result.geometry.coordinates, 
      result.geometry.type
    );
  }
  
  // Mettre à jour le système de coordonnées de référence (CRS)
  if (result.crs) {
    result.crs = {
      type: "name",
      properties: {
        name: "urn:ogc:def:crs:OGC:1.3:CRS84" // Standard WGS84
      }
    };
  }
  
  return result;
}
