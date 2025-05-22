#!/usr/bin/env python3
import json
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
import copy

def merge_terrasses_enhanced(input_file, additional_data_file, output_file):
    """
    Fonction qui fusionne les terrasses d'un même établissement (même iddossier),
    exclut les étalages et ajoute le nom de l'enseigne.
    
    Args:
        input_file (str): Chemin vers le fichier GeoJSON d'entrée des terrasses
        additional_data_file (str): Chemin vers le fichier GeoJSON contenant les noms d'enseignes
        output_file (str): Chemin vers le fichier GeoJSON de sortie
    """
    # Charger le GeoJSON des terrasses
    with open(input_file, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    # Charger le GeoJSON des données supplémentaires (noms d'enseignes)
    with open(additional_data_file, 'r', encoding='utf-8') as f:
        additional_data = json.load(f)
    
    # Vérifier que ce sont bien des FeatureCollections
    if geojson['type'] != 'FeatureCollection' or additional_data['type'] != 'FeatureCollection':
        raise ValueError("Les fichiers d'entrée ne sont pas des FeatureCollections")
    
    # Créer un dictionnaire pour mapper les adresses aux noms d'enseignes
    address_to_enseigne = {}
    for feature in additional_data['features']:
        if 'properties' in feature and 'adresse' in feature['properties'] and 'nom_enseigne' in feature['properties']:
            address = feature['properties']['adresse']
            nom_enseigne = feature['properties']['nom_enseigne']
            if address and nom_enseigne:  # S'assurer que les valeurs ne sont pas vides
                # Standardiser l'adresse pour faciliter la correspondance
                address = standardize_address(address)
                address_to_enseigne[address] = nom_enseigne
    
    # Garder les métadonnées du GeoJSON original
    output_geojson = {
        'type': 'FeatureCollection',
        'name': 'Geojson unifié avec noms d\'enseignes',
        'crs': geojson.get('crs', None),
        'features': []
    }
    
    # Regrouper les features par iddossier, en excluant les étalages
    dossier_features = {}
    for feature in geojson['features']:
        # Exclure les étalages
        libelle_type = feature['properties'].get('libelle_type', '')
        if libelle_type == 'ETALAGE':
            continue
        
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
            # Si une seule feature pour ce dossier (et ce n'est pas un étalage), la enrichir avec nom_enseigne
            merged_feature = copy.deepcopy(features[0])
        else:
            # Fusionner les géométries
            geometries = []
            total_area = 0  # Pour stocker la somme des surfaces
            
            for feature in features:
                geom = shape(feature['geometry'])
                geometries.append(geom)
                
                # Additionner les surfaces de chaque feature
                st_area = feature['properties'].get('st_area(shape)', 0)
                if st_area:  # Vérifier que st_area existe et n'est pas None
                    total_area += float(st_area)
            
            merged_geometry = unary_union(geometries)
            
            # Créer une nouvelle feature avec la géométrie fusionnée et les propriétés de la première feature
            merged_feature = copy.deepcopy(features[0])
            merged_feature['geometry'] = mapping(merged_geometry)
            
            # Mettre à jour la surface avec la somme calculée
            merged_feature['properties']['st_area(shape)'] = total_area
            
            # Ajouter des informations sur la fusion
            original_count = len(features)
            original_types = set(f['properties'].get('libelle_type', '') for f in features)
            merged_feature['properties']['merged_count'] = original_count
            merged_feature['properties']['original_types'] = list(original_types)
        
        # Récupérer l'adresse (lieu1) et rechercher le nom d'enseigne correspondant
        address = merged_feature['properties'].get('lieu1', '')
        if address:
            standardized_address = standardize_address(address)
            nom_enseigne = address_to_enseigne.get(standardized_address, '')
            if nom_enseigne:
                merged_feature['properties']['nom_enseigne'] = nom_enseigne
            else:
                # Si pas de correspondance exacte, chercher une correspondance partielle
                matching_address = find_closest_address(standardized_address, address_to_enseigne.keys())
                if matching_address:
                    merged_feature['properties']['nom_enseigne'] = address_to_enseigne[matching_address]
                else:
                    merged_feature['properties']['nom_enseigne'] = "Non identifié"
        else:
            merged_feature['properties']['nom_enseigne'] = "Non identifié"
        
        # Ajouter au résultat
        output_geojson['features'].append(merged_feature)
    
    # Écrire le résultat dans le fichier de sortie
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_geojson, f, ensure_ascii=False, indent=2)
    
    return len(output_geojson['features'])

def standardize_address(address):
    """
    Standardise une adresse pour faciliter la correspondance :
    - Conversion en majuscules
    - Suppression des espaces en début et fin
    - Normalisation des articles et prépositions
    """
    if not address:
        return ""
    
    address = address.upper().strip()
    
    # Remplacements courants pour normaliser les adresses
    replacements = {
        "BOULEVARD": "BD",
        "AVENUE": "AV",
        "SAINT": "ST",
        "SAINTE": "STE",
        " DE LA ": " DE LA ",
        " DE L'": " DE L'",
        " DU ": " DU ",
        " DES ": " DES ",
        " D'": " D'"
    }
    
    for old, new in replacements.items():
        address = address.replace(old, new)
    
    return address

def find_closest_address(target, addresses):
    """
    Trouve l'adresse la plus proche dans la liste des adresses disponibles
    basée sur une correspondance partielle
    """
    # Simplifier pour trouver une correspondance partielle
    simplified_target = ''.join(c for c in target if c.isalnum())
    
    best_match = None
    best_score = 0
    
    for address in addresses:
        simplified_addr = ''.join(c for c in address if c.isalnum())
        
        # Chercher si une chaîne est contenue dans l'autre
        if simplified_target in simplified_addr or simplified_addr in simplified_target:
            # Calculer un score basique de correspondance basé sur la longueur commune
            score = min(len(simplified_target), len(simplified_addr)) / max(len(simplified_target), len(simplified_addr))
            
            if score > best_score:
                best_score = score
                best_match = address
    
    # Retourner le meilleur match s'il dépasse un certain seuil
    if best_score > 0.6:  # Seuil de 60% de correspondance
        return best_match
    return None

if __name__ == '__main__':
    input_file = 'Geojson complet.geojson'
    additional_data_file = 'couche_autorisations_voiries_paris_multiploygone_reprojeté.geojson'
    output_file = 'Geojson_final.geojson'
    
    feature_count = merge_terrasses_enhanced(input_file, additional_data_file, output_file)
    print(f"Fusion et enrichissement terminés. Le fichier résultant contient {feature_count} features.")
