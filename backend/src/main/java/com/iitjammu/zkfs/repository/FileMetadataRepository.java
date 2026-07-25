package com.iitjammu.zkfs.repository;

import com.iitjammu.zkfs.domain.FileMetadata;
import com.iitjammu.zkfs.domain.FileMetadata.UploadStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA repository for {@link FileMetadata} entities.
 */
@Repository
public interface FileMetadataRepository extends JpaRepository<FileMetadata, UUID> {

    /** Paginated list of active files belonging to a user in the root folder. */
    Page<FileMetadata> findByUserIdAndFolderIsNullAndDeletedAtIsNullOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    /** Paginated list of active files belonging to a user in a specific folder. */
    Page<FileMetadata> findByUserIdAndFolder_IdAndDeletedAtIsNullOrderByCreatedAtDesc(UUID userId, UUID folderId, Pageable pageable);

    /** All files in a specific folder (for recursive deletion). */
    List<FileMetadata> findAllByFolder_Id(UUID folderId);

    /** Paginated list of soft-deleted files belonging to a user (Trash view). */
    Page<FileMetadata> findByUserIdAndDeletedAtIsNotNullOrderByDeletedAtDesc(UUID userId, Pageable pageable);

    /** Find a specific active file ensuring it belongs to the authenticated user. */
    Optional<FileMetadata> findByIdAndUserIdAndDeletedAtIsNull(UUID fileId, UUID userId);

    /** Find a specific soft-deleted file. */
    Optional<FileMetadata> findByIdAndUserIdAndDeletedAtIsNotNull(UUID fileId, UUID userId);

    /** Count files for a user matching a specific upload status. */
    long countByUserIdAndUploadStatusAndDeletedAtIsNull(UUID userId, UploadStatus status);

    /** Sum of total_size for complete, non-deleted files of a user (storage usage). */
    @Query("SELECT COALESCE(SUM(f.totalSize), 0) FROM FileMetadata f " +
           "WHERE f.user.id = :userId AND f.uploadStatus = 'COMPLETE' AND f.deletedAt IS NULL")
    long sumTotalSizeByUserId(@Param("userId") UUID userId);
}
