from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from .models import User
from .utils import clean_code

main = Blueprint('main', __name__)

@main.route('/signup', methods=['POST'])
def signup():
    """Handle user signup."""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    if User.find_user_by_email(email):
        return jsonify({"message": "User already exists"}), 400

    hashed_password = generate_password_hash(password)
    User.create_user(email, hashed_password)
    return jsonify({"message": "User created successfully"}), 201

@main.route('/signin', methods=['POST'])
def signin():
    """Handle user signin."""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    user = User.find_user_by_email(email)
    if not user or not check_password_hash(user['password'], password):
        return jsonify({"message": "Invalid email or password"}), 401

    return jsonify({"message": "Signed in successfully"}), 200

@main.route('/')
def home():
    """Home endpoint."""
    return jsonify({"message": "Flask server is running!"}), 200