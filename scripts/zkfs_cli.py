#!/usr/bin/env python3
"""
ZKFS CLI - Zero-Knowledge File Storage Command Line Client
==========================================================
This script allows you to login, download, and decrypt your files and folders
directly to your computer using your Master Password (secret key).

Requirements:
    pip install requests cryptography argon2-cffi

Usage:
    python zkfs_cli.py download-file <file_id>
    python zkfs_cli.py download-folder <folder_id>
    python zkfs_cli.py decrypt-local <file.zkfs>
"""

import sys
import os
import json
import getpass
import requests
from base64 import b64decode
from argon2.low_level import hash_secret_raw, Type
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

API_BASE = os.environ.get("ZKFS_API_URL", "http://localhost:8080/api")

def derive_kek(password: str, salt_b64: str) -> bytes:
    """Derives the 256-bit Key Encryption Key (KEK) using Argon2id."""
    salt = b64decode(salt_b64)
    return hash_secret_raw(
        secret=password.encode('utf-8'),
        salt=salt,
        time_cost=3,
        memory_cost=65536,
        parallelism=4,
        hash_len=32,
        type=Type.ID
    )

def unwrap_dek(wrapped_dek_b64: str, iv_b64: str, kek: bytes) -> bytes:
    """Unwraps the DEK using the session KEK."""
    wrapped_dek = b64decode(wrapped_dek_b64)
    iv = b64decode(iv_b64)
    aesgcm = AESGCM(kek)
    return aesgcm.decrypt(iv, wrapped_dek, None)

def decrypt_filename(enc_filename_b64: str, iv_b64: str, kek: bytes) -> str:
    """Decrypts a filename using the session KEK."""
    ciphertext = b64decode(enc_filename_b64)
    iv = b64decode(iv_b64)
    aesgcm = AESGCM(kek)
    return aesgcm.decrypt(iv, ciphertext, None).decode('utf-8')

class ZkfsClient:
    def __init__(self):
        self.session = requests.Session()
        self.kek = None

    def login(self):
        email = input("Email: ").strip()
        password = getpass.getpass("Master Password (Secret Key): ")

        print("[*] Fetching salt...")
        r = self.session.post(f"{API_BASE}/v1/auth/salt", json={"email": email})
        if r.status_code != 200:
            print("[-] Error fetching salt:", r.text)
            sys.exit(1)
        salt_b64 = r.json()["salt"]

        print("[*] Deriving KEK (this may take a moment)...")
        self.kek = derive_kek(password, salt_b64)

        print("[*] Logging in...")
        r = self.session.post(f"{API_BASE}/v1/auth/login", json={"email": email})
        if r.status_code != 200:
            print("[-] Login failed:", r.text)
            sys.exit(1)
            
        token = r.json()["accessToken"]
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        print("[+] Logged in successfully!")

    def download_file(self, file_id: str, out_dir: str = "."):
        print(f"\n[*] Fetching metadata for file {file_id}...")
        r = self.session.get(f"{API_BASE}/v1/files/{file_id}")
        if r.status_code != 200:
            print("[-] Failed to get file metadata:", r.text)
            return
        meta = r.json()

        filename = decrypt_filename(meta["filenameEncrypted"], meta["ivFilename"], self.kek)
        print(f"[*] Filename: {filename}")
        
        dek = unwrap_dek(meta["wrappedDek"], meta["ivWrappedDek"], self.kek)
        
        print(f"[*] Fetching chunk manifest...")
        r = self.session.get(f"{API_BASE}/v1/files/{file_id}/chunks")
        chunks = r.json()
        
        out_path = os.path.join(out_dir, filename)
        print(f"[*] Downloading and decrypting {len(chunks)} chunks to {out_path}...")
        
        aesgcm = AESGCM(dek)
        with open(out_path, 'wb') as f:
            for i, chunk in enumerate(chunks):
                idx = chunk["chunkIndex"]
                print(f"    -> Chunk {idx + 1}/{len(chunks)}")
                r_chunk = self.session.get(f"{API_BASE}/v1/files/{file_id}/chunk/{idx}/stream")
                ciphertext = r_chunk.content
                iv = b64decode(chunk["ivChunk"])
                plaintext = aesgcm.decrypt(iv, ciphertext, None)
                f.write(plaintext)
                
        print(f"[+] Successfully downloaded {filename}!")

    def download_folder(self, folder_id: str, current_dir: str = "."):
        print(f"\n[*] Fetching folder contents for {folder_id}...")
        r = self.session.get(f"{API_BASE}/v1/folders?parentId={folder_id}")
        if r.status_code != 200:
            print("[-] Failed to list folders:", r.text)
            return
            
        folders = r.json()
        
        r = self.session.get(f"{API_BASE}/v1/files?folderId={folder_id}&page=0&size=1000")
        if r.status_code != 200:
            print("[-] Failed to list files:", r.text)
            return
        files = r.json().get("content", [])
        
        # We don't have folder names unencrypted in the listing right now unless we decrypt them
        for file in files:
            self.download_file(file["id"], current_dir)
            
        for folder in folders:
            # Note: For full recursive, we'd decrypt folder name here.
            # Using folder ID as dir name for simplicity if name is encrypted
            try:
                name = decrypt_filename(folder["nameEncrypted"], folder["iv"], self.kek)
            except:
                name = folder["id"]
                
            new_dir = os.path.join(current_dir, name)
            os.makedirs(new_dir, exist_ok=True)
            self.download_folder(folder["id"], new_dir)

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    target_id = sys.argv[2]
    
    if cmd == "decrypt-local":
        print("Use the standalone decrypt_zkfs function (see earlier script) for local files.")
        return

    client = ZkfsClient()
    client.login()

    if cmd == "download-file":
        client.download_file(target_id)
    elif cmd == "download-folder":
        client.download_folder(target_id)
    else:
        print(f"Unknown command: {cmd}")

if __name__ == "__main__":
    main()
