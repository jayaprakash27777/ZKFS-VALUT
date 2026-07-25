package com.iitjammu.zkfs.service;

import com.iitjammu.zkfs.domain.Folder;
import com.iitjammu.zkfs.domain.User;
import com.iitjammu.zkfs.dto.CreateFolderRequest;
import com.iitjammu.zkfs.dto.FolderDto;
import com.iitjammu.zkfs.repository.FolderRepository;
import com.iitjammu.zkfs.repository.UserRepository;
import com.iitjammu.zkfs.repository.FileMetadataRepository;
import com.iitjammu.zkfs.domain.FileMetadata;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class FolderService {

    private final FolderRepository folderRepository;
    private final UserRepository userRepository;
    private final FileMetadataRepository fileMetadataRepository;
    private final FileStorageService fileStorageService;

    @Transactional
    public FolderDto createFolder(CreateFolderRequest request, String email) {
        User user = resolveUser(email);
        Folder parent = null;
        if (request.parentId() != null) {
            parent = folderRepository.findByIdAndUserIdAndDeletedAtIsNull(request.parentId(), user.getId())
                    .orElseThrow(() -> new IllegalArgumentException("Parent folder not found"));
        }

        Folder folder = Folder.builder()
                .userId(user.getId())
                .parent(parent)
                .nameEncrypted(request.nameEncrypted())
                .iv(request.iv())
                .build();

        Folder saved = folderRepository.save(folder);
        return FolderDto.from(saved);
    }

    @Transactional(readOnly = true)
    public List<FolderDto> listFolders(UUID parentId, String email) {
        User user = resolveUser(email);
        List<Folder> folders;
        if (parentId == null) {
            folders = folderRepository.findAllByUserIdAndParentIdIsNullAndDeletedAtIsNull(user.getId());
        } else {
            folders = folderRepository.findAllByUserIdAndParentIdAndDeletedAtIsNull(user.getId(), parentId);
        }
        return folders.stream().map(FolderDto::from).toList();
    }

    @Transactional(readOnly = true)
    public FolderDto getFolder(UUID folderId, String email) {
        User user = resolveUser(email);
        Folder folder = folderRepository.findByIdAndUserIdAndDeletedAtIsNull(folderId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("Folder not found"));
        return FolderDto.from(folder);
    }

    @Transactional(readOnly = true)
    public List<FolderDto> listTrashFolders(String email) {
        User user = resolveUser(email);
        return folderRepository.findAllByUserIdAndDeletedAtIsNotNull(user.getId())
                .stream().map(FolderDto::from).toList();
    }

    @Transactional
    public void deleteFolder(UUID folderId, String email) {
        User user = resolveUser(email);
        Folder folder = folderRepository.findByIdAndUserIdAndDeletedAtIsNull(folderId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("Folder not found"));
        folder.setDeletedAt(java.time.OffsetDateTime.now());
        folderRepository.save(folder);
    }

    @Transactional
    public void restoreFolder(UUID folderId, String email) {
        User user = resolveUser(email);
        Folder folder = folderRepository.findByIdAndUserIdAndDeletedAtIsNotNull(folderId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("Trash Folder not found"));
        folder.setDeletedAt(null);
        folderRepository.save(folder);
    }

    @Transactional
    public void hardDeleteFolder(UUID folderId, String email) {
        User user = resolveUser(email);
        Folder folder = folderRepository.findByIdAndUserIdAndDeletedAtIsNotNull(folderId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("Trash Folder not found"));
        
        recursivelyHardDelete(folder);
    }

    private void recursivelyHardDelete(Folder folder) {
        // Hard delete all files in this folder
        List<FileMetadata> files = fileMetadataRepository.findAllByFolder_Id(folder.getId());
        for (FileMetadata file : files) {
            fileStorageService.hardDeleteFileInternal(file);
        }

        // Hard delete all subfolders
        List<Folder> subfolders = folderRepository.findAllByParentId(folder.getId());
        for (Folder sub : subfolders) {
            recursivelyHardDelete(sub);
        }

        // Delete the folder itself
        folderRepository.delete(folder);
    }

    private User resolveUser(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("User not found"));
    }
}
