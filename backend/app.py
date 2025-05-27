import os
import re
import json
import requests
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_pymongo import PyMongo
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import googlemaps
from datetime import datetime
import uuid
import tempfile
import speech_recognition as sr
from pydub import AudioSegment
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import shutil

# Configure logging for debugging and monitoring
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})

# MongoDB Configuration
app.config["MONGO_URI"] = os.getenv("MONGO_URI", "mongodb://localhost:27017/mydatabase")
mongo = PyMongo(app)

# Configuration Google Maps
GOOGLEMAPS_KEY = os.getenv('GOOGLEMAPS_KEY')
if not GOOGLEMAPS_KEY:
    logger.error("Google Maps API key is missing")
    raise ValueError("Google Maps API key is required")
gmaps = googlemaps.Client(key=GOOGLEMAPS_KEY)

# Groq API Configuration
GROQ_API_KEY = os.getenv('GROQ_API_KEY')
if not GROQ_API_KEY:
    logger.error("GROQ API Key is not set in environment variables")
GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

# Pexels API Configuration
PEXELS_API_KEY = os.getenv('PEXELS_API_KEY')
if not PEXELS_API_KEY:
    logger.error("PEXELS_API_KEY is not set in the environment variables")

# Pixabay API Configuration
PIXABAY_API_KEY = os.getenv('PIXABAY_API_KEY')
if not PIXABAY_API_KEY:
    logger.error("PIXABAY_API_KEY is not set in the environment variables")

# Font Awesome Kit Configuration
FONT_AWESOME_KIT = os.getenv('FONT_AWESOME_KIT', '5411779918.js')
if not FONT_AWESOME_KIT:
    logger.error("Font Awesome Kit code is missing")
    raise ValueError("Font Awesome Kit code is required")

# Initialize SpeechRecognition recognizer for audio transcription
recognizer = sr.Recognizer()


def get_folder_from_path(page_path: str) -> str:
    """Extract folder name from page path."""
    if not page_path:
        return 'default'
    parts = page_path.split('/')
    return parts[0] if len(parts) > 1 and parts[0] else 'default'
def refine_query(query: str, page_name: str = None, folder_name: str = None) -> str:
    """Amélioration de la requête avec contexte de la page/dossier"""
    # Mots à exclure
    stop_words = {'a', 'an', 'the', 'with', 'at', 'in', 'on', 'of', 'and', 'page', 'template'}
    
    # Contextes spécifiques
    context_keywords = {
        'fruits': ['fruit', 'fresh', 'organic', 'apple', 'banana', 'orange'],
        'voyages': ['travel', 'landscape', 'destination', 'tourist'],
        'technologie': ['tech', 'computer', 'electronic', 'device']
    }
    
    # Nettoyage de base
    words = [word.lower() for word in query.split() if word.lower() not in stop_words]
    
    # Ajout de contexte basé sur le nom de page/dossier
    if page_name:
        page_key = page_name.lower().split()[0]
        if page_key in context_keywords:
            words.extend(context_keywords[page_key])
    
    if folder_name:
        folder_key = folder_name.lower().split()[0]
        if folder_key in context_keywords:
            words.extend(context_keywords[folder_key])
    
    # Éviter les doublons
    unique_words = list(dict.fromkeys(words))
    
    # Limiter à 5 mots max pour la requête API
    return " ".join(unique_words[:5])

def get_alternative_keywords(query: str) -> list:
    """Generate alternative keywords for specific prompts to improve image search."""
    query = query.lower()
    alternatives = {
        "justin bieber": ["pop star", "celebrity singer", "music concert", "pop music"],
        "healthy food": ["salad", "fresh vegetables", "healthy meal", "nutritious diet"]
    }
    return alternatives.get(query, [query])
def check_relevance(tags: list, keywords: list, min_matches: int = 2) -> bool:
    """Vérifie si au moins 2 mots-clés correspondent"""
    tags = [tag.lower() for tag in tags]
    keywords = [keyword.lower() for keyword in keywords]
    
    # Compter les correspondances
    matches = sum(1 for keyword in keywords if keyword in tags)
    
    return matches >= min_matches

def fetch_image_from_pexels(query: str, image_id: str, max_attempts: int = 3) -> dict:
    logger.debug("Fetching image %s from Pexels for query: %s", image_id, query)
    if not PEXELS_API_KEY:
        raise Exception("Pexels API Key is not set")

    refined_query = refine_query(query)
    logger.debug("Refined query for Pexels %s: %s", image_id, refined_query)
    
    page = int(image_id.split('_')[-1]) + 1
    attempt = 0
    keywords = refined_query.split()
    fallback_photo = None

    while attempt < max_attempts:
        try:
            url = "https://api.pexels.com/v1/search"
            headers = {"Authorization": PEXELS_API_KEY}
            params = {
                "query": refined_query,
                "per_page": 3,
                "page": page + attempt,
                "orientation": "landscape"
            }
            
            response = requests.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            
            if not data['photos']:
                logger.warning("No images found for query '%s' on page %d, attempt %d", refined_query, page + attempt, attempt + 1)
                attempt += 1
                continue

            if not fallback_photo:
                fallback_photo = data['photos'][0]

            for photo in data['photos']:
                description = photo.get('alt', '') + ' ' + photo.get('description', '')
                tags = description.lower().split()
                if check_relevance(tags, keywords):
                    image_url = photo['src']['medium']
                    photographer = photo['photographer']
                    photographer_url = photo['photographer_url']
                    logger.debug("Fetched direct image URL %s from Pexels: %s", image_id, image_url)
                    return {
                        "url": image_url,
                        "attribution": f"Photo by <a href=\"{photographer_url}\">{photographer}</a> on <a href=\"https://www.pexels.com\">Pexels</a>",
                        "source": "Pexels"
                    }
            logger.warning("No relevant images found for query '%s' on page %d, attempt %d", refined_query, page + attempt, attempt + 1)
            attempt += 1
            continue
        except Exception as e:
            logger.error("Error fetching image %s from Pexels with query '%s': %s", image_id, refined_query, e)
            attempt += 1
            continue

    # Fallback: use the first image if available
    if fallback_photo:
        photo = fallback_photo
        image_url = photo['src']['medium']
        photographer = photo['photographer']
        photographer_url = photo['photographer_url']
        logger.debug("Fetched fallback direct image URL %s from Pexels: %s", image_id, image_url)
        return {
            "url": image_url,
            "attribution": f"Photo by <a href=\"{photographer_url}\">{photographer}</a> on <a href=\"https://www.pexels.com\">Pexels</a>",
            "source": "Pexels"
        }
    return None

def fetch_image_from_pixabay(query: str, image_id: str, max_attempts: int = 3) -> dict:
    logger.debug("Fetching image %s from Pixabay for query: %s", image_id, query)
    if not PIXABAY_API_KEY:
        raise Exception("Pixabay API Key is not set")

    refined_query = refine_query(query)
    logger.debug("Refined query for Pixabay %s: %s", image_id, refined_query)
    
    page = int(image_id.split('_')[-1]) + 1
    attempt = 0
    keywords = refined_query.split()
    fallback_hit = None

    while attempt < max_attempts:
        try:
            url = "https://pixabay.com/api/"
            params = {
                "key": PIXABAY_API_KEY,
                "q": refined_query,
                "per_page": 3,
                "page": page + attempt,
                "image_type": "photo",
                "orientation": "horizontal"
            }
            
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if not data['hits']:
                logger.warning("No images found for query '%s' on page %d, attempt %d", refined_query, page + attempt, attempt + 1)
                attempt += 1
                continue

            if not fallback_hit:
                fallback_hit = data['hits'][0]

            for hit in data['hits']:
                tags = hit.get('tags', '').split(', ')
                if check_relevance(tags, keywords):
                    image_url = hit['webformatURL']
                    photographer = hit['user']
                    photographer_url = f"https://pixabay.com/users/{hit['user']}-{hit['user_id']}/"
                    logger.debug("Fetched direct image URL %s from Pixabay: %s", image_id, image_url)
                    return {
                        "url": image_url,
                        "attribution": f"Photo by <a href=\"{photographer_url}\">{photographer}</a> on <a href=\"https://pixabay.com\">Pixabay</a>",
                        "source": "Pixabay"
                    }
            logger.warning("No relevant images found for query '%s' on page %d, attempt %d", refined_query, page + attempt, attempt + 1)
            attempt += 1
            continue
        except Exception as e:
            logger.error("Error fetching image %s from Pixabay with query '%s': %s", image_id, refined_query, e)
            attempt += 1
            continue

    # Fallback: use the first image if available
    if fallback_hit:
        hit = fallback_hit
        image_url = hit['webformatURL']
        photographer = hit['user']
        photographer_url = f"https://pixabay.com/users/{hit['user']}-{hit['user_id']}/"
        logger.debug("Fetched fallback direct image URL %s from Pixabay: %s", image_id, image_url)
        return {
            "url": image_url,
            "attribution": f"Photo by <a href=\"{photographer_url}\">{photographer}</a> on <a href=\"https://pixabay.com\">Pixabay</a>",
            "source": "Pixabay"
        }
    return None
def fetch_image(query: str, image_id: str, page_name: str = None, folder_name: str = None) -> dict:
    """Version améliorée avec contexte"""
    refined_query = refine_query(query, page_name, folder_name)
    logger.debug(f"Requête raffinée avec contexte: {refined_query}")
    
    # Essayer d'abord avec la requête exacte
    result = fetch_image_from_pexels(refined_query, image_id)
    if result:
        return result
    
    # En cas d'échec, essayer avec des alternatives
    alternatives = generate_alternative_queries(refined_query, page_name, folder_name)
    for alt_query in alternatives:
        result = fetch_image_from_pexels(alt_query, image_id)
        if result:
            return result
        
        result = fetch_image_from_pixabay(alt_query, image_id)
        if result:
            return result
    
    logger.warning(f"Aucune image pertinente trouvée pour {refined_query}")
    return {"url": "", "source": ""}
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    retry=retry_if_exception_type(requests.exceptions.HTTPError),
    before_sleep=lambda retry_state: logger.debug(f"Retrying Groq API call, attempt {retry_state.attempt_number} due to error: {retry_state.outcome.exception()}")
)
def generate_alternative_queries(base_query: str, page_name: str, folder_name: str) -> list:
    """Génère des alternatives logiques basées sur le contexte"""
    alternatives = [base_query]
    
    # Mapping de termes associés
    term_associations = {
        'fruits': ['produce', 'fresh food', 'healthy snack'],
        'voyages': ['vacation', 'tourism', 'adventure'],
        'technologie': ['gadget', 'innovation', 'digital']
    }
    
    context = page_name or folder_name or ""
    context_key = context.lower().split()[0]
    
    if context_key in term_associations:
        alternatives.extend(term_associations[context_key])
    
    return alternatives
def call_groq_api(messages: list) -> dict:
    """Call the Groq API with error handling and retries."""
    logger.debug("Calling Groq API with messages: %s", messages)
    try:
        headers = {
            'Authorization': f'Bearer {GROQ_API_KEY}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'model': 'llama3-70b-8192',
            'messages': messages,
            'max_tokens': 2000,
            'temperature': 0.7,
        }
        
        response = requests.post(GROQ_API_URL, headers=headers, json=payload)
        response.raise_for_status()
        logger.debug("Groq API response: %s", response.json())
        return response.json()
    except requests.exceptions.HTTPError as e:
        logger.error("HTTP error during Groq API call: %s", e)
        if e.response.status_code == 429:
            logger.warning("Rate limit exceeded, retrying...")
        raise
    except Exception as e:
        logger.error("Error during Groq API call: %s", e)
        raise

def clean_code(html_code: str, page_name: str) -> str:
    """Clean HTML without injecting a dynamic navbar."""
    # Extract HTML content and remove markdown/explanatory text
    html_match = re.search(r'```html\n([\s\S]*?)\n```', html_code, re.MULTILINE)
    cleaned = html_match.group(1) if html_match else html_code

    # Remove markdown, comments, and explanatory text
    cleaned = re.sub(r'```html\n|```', '', cleaned)
    cleaned = re.sub(r'<!--[\s\S]*?-->', '', cleaned)
    cleaned = re.sub(
        r'<p[^>]*>\s*(This code creates|This HTML page is designed|Here is|Generated by|Explanation|Note|Description)[\s\S]*?</p>',
        '',
        cleaned,
        flags=re.I
    )

    # Ensure basic HTML structure
    if not cleaned.strip().startswith('<!DOCTYPE html>'):
        cleaned = f'<!DOCTYPE html>\n<html lang="en">\n{cleaned.strip()}\n</html>'
    if '<html' not in cleaned:
        cleaned = f'<!DOCTYPE html>\n<html lang="en">\n{cleaned.strip()}\n</html>'
    if '<head>' not in cleaned:
        cleaned = cleaned.replace(
            '<html',
            f'<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n'
        )
    if '<body>' not in cleaned:
        cleaned = cleaned.replace('</head>', '</head>\n<body>\n') + '\n</body>'
    cleaned = re.sub(r'<title>.*?</title>', f'<title>{page_name.replace(".html", "")} - My Website</title>', cleaned, flags=re.I)
    if not cleaned.endswith('</html>'):
        cleaned += '\n</html>'

    # Validate HTML structure
    if not re.search(r'<html[\s\S]*?</html>', cleaned, re.I):
        cleaned = (
            '<!DOCTYPE html>\n'
            '<html lang="en">\n'
            '<head>\n'
            '<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            f'<title>{page_name.replace(".html", "")} - My Website</title>\n'
            '</head>\n'
            '<body>\n'
            f'<p>Error: Invalid HTML generated for {page_name}</p>\n'
            '</body>\n'
            '</html>'
        )

    return cleaned.strip()

def is_address_and_map_intent(prompt: str) -> bool:
    """Check if the prompt contains an address AND an intent to add a map."""
    address_keywords = ['rue', 'avenue', 'boulevard', 'place', 'impasse', 'allée', 'route', 'street', 'avenue', 'blvd', 'road', 'city', 'town']
    has_number = bool(re.search(r'\d+', prompt.lower()))
    has_address_keyword = any(keyword in prompt.lower() for keyword in address_keywords)
    has_address = has_number or has_address_keyword

    map_intent_keywords = ['carte', 'map', 'localisation', 'location', 'géographique', 'geographic']
    has_map_intent = any(keyword in prompt.lower() for keyword in map_intent_keywords)

    return has_address and has_map_intent

@app.route('/api/check-address', methods=['POST'])
def check_address():
    """Check if the prompt contains an address AND an intent to add a map."""
    logger.debug("Received request for /api/check-address: %s", request.json)
    try:
        data = request.json
        prompt = data.get('prompt')
        
        if not prompt:
            logger.warning("Prompt is missing in request")
            return jsonify({'isAddressAndMapIntent': False, 'code': 'MISSING_PROMPT'}), 400
        
        result = is_address_and_map_intent(prompt)
        logger.debug("Prompt '%s' has address and map intent: %s", prompt, result)
        return jsonify({'isAddressAndMapIntent': result})
    
    except Exception as e:
        logger.error("Error checking address: %s", e)
        return jsonify({'isAddressAndMapIntent': False, 'code': 'CHECK_ADDRESS_FAILED'}), 500

@app.route('/api/generate', methods=['POST'])
def generate_code_endpoint():
    """Generate or modify HTML/CSS code dynamically based on a structured prompt, folder, and page context, including icon support."""
    logger.debug("Received request for /api/generate: %s", request.json)
    try:
        data = request.json
        prompt = data.get('prompt', '').strip()
        current_code = data.get('currentCode', '')
        existing_pages = data.get('existingPages', [])
        page_path = data.get('pagePath', 'default/index.html')
        site_type = data.get('siteType', 'generic')

        if not prompt:
            logger.warning("Prompt is missing in request")
            return jsonify({'error': 'Prompt is required', 'code': 'MISSING_PROMPT'}), 400

        # Parse the structured prompt
        action_match = re.search(r'Action: (add|remove|modify)', prompt, re.I)
        target_match = re.search(r'Target: (\w+)', prompt, re.I)
        content_match = re.search(r'Content: "([^"]*)"', prompt, re.I)
        style_match = re.search(r'Style: (\{.*?\})', prompt, re.I)
        icon_match = re.search(r'Icon: ([\w-]+)', prompt, re.I)

        action = action_match.group(1).lower() if action_match else 'add'
        target = target_match.group(1).lower() if target_match else 'custom'
        content = content_match.group(1) if content_match else ''
        style = json.loads(style_match.group(1)) if style_match else {}
        icon = icon_match.group(1) if icon_match else None

        logger.debug("Parsed prompt - Action: %s, Target: %s, Content: %s, Style: %s, Icon: %s", action, target, content, style, icon)

        folder_name = get_folder_from_path(page_path)
        page_name = page_path.split('/')[-1].replace('.html', '')

        # Define default header and footer without icons in titles
      
        default_footer = f"""
            <footer style="background: #f8fafc; color: #4b5563; padding: 20px; text-align: center;">
                <p>© {datetime.now().year} {page_name}. Tous droits réservés.</p>
                <ul style="list-style: none; display: flex; justify-content: center; gap: 20px; margin-top: 10px;">
                    <li><a href="/privacy.html" style="color: #4b5563; text-decoration: none;">Politique de confidentialité</a></li>
                    <li><a href="/terms.html" style="color: #4b5563; text-decoration: none;">Conditions d'utilisation</a></li>
                </ul>
            </footer>
        """
        system_prompt = (
            "You are an expert AI specialized in dynamic, context-aware web development. "
            "Generate or modify HTML/CSS content that strictly adheres to the page theme and user request. "
            "Critical Rules:\n"
            "1. Theme Coherence:\n"
            "   - Analyze the page name '{page_name}' and folder '{folder_name}' to determine the core theme\n"
            "   - All generated content must be semantically relevant to this theme\n"
            "   - Example: 'flowers' page → floral content, gardening terms, plant imagery\n"
            
            "2. Dynamic Content Generation:\n"
            "   - NEVER use placeholder text like Lorem Ipsum\n"
            "   - Generate realistic, theme-specific content in French\n"
            "   - For '{page_name}':\n"
            "     * Research appropriate terminology\n"
            "     * Create plausible section structure\n"
            "     * Use authentic examples\n"
            
            "3. Visual Hierarchy:\n"
            "   - Main title: Clearly reflects the page theme\n"
            "   - Sections: Organized by logical sub-themes\n"
            "   - Content: Detailed and specific to each section\n"
            
            "4. Structural Requirements:\n"
            "   - Mandatory sections based on theme:\n"
            "     * Flowers: Bouquets, Care Tips, Seasonal Varieties\n"
            "     * Products: Features, Specifications, Reviews\n"
            "     * Services: Process, Benefits, Testimonials\n"
            
            "5. Modification Protocol:\n"
            "   - Action: '{action}' → Apply precisely to '{target}'\n"
            "   - Content: '{content}' → Expand into complete, theme-appropriate elements\n"
            "   - Style: {style} → Implement with theme-consistent colors\n"
            "   - Icon: '{icon}' → Only use when semantically relevant\n"
            
            "6. Quality Controls:\n"
            "   - Content Validation: Self-check for theme relevance\n"
            "   - Language: Professional French with correct terminology\n"
            "   - Accessibility: ARIA tags, alt text, semantic HTML\n"
            "   - Responsiveness: Mobile-first CSS with flex/grid\n"
            
            "7. Output Format:\n"
            "   - Complete HTML document\n"
            "   - CSS embedded in <style>\n"
            "   - No placeholders or generic content\n"
            "   - French language content\n"
            
            "8. Prohibited Actions:\n"
            "   - Generic templates\n"
            "   - Off-theme content\n"
            "   - Placeholder text\n"
            "   - Broken semantic structure\n"
            
            "Example for 'flowers' page:\n"
            "1. Header with floral imagery\n"
            "2. Section: 'Nos Bouquets Printaniers'\n"
            "3. Section: 'Conseils d'Entretien'\n"
            "4. Footer with contact information\n"
            ).format(
                action=action,
                target=target,
                content=content,
                style=json.dumps(style),
                icon=icon if icon else 'none',
                page_name=page_name,
                folder_name=folder_name
            )

        # Prompt utilisateur avec contexte clair
        user_prompt = (
            f"Current code:\n{current_code}\n\n"
            f"Existing pages: {existing_pages}\n\n"
            f"Structured prompt:\nAction: {action}\nTarget: {target}\nContent: {content}\nStyle: {json.dumps(style)}\nIcon: {icon if icon else 'none'}\n\n"
            "Apply the requested modifications to the current code. Preserve all existing content unless explicitly instructed to remove or modify specific elements."
        )

        # Appel unique à l'API Groq
        logger.debug("Calling Groq API with system prompt: %s", system_prompt)
        logger.debug("User prompt: %s", user_prompt)
        completion = call_groq_api([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ])
        generated_code = completion['choices'][0]['message']['content']
        logger.debug("Generated code from Groq: %s", generated_code)

        # Nettoyage du code généré
        cleaned_code = clean_code(generated_code, page_name)
        logger.debug("Cleaned code: %s", cleaned_code)

        # Ajout des styles par défaut si nécessaire
        if '<style>' not in cleaned_code:
            default_styles = """
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Roboto', sans-serif; background: #ffffff; color: #333333; line-height: 1.6; }
                h1, h2, h3 { font-family: 'Playfair Display', serif; color: #1e40af; margin-bottom: 20px; }
                header { background: #ffffff; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1); padding: 20px; text-align: center; }
                nav a { color: #1e40af; margin: 0 15px; text-decoration: none; font-weight: 600; }
                nav a:hover { color: #3b82f6; }
                main { max-width: 1200px; margin: 0 auto; padding: 20px; background: #ffffff; }
                button { background: #1e40af; color: #ffffff; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
                button:hover { background: #3b82f6; }
                footer { background: #f8fafc; color: #4b5563; padding: 20px; text-align: center; }
                .product-card { display: grid; gap: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
                @keyframes slideIn { 0% { transform: translateX(-100%); } 100% { transform: translateX(0); } }
                .animated { animation: fadeIn 0.5s ease-in-out; }
                i { margin-right: 8px; }
            """
            cleaned_code = cleaned_code.replace(
                '</head>',
                f'<style>{default_styles}</style>\n</head>'
            )

        # Vérifier si l'icône a été appliquée si demandée
        if icon and target not in ['navbar', 'title', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            icon_class = f'fa-{icon}'
            if icon_class not in cleaned_code:
                logger.warning("Icon '%s' was requested but not applied in the generated code", icon)

        # Vérifier si l'animation a été appliquée
        if style.get('animation') and '.animated' not in cleaned_code:
            logger.warning("Animation style was requested but not applied in the generated code")

        return jsonify({
            'code': cleaned_code,
            'folder': folder_name,
            'modifications': [f"Applied prompt: Action: {action}, Target: {target}, Content: {content}, Style: {json.dumps(style)}, Icon: {icon if icon else 'none'}"]
        })

    except Exception as e:
        logger.error("Error during code generation: %s", e, exc_info=True)
        return jsonify({'error': str(e), 'code': 'GENERATE_CODE_FAILED'}), 500

def fetch_image_from_pexels_or_pixabay(query: str) -> str:
    headers = {"Authorization": PEXELS_API_KEY}
    params = {"query": query, "per_page": 1}
    url = "https://api.pexels.com/v1/search"
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("photos"):
            image_url = data["photos"][0]["src"]["medium"]
            ext = os.path.splitext(image_url)[1] or ".jpg"
            image_id = f"real_image_{uuid.uuid4().hex[:8]}"
            static_dir = "static"
            os.makedirs(static_dir, exist_ok=True)
            image_path = os.path.join(static_dir, f"{image_id}{ext}")
            img_data = requests.get(image_url).content
            with open(image_path, "wb") as f:
                f.write(img_data)
            return f"/static/{image_id}{ext}"
    except Exception as e:
        logger.error(f"Error fetching image from Pexels for query '{query}': {e}")
    # Fallback
    return "/static/real_image.jpg"

@app.route('/api/add-image', methods=['POST'])
def add_image():
    try:
        current_code = request.form.get('currentCode')
        page_path = request.form.get('pagePath', '')
        # Utilise le nom de fichier comme query par défaut
        page_name = os.path.splitext(os.path.basename(page_path))[0] if page_path else 'default'
        if not current_code:
            return jsonify({'error': 'Current code is required', 'code': 'MISSING_CURRENT_CODE'}), 400

        updated_code = current_code
        images_metadata = []

        # 1. Remplacer les <img src="https://picsum.photos/..."> ou <img src=""> par des images pertinentes
        def find_external_or_empty_img_tags(code: str) -> list:
            # Trouve <img> avec src vide ou src externe
            return re.findall(r'(<img[^>]*src=["\'](https?://[^"\']*|)["\'][^>]*>)', code)

        img_tags = find_external_or_empty_img_tags(updated_code)
        for i, (img_tag, src_val) in enumerate(img_tags):
            # Utilise le alt comme query si possible
            alt_match = re.search(r'alt=["\']([^"\']*)["\']', img_tag)
            alt_query = alt_match.group(1) if alt_match and alt_match.group(1).strip() else page_name
            try:
                result = fetch_image(alt_query, f"{page_name}_{i}", page_name)
                real_img_url = result["url"] if result else "/static/real_image.jpg"
                attribution = result["attribution"] if result and "attribution" in result else ""
                images_metadata.append({
                    "url": real_img_url,
                    "query": alt_query,
                    "attribution": attribution,
                    "source": result["source"] if result and "source" in result else ""
                })
            except Exception as e:
                real_img_url = "/static/real_image.jpg"
                images_metadata.append({
                    "url": real_img_url,
                    "query": alt_query,
                    "attribution": "",
                    "source": ""
                })
            new_img_tag = re.sub(r'src=["\'][^"\']*["\']', f'src="{real_img_url}"', img_tag)
            updated_code = updated_code.replace(img_tag, new_img_tag, 1)

        # 2. Remplacer les background-image: url("https://picsum.photos/...") dans le CSS
        bg_pattern = r'background-image:\s*url\([\'\"]?(https?://[^)\'\"]+)[\'\"]?\)'
        matches = re.findall(bg_pattern, updated_code)
        for i, url in enumerate(matches):
            try:
                result = fetch_image(page_name, f"{page_name}_bg_{i}", page_name)
                real_img_url = result["url"] if result else "/static/real_image.jpg"
            except Exception as e:
                real_img_url = "/static/real_image.jpg"
            updated_code = updated_code.replace(url, real_img_url)

        # 3. Remplacer les images locales (ex: car1.jpg, bg.jpg, etc.)
        def find_local_img_tags(code: str) -> list:
            # Trouve les balises <img> avec src local (ex: .jpg, .png, etc. sans http/data)
            return re.findall(r'(<img[^>]*src=["\']((?!http)(?!data:)[^"\']*\.(jpg|jpeg|png|webp|gif))["\'][^>]*>)', code, re.IGNORECASE)

        local_imgs = find_local_img_tags(updated_code)
        for i, img_tag_tuple in enumerate(local_imgs):
            img_tag = img_tag_tuple[0]
            src_match = re.search(r'src=["\']([^"\']+)["\']', img_tag)
            original_filename = src_match.group(1) if src_match else f"{page_name}_local_{i}.jpg"
            alt_match = re.search(r'alt=["\']([^"\']*)["\']', img_tag)
            alt_query = alt_match.group(1) if alt_match and alt_match.group(1).strip() else page_name
            try:
                result = fetch_image(alt_query, f"{page_name}_local_{i}", page_name)
                # Download the image from result["url"] and save as static/original_filename
                if result and "url" in result:
                    image_response = requests.get(result["url"])
                    image_response.raise_for_status()
                    static_dir = "static"
                    os.makedirs(static_dir, exist_ok=True)
                    image_path = os.path.join(static_dir, original_filename)
                    with open(image_path, 'wb') as f:
                        f.write(image_response.content)
                    real_img_url = f"/static/{original_filename}"
                else:
                    real_img_url = "/static/real_image.jpg"
                attribution = result["attribution"] if result and "attribution" in result else ""
                images_metadata.append({
                    "url": real_img_url,
                    "query": alt_query,
                    "attribution": attribution,
                    "source": result["source"] if result and "source" in result else ""
                })
            except Exception as e:
                real_img_url = "/static/real_image.jpg"
                images_metadata.append({
                    "url": real_img_url,
                    "query": alt_query,
                    "attribution": "",
                    "source": ""
                })
            new_img_tag = re.sub(r'src=["\'][^"\']*["\']', f'src="{real_img_url}"', img_tag)
            updated_code = updated_code.replace(img_tag, new_img_tag, 1)

        return jsonify({
            'code': updated_code,
            'images': images_metadata
        })

    except Exception as e:
        logger.error(f"Error in add_image: {str(e)}", exc_info=True)
        return jsonify({'error': str(e), 'code': 'ADD_IMAGE_FAILED'}), 500

@app.route('/api/voice-modification', methods=['POST'])
def voice_modification():
    """Process voice command input to apply specific changes to the code, including icon support."""
    logger.debug("Received request for /api/voice-modification: %s", request.json)
    try:
        data = request.json
        voice_transcription = data.get('voiceTranscription', '').strip()
        current_code = data.get('currentCode', '')
        existing_pages = data.get('existingPages', [])
        page_path = data.get('pagePath', 'default/index.html')

        if not voice_transcription:
            logger.warning("Voice transcription is missing in request")
            return jsonify({'error': 'Voice transcription is required', 'code': 'MISSING_TRANSCRIPTION'}), 400

        if not current_code:
            logger.warning("Current code is missing in request")
            return jsonify({'error': 'Current code is required', 'code': 'MISSING_CURRENT_CODE'}), 400

        page_name = page_path.split('/')[-1].replace('.html', '')

        def extract_intent(transcription: str) -> tuple:
            """Analyze the voice command to determine the intent and icon if specified."""
            transcription = transcription.lower()
            intent = "unknown"
            icon = None

            # Check for intent
            if "ajouter une image" in transcription or "add an image" in transcription:
                intent = "add_image"
            elif "changer le texte" in transcription or "change the text" in transcription:
                intent = "modify_text"
            elif "changer le style" in transcription or "change the style" in transcription:
                intent = "modify_style"
            elif "ajouter un bouton" in transcription or "add a button" in transcription:
                intent = "add_button"
            elif "ajouter une icône" in transcription or "add an icon" in transcription:
                intent = "add_icon"

            # Check for icon specification
            icon_match = re.search(r'icône ([\w-]+)|icon ([\w-]+)', transcription)
            if icon_match:
                icon = icon_match.group(1) or icon_match.group(2)

            return intent, icon

        intent, icon = extract_intent(voice_transcription)
        logger.debug("Extracted intent: %s, Icon: %s", intent, icon)

        if intent == "unknown":
            logger.warning("Intent could not be determined from voice transcription: %s", voice_transcription)
            return jsonify({'error': 'Intent could not be determined', 'code': 'UNKNOWN_INTENT'}), 400

        # Construct contextual prompt for AI
        contextual_prompt = (
            f"The following voice command was given: '{voice_transcription}'. "
            "Modify only the relevant elements in the current code based on this command. "
            f"Intent: {intent}. "
            f"Icon (if specified): {icon if icon else 'none'}."
        )

        system_prompt = (
            "You are an AI specialized in web development. "
            "Analyze the voice command and modify only the parts of the HTML/CSS code that correspond to the command. "
            "Do not modify other parts unless explicitly requested. "
            "If an icon is specified, add the corresponding Font Awesome icon to the target element:\n"
            "   - For buttons: Add the icon inside the button with `<i class=\"fas fa-{icon}\"></i>` before the text.\n"
            "   - For links: Add the icon before the link text with `<i class=\"fas fa-{icon}\"></i>`.\n"
            "   - For sections: Add the icon in a wrapper div above the section content.\n"
            "   - Do NOT add icons to titles (e.g., <h1>, <h2>, etc.) or navigation bars (<nav>).\n"
            "Ensure accessibility by adding appropriate aria-labels to elements with icons."
        )

        # Construct the full prompt
        full_prompt = f"{contextual_prompt}\n\n{system_prompt}"

        # Call Groq API for AI interpretation
        completion = call_groq_api([
            {"role": "system", "content": full_prompt},
            {
                "role": "user",
                "content": (
                    f"Current code:\n{current_code}\n\n"
                    f"Existing pages: {existing_pages}\n\n"
                    f"Voice command: {voice_transcription}"
                )
            }
        ])

        # Process the AI response
        generated_code = completion['choices'][0]['message']['content']
        cleaned_code = clean_code(generated_code, page_name)
        logger.debug("Generated code: %s", cleaned_code)

        return jsonify({
            'code': cleaned_code,
            'intent': intent,
            'icon': icon if icon else 'none',
            'message': f"Code modified successfully for intent '{intent}'"
        })

    except Exception as e:
        logger.error("Error processing voice command: %s", e)
        return jsonify({'error': str(e), 'code': 'VOICE_MODIFICATION_FAILED'}), 500

@app.route('/api/transcribe', methods=['POST'])
def transcribe_audio():
    """Transcribe audio using SpeechRecognition with Google Speech-to-Text."""
    logger.debug("Received /api/transcribe request")
    temp_file_path = None
    wav_path = None
    max_retries = 3
    try:
        if 'audio' not in request.files:
            logger.warning("No audio file provided")
            return jsonify({'error': 'Audio file required', 'code': 'MISSING_AUDIO_FILE'}), 400

        audio_file = request.files['audio']
        if not audio_file.filename.lower().endswith(('.webm', '.wav', '.mp3', '.m4a')):
            logger.warning("Unsupported format: %s", audio_file.filename)
            return jsonify({'error': 'Unsupported audio format, must be .webm, .wav, .mp3, or .m4a', 'code': 'UNSUPPORTED_FORMAT'}), 400

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.webm')
        temp_file_path = temp_file.name
        audio_file.save(temp_file_path)
        temp_file.close()
        logger.debug("Saved audio to: %s", temp_file_path)

        file_size = os.path.getsize(temp_file_path)
        logger.debug("Audio file size: %d bytes", file_size)
        if file_size == 0:
            logger.error("Audio file is empty")
            return jsonify({'error': 'Audio file is empty', 'code': 'EMPTY_AUDIO_FILE'}), 400

        if not os.path.exists(temp_file_path):
            logger.error("Temporary audio file does not exist at: %s", temp_file_path)
            return jsonify({'error': 'Failed to save audio file', 'code': 'SAVE_AUDIO_FAILED'}), 500

        try:
            audio = AudioSegment.from_file(temp_file_path)
            logger.debug("Successfully loaded audio file with pydub")
        except Exception as e:
            logger.error("Failed to load audio file with pydub: %s", e)
            return jsonify({'error': 'Failed to process audio file, ensure ffmpeg is installed and in PATH', 'code': 'PROCESS_AUDIO_FAILED'}), 500

        wav_path = temp_file_path.replace('.webm', '.wav')
        try:
            audio.export(wav_path, format='wav')
            logger.debug("Converted audio to WAV: %s", wav_path)
        except Exception as e:
            logger.error("Failed to convert audio to WAV: %s", e)
            return jsonify({'error': 'Failed to convert audio to WAV format, ensure ffmpeg is installed', 'code': 'CONVERT_AUDIO_FAILED'}), 500

        if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
            logger.error("WAV file conversion failed: %s", wav_path)
            return jsonify({'error': 'Failed to convert audio to WAV format', 'code': 'CONVERT_AUDIO_FAILED'}), 500
        logger.debug("WAV file size after conversion: %d bytes", os.path.getsize(wav_path))

        for attempt in range(max_retries):
            try:
                with sr.AudioFile(wav_path) as source:
                    audio_data = recognizer.record(source)
                    if not audio_data:
                        logger.warning("No audio data recorded")
                        return jsonify({'error': 'No audio data recorded', 'code': 'NO_AUDIO_DATA'}), 400
                    transcribed_text = recognizer.recognize_google(audio_data, language='en-US')
                    logger.debug("Transcription successful: %s", transcribed_text)
                    return jsonify({'text': transcribed_text})
            except sr.UnknownValueError as e:
                logger.warning("Attempt %d: Google Speech Recognition could not understand the audio: %s", attempt + 1, e)
                if attempt == max_retries - 1:
                    return jsonify({'error': 'Could not understand the audio after multiple attempts', 'code': 'TRANSCRIBE_FAILED'}), 400
            except sr.RequestError as e:
                logger.warning("Attempt %d: Google Speech Recognition request failed: %s", attempt + 1, e)
                if attempt == max_retries - 1:
                    return jsonify({'error': f'Request to Google Speech API failed after multiple attempts: {e}', 'code': 'API_REQUEST_FAILED'}), 500
            time.sleep(1)

        return jsonify({'error': 'Failed to transcribe audio after retries', 'code': 'TRANSCRIBE_FAILED'}), 500

    except Exception as e:
        logger.error("Transcription error: %s", e)
        return jsonify({'error': f'Transcription failed: {str(e)}', 'code': 'TRANSCRIBE_FAILED'}), 500
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.debug("Cleaned up temp file: %s", temp_file_path)
            except Exception as e:
                logger.error("Failed to clean up temp file %s: %s", temp_file_path, e)
        if wav_path and os.path.exists(wav_path):
            try:
                os.remove(wav_path)
                logger.debug("Cleaned up WAV file: %s", wav_path)
            except Exception as e:
                logger.error("Failed to clean up WAV file %s: %s", wav_path, e)

@app.route('/api/add-folder', methods=['POST'])
def add_folder():
    """Route to create a folder and integrate generated pages."""
    logger.debug("Received request for /api/add-folder: %s", request.json)
    try:
        data = request.json
        folder_name = data.get('folderName')
        pages = data.get('pages')

        if not folder_name:
            logger.warning("Folder name is missing in request")
            return jsonify({'error': 'Folder name is required', 'code': 'MISSING_FOLDER_NAME'}), 400

        if not pages or not isinstance(pages, dict):
            logger.warning("Pages data is missing or invalid in request")
            return jsonify({'error': 'Pages are required and must be a dictionary', 'code': 'INVALID_PAGES'}), 400

        folder_path = os.path.join('static', folder_name)
        os.makedirs(folder_path, exist_ok=True)

        for page_name, page_content in pages.items():
            if not page_name.endswith('.html'):
                page_name += '.html'
            file_path = os.path.join(folder_path, page_name)
            # --- Image replacement logic: use folder_name as the image query ---
            # Find all <img> tags and replace their src with images from Pexels/Pixabay using folder_name as the query
            def replace_imgs_with_folder_query(html_code, folder_query):
                def img_replacer(match):
                    img_tag = match.group(0)
                    alt_match = re.search(r'alt=["\']([^"\']*)["\']', img_tag)
                    alt_query = alt_match.group(1) if alt_match and alt_match.group(1).strip() else folder_query
                    result = fetch_image(alt_query, f"{folder_query}_folder", folder_query)
                    real_img_url = result["url"] if result else "https://via.placeholder.com/300"
                    return re.sub(r'src=["\'][^"\']*["\']', f'src="{real_img_url}"', img_tag)
                return re.sub(r'<img[^>]*src=["\'](https?://[^"\']*|)["\'][^>]*>', img_replacer, html_code)
            page_content = replace_imgs_with_folder_query(page_content, folder_name)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(page_content)
            logger.debug("Saved page %s to %s", page_name, file_path)

        logger.info("Folder '%s' created with %d pages", folder_name, len(pages))
        return jsonify({
            'message': f"Folder '{folder_name}' created successfully",
            'folderPath': folder_path,
            'pages': list(pages.keys())
        })

    except Exception as e:
        logger.error("Error creating folder: %s", e)
        return jsonify({'error': str(e), 'code': 'FOLDER_CREATION_FAILED'}), 500

@app.route('/api/add-page', methods=['POST'])
def add_page():
    logger.debug("Received request for /api/add-page: %s", request.json)
    try:
        data = request.json
        prompt = data.get('prompt')
        page_name = data.get('pageName')

        if not page_name:
            logger.warning("Page name is missing in request")
            return jsonify({'error': 'Page name is required', 'code': 'MISSING_PAGE_NAME'}), 400

        folder_name = get_folder_from_path(page_name)
        page_title = page_name.split('/')[-1].replace('.html', '')

        default_header = f"""
            <header>
                <nav style="display: flex; justify-content: center; align-items: center; padding: 20px; background: #ffffff; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);">
                    <h1 style="font-family: 'Playfair Display', serif; color: #1e40af; margin: 0;">{page_title}</h1>
                </nav>
            </header>
        """

        default_footer = f"""
            <footer style="background: #f8fafc; color: #4b5563; padding: 20px; text-align: center;">
                <p>© {datetime.now().year} {page_title}. Tous droits réservés.</p>
            </footer>
        """

        system_prompt = (
            "Tu es un expert en développement web. Génère un code HTML/CSS complet pour une nouvelle page web nommée '{page_name}'. "
            "Assure-toi que le design est moderne, professionnel et responsive, et que tout le CSS est inclus dans une balise <style> dans le <head> du HTML. "
            "Retourne uniquement le code, sans explications, entouré de ```html\\n...\\n```.\n"
            "Règles supplémentaires :\n"
            "- N'utilise jamais d'images de démonstration ou de placeholder (ex : picsum.photos, placekitten, loremflickr, unsplash, etc.).\n"
            "- N'utilise jamais de background-image avec une URL externe dans le CSS, même pour les sections parallax.\n"
            "- Pour chaque image, utilise une balise <img src=\"\" alt=\"nom pertinent\"> (le backend ajoutera l'image réelle).\n"
            "- Ne mets jamais de src commençant par http ou data: dans les balises <img>.\n"
            "- Le alt de chaque image doit être en rapport direct avec le contenu ou le nom de la page (ex: pour une page 'flowers.html', alt='Bouquet de fleurs', alt='Fleurs exotiques', etc.).\n"
            "- N'utilise jamais de background-image pour afficher une image décorative : utilise toujours une balise <img> à la place.\n"
            "- Ne génère jamais de texte explicatif, ni d'exemple, ni de note, ni de commentaire en dehors du code HTML.\n"
            "Exemple : Pour une page 'flowers.html', écris <img src=\"\" alt=\"Bouquet de fleurs\"> et non <div style=\"background-image: url('https://picsum.photos/200/300')\"></div>.\n"
        )

        creative_prompt = (
            f"{prompt or f'Crée une page {page_name} pour le site web'}\n\n"
            "Assure-toi que le design est très créatif et professionnel: utilise des combinaisons de polices uniques (par exemple, une police décorative comme 'Playfair Display' pour les titres et une police sans-serif comme 'Quicksand' pour le texte), des dégradés de couleurs vibrants (par exemple, corail et violet), des animations fluides (comme des effets de rebond ou de fondu). Ajoute des effets de survol interactifs sur les liens et les boutons, et intègre une section parallax pour les arrière-plans. Assure-toi que le site reste responsive et accessible."
        )

        messages = [
            {
                "role": "system",
                "content": f"Tu es un expert en développement web. Génère un code HTML/CSS complet pour une nouvelle page web nommée '{page_name}'. "
            },
            {"role": "user", "content": creative_prompt}
        ]

        completion = call_groq_api(messages)
        generated_code = completion['choices'][0]['message']['content'].strip()
        
        # Extract the HTML code from the markdown-like format if present
        if generated_code.startswith('```html') and generated_code.endswith('```'):
            generated_code = generated_code[len('```html'):].rsplit('```', 1)[0].strip()

        cleaned_code = clean_code(generated_code, page_title)

        return jsonify({'code': cleaned_code, 'pageName': page_name, 'style': 'modern'})
    except Exception as e:
        logger.error("Error during page creation: %s", e)
        return jsonify({'error': str(e), 'code': 'PAGE_GENERATION_FAILED'}), 500

@app.route('/api/save-page', methods=['POST'])
def save_page():
    """Save the updated HTML content to the specified page file."""
    logger.debug("Received request for /api/save-page: %s", request.json)
    try:
        data = request.json
        page_path = data.get('pagePath')
        updated_code = data.get('code')

        if not page_path:
            logger.warning("Page path is missing in request")
            return jsonify({'error': 'Page path is required', 'code': 'MISSING_PAGE_PATH'}), 400

        if not updated_code:
            logger.warning("Updated code is missing in request")
            return jsonify({'error': 'Updated code is required', 'code': 'MISSING_CODE'}), 400

        static_dir = 'static'
        absolute_path = os.path.normpath(os.path.join(static_dir, page_path))

        if not absolute_path.startswith(static_dir):
            logger.warning("Unauthorized path manipulation attempted: %s", absolute_path)
            return jsonify({'error': 'Unauthorized path', 'code': 'INVALID_PATH'}), 400

        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)

        with open(absolute_path, 'w', encoding='utf-8') as f:
            f.write(updated_code)
        logger.debug("Saved updated content to %s", absolute_path)

        logger.info("Page '%s' updated successfully", page_path)
        return jsonify({
            'message': f"Page '{page_path}' updated successfully",
            'pagePath': page_path
        })

    except Exception as e:
        logger.error("Error saving page: %s", e)
        return jsonify({'error': str(e), 'code': 'SAVE_PAGE_FAILED'}), 500

    
@app.route('/api/hierarchy', methods=['GET'])
def get_hierarchy():
    """Return the hierarchy of files and folders in the static directory."""
    logger.debug("Received request for /api/hierarchy")
    try:
        static_dir = 'static'
        hierarchy = []

        for root, dirs, files in os.walk(static_dir):
            folder = root.replace(static_dir, '').lstrip(os.sep)
            if folder:
                folder_data = {
                    'name': folder,
                    'type': 'folder',
                    'path': folder,
                    'children': [
                        {'name': f, 'type': 'file', 'path': os.path.join(folder, f)}
                        for f in files if f.endswith(('.html', '.jpg', '.png', '.css', '.js'))
                    ]
                }
                hierarchy.append(folder_data)

        root_files = [
            {'name': f, 'type': 'file', 'path': f}
            for f in os.listdir(static_dir)
            if os.path.isfile(os.path.join(static_dir, f)) and f.endswith(('.html', '.jpg', '.png', '.css', '.js'))
        ]
        if root_files:
            hierarchy.append({'name': 'root', 'type': 'folder', 'path': '', 'children': root_files})

        logger.debug("Hierarchy returned: %s", hierarchy)
        return jsonify({'hierarchy': hierarchy})
    except Exception as e:
        logger.error("Error retrieving hierarchy: %s", e)
        return jsonify({'error': str(e), 'code': 'HIERARCHY_FETCH_FAILED'}), 500

@app.route('/api/update-hierarchy', methods=['POST'])
def update_hierarchy():
    """Update the hierarchy of files and pages based on drag-and-drop changes."""
    logger.debug("Received request for /api/update-hierarchy: %s", request.json)
    try:
        data = request.json
        new_hierarchy = data.get('hierarchy')

        if not new_hierarchy:
            logger.warning("Hierarchy data missing in request")
            return jsonify({'error': 'Hierarchy data required', 'code': 'MISSING_HIERARCHY'}), 400

        static_dir = 'static'
        for item in new_hierarchy:
            if item['type'] == 'folder':
                folder_path = os.path.normpath(os.path.join(static_dir, item['path']))
                if not folder_path.startswith(static_dir):
                    logger.warning("Unauthorized path manipulation attempted: %s", folder_path)
                    return jsonify({'error': 'Unauthorized path', 'code': 'INVALID_PATH'}), 400
                
                os.makedirs(folder_path, exist_ok=True)
                for child in item.get('children', []):
                    if child['type'] == 'file':
                        src_path = os.path.normpath(os.path.join(static_dir, child['path']))
                        dest_path = os.path.normpath(os.path.join(folder_path, child['name']))
                        
                        if not src_path.startswith(static_dir) or not dest_path.startswith(static_dir):
                            logger.warning("Unauthorized source or destination path: %s -> %s", src_path, dest_path)
                            return jsonify({'error': 'Unauthorized path', 'code': 'INVALID_PATH'}), 400

                        if os.path.exists(src_path) and src_path != dest_path:
                            os.rename(src_path, dest_path)
                            logger.debug("Moved file from %s to %s", src_path, dest_path)

        logger.info("Hierarchy updated successfully")
        return jsonify({'message': 'Hierarchy updated successfully'})
    except Exception as e:
        logger.error("Error updating hierarchy: %s", e)
        return jsonify({'error': str(e), 'code': 'HIERARCHY_UPDATE_FAILED'}), 500

@app.route('/api/live-preview', methods=['POST'])
def live_preview():
    """Update the Live Preview based on hierarchy changes."""
    logger.debug("Received request for /api/live-preview")
    try:
        data = request.json
        file_path = data.get('path')

        if not file_path:
            logger.warning("File path missing in request")
            return jsonify({'error': 'File path is required', 'code': 'MISSING_FILE_PATH'}), 400

        static_dir = 'static'
        absolute_path = os.path.join(static_dir, file_path)

        if not os.path.exists(absolute_path) or not absolute_path.startswith(static_dir):
            logger.warning("Invalid or unauthorized file path: %s", absolute_path)
            return jsonify({'error': 'Invalid file path', 'code': 'INVALID_FILE_PATH'}), 400

        with open(absolute_path, 'r', encoding='utf-8') as f:
            file_content = f.read()

        logger.info("File content returned for Live Preview: %s", file_path)
        return jsonify({'content': file_content, 'message': 'Live Preview content updated successfully'})
    except Exception as e:
        logger.error("Error updating Live Preview: %s", e)
        return jsonify({'error': str(e), 'code': 'LIVE_PREVIEW_UPDATE_FAILED'}), 500    

@app.route('/api/add-map', methods=['POST'])
def add_map():
    """Route to add a Google Maps map to the site with an icon."""
    logger.debug("Received request for /api/add-map: %s", request.json)
    try:
        data = request.json
        current_code = data.get('currentCode')
        map_description = data.get('mapDescription', 'Add a Google Maps map')
        lat = data.get('lat', 37.4419)
        lng = data.get('lng', -122.1419)
        zoom = data.get('zoom', 13)
        markers = data.get('markers', [])

        if not current_code:
            logger.warning("Current code is missing in request")
            return jsonify({'error': 'Current code is required', 'code': 'MISSING_CURRENT_CODE'}), 400

        if not GOOGLEMAPS_KEY:
            logger.error("Google Maps API key is not configured")
            return jsonify({'error': 'Google Maps API key is not configured', 'code': 'MISSING_API_KEY'}), 500

        # Generate the map HTML
        map_html = f"""
        <section class="map-section">
            <h2>Location Map</h2>
            <div id="map" style="height: 400px; width: 100%; margin: 20px 0;"></div>
            <script src="https://maps.googleapis.com/maps/api/js?key={GOOGLEMAPS_KEY}&callback=initMap" async defer></script>
            <script>
                function initMap() {{
                    const map = new google.maps.Map(document.getElementById("map"), {{
                        zoom: {zoom},
                        center: {{ lat: {lat}, lng: {lng} }}
                    }});
                    {''.join([f'new google.maps.Marker({{ position: {{ lat: {m["lat"]}, lng: {m["lng"]} }}, map: map, title: "{m.get("title", "")}" }});' for m in markers])}
                }}
            </script>
        </section>
        """

        # Log the generated map HTML for debugging
        logger.debug("Generated map HTML: %s", map_html)

        # Return the generated code with the map
        return jsonify({
            'code': current_code.replace('</body>', f'{map_html}\n</body>'),
            'map': {
                'lat': lat,
                'lng': lng,
                'zoom': zoom,
                'markers': markers
            }
        })

    except Exception as e:
        logger.error("Error adding map: %s", e)
        return jsonify({'error': str(e), 'code': 'ADD_MAP_FAILED'}), 500

@app.route('/api/geocode', methods=['POST'])
def geocode():
    """Route to get coordinates from an address (geocoding)."""
    logger.debug("Received request for /api/geocode: %s", request.json)
    try:
        data = request.json
        address = data.get('address')
        
        if not address:
            logger.warning("Address is missing in request")
            return jsonify({'error': 'Address is required', 'code': 'MISSING_ADDRESS'}), 400
        
        geocode_result = gmaps.geocode(address)
        if not geocode_result:
            logger.warning("No coordinates found for address: %s", address)
            return jsonify({'error': 'No coordinates found for this address', 'code': 'NO_COORDINATES_FOUND'}), 404
        
        coordinates = {
            'lat': geocode_result[0]['geometry']['location']['lat'],
            'lng': geocode_result[0]['geometry']['location']['lng']
        }
        
        logger.debug("Geocoded address %s to coordinates: %s", address, coordinates)
        return jsonify({
            'coordinates': coordinates
        })
    
    except Exception as e:
        logger.error("Error during geocoding: %s", e)
        return jsonify({'error': str(e), 'code': 'GEOCODE_FAILED'}), 500

@app.route('/api/reverse-geocode', methods=['POST'])
def reverse_geocode():
    """Route to get an address from coordinates (reverse geocoding)."""
    logger.debug("Received request for /api/reverse-geocode: %s", request.json)
    try:
        data = request.json
        lat = data.get('lat')
        lng = data.get('lng')
        
        if lat is None or lng is None:
            logger.warning("Coordinates are missing in request")
            return jsonify({'error': 'Coordinates (lat, lng) are required', 'code': 'MISSING_COORDINATES'}), 400
        
        reverse_geocode_result = gmaps.reverse_geocode((lat, lng))
        if not reverse_geocode_result:
            logger.warning("No address found for coordinates: (%s, %s)", lat, lng)
            return jsonify({'error': 'No address found for these coordinates', 'code': 'NO_ADDRESS_FOUND'}), 404
        
        address = {
            'formatted_address': reverse_geocode_result[0]['formatted_address'],
            'city': next((comp['long_name'] for comp in reverse_geocode_result[0]['address_components'] if 'locality' in comp['types']), None),
            'state': next((comp['long_name'] for comp in reverse_geocode_result[0]['address_components'] if 'administrative_area_level_1' in comp['types']), None),
            'country': next((comp['long_name'] for comp in reverse_geocode_result[0]['address_components'] if 'country' in comp['types']), None),
            'zip': next((comp['long_name'] for comp in reverse_geocode_result[0]['address_components'] if 'postal_code' in comp['types']), None),
        }
        
        logger.debug("Reverse geocoded coordinates (%s, %s) to address: %s", lat, lng, address)
        return jsonify({
            'address': address
        })
    
    except Exception as e:
        logger.error("Error during reverse geocoding: %s", e)
        return jsonify({'error': str(e), 'code': 'REVERSE_GEOCODE_FAILED'}), 500

@app.route('/')
def home():
    """Serve the main frontend page for testing."""
    logger.debug("Home endpoint called")
    return send_file('templates/index.html')

@app.route('/api/test', methods=['GET'])
def test():
    """Test route to verify server is running."""
    logger.debug("Test endpoint called")
    return jsonify({'message': 'Server is running!'}), 200

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files like images."""
    return app.send_static_file(filename)

def replace_external_images_with_real(code: str, query: str) -> str:
    # 1. Trouver tous les background-image: url(...)
    bg_pattern = r'background-image:\s*url\([\'"]?(http[^)\'"]+)[\'"]?\)'
    matches = re.findall(bg_pattern, code)
    for url in matches:
        # Appeler ici ta fonction fetch_image(query, ...) pour obtenir une vraie image
        real_img_url = fetch_image_from_pexels_or_pixabay(query)
        if real_img_url:  # Only replace if we got a valid URL
            code = code.replace(url, real_img_url)
    # 2. Idem pour les <img src="http...">
    img_pattern = r'<img[^>]*src=["\'](http[^"\']+)["\']'
    matches = re.findall(img_pattern, code)
    for url in matches:
        real_img_url = fetch_image_from_pexels_or_pixabay(query)
        if real_img_url:  # Only replace if we got a valid URL
            code = code.replace(url, real_img_url)
    return code

if __name__ == '__main__':
    for directory in ('static', 'templates'):
        os.makedirs(directory, exist_ok=True)
    
    port = int(os.getenv('PORT', 5000))
    logger.info("Starting Flask server on port %s", port)
    app.run(host='0.0.0.0', port=port, debug=True)
