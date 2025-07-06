// Cryptographic utilities for seed phrase generation, key derivation, and encryption
// Uses BIP39 for proper seed phrase generation and Noble crypto for scrypt key derivation
import * as bip39 from 'bip39';
import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';

/**
 * Gets the base API URL from environment variables
 */
export function getBaseApiUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_BASE_API_URL || 'http://localhost:8080';
  const env = process.env.NODE_ENV || 'development';
  
  // Log environment for debugging (only in development)
  // if (env === 'development') {
    console.log(`🌍 Environment: ${env}`);
    console.log(`🔗 API URL: ${apiUrl}`);
  // }
  
  return apiUrl;
}

/**
 * Generates a proper 12-word BIP39 mnemonic seed phrase
 */
export async function generateSeedPhrase(): Promise<string> {
  // Generate 128 bits of entropy for 12-word mnemonic
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  
  // Convert Uint8Array to Buffer for bip39 compatibility
  const entropyBuffer = Buffer.from(entropy);
  
  // Generate BIP39 mnemonic from entropy
  const mnemonic = bip39.entropyToMnemonic(entropyBuffer);
  
  return mnemonic;
}

/**
 * Validates a BIP39 mnemonic seed phrase
 */
export function validateSeedPhrase(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

/**
 * Imports an existing seed phrase (for account recovery)
 */
export async function importSeedPhrase(
  mnemonic: string,
  password: string
): Promise<{ userAddress: string; encryptionKey: CryptoKey }> {
  // Validate the mnemonic first
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid seed phrase');
  }
  
  // Derive user address first to check if user exists
  const userAddress = await deriveUserAddress(mnemonic);
  const hashedPassword = await getHash(password);
  
  // Check if user exists on the server
  const response = await fetch(`${getBaseApiUrl()}/users/check`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userAddress}:${hashedPassword}`,
    },
  });

  if (!response.ok) {
    throw new Error('User not found or invalid credentials');
  }
  
  // Store the imported seed phrase locally
  await storeSeedPhrase(mnemonic, password);
  
  // Derive encryption key
  const encryptionKey = await deriveEncryptionKey(mnemonic);
  
  return { userAddress, encryptionKey };
}

/**
 * Derives a deterministic user address from a seed phrase
 * Always generates the same ID for the same seed phrase
 */
export async function deriveUserAddress(seedPhrase: string): Promise<string> {
  // Validate the mnemonic first
  if (!bip39.validateMnemonic(seedPhrase)) {
    throw new Error('Invalid seed phrase');
  }
  
  // Convert mnemonic to seed using BIP39
  const seed = await bip39.mnemonicToSeed(seedPhrase);
  
  // Convert seed to string for hashing
  const seedString = Array.from(seed)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Use shared hash function for consistency (64 hex characters)
  return await getHash(seedString);
}

/**
 * Derives an encryption key from a seed phrase using scrypt
 * This follows the strategy outlined in the documentation
 */
export async function deriveEncryptionKey(seedPhrase: string): Promise<CryptoKey> {
  // Validate the mnemonic first
  if (!bip39.validateMnemonic(seedPhrase)) {
    throw new Error('Invalid seed phrase');
  }
  
  // Convert mnemonic to seed
  const seed = await bip39.mnemonicToSeed(seedPhrase);
  
  // App-specific salt as recommended in documentation
  const salt = new TextEncoder().encode('crypter-app-v1-2025');
  
  // Use scrypt for key derivation (stronger than PBKDF2)
  const derivedKey = scrypt(seed, salt, {
    N: 2 ** 16, // 65536
    r: 8,
    p: 1,
    dkLen: 32, // 256 bits
  });
  
  // Import the derived key for use with Web Crypto API
  const key = await crypto.subtle.importKey(
    'raw',
    derivedKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  
  return key;
}

/**
 * Encrypts data using AES-GCM
 */
export async function encryptData(data: string, key: CryptoKey): Promise<{
  encryptedData: string;
  iv: string;
}> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    dataBuffer
  );
  
  return {
    encryptedData: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer)
  };
}

/**
 * Decrypts data using AES-GCM
 */
export async function decryptData(encryptedData: string, iv: string, key: CryptoKey): Promise<string> {
  const encryptedBuffer = base64ToArrayBuffer(encryptedData);
  const ivBuffer = base64ToArrayBuffer(iv);
  
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer
    },
    key,
    encryptedBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Stores encrypted seed phrase in localStorage using password-derived key
 * Uses a random salt for each user to prevent rainbow table attacks
 */
export async function storeSeedPhrase(seedPhrase: string, password: string): Promise<void> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  
  // Generate a random salt for this user (stored with encrypted data)
  const salt = crypto.getRandomValues(new Uint8Array(32));
  
  // Derive key from password using random salt
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  const { encryptedData, iv } = await encryptData(seedPhrase, key);
  
  const storedData = {
    encryptedData,
    iv,
    salt: arrayBufferToBase64(salt.buffer)
  };
  
  // Store encrypted data with salt (needed for future decryption)
  localStorage.setItem('encryptedSeedPhrase', JSON.stringify(storedData));
}

/**
 * Retrieves and decrypts seed phrase from localStorage
 * Returns null if password is incorrect or no data exists
 */
export async function retrieveSeedPhrase(password: string): Promise<string | null> {
  const stored = localStorage.getItem('encryptedSeedPhrase');
  if (!stored) {
    return null;
  }
  
  try {
    const { encryptedData, iv, salt } = JSON.parse(stored);
    
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    
    // Convert stored salt back to Uint8Array
    const saltBuffer = base64ToArrayBuffer(salt);
    
    // Derive key from password using stored salt
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    
    // Attempt to decrypt - if password is wrong, this will throw an error
    return await decryptData(encryptedData, iv, key);
  } catch (error) {
    // Decryption failed - password is incorrect
    return null;
  }
}

/**
 * Encrypts a key-value pair for storage with separate IVs
 * This follows the pattern from the documentation
 */
export async function encryptKeyValue(
  key: string,
  value: string,
  encryptionKey: CryptoKey
): Promise<{
  encryptedKey: string;
  encryptedData: string;
  iv: string;
  keyIv: string;
}> {
  // Encrypt both key and value separately with unique IVs
  const keyResult = await encryptData(key, encryptionKey);
  const valueResult = await encryptData(value, encryptionKey);
  
  return {
    encryptedKey: keyResult.encryptedData,
    encryptedData: valueResult.encryptedData,
    iv: valueResult.iv, // Use value's IV as primary
    keyIv: keyResult.iv, // Store key's IV separately
  };
}

/**
 * Decrypts a key-value pair
 */
export async function decryptKeyValue(
  encryptedKey: string,
  encryptedData: string,
  keyIv: string,
  valueIv: string,
  encryptionKey: CryptoKey
): Promise<{ key: string; value: string }> {
  const key = await decryptData(encryptedKey, keyIv, encryptionKey);
  const value = await decryptData(encryptedData, valueIv, encryptionKey);
  return { key, value };
}

/**
 * Generates a SHA-256 hash and returns it as a 64-character hex string
 * Used for both user addresses and password hashing
 */
export async function getHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  
  // Use sha256 from @noble/hashes for consistency
  const hash = sha256(data);
  
  // Convert to hex string (64 characters)
  return Array.from(hash)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Authenticates user with backend server
 */
export async function authenticateWithBackend(
  userAddress: string, 
  password: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const hashedPassword = await getHash(password);
    
    const response = await fetch(`${getBaseApiUrl()}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_address: userAddress,
        password: hashedPassword,
      }),
    });

    if (response.status === 201) {
      let data: any = {};
      try {
        const text = await response.text();
        if (text) {
          data = JSON.parse(text);
        }
      } catch (parseError) {
        console.log('Warning: Could not parse response JSON, but 201 status indicates success');
      }
      return { success: true, message: data.message || 'Authentication successful' };
    } else {
      try {
        const errorData = await response.json();
        return { success: false, message: errorData.error || 'Authentication failed' };
      } catch (parseError) {
        console.log('Auth failed - status:', response.status, 'Could not parse error response');
        return { success: false, message: `Authentication failed (${response.status})` };
      }
    }
  } catch (error) {
    return { success: false, message: 'Failed to connect to server' };
  }
}

/**
 * Sends encrypted key-value pair to the backend
 */
export async function sendEncryptedDataToBackend(
  userAddress: string,
  key: string,
  value: string,
  encryptionKey: CryptoKey
): Promise<{ success: boolean; message?: string; data?: { id: string; created_at?: string } }> {
  try {
    // Encrypt the key-value pair
    const encryptedData = await encryptKeyValue(key, value, encryptionKey);
    const password = sessionStorage.getItem('userPassword');
    if (!password) {
      return { success: false, message: 'Password not available for authentication' };
    }
    const hashedPassword = await getHash(password);
    
    const response = await fetch(`${getBaseApiUrl()}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_address: userAddress,
        encrypted_key: encryptedData.encryptedKey,
        encrypted_data: encryptedData.encryptedData,
        data_iv: encryptedData.iv,
        key_iv: encryptedData.keyIv,
        password: hashedPassword,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return { 
        success: true, 
        message: data.message,
        data: {
          id: data.id,
          created_at: data.created_at
        }
      };
    } else {
      const errorData = await response.json();
      return { success: false, message: errorData.error || 'Failed to store data' };
    }
  } catch (error) {
    return { success: false, message: 'Failed to connect to server' };
  }
}

/**
 * Fetches and decrypts user data from the backend
 */
export async function fetchAndDecryptDataFromBackend(
  userAddress: string,
  encryptionKey: CryptoKey
): Promise<{ success: boolean; data?: Array<{key: string, value: string, id: string, createdAt: string}>; message?: string }> {
  try {
    const password = sessionStorage.getItem('userPassword');
    if (!password) {
      return { success: false, message: 'Password not available for authentication' };
    }
    
    const hashedPassword = await getHash(password);
    
    const response = await fetch(`${getBaseApiUrl()}/keys`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAddress}:${hashedPassword}`,
      },
    });

    if (response.status === 204) {
      return { success: true, data: [] };
    }

    if (!response.ok) {
      return { success: false, message: 'Failed to fetch data' };
    }

    const data = await response.json();
    
    // Decrypt each item
    const decryptedData = await Promise.all(
      data.map(async (item: any, index: number) => {
        try {
          const { key, value } = await decryptKeyValue(
            item.encrypted_key,
            item.encrypted_data,
            item.key_iv,
            item.data_iv, // Changed from item.iv to item.data_iv to match server response
            encryptionKey
          );
          
          return {
            id: `${item.id}`,
            key,
            value,
            createdAt: `${item.created_at}`,
          };
        } catch (decryptError) {
          console.log('Decryption error for item:', item.id, decryptError); // Debug log
          return null;
        }
      })
    );

    // Filter out failed decryptions
    // const validData = decryptedData.filter(item => item !== null);
    
    return { success: true, data: decryptedData };
  } catch (error) {
    return { success: false, message: 'Failed to connect to server' };
  }
}

/**
 * Test function to verify encryption/decryption works
 */
export async function testEncryptionDecryption(encryptionKey: CryptoKey): Promise<boolean> {
  try {
    const testKey = 'test-key';
    const testValue = 'test-value';
    
    // Encrypt
    const encrypted = await encryptKeyValue(testKey, testValue, encryptionKey);
    
    // Decrypt
    const decrypted = await decryptKeyValue(
      encrypted.encryptedKey,
      encrypted.encryptedData,
      encrypted.keyIv,
      encrypted.iv,
      encryptionKey
    );
    
    return decrypted.key === testKey && decrypted.value === testValue;
  } catch (error) {
    return false;
  }
}

/**
 * Clears all stored user data from localStorage
 * WARNING: This will delete the encrypted seed phrase permanently!
 * Only use this for account deletion, not logout.
 */
export function clearStoredCredentials(): void {
  localStorage.removeItem('encryptedSeedPhrase');
  // Also clear any session data
  sessionStorage.clear();
}

/**
 * Clears only session data (for logout) while keeping encrypted seed phrase
 * This allows the user to login again without re-entering the seed phrase
 */
export function clearSessionData(): void {
  // Clear session-specific data but keep the encrypted seed phrase
  sessionStorage.clear();
  localStorage.removeItem('userAddress');
  localStorage.removeItem('sessionExpiry');
}

/**
 * Verifies a password by attempting to decrypt the stored seed phrase
 * This is more secure than storing password hashes
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const seedPhrase = await retrieveSeedPhrase(password);
  return seedPhrase !== null;
}

/**
 * Deletes a key-value pair from the backend
 */
export async function deleteKeyValueFromBackend(
  userAddress: string,
  id: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const password = sessionStorage.getItem('userPassword');
    if (!password) {
      return { success: false, message: 'Password not available for authentication' };
    }
    
    const hashedPassword = await getHash(password);
    
    const response = await fetch(`${getBaseApiUrl()}/keys/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAddress}:${hashedPassword}`,
      },
    });

    if (response.status === 204) {
      return { success: true, message: 'Data deleted successfully' };
    } else if (response.status === 401) {
      return { success: false, message: 'Authentication failed' };
    } else if (response.status === 500) {
      return { success: false, message: 'Server error occurred' };
    } else {
      try {
        const errorData = await response.json();
        return { success: false, message: errorData.error || 'Failed to delete data' };
      } catch (parseError) {
        return { success: false, message: `Delete failed (${response.status})` };
      }
    }
  } catch (error) {
    return { success: false, message: 'Failed to connect to server' };
  }
}

/**
 * Verifies user credentials with the backend using /users/check endpoint
 */
export async function verifyUserCredentials(
  userAddress: string,
  password: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const hashedPassword = await getHash(password);
    
    const response = await fetch(`${getBaseApiUrl()}/users/check`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userAddress}:${hashedPassword}`,
      },
    });

    if (response.status === 200) {
      return { success: true, message: 'Login successful' };
    } else if (response.status === 404) {
      return { success: false, message: 'Invalid credentials. Please check your password and try again.' };
    } else {
      return { success: false, message: 'Server error occurred. Please try again later.' };
    }
  } catch (error) {
    return { success: false, message: 'Failed to connect to server. Please check your internet connection.' };
  }
}

// Utility functions
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
