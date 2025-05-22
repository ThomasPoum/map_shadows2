#!/usr/bin/env python3
import json
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
import copy

def merge_terrasses(input_file, output_file):
    """
    Fonction qui fusionne les terrasses d'un même établissement (même iddossier)
    pour créer un nouveau GeoJSON avec une seule feature par établissement.
    
    Args:
        input_file (str): Chemin vers le fichier GeoJSON d'entrée
        output_file (str): Chemin vers le fichier GeoJSON de sortie
    """
    # Charger le GeoJSON
    with open(input_file, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    # Vérifier que c'est bien une FeatureCollection
    if geojson['type'] != 'FeatureCollection':
        raise ValueError("Le fichier d'entrée n'est pas une FeatureCollection")
    
    # Garder les métadonnées du GeoJSON original
    output_geojson = {
        'type': 'FeatureCollection',
        'name': 'Geojson unifié',
        'crs': geojson.get('crs', None),
        'features': []
    }
    
    # Regrouper les features par iddossier
    dossier_features = {}
    for feature in geojson['features']:
        iddossier = feature['properties'].get('iddossier', 'unknown')
        if iddossier == 'unknown':
            # Si pas d'iddossier, on conserve la feature telle quelle
            output_geojson['features'].append(feature)
            continue
        
        if iddossier not in dossier_features:
            dossier_features[iddossier] = []
        
        dossier_features[iddossier].append(feature)
    
    # Pour chaque iddossier, fusionner les géométries
    for iddossier, features in dossier_features.items():
        if len(features) == 1:
            # Si une seule feature pour ce dossier, la conserver telle quelle
            output_geojson['features'].append(features[0])
            continue
        
        # Fusionner les géométries
        geometries = []
        for feature in features:
            geom = shape(feature['geometry'])
            geometries.append(geom)
        
        merged_geometry = unary_union(geometries)
        
        # Créer une nouvelle feature avec la géométrie fusionnée et les propriétés de la première feature
        merged_feature = copy.deepcopy(features[0])
        merged_feature['geometry'] = mapping(merged_geometry)
        
        # Ajouter des informations sur la fusion
        original_count = len(features)
        original_types = set(f['properties'].get('libelle_type', '') for f in features)
        merged_feature['properties']['merged_count'] = original_count
        merged_feature['properties']['original_types'] = list(original_types)
        
        # Ajouter au résultat
        output_geojson['features'].append(merged_feature)
    
    # Écrire le résultat dans le fichier de sortie
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_geojson, f, ensure_ascii=False, indent=2)
    
    return len(output_geojson['features'])

if __name__ == '__main__':
    input_file = 'Geojson complet.geojson'
    output_file = 'Geojson fusionné.geojson'
    
    feature_count = merge_terrasses(input_file, output_file)
    print(f"Fusion terminée. Le fichier résultant contient {feature_count} features.")
