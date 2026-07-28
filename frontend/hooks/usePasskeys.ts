import { useState, useCallback, useEffect } from 'react';
import { startRegistration, startAuthentication, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { authApi } from '@/lib/api/auth';
import { getPrfSaltBytes, wrapKekWithPrf, unwrapKekWithPrf } from '@/lib/crypto/passkeys';
import { useVaultStore } from '@/store/useVaultStore';
import { useAuth } from '@/hooks/useAuth';

export function usePasskeys() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const kek = useVaultStore((s) => s.kek);
  const setUser = useVaultStore((s) => s.setUser);
  const setKek = useVaultStore((s) => s.setKek);
  const setPrivateKey = useVaultStore((s) => s.setPrivateKey);
  
  const isSupported = browserSupportsWebAuthn();
  const [isAutofillSupported, setIsAutofillSupported] = useState(false);

  useEffect(() => {
    browserSupportsWebAuthnAutofill().then(setIsAutofillSupported).catch(() => setIsAutofillSupported(false));
  }, []);

  const registerPasskey = useCallback(async (deviceName: string, useQR: boolean = false) => {
    if (!kek) {
      setError("Vault is locked. Cannot register passkey.");
      return;
    }
    
    setIsRegistering(true);
    setError(null);
    try {
      // 1. Get options from server
      const optionsRes = await authApi.getPasskeyRegisterOptions();
      const rawOptions = typeof optionsRes === 'string' ? JSON.parse(optionsRes) : optionsRes;
      const options = rawOptions.publicKey ? rawOptions.publicKey : rawOptions;
      
      const prfSalt = await getPrfSaltBytes();

      // 2. Configure QR code / cross-platform hybrid flow if requested
      if (useQR) {
        options.authenticatorSelection = {
          ...(options.authenticatorSelection || {}),
          authenticatorAttachment: 'cross-platform',
        };
        options.hints = ['hybrid'];
      }

      // 3. Start WebAuthn registration with PRF extension
      options.extensions = {
        ...(options.extensions || {}),
        prf: {
          eval: { first: prfSalt }
        }
      };

      const authResp = await startRegistration({ optionsJSON: options });
      
      // 4. Extract PRF output
      const prfResults = (authResp.clientExtensionResults as any)?.prf?.results;
      let passkeyWrappedKek = "unsupported";
      if (prfResults && prfResults.first) {
        passkeyWrappedKek = await wrapKekWithPrf(kek, prfResults.first);
      }
      
      // 5. Send to server
      await authApi.registerPasskey(JSON.stringify(authResp), passkeyWrappedKek, deviceName);
      
      return true;
    } catch (err: any) {
      console.error("Passkey registration failed:", err);
      setError(err.message || "Failed to register passkey");
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [kek]);

  const loginWithPasskey = useCallback(async (email?: string, useQR: boolean = false, conditionalUI: boolean = false) => {
    if (!conditionalUI) {
      setIsAuthenticating(true);
    }
    setError(null);
    try {
      // 1. Get login options and requestId
      const res = await authApi.getPasskeyLoginOptions(email);
      const rawOptions = typeof res.options === 'string' ? JSON.parse(res.options) : res.options;
      const options = rawOptions.publicKey ? rawOptions.publicKey : rawOptions;
      const requestId = res.requestId;
      
      const prfSalt = await getPrfSaltBytes();

      // 2. Configure QR code / cross-platform hybrid flow if requested
      if (useQR) {
        options.hints = ['hybrid'];
        if (Array.isArray(options.allowCredentials)) {
          options.allowCredentials = options.allowCredentials.map((cred: any) => ({
            ...cred,
            transports: ['hybrid', 'ble', 'nfc', 'usb'],
          }));
        }
      }

      // 3. Start WebAuthn authentication with PRF extension
      options.extensions = {
        ...(options.extensions || {}),
        prf: {
          eval: { first: prfSalt }
        }
      };

      // If conditionalUI is true, pass it to useBrowserAutofill option
      const authResp = await startAuthentication({ optionsJSON: options, useBrowserAutofill: conditionalUI });
      
      if (conditionalUI) {
        // Now that the user selected a passkey, show the loading state
        setIsAuthenticating(true);
      }
      
      // 3. Extract PRF output
      const prfResults = (authResp.clientExtensionResults as any)?.prf?.results;
      
      // 4. Finish login on server using requestId
      const loginResult = await authApi.loginPasskey(requestId, JSON.stringify(authResp));
      
      // 5. Unwrap KEK
      let unwrappedKek = null;
      if (prfResults && prfResults.first && loginResult.passkeyWrappedKek && loginResult.passkeyWrappedKek !== 'unsupported') {
        unwrappedKek = await unwrapKekWithPrf(loginResult.passkeyWrappedKek, prfResults.first);
      }
      
      // 6. Update Vault Store
      if (unwrappedKek) {
        setKek(unwrappedKek);
        const { checkAndUploadRSAKeys } = await import('@/lib/crypto/asymmetric');
        await checkAndUploadRSAKeys(loginResult.user, unwrappedKek, setPrivateKey);
      } else {
        console.warn("Passkey does not support PRF. Vault remains locked.");
      }
      setUser(loginResult.user.id, loginResult.user.email);
      
      return loginResult.user;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // This is normal for conditional UI if the user ignores it
        if (!conditionalUI) {
            console.error("Passkey login cancelled or failed:", err);
            setError(err.message || "Failed to login with passkey");
        }
      } else {
        console.error("Passkey login failed:", err);
        setError(err.message || "Failed to login with passkey");
      }
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, [setKek, setUser]);

  return {
    isSupported,
    isAutofillSupported,
    isRegistering,
    isAuthenticating,
    error,
    registerPasskey,
    loginWithPasskey
  };
}
