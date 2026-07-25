package com.iitjammu.zkfs.repository;

import com.iitjammu.zkfs.domain.FileShare;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for FileShare entities.
 *
 * <p>All queries are scoped appropriately:
 * <ul>
 *   <li>Public token lookups — by shareToken only (no user check)</li>
 *   <li>Owner operations    — filtered by file owner's email</li>
 * </ul>
 */
public interface FileShareRepository extends JpaRepository<FileShare, UUID> {

    /** Look up a share by its public token (for recipient download flow). */
    Optional<FileShare> findByShareToken(UUID shareToken);

    /**
     * List all shares created by a specific user (for the owner's share management view).
     * Joins through FileMetadata → User to verify ownership.
     */
    @Query("""
        SELECT fs FROM FileShare fs
        JOIN fs.fileMetadata fm
        JOIN fm.user u
        WHERE u.email = :email
        ORDER BY fs.createdAt DESC
    """)
    List<FileShare> findAllByOwnerEmail(@Param("email") String email);

    /**
     * Find a specific share by token AND verify it belongs to the given owner.
     * Used to prevent one user revoking another's share.
     */
    @Query("""
        SELECT fs FROM FileShare fs
        JOIN fs.fileMetadata fm
        JOIN fm.user u
        WHERE fs.shareToken = :token AND u.email = :email
    """)
    Optional<FileShare> findByTokenAndOwnerEmail(
            @Param("token") UUID token,
            @Param("email") String email);

    /**
     * Atomically increment download count for a share.
     * Uses JPQL UPDATE to avoid a read-modify-write race condition.
     */
    @Modifying
    @Query("UPDATE FileShare fs SET fs.downloadCount = fs.downloadCount + 1 WHERE fs.id = :id")
    void incrementDownloadCount(@Param("id") UUID id);

    /** Delete all shares belonging to a file (used when the file itself is deleted). */
    void deleteAllByFileMetadataId(UUID fileId);
}
