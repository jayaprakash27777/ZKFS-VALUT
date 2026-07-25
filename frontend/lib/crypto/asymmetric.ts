export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: "SHA-256",
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", key);
  const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported) as unknown as number[]);
  return window.btoa(exportedAsString);
}

export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("pkcs8", key);
  const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported) as unknown as number[]);
  return window.btoa(exportedAsString);
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const binaryDerString = window.atob(pem);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  return await window.crypto.subtle.importKey(
    "spki",
    binaryDer.buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const binaryDerString = window.atob(pem);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  return await window.crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}

// Encrypt a symmetric key (DEK) using a public key
export async function encryptWithPublicKey(publicKey: CryptoKey, data: Uint8Array): Promise<string> {
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "RSA-OAEP",
    },
    publicKey,
    data as any
  );
  
  const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(encrypted) as unknown as number[]);
  return window.btoa(exportedAsString);
}

// Decrypt a wrapped symmetric key (DEK) using a private key
export async function decryptWithPrivateKey(privateKey: CryptoKey, encryptedDataB64: string): Promise<Uint8Array> {
  const binaryString = window.atob(encryptedDataB64);
  const binaryData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    binaryData[i] = binaryString.charCodeAt(i);
  }
  
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "RSA-OAEP",
    },
    privateKey,
    binaryData
  );
  
  return new Uint8Array(decrypted);
}

export async function wrapPrivateKeyWithKek(privateKeyPkcs8B64: string, kek: CryptoKey): Promise<string> {
  const binaryString = window.atob(privateKeyPkcs8B64);
  const pkcs8Data = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pkcs8Data[i] = binaryString.charCodeAt(i);
  }

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    kek,
    pkcs8Data
  );

  const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(encrypted) as unknown as number[]);
  const ivAsString = String.fromCharCode.apply(null, iv as unknown as number[]);
  return `${window.btoa(ivAsString)}:${window.btoa(exportedAsString)}`;
}

export async function unwrapPrivateKeyWithKek(encPrivateKey: string, kek: CryptoKey): Promise<CryptoKey> {
  const parts = encPrivateKey.split(':');
  if (parts.length !== 2) throw new Error("Invalid encPrivateKey format");
  const [ivB64, wrappedB64] = parts;

  const encryptedString = window.atob(wrappedB64);
  const encryptedData = new Uint8Array(encryptedString.length);
  for (let i = 0; i < encryptedString.length; i++) {
    encryptedData[i] = encryptedString.charCodeAt(i);
  }

  const ivString = window.atob(ivB64);
  const iv = new Uint8Array(ivString.length);
  for (let i = 0; i < ivString.length; i++) {
    iv[i] = ivString.charCodeAt(i);
  }

  const decryptedPkcs8 = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    kek,
    encryptedData
  );

  return await window.crypto.subtle.importKey(
    "pkcs8",
    decryptedPkcs8,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}

export async function checkAndUploadRSAKeys(user: any, kek: CryptoKey, setPrivateKey: (pk: CryptoKey) => void) {
  if (user.encPrivateKey && user.publicKey) {
    const pk = await unwrapPrivateKeyWithKek(user.encPrivateKey, kek);
    setPrivateKey(pk);
    return;
  }

  const keypair = await generateRSAKeyPair();
  const pubB64 = await exportPublicKey(keypair.publicKey);
  const privB64 = await exportPrivateKey(keypair.privateKey);

  const encPriv = await wrapPrivateKeyWithKek(privB64, kek);
  
  // Note: authApi is imported to upload the keys
  const { authApi } = await import('@/lib/api/auth');
  await authApi.updateKeys(pubB64, encPriv);
  
  setPrivateKey(keypair.privateKey);
}
