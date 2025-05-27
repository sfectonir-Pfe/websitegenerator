#!/bin/bash

# Script de démarrage pour le backend Python

echo "Installation des dépendances..."
pip install -r requirements.txt

echo "Démarrage du serveur backend..."
python app.py
