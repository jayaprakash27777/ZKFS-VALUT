#!/usr/bin/env python3
"""
ZKFS Offline Decryptor
----------------------
This script allows you to decrypt a .zkfs file completely offline,
without needing the ZKFS server or your browser.

Dependencies:
    pip install cryptography argon2-cffi

Usage:
    python zkfs_decrypt.py <file.zkfs>
"""

import sys
import getpass
import os

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from argon2.low_level import hash_secret_raw, Type
except ImportError:
    print("Missing dependencies! Please run:")
    print("  pip install cryptography argon2-cffi")
    sys.exit(1)

MAGIC_BYTES = b'ZKFS'
SALT_LEN = 16
IV_LEN = 12

def decrypt_file(filepath, password):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return

    print(f"Reading {filepath}...")
    with open(filepath, 'rb') as f:
        data = f.read()
    
    if len(data) < len(MAGIC_BYTES) + SALT_LEN + IV_LEN:
        print("Error: File is too small to be a valid ZKFS file.")
        return
        
    if data[:4] != MAGIC_BYTES:
        print("Error: Invalid file format. Magic bytes 'ZKFS' not found.")
        return
        
    salt = data[4:20]
    iv = data[20:32]
    ciphertext = data[32:]
    
    print("Deriving Master Key using Argon2id (this may take a moment)...")
    # These parameters MUST match the frontend configuration exactly
    try:
        kek = hash_secret_raw(
            secret=password.encode('utf-8'),
            salt=salt,
            time_cost=3,          # iterations
            memory_cost=65536,    # 64 MB
            parallelism=4,
            hash_len=32,
            type=Type.ID
        )
    except Exception as e:
        print(f"Key derivation failed: {e}")
        return

    print("Decrypting file contents...")
    aesgcm = AESGCM(kek)
    try:
        plaintext = aesgcm.decrypt(iv, ciphertext, None)
    except Exception as e:
        print("\n[!] Decryption failed!")
        print("    This usually means the password you entered is incorrect,")
        print("    or the file has been corrupted/tampered with.")
        return
        
    out_path = filepath[:-5] if filepath.endswith('.zkfs') else filepath + '.decrypted'
    
    with open(out_path, 'wb') as f:
        f.write(plaintext)
        
    print(f"\n[+] Success! File decrypted to: {out_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python zkfs_decrypt.py <file.zkfs>")
        sys.exit(1)
        
    target_file = sys.argv[1]
    pwd = getpass.getpass("Enter your ZKFS Master Password: ")
    decrypt_file(target_file, pwd)
