# README.md - DeepSite Clone (Version Python)

## Description

DeepSite Clone est une application web qui permet de créer des sites web à partir de prompts textuels. Cette version utilise un backend Python avec Flask et un frontend React/Next.js, offrant une interface intuitive où l'utilisateur peut voir le code généré à gauche et un aperçu en direct à droite.

## Fonctionnalités

- Génération de sites web à partir de descriptions textuelles
- Modification du site via des prompts supplémentaires
- Ajout d'images avec description
- Création et gestion de plusieurs pages
- Prévisualisation en direct du site
- Exportation du code HTML

## Architecture

L'application est divisée en deux parties principales :

### Frontend
- Développé avec React, Next.js et TailwindCSS
- Utilise Monaco Editor pour l'affichage du code
- Interface responsive et intuitive

### Backend
- Serveur Flask (Python)
- Intégration avec l'API Groq pour la génération de code
- Routes API pour la génération, l'ajout d'images et la création de pages

## Installation

### Prérequis
- Python 3.7 ou supérieur
- pip (gestionnaire de paquets Python)
- Node.js (v14 ou supérieur)
- npm (v6 ou supérieur)

### Installation du backend
```bash
cd backend
pip install -r requirements.txt
```

Le fichier `.env` dans le dossier backend contient déjà la clé API Groq.

### Installation du frontend
```bash
cd frontend
npm install
```

## Lancement

### Backend
```bash
cd backend
./run.sh
```
Ou manuellement :
```bash
cd backend
python app.py
```

### Frontend
```bash
cd frontend
./run.sh
```
Ou manuellement :
```bash
cd frontend
npm run dev
```

Accédez à l'application via `http://localhost:3000`

## Utilisation

Consultez le fichier [USAGE.md](./USAGE.md) pour des instructions détaillées sur l'utilisation de l'application.

## Structure du projet

```
deepsite-clone-python/
├── backend/
│   ├── app.py              # Serveur Flask avec routes API
│   ├── requirements.txt    # Dépendances Python
│   ├── .env                # Variables d'environnement (clé API Groq)
│   └── run.sh              # Script de démarrage du backend
├── frontend/
│   ├── src/
│   │   ├── app/            # Pages Next.js
│   │   └── components/     # Composants React
│   ├── public/             # Ressources statiques
│   ├── package.json        # Dépendances Node.js
│   └── run.sh              # Script de démarrage du frontend
├── README.md               # Ce fichier
└── USAGE.md                # Guide d'utilisation détaillé
```

## Développement

Ce projet a été développé dans le cadre d'un projet de fin d'études. Il démontre l'utilisation des technologies modernes de développement web et l'intégration d'API d'intelligence artificielle pour la génération de contenu.

## Pourquoi Python ?

Le backend a été développé en Python pour faciliter la compréhension et la modification du code par les utilisateurs familiers avec ce langage. Flask a été choisi comme framework web pour sa simplicité et sa flexibilité.

## Licence

MIT
#   w e b s i t e g e n e r a t o r  
 