package com.iitjammu.zkfs.controller;

import com.iitjammu.zkfs.dto.CreateFolderRequest;
import com.iitjammu.zkfs.dto.FolderDto;
import com.iitjammu.zkfs.service.FolderService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@Slf4j
@Validated
@RestController
@RequestMapping("/v1/folders")
@RequiredArgsConstructor
public class FolderController {

    private final FolderService folderService;

    @PostMapping
    public ResponseEntity<FolderDto> createFolder(
            @Validated @RequestBody CreateFolderRequest request,
            @AuthenticationPrincipal UserDetails principal
    ) {
        FolderDto folder = folderService.createFolder(request, principal.getUsername());
        return ResponseEntity.ok(folder);
    }

    @GetMapping
    public ResponseEntity<List<FolderDto>> listFolders(
            @RequestParam(required = false) UUID parentId,
            @RequestParam(defaultValue = "false") boolean deleted,
            @AuthenticationPrincipal UserDetails principal
    ) {
        if (deleted) {
            List<FolderDto> folders = folderService.listTrashFolders(principal.getUsername());
            return ResponseEntity.ok(folders);
        }
        List<FolderDto> folders = folderService.listFolders(parentId, principal.getUsername());
        return ResponseEntity.ok(folders);
    }

    @GetMapping("/{folderId}")
    public ResponseEntity<FolderDto> getFolder(
            @PathVariable UUID folderId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        FolderDto folder = folderService.getFolder(folderId, principal.getUsername());
        return ResponseEntity.ok(folder);
    }

    @DeleteMapping("/{folderId}")
    public ResponseEntity<Void> deleteFolder(
            @PathVariable UUID folderId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        folderService.deleteFolder(folderId, principal.getUsername());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{folderId}/restore")
    public ResponseEntity<Void> restoreFolder(
            @PathVariable UUID folderId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        folderService.restoreFolder(folderId, principal.getUsername());
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/{folderId}/force")
    public ResponseEntity<Void> hardDeleteFolder(
            @PathVariable UUID folderId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        folderService.hardDeleteFolder(folderId, principal.getUsername());
        return ResponseEntity.noContent().build();
    }
}
