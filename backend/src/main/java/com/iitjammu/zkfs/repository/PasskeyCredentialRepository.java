package com.iitjammu.zkfs.repository;

import com.iitjammu.zkfs.domain.PasskeyCredential;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PasskeyCredentialRepository extends JpaRepository<PasskeyCredential, UUID> {
    Optional<PasskeyCredential> findByCredentialId(String credentialId);
    List<PasskeyCredential> findAllByUserId(UUID userId);
}
