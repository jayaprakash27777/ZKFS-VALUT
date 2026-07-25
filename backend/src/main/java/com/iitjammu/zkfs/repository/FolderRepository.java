package com.iitjammu.zkfs.repository;

import com.iitjammu.zkfs.domain.Folder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface FolderRepository extends JpaRepository<Folder, UUID> {
    
    List<Folder> findAllByUserIdAndParentIdAndDeletedAtIsNull(UUID userId, UUID parentId);
    List<Folder> findAllByUserIdAndParentIdIsNullAndDeletedAtIsNull(UUID userId);
    List<Folder> findAllByParentId(UUID parentId);
    Optional<Folder> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    List<Folder> findAllByUserIdAndDeletedAtIsNotNull(UUID userId);
    Optional<Folder> findByIdAndUserIdAndDeletedAtIsNotNull(UUID id, UUID userId);
}
