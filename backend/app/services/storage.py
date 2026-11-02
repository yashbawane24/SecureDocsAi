"""
Encrypted File Storage Service
Enforces zero plaintext on disk:
- When storing: raw incoming bytes are encrypted in-memory and only the ciphertext is written to disk.
- When retrieving: ciphertext is read from disk and decrypted strictly into an in-memory io.BytesIO stream.
- Zero plaintext bytes are ever written to disk or temporary scratch files.
"""

import os
import io
import uuid
from typing import Tuple
from app.core.config import settings
from app.services.crypto import encrypt_bytes, decrypt_bytes

def ensure_storage_dir():
    os.makedirs(settings.STORAGE_DIR, exist_ok=True)

def store_encrypted_document(file_content: bytes, original_filename: str) -> Tuple[str, str, str, int]:
    """
    Encrypts raw document bytes in memory and writes ONLY the ciphertext to storage.
    Returns: (stored_filename, iv_hex, tag_hex, file_size_bytes)
    """
    ensure_storage_dir()
    
    # In-memory AES-256-GCM encryption
    ciphertext, iv, tag = encrypt_bytes(file_content)
    
    # Generate unique stored filename
    stored_filename = f"{uuid.uuid4().hex}.enc"
    file_path = os.path.join(settings.STORAGE_DIR, stored_filename)
    
    # Write ONLY encrypted ciphertext to disk
    with open(file_path, "wb") as f:
        f.write(ciphertext)
        
    return stored_filename, iv.hex(), tag.hex(), len(file_content)

def load_decrypted_document(stored_filename: str, iv_hex: str, tag_hex: str) -> io.BytesIO:
    """
    Reads ciphertext from disk and decrypts strictly in memory.
    Returns: io.BytesIO containing plaintext document bytes.
    No plaintext file is ever created on disk.
    """
    file_path = os.path.join(settings.STORAGE_DIR, stored_filename)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Stored encrypted document {stored_filename} not found.")
        
    with open(file_path, "rb") as f:
        ciphertext = f.read()
        
    iv = bytes.fromhex(iv_hex)
    tag = bytes.fromhex(tag_hex)
    
    # Decrypt in memory
    plaintext = decrypt_bytes(ciphertext, iv, tag)
    
    # Return as in-memory stream
    return io.BytesIO(plaintext)
