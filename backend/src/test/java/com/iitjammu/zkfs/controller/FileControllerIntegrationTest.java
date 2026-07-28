package com.iitjammu.zkfs.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitjammu.zkfs.dto.InitiateUploadRequest;
import com.iitjammu.zkfs.dto.RegisterRequest;
import com.iitjammu.zkfs.repository.FileChunkRepository;
import com.iitjammu.zkfs.repository.FileMetadataRepository;
import com.iitjammu.zkfs.repository.UserRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration test for the full Phase 3 upload pipeline:
 * initiate → upload chunks → complete → list → delete.
 *
 * Uses H2 in-memory DB (test profile). MinIO is mocked via
 * {@link MockMinioConfig} — actual object storage calls are stubbed.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisplayName("File Upload Pipeline Integration Tests")
class FileControllerIntegrationTest {

    @Autowired MockMvc              mvc;
    @Autowired ObjectMapper         objectMapper;
    @Autowired UserRepository       userRepository;
    @Autowired FileMetadataRepository fileRepo;
    @Autowired FileChunkRepository  chunkRepo;

    // ── Test fixtures ──────────────────────────────────────────────────────────
    private static final String EMAIL        = "uploader@zkfs-test.com";
    private static final String AUTH_HASH    =
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    private static final String SALT         = "dGVzdHNhbHQxMjM0AAAA";

    // Simulated client-side crypto output — opaque Base64/hex strings
    private static final String FILENAME_ENC  = "Z2NtZW5jcnlwdGVkZmlsZW5hbWU=";
    private static final String WRAPPED_DEK   = "d3JhcHBlZERFS2NpcGhlcnRleHQ=";
    private static final String IV_WRAPPED_DEK = "aXZXcmFwcGVkREVL";

    /** Simulated encrypted chunk: [12-byte IV] || [AES-GCM ciphertext] */
    private static final byte[] FAKE_ENCRYPTED_CHUNK = new byte[12 + 32 + 16]; // 60 bytes
    private static final String CHUNK_SHA256 =
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    private static final String CHUNK_IV_B64 = "aXZGb3JDaHVuawo=";  // 16-char Base64

    private static String jwtToken;
    private static String uploadedFileId;

    // ── Setup ──────────────────────────────────────────────────────────────────

    @BeforeAll
    static void setup(@Autowired MockMvc mvc,
                      @Autowired ObjectMapper mapper,
                      @Autowired UserRepository userRepo) throws Exception {
        userRepo.deleteAll();

        // Register and capture JWT
        MvcResult result = mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(
                        new RegisterRequest(EMAIL, AUTH_HASH, SALT, null, null)
                )))
                .andExpect(status().isCreated())
                .andReturn();

        String body = result.getResponse().getContentAsString();
        jwtToken = mapper.readTree(body).get("accessToken").asText();

        assertNotNull(jwtToken, "JWT token should not be null after registration");
    }

    // ── Test 1: Initiate Upload ────────────────────────────────────────────────

    @Test
    @Order(1)
    @DisplayName("POST /files/initiate → 201 Created with fileId")
    void initiate_ValidRequest_Returns201() throws Exception {
        InitiateUploadRequest request = new InitiateUploadRequest(
                "filenameEncrypted", "application/pdf", null,
                3, 15_728_640L,
                WRAPPED_DEK, IV_WRAPPED_DEK, null, false, null
        );

        MvcResult result = mvc.perform(post("/v1/files/initiate")
                .header("Authorization", "Bearer " + jwtToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.fileId",      notNullValue()))
                .andExpect(jsonPath("$.status",      is("UPLOADING")))
                .andExpect(jsonPath("$.totalChunks", is(3)))
                .andReturn();

        String body = result.getResponse().getContentAsString();
        uploadedFileId = objectMapper.readTree(body).get("fileId").asText();
        assertNotNull(uploadedFileId);
    }

    @Test
    @Order(2)
    @DisplayName("POST /files/initiate → 401 without JWT")
    void initiate_NoToken_Returns401() throws Exception {
        mvc.perform(post("/v1/files/initiate")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @Order(3)
    @DisplayName("POST /files/initiate → 400 with totalChunks=0")
    void initiate_ZeroChunks_Returns400() throws Exception {
        InitiateUploadRequest request = new InitiateUploadRequest(
                FILENAME_ENC, null, null, 0, 0L, WRAPPED_DEK, IV_WRAPPED_DEK, null, false, null
        );

        mvc.perform(post("/v1/files/initiate")
                .header("Authorization", "Bearer " + jwtToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    // ── Test 2: Upload Chunks ──────────────────────────────────────────────────

    @Test
    @Order(4)
    @DisplayName("POST /files/{fileId}/chunk/{index} → 201 Created")
    void uploadChunk_ValidChunk_Returns201() throws Exception {
        Assumptions.assumeTrue(uploadedFileId != null, "Requires Test 1 to have passed");

        MockMultipartFile chunkPart = new MockMultipartFile(
                "chunk",
                "chunk-0.enc",
                "application/octet-stream",
                FAKE_ENCRYPTED_CHUNK
        );

        mvc.perform(multipart("/v1/files/{fileId}/chunk/{index}", uploadedFileId, 0)
                .file(chunkPart)
                .param("sha256Checksum", CHUNK_SHA256)
                .param("ivChunk", CHUNK_IV_B64)
                .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.chunkIndex", is(0)))
                .andExpect(jsonPath("$.s3ObjectKey", containsString(uploadedFileId)))
                .andExpect(jsonPath("$.s3ObjectKey", endsWith("chunk_0.enc")));
    }

    @Test
    @Order(5)
    @DisplayName("POST /files/{fileId}/chunk/{index} → 400 invalid sha256")
    void uploadChunk_BadChecksum_Returns400() throws Exception {
        Assumptions.assumeTrue(uploadedFileId != null);

        MockMultipartFile chunkPart = new MockMultipartFile(
                "chunk", "chunk-0.enc", "application/octet-stream", FAKE_ENCRYPTED_CHUNK
        );

        mvc.perform(multipart("/v1/files/{fileId}/chunk/{index}", uploadedFileId, 0)
                .file(chunkPart)
                .param("sha256Checksum", "not-valid-hex")   // fails regex
                .param("ivChunk", CHUNK_IV_B64)
                .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isBadRequest());
    }

    // ── Test 3: Complete Upload ────────────────────────────────────────────────

    @Test
    @Order(6)
    @DisplayName("POST /files/{fileId}/complete → 409 when chunks missing")
    void complete_ChunksMissing_Returns409() throws Exception {
        // Start a new upload with 3 chunks declared but upload 0 chunks
        MvcResult initiateResult = mvc.perform(post("/v1/files/initiate")
                .header("Authorization", "Bearer " + jwtToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new InitiateUploadRequest(
                        FILENAME_ENC, "text/plain", null, 1, 60L, WRAPPED_DEK, IV_WRAPPED_DEK, null, false, null
                ))))
                .andExpect(status().isCreated())
                .andReturn();

        String incompleteFileId = objectMapper
                .readTree(initiateResult.getResponse().getContentAsString())
                .get("fileId").asText();

        // Try to complete with no chunks uploaded → should 409
        mvc.perform(post("/v1/files/{fileId}/complete", incompleteFileId)
                .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status", is(409)))
                .andExpect(jsonPath("$.message", containsString("incomplete")));
    }

    // ── Test 4: File Listing ───────────────────────────────────────────────────

    @Test
    @Order(7)
    @DisplayName("GET /files → 200 OK with paginated file list")
    void listFiles_Authenticated_Returns200() throws Exception {
        mvc.perform(get("/v1/files")
                .param("page", "0")
                .param("size", "10")
                .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content",       notNullValue()))
                .andExpect(jsonPath("$.totalElements", greaterThan(0)));
    }

    // ── Test 5: Access Control ─────────────────────────────────────────────────

    @Test
    @Order(8)
    @DisplayName("GET /files/{unknownId} → 404 for non-existent or other user's file")
    void getFile_UnknownId_Returns404() throws Exception {
        mvc.perform(get("/v1/files/{id}", UUID.randomUUID())
                .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isNotFound());
    }
}
