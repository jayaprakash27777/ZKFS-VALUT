package com.iitjammu.zkfs.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitjammu.zkfs.dto.LoginRequest;
import com.iitjammu.zkfs.dto.RegisterRequest;
import com.iitjammu.zkfs.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for the Auth endpoints.
 * Uses H2 in-memory database (test profile) and full Spring context.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DisplayName("Auth Controller Integration Tests")
class AuthControllerIntegrationTest {

    @Autowired MockMvc       mvc;
    @Autowired ObjectMapper  objectMapper;
    @Autowired UserRepository userRepository;

    // Test fixtures — simulate client-derived Argon2id output
    private static final String TEST_EMAIL     = "alice@zkfs-test.com";
    private static final String TEST_AUTH_HASH =
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"; // 64 hex chars
    private static final String TEST_SALT      = "dGVzdHNhbHQxMjM0NTY="; // Base64("testsalt1234567")
    // Pad to 24 chars
    private static final String TEST_SALT_24   = "dGVzdHNhbHQxMjM0AAAA";  // 24 chars exact

    @BeforeEach
    void cleanDatabase() {
        userRepository.deleteAll();
    }

    // ── Registration Tests ────────────────────────────────────────────────────

    @Test
    @DisplayName("POST /register → 201 Created with tokens and user profile")
    void register_ValidRequest_Returns201() throws Exception {
        RegisterRequest request = new RegisterRequest(
                TEST_EMAIL, TEST_AUTH_HASH, TEST_SALT_24, null, null
        );

        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken",  notNullValue()))
                .andExpect(jsonPath("$.refreshToken", notNullValue()))
                .andExpect(jsonPath("$.tokenType",    is("Bearer")))
                .andExpect(jsonPath("$.expiresIn",    greaterThan(0)))
                .andExpect(jsonPath("$.user.email",   is(TEST_EMAIL)))
                .andExpect(jsonPath("$.user.salt",    is(TEST_SALT_24)))
                .andExpect(jsonPath("$.user.id",      notNullValue()));
    }

    @Test
    @DisplayName("POST /register → 409 Conflict on duplicate email")
    void register_DuplicateEmail_Returns409() throws Exception {
        RegisterRequest request = new RegisterRequest(
                TEST_EMAIL, TEST_AUTH_HASH, TEST_SALT_24, null, null
        );

        // First registration
        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());

        // Duplicate
        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status",  is(409)))
                .andExpect(jsonPath("$.error",   is("Conflict")));
    }

    @Test
    @DisplayName("POST /register → 400 Bad Request on invalid authHash format")
    void register_InvalidAuthHash_Returns400() throws Exception {
        RegisterRequest request = new RegisterRequest(
                TEST_EMAIL,
                "not-a-valid-hex-hash",  // Invalid: not 64 hex chars
                TEST_SALT_24, null, null
        );

        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status", is(400)));
    }

    // ── Login Tests ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("POST /login → 200 OK with valid credentials")
    void login_ValidCredentials_Returns200() throws Exception {
        // Register first
        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        new RegisterRequest(TEST_EMAIL, TEST_AUTH_HASH, TEST_SALT_24, "mock_wrapping_key_base64", null)
                ))).andExpect(status().isCreated());

        // Login
        mvc.perform(post("/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        new LoginRequest(TEST_EMAIL, TEST_AUTH_HASH)
                )))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken",  notNullValue()))
                .andExpect(jsonPath("$.refreshToken", notNullValue()))
                .andExpect(jsonPath("$.user.email",   is(TEST_EMAIL)));
    }

    @Test
    @DisplayName("POST /login → 401 Unauthorized with wrong authHash")
    void login_WrongAuthHash_Returns401() throws Exception {
        // Register
        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        new RegisterRequest(TEST_EMAIL, TEST_AUTH_HASH, TEST_SALT_24, "mock_wrapping_key_base64", null)
                ))).andExpect(status().isCreated());

        // Wrong hash (same format, different bytes)
        String wrongHash = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
        mvc.perform(post("/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        new LoginRequest(TEST_EMAIL, wrongHash)
                )))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message", containsString("Invalid")));
    }

    @Test
    @DisplayName("POST /login → 401 for non-existent user (same error as wrong password)")
    void login_NonExistentUser_Returns401() throws Exception {
        mvc.perform(post("/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        new LoginRequest("ghost@nowhere.com", TEST_AUTH_HASH)
                )))
                .andExpect(status().isUnauthorized());
    }

    // ── Salt Endpoint Tests ────────────────────────────────────────────────────

    @Test
    @DisplayName("GET /salt → 200 OK returns real salt for existing user")
    void getSalt_ExistingUser_ReturnsRealSalt() throws Exception {
        mvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        new RegisterRequest(TEST_EMAIL, TEST_AUTH_HASH, TEST_SALT_24, "mock_wrapping_key_base64", null)
                ))).andExpect(status().isCreated());

        mvc.perform(get("/v1/auth/salt").param("email", TEST_EMAIL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.salt", is(TEST_SALT_24)));
    }

    @Test
    @DisplayName("GET /salt → 200 OK returns fake deterministic salt for unknown user")
    void getSalt_UnknownUser_ReturnsFakeSalt() throws Exception {
        // Should not 404 — returns a fake salt to prevent enumeration
        mvc.perform(get("/v1/auth/salt").param("email", "unknown@ghost.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.salt", notNullValue()))
                .andExpect(jsonPath("$.salt", hasLength(24)));  // 16 bytes Base64 = 24 chars
    }

    // ── Protected Endpoint Tests ───────────────────────────────────────────────

    @Test
    @DisplayName("GET /auth/me → 401 without JWT token")
    void getMe_NoToken_Returns401() throws Exception {
        mvc.perform(get("/v1/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.status", is(401)));
    }

    @Test
    @DisplayName("GET /files/** → 401 without JWT token (protected route)")
    void getFiles_NoToken_Returns401() throws Exception {
        mvc.perform(get("/v1/files/"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON));
    }
}
