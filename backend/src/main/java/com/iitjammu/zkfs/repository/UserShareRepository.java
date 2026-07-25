package com.iitjammu.zkfs.repository;

import com.iitjammu.zkfs.domain.UserShare;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface UserShareRepository extends JpaRepository<UserShare, UUID> {
    List<UserShare> findBySharedWithId(UUID sharedWithId);
    List<UserShare> findByFileId(UUID fileId);
    void deleteByFileIdAndSharedWithId(UUID fileId, UUID sharedWithId);
}
