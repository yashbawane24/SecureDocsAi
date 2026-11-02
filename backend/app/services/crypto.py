"""
Cryptographic Engine for Ledger Vault
Implements AES-256-GCM authenticated encryption at rest.

SECURITY REQUIREMENT:
Decryption and watermarking happen strictly in memory (io.BytesIO).
Results are streamed directly to the client via StreamingResponse.
No plaintext file or intermediate decrypted data is ever written to disk or temporary files.
"""

import os
import secrets
from typing import Tuple
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings

def get_aes_key() -> bytes:
    """Retrieve and validate the 32-byte AES-256 master key from configuration."""
    raw_key = settings.AES_SECRET_KEY.strip()
    # Support 64-hex string or raw 32-byte string
    if len(raw_key) == 64:
        try:
            return bytes.fromhex(raw_key)
        except ValueError:
            pass
    key_bytes = raw_key.encode("utf-8")
    if len(key_bytes) < 32:
        # Pad to 32 bytes if needed in development, or truncate
        key_bytes = key_bytes.ljust(32, b"0")
    return key_bytes[:32]

def encrypt_bytes(plaintext: bytes) -> Tuple[bytes, bytes, bytes]:
    """
    Encrypt plaintext bytes using AES-256-GCM.
    Returns: (ciphertext, iv, tag)
    All operations occur strictly in memory.
    """
    key = get_aes_key()
    aesgcm = AESGCM(key)
    iv = secrets.token_bytes(12)  # 96-bit standard IV for GCM
    
    # AESGCM.encrypt returns ciphertext with 16-byte authentication tag appended
    encrypted_payload = aesgcm.encrypt(iv, plaintext, None)
    ciphertext = encrypted_payload[:-16]
    tag = encrypted_payload[-16:]
    
    return ciphertext, iv, tag

def decrypt_bytes(ciphertext: bytes, iv: bytes, tag: bytes) -> bytes:
    """
    Decrypt ciphertext bytes using AES-256-GCM with authentication tag verification.
    Returns: plaintext bytes.
    All operations occur strictly in memory.
    """
    key = get_aes_key()
    aesgcm = AESGCM(key)
    encrypted_payload = ciphertext + tag
    return aesgcm.decrypt(iv, encrypted_payload, None)
