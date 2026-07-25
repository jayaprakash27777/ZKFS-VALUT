package com.iitjammu.zkfs.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitjammu.zkfs.domain.PasskeyCredential;
import com.iitjammu.zkfs.domain.User;
import com.iitjammu.zkfs.repository.PasskeyCredentialRepository;
import com.iitjammu.zkfs.repository.UserRepository;
import com.iitjammu.zkfs.security.JwtService;
import com.yubico.webauthn.*;
import com.yubico.webauthn.data.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class PasskeyService {

    private final RelyingParty relyingParty;
    private final PasskeyCredentialRepository passkeyCredentialRepository;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // In-memory challenge storage (cache). For production, use Redis.
    private final Map<String, String> registrationStorage = new ConcurrentHashMap<>();
    private final Map<String, String> assertionStorage = new ConcurrentHashMap<>();

    // ── Registration ──────────────────────────────────────────────────────────

    public String generateRegistrationOptions(String email) throws Exception {
        User user = userRepository.findByEmail(email).orElseThrow(() -> new RuntimeException("User not found"));

        PublicKeyCredentialCreationOptions pkcco = relyingParty.startRegistration(StartRegistrationOptions.builder()
                .user(UserIdentity.builder()
                        .name(user.getEmail())
                        .displayName(user.getEmail())
                        .id(new ByteArray(user.getId().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                        .build())
                .authenticatorSelection(AuthenticatorSelectionCriteria.builder()
                        .residentKey(ResidentKeyRequirement.PREFERRED)
                        .userVerification(UserVerificationRequirement.PREFERRED)
                        .build())
                .build());

        // Enable PRF extension
        // Yubico webauthn-server-core doesn't natively serialize PRF in JSON output without custom MixIns in older versions,
        // but PRF request is initiated purely client-side during registration. The server just needs to know if it was supported.
        
        String json = pkcco.toCredentialsCreateJson();
        registrationStorage.put(email, pkcco.toJson()); // store the full server-side object for verification
        return json;
    }

    @Transactional
    public void finishRegistration(String email, String responseJson, String passkeyWrappedKek, String deviceName) throws Exception {
        User user = userRepository.findByEmail(email).orElseThrow(() -> new RuntimeException("User not found"));
        String pkccoJson = registrationStorage.remove(email);
        if (pkccoJson == null) {
            throw new RuntimeException("No registration in progress");
        }

        PublicKeyCredentialCreationOptions pkcco = PublicKeyCredentialCreationOptions.fromJson(pkccoJson);
        PublicKeyCredential<AuthenticatorAttestationResponse, ClientRegistrationExtensionOutputs> pkc =
                PublicKeyCredential.parseRegistrationResponseJson(responseJson);

        RegistrationResult result = relyingParty.finishRegistration(FinishRegistrationOptions.builder()
                .request(pkcco)
                .response(pkc)
                .build());

        // Save credential
        PasskeyCredential credential = PasskeyCredential.builder()
                .user(user)
                .name(deviceName)
                .credentialId(result.getKeyId().getId().getBase64Url())
                .publicKeyCose(result.getPublicKeyCose().getBase64Url())
                .signatureCount(result.getSignatureCount())
                .passkeyWrappedKek(passkeyWrappedKek) // Crucial for ZKFS
                .build();

        passkeyCredentialRepository.save(credential);
        log.info("Passkey registered for user: {}", email);
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    public Map<String, Object> generateLoginOptions(String email) throws JsonProcessingException {
        StartAssertionOptions.StartAssertionOptionsBuilder builder = StartAssertionOptions.builder()
                .userVerification(UserVerificationRequirement.PREFERRED);
                
        if (email != null && !email.trim().isEmpty()) {
            builder.username(email);
        }

        AssertionRequest request = relyingParty.startAssertion(builder.build());

        String requestId = UUID.randomUUID().toString();
        String json = request.toCredentialsGetJson();
        assertionStorage.put(requestId, request.toJson());
        
        return Map.of(
            "requestId", requestId,
            "options", objectMapper.readValue(json, Map.class)
        );
    }

    @Transactional
    public LoginResult finishLogin(String requestId, String responseJson) throws Exception {
        String requestJson = assertionStorage.remove(requestId);
        if (requestJson == null) {
            throw new RuntimeException("No assertion in progress");
        }

        AssertionRequest request = AssertionRequest.fromJson(requestJson);
        PublicKeyCredential<AuthenticatorAssertionResponse, ClientAssertionExtensionOutputs> pkc =
                PublicKeyCredential.parseAssertionResponseJson(responseJson);

        AssertionResult result = relyingParty.finishAssertion(FinishAssertionOptions.builder()
                .request(request)
                .response(pkc)
                .build());

        if (!result.isSuccess()) {
            throw new RuntimeException("Assertion failed");
        }
        String email = result.getUsername();
        if (email == null) {
            throw new RuntimeException("Could not determine username from assertion");
        }

        // Update signature count
        PasskeyCredential credential = passkeyCredentialRepository.findByCredentialId(result.getCredential().getCredentialId().getBase64Url())
                .orElseThrow(() -> new RuntimeException("Credential not found"));
        
        credential.setSignatureCount(result.getSignatureCount());
        passkeyCredentialRepository.save(credential);

        // Issue JWT
        User user = userRepository.findByEmail(email).orElseThrow(() -> new RuntimeException("User not found"));
        UserDetails userDetails = org.springframework.security.core.userdetails.User.builder()
                .username(user.getEmail())
                .password(user.getPasswordHash())
                .authorities(java.util.List.of(new SimpleGrantedAuthority("ROLE_USER")))
                .build();
        String accessToken = jwtService.generateAccessToken(userDetails);
        String refreshToken = jwtService.generateRefreshToken(userDetails);

        return new LoginResult(accessToken, refreshToken, user, credential.getPasskeyWrappedKek());
    }
    public java.util.List<com.iitjammu.zkfs.controller.PasskeyController.PasskeyDto> getUserPasskeys(String email) {
        User user = userRepository.findByEmail(email).orElseThrow(() -> new RuntimeException("User not found"));
        return passkeyCredentialRepository.findAllByUserId(user.getId()).stream()
                .map(c -> new com.iitjammu.zkfs.controller.PasskeyController.PasskeyDto(c.getId(), c.getName(), c.getCreatedAt()))
                .collect(java.util.stream.Collectors.toList());
    }

    public void deletePasskey(String email, java.util.UUID id) {
        User user = userRepository.findByEmail(email).orElseThrow(() -> new RuntimeException("User not found"));
        PasskeyCredential credential = passkeyCredentialRepository.findById(id).orElseThrow(() -> new RuntimeException("Credential not found"));
        if (!credential.getUser().getId().equals(user.getId())) {
            throw new RuntimeException("Unauthorized");
        }
        passkeyCredentialRepository.delete(credential);
    }

    public record LoginResult(String token, String refreshToken, User user, String passkeyWrappedKek) {}
}
