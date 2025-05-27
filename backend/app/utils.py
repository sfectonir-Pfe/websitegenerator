def clean_code(code):
    """Clean the generated code by removing unnecessary markers."""
    import re
    cleaned = re.sub(r'^```html\n|^```|\n```$', '', code)
    return cleaned.strip()