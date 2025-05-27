from . import mongo

class User:
    """User model to interact with MongoDB."""

    @staticmethod
    def find_user_by_email(email):
        """Find a user by email."""
        return mongo.db.users.find_one({"email": email})

    @staticmethod
    def create_user(email, password):
        """Create a new user."""
        mongo.db.users.insert_one({"email": email, "password": password})