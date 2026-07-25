package com.iitjammu.zkfs.config;

import com.iitjammu.zkfs.domain.PasskeyCredential;
import com.iitjammu.zkfs.domain.User;
import com.iitjammu.zkfs.repository.PasskeyCredentialRepository;
import com.iitjammu.zkfs.repository.UserRepository;
import com.yubico.webauthn.CredentialRepository;
import com.yubico.webauthn.RegisteredCredential;
import com.yubico.webauthn.RelyingParty;
import com.yubico.webauthn.data.ByteArray;
import com.yubico.webauthn.data.RelyingPartyIdentity;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Configuration
@RequiredArgsConstructor
public class WebAuthnConfig {

    private final UserRepository userRepository;
    private final PasskeyCredentialRepository passkeyCredentialRepository;

    @Bean
    public RelyingParty relyingParty() {
        RelyingPartyIdentity rpIdentity = RelyingPartyIdentity.builder()
                .id("localhost") // MUST match frontend domain
                .name("ZKFS Secure Vault")
                .build();

        return RelyingParty.builder()
                .identity(rpIdentity)
                .credentialRepository(new JpaCredentialRepository(userRepository, passkeyCredentialRepository))
                .origins(Set.of("http://localhost:3000", "http://localhost:3001")) // Allowed origins
                .build();
    }

    @RequiredArgsConstructor
    public static class JpaCredentialRepository implements CredentialRepository {
        private final UserRepository userRepository;
        private final PasskeyCredentialRepository passkeyCredentialRepository;

        @Override
        public Set<com.yubico.webauthn.data.PublicKeyCredentialDescriptor> getCredentialIdsForUsername(String username) {
            Optional<User> userOpt = userRepository.findByEmail(username);
            if (userOpt.isEmpty()) return Set.of();
            return passkeyCredentialRepository.findAllByUserId(userOpt.get().getId()).stream()
                    .map(c -> {
                        try {
                            return com.yubico.webauthn.data.PublicKeyCredentialDescriptor.builder()
                                .id(ByteArray.fromBase64Url(c.getCredentialId()))
                                .build();
                        } catch (Exception e) {
                            return null;
                        }
                    })
                    .filter(java.util.Objects::nonNull)
                    .collect(Collectors.toSet());
        }

        @Override
        public Optional<ByteArray> getUserHandleForUsername(String username) {
            return userRepository.findByEmail(username)
                    .map(u -> new ByteArray(u.getId().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }

        @Override
        public Optional<String> getUsernameForUserHandle(ByteArray userHandle) {
            try {
                String uuidStr = new String(userHandle.getBytes(), java.nio.charset.StandardCharsets.UTF_8);
                return userRepository.findById(java.util.UUID.fromString(uuidStr)).map(com.iitjammu.zkfs.domain.User::getEmail);
            } catch (Exception e) {
                return Optional.empty();
            }
        }

        @Override
        public Optional<RegisteredCredential> lookup(ByteArray credentialId, ByteArray userHandle) {
            return passkeyCredentialRepository.findByCredentialId(credentialId.getBase64Url())
                    .map(c -> RegisteredCredential.builder()
                            .credentialId(credentialId)
                            .userHandle(userHandle)
                            .publicKeyCose(safeBase64Url(c.getPublicKeyCose()))
                            .signatureCount(c.getSignatureCount())
                            .build()
                    );
        }

        @Override
        public Set<RegisteredCredential> lookupAll(ByteArray credentialId) {
            return passkeyCredentialRepository.findByCredentialId(credentialId.getBase64Url())
                    .map(c -> RegisteredCredential.builder()
                            .credentialId(credentialId)
                            .userHandle(new ByteArray(c.getUser().getId().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                            .publicKeyCose(safeBase64Url(c.getPublicKeyCose()))
                            .signatureCount(c.getSignatureCount())
                            .build()
                    ).stream().collect(Collectors.toSet());
        }

        private ByteArray safeBase64Url(String base64) {
            try {
                return ByteArray.fromBase64Url(base64);
            } catch (Exception e) {
                return new ByteArray(new byte[0]);
            }
        }
    }
}
