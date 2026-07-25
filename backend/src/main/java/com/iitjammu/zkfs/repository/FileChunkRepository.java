package com.iitjammu.zkfs.repository;

import com.iitjammu.zkfs.domain.FileChunk;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA repository for {@link FileChunk} entities.
 */
@Repository
public interface FileChunkRepository extends JpaRepository<FileChunk, UUID> {

    /** Retrieve all chunks for a file ordered by chunk index (for reassembly). */
    List<FileChunk> findByFileMetadataIdOrderByChunkIndexAsc(UUID fileId);

    /** Find a specific chunk by file and index (for individual download/verification). */
    Optional<FileChunk> findByFileMetadataIdAndChunkIndex(UUID fileId, int chunkIndex);

    /** Count chunks uploaded for a file (to detect complete uploads). */
    long countByFileMetadataId(UUID fileId);
}
