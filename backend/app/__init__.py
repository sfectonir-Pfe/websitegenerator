from flask import Flask
from flask_pymongo import PyMongo
from flask_cors import CORS
from .config import Config
from .routes import main  # Import routes from routes.py

# Initialize MongoDB instance
mongo = PyMongo()

def create_app():
    """Factory function to create the Flask app."""
    app = Flask(__name__)
    app.config.from_object(Config)
    CORS(app)

    # Initialize MongoDB
    mongo.init_app(app)

    # Register the main blueprint
    app.register_blueprint(main)

    return app